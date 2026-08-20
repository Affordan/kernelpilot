import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { LocalExecutionBackend } from '../backends/local.js'
import { resolveInside, validateTaskPaths } from '../backends/process.js'
import { evaluateCandidate } from '../core/evaluator.js'
import { optimizationTaskSchema, type BenchmarkResult, type CompileResult, type OptimizationTask, type ValidationResult } from '../domain/schema.js'
import { appendWebRunEvent, type WebRunEventType } from '../web/run-events.js'

export const name = 'kernelpilot'
export const inject = ['tools', 'skills']

export interface Config {
  readonly workspaceRoot?: string
  readonly stateRoot?: string
}

const taskArgumentSchema = z.object({ task_path: z.string().min(1), candidate_id: z.string().min(1).default('baseline') })
const jsonObjectSchema = { type: 'object', additionalProperties: true } as const

/** Register KernelPilot's seven guarded tools and runtime CUDA skills on rc.7 public registries. */
export function apply(ctx: Context, config: Config = {}): void {
  const workspaceRoot = path.resolve(config.workspaceRoot ?? process.cwd())
  const stateRoot = config.stateRoot ?? '.kernelpilot'
  const backend = new LocalExecutionBackend(workspaceRoot, stateRoot)
  const webRunId = process.env.KERNELPILOT_WEB_RUN_ID
  const webEvent = async (type: WebRunEventType, candidateId: string, data: unknown): Promise<void> => {
    if (webRunId !== undefined) await appendWebRunEvent(workspaceRoot, webRunId, type, candidateId, data)
  }
  const initializedTasks = new Set<string>()
  const executions = new Map<string, { compile?: CompileResult; validation?: ValidationResult; benchmark?: BenchmarkResult }>()
  const executionFor = (task: OptimizationTask, candidateId: string) => {
    const key = `${task.id}:${candidateId}`
    const current = executions.get(key) ?? {}
    executions.set(key, current)
    return current
  }

  const taskFor = async (taskPath: string, signal: AbortSignal): Promise<OptimizationTask> => {
    const task = await loadTask(taskPath, workspaceRoot)
    if (!initializedTasks.has(task.id)) {
      await backend.initialize(task, signal)
      initializedTasks.add(task.id)
    }
    return task
  }

  registerTool(ctx, {
    name: 'prepare_baseline',
    description: 'Compile, validate, benchmark, and profile the real baseline in one bounded operation.',
    parameters: taskParameters(),
    timeoutMs: 480_000,
    output: output(),
    async execute(raw, execution) {
      const args = taskArgumentSchema.parse(raw)
      if (args.candidate_id !== 'baseline') throw new Error('prepare_baseline only accepts candidate_id "baseline"')
      const task = await taskFor(args.task_path, execution.signal)
      const recorded = executionFor(task, 'baseline')
      const compile = await backend.compile(task, 'baseline', execution.signal)
      recorded.compile = compile
      if (!compile.success) throw new Error(`baseline compilation failed: ${tail(compile.stderr || compile.stdout)}`)
      const validation = await backend.validate(task, 'baseline', execution.signal)
      recorded.validation = validation
      if (!validation.passed) throw new Error('baseline correctness validation failed')
      const benchmark = await backend.benchmark(task, 'baseline', execution.signal)
      recorded.benchmark = benchmark
      if (!benchmark.valid) throw new Error('baseline benchmark is invalid')
      const profile = await backend.profile(task, 'baseline', execution.signal)
      const result = {
        compile: { success: true, durationMs: compile.durationMs, warningCount: compile.warnings.length },
        validation,
        benchmark,
        profile,
      }
      await webEvent('baseline', 'baseline', result)
      return result
    },
  })

  registerTool(ctx, {
    name: 'compile_cuda',
    description: 'Compile one OptimizationTask CUDA candidate with the task-declared command.',
    parameters: taskParameters(),
    timeoutMs: 120_000,
    output: compileOutput(),
    async execute(raw, execution) {
      const args = taskArgumentSchema.parse(raw)
      const task = await taskFor(args.task_path, execution.signal)
      const result = await backend.compile(task, args.candidate_id, execution.signal)
      executionFor(task, args.candidate_id).compile = result
      await webEvent('compile', args.candidate_id, result)
      return result
    },
  })

  registerTool(ctx, {
    name: 'run_benchmark',
    description: 'Run warmups and repeated latency samples for one compiled candidate.',
    parameters: taskParameters(), timeoutMs: 180_000, output: output(),
    async execute(raw, execution) {
      const args = taskArgumentSchema.parse(raw)
      const task = await taskFor(args.task_path, execution.signal)
      const result = await backend.benchmark(task, args.candidate_id, execution.signal)
      executionFor(task, args.candidate_id).benchmark = result
      await webEvent('benchmark', args.candidate_id, result)
      return result
    },
  })

  registerTool(ctx, {
    name: 'validate_kernel',
    description: 'Run the task-declared CPU/golden correctness comparison for one candidate.',
    parameters: taskParameters(), timeoutMs: 120_000, output: output(),
    async execute(raw, execution) {
      const args = taskArgumentSchema.parse(raw)
      const task = await taskFor(args.task_path, execution.signal)
      const result = await backend.validate(task, args.candidate_id, execution.signal)
      executionFor(task, args.candidate_id).validation = result
      await webEvent('validation', args.candidate_id, result)
      return result
    },
  })

  registerTool(ctx, {
    name: 'profile_kernel',
    description: 'Profile one task kernel with Nsight Compute and return bounded structured metrics.',
    parameters: taskParameters(), timeoutMs: 240_000, output: output(),
    async execute(raw, execution) {
      const args = taskArgumentSchema.parse(raw)
      const task = await taskFor(args.task_path, execution.signal)
      const result = await backend.profile(task, args.candidate_id, execution.signal)
      await webEvent('profile', args.candidate_id, result)
      return result
    },
  })

  registerTool(ctx, {
    name: 'evaluate_candidate',
    description: 'Apply the correctness-first acceptance gate to actual recorded compile, validation, and benchmark results.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { task_path: { type: 'string' }, candidate_id: { type: 'string' }, baseline_id: { type: 'string' } },
      required: ['task_path', 'candidate_id'],
    },
    output: output(),
    async execute(raw, execution) {
      const args = z.object({
        task_path: z.string().min(1),
        candidate_id: z.string().min(1),
        baseline_id: z.string().min(1).default('baseline'),
      }).parse(raw)
      const task = await taskFor(args.task_path, execution.signal)
      const candidate = executions.get(`${task.id}:${args.candidate_id}`)
      const baseline = executions.get(`${task.id}:${args.baseline_id}`)
      if (candidate?.compile === undefined) throw new Error('candidate has no recorded compile result')
      if (candidate.validation === undefined) throw new Error('candidate has no recorded validation result')
      if (candidate.benchmark === undefined) throw new Error('candidate has no recorded benchmark result')
      if (baseline?.benchmark === undefined) throw new Error('baseline has no recorded benchmark result')
      const result = evaluateCandidate(task, {
        baseline: baseline.benchmark,
        compile: candidate.compile,
        validation: candidate.validation,
        benchmark: candidate.benchmark,
      })
      await webEvent('evaluation', args.candidate_id, result)
      return result
    },
  })

  registerTool(ctx, {
    name: 'apply_source_patch',
    description: 'Checkpoint declared task sources and apply a candidate unified diff inside an isolated workspace.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        task_path: { type: 'string' }, candidate_id: { type: 'string' }, patch: { type: 'string' },
        hypothesis: { type: 'string' }, expected_effect: { type: 'string' },
        risks: { type: 'array', items: { type: 'string' } }, selected_skills: { type: 'array', items: { type: 'string' } },
      },
      required: ['task_path', 'candidate_id', 'patch'],
    },
    timeoutMs: 60_000, output: output(),
    async execute(raw, execution) {
      const args = z.object({
        task_path: z.string().min(1), candidate_id: z.string().regex(/^[a-zA-Z0-9._-]+$/), patch: z.string().min(1),
        hypothesis: z.string().default('model-proposed patch'), expected_effect: z.string().default('measured by the evaluator'),
        risks: z.array(z.string()).default([]), selected_skills: z.array(z.string()).default([]),
      }).parse(raw)
      const task = await taskFor(args.task_path, execution.signal)
      await backend.prepareCandidate(task, {
        id: args.candidate_id,
        parentId: 'baseline',
        hypothesis: args.hypothesis,
        expectedEffect: args.expected_effect,
        risks: args.risks,
        selectedSkills: args.selected_skills,
        patch: args.patch,
      }, execution.signal)
      await webEvent('candidate', args.candidate_id, {
        hypothesis: args.hypothesis, expectedEffect: args.expected_effect, risks: args.risks,
        selectedSkills: args.selected_skills, patch: args.patch,
      })
      return { success: true, candidateId: args.candidate_id }
    },
  })

  for (const skill of skillDefinitions()) ctx.skills.register(skill)
}

function registerTool(ctx: Context, tool: ToolDefinition): void { ctx.tools.register(tool) }
function output(): ToolDefinition['output'] { return { schema: jsonObjectSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] } }
function compileOutput(): ToolDefinition['output'] {
  return {
    schema: jsonObjectSchema,
    render: (_args, value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [{ type: 'text', text: JSON.stringify(value) }]
      const result = value as Record<string, unknown>
      const warnings = Array.isArray(result.warnings) ? result.warnings : []
      return [{
        type: 'text',
        text: JSON.stringify({
          success: result.success,
          executable: result.executable,
          durationMs: result.durationMs,
          warningCount: warnings.length,
          stdoutTail: tail(result.stdout),
          stderrTail: tail(result.stderr),
        }, null, 2),
      }]
    },
  }
}

function tail(value: unknown): string {
  return typeof value === 'string' ? value.slice(-2000) : ''
}
function taskParameters(): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, properties: { task_path: { type: 'string' }, candidate_id: { type: 'string' } }, required: ['task_path'] }
}

async function loadTask(taskPath: string, workspaceRoot: string): Promise<OptimizationTask> {
  const absolute = resolveInside(workspaceRoot, taskPath)
  const task = optimizationTaskSchema.parse(JSON.parse(await readFile(absolute, 'utf8')))
  validateTaskPaths(task, workspaceRoot)
  return task
}

function skillDefinitions(): SkillRegistration[] {
  const definitions = [
    ['memory-coalescing', 'Diagnose and repair uncoalesced global-memory access.'],
    ['vectorized-memory-access', 'Use aligned vector loads and stores when tails and alignment are proven.'],
    ['shared-memory', 'Stage reusable data in shared memory with explicit lifetime and synchronization.'],
    ['bank-conflict', 'Identify shared-memory bank conflicts and select padding or layout changes.'],
    ['warp-shuffle', 'Replace eligible intra-warp shared-memory reductions with shuffle operations.'],
    ['reduction', 'Optimize hierarchical CUDA reductions while preserving numerical behavior.'],
    ['occupancy', 'Balance registers, shared memory, blocks, and achieved occupancy.'],
    ['fp16', 'Use half precision only under explicit accuracy and accumulation constraints.'],
    ['rmsnorm', 'Optimize RMSNorm fusion, vector access, reduction, and precision.'],
  ] as const
  return definitions.map(([skillName, description]) => ({
    name: skillName,
    description,
    source: 'bundled',
    invocation: { modelInvocable: true, userInvocable: true },
    content: `Use the packaged skills/${skillName}/SKILL.md instructions. Load this skill only when profiler evidence or the operator structure makes it relevant. State the hypothesis, expected metric change, risks, correctness checks, and benchmark checks before proposing a patch.`,
  }))
}

export default apply
