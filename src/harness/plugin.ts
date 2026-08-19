import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { applySourcePatch } from '../backends/patch.js'
import { resolveInside, runCommand, validateTaskPaths } from '../backends/process.js'
import { summarizeSamples } from '../core/statistics.js'
import { optimizationTaskSchema, type CommandSpec, type OptimizationTask } from '../domain/schema.js'
import { parseNcuCsv } from '../ncu/parser.js'

export const name = 'kernelpilot'
export const inject = ['tools', 'skills']

export interface Config {
  readonly workspaceRoot?: string
  readonly stateRoot?: string
}

const taskArgumentSchema = z.object({ task_path: z.string().min(1), candidate_id: z.string().min(1).default('baseline') })
const jsonObjectSchema = { type: 'object', additionalProperties: true } as const

/** Register KernelPilot's five guarded tools and runtime CUDA skills on rc.7 public registries. */
export function apply(ctx: Context, config: Config = {}): void {
  const workspaceRoot = path.resolve(config.workspaceRoot ?? process.cwd())
  const stateRoot = resolveInside(workspaceRoot, config.stateRoot ?? '.kernelpilot')
  const candidateRoots = new Map<string, string>()

  registerTool(ctx, {
    name: 'compile_cuda',
    description: 'Compile one OptimizationTask CUDA candidate with the task-declared command.',
    parameters: taskParameters(),
    timeoutMs: 120_000,
    output: output(),
    async execute(raw, execution) {
      const args = taskArgumentSchema.parse(raw)
      const task = await loadTask(args.task_path, workspaceRoot)
      const root = candidateRoot(task, args.candidate_id, workspaceRoot, candidateRoots)
      const command = commandInRoot(task.build.command, task.build.nvccFlags)
      const result = await runCommand(command, task.benchmark.timeoutMs, execution.signal, policy(root, command.executable))
      return {
        success: result.exitCode === 0,
        ...(result.exitCode === 0 && findOutputArgument(command.args) !== undefined ? { executable: findOutputArgument(command.args) } : {}),
        stdout: result.stdout,
        stderr: result.stderr,
        warnings: result.stderr.split(/\r?\n/).filter(line => /warning/i.test(line)),
        durationMs: result.durationMs,
      }
    },
  })

  registerTool(ctx, {
    name: 'run_benchmark',
    description: 'Run warmups and repeated latency samples for one compiled candidate.',
    parameters: taskParameters(), timeoutMs: 180_000, output: output(),
    async execute(raw, execution) {
      const args = taskArgumentSchema.parse(raw)
      const task = await loadTask(args.task_path, workspaceRoot)
      const root = candidateRoot(task, args.candidate_id, workspaceRoot, candidateRoots)
      const command = commandInRoot(task.benchmark.command)
      for (let index = 0; index < task.benchmark.warmup; index += 1) {
        const warmup = await runCommand(command, task.benchmark.timeoutMs, execution.signal, policy(root, command.executable))
        if (warmup.exitCode !== 0) throw new Error(`benchmark warmup failed: ${warmup.stderr}`)
      }
      const samples: number[] = []
      for (let index = 0; index < task.benchmark.repeat; index += 1) {
        const sample = await runCommand(command, task.benchmark.timeoutMs, execution.signal, policy(root, command.executable))
        if (sample.exitCode !== 0) throw new Error(`benchmark failed: ${sample.stderr}`)
        samples.push(parseLatency(sample.stdout))
      }
      return summarizeSamples(samples, task.benchmark.bytesPerIteration)
    },
  })

  registerTool(ctx, {
    name: 'validate_kernel',
    description: 'Run the task-declared CPU/golden correctness comparison for one candidate.',
    parameters: taskParameters(), timeoutMs: 120_000, output: output(),
    async execute(raw, execution) {
      const args = taskArgumentSchema.parse(raw)
      const task = await loadTask(args.task_path, workspaceRoot)
      const root = candidateRoot(task, args.candidate_id, workspaceRoot, candidateRoots)
      const command = commandInRoot(task.validation.command)
      const result = await runCommand(command, task.benchmark.timeoutMs, execution.signal, policy(root, command.executable))
      if (result.exitCode !== 0) throw new Error(`validation process failed: ${result.stderr}`)
      return parseValidation(result.stdout, task)
    },
  })

  registerTool(ctx, {
    name: 'profile_kernel',
    description: 'Profile one task kernel with Nsight Compute and return bounded structured metrics.',
    parameters: taskParameters(), timeoutMs: 240_000, output: output(),
    async execute(raw, execution) {
      const args = taskArgumentSchema.parse(raw)
      const task = await loadTask(args.task_path, workspaceRoot)
      const root = candidateRoot(task, args.candidate_id, workspaceRoot, candidateRoots)
      const reportRoot = resolveInside(stateRoot, path.join('reports', task.id))
      await mkdir(reportRoot, { recursive: true })
      const reportPath = resolveInside(reportRoot, `${args.candidate_id}.ncu-rep`)
      const benchmark = commandInRoot(task.benchmark.command)
      const ncuArgs = ['--csv', '--page', 'raw', '--export', reportPath, '--force-overwrite']
      if (task.profile.kernelFilter !== undefined) ncuArgs.push('--kernel-name', task.profile.kernelFilter)
      if (task.profile.metrics.length > 0) ncuArgs.push('--metrics', task.profile.metrics.join(','))
      ncuArgs.push(benchmark.executable, ...benchmark.args)
      const command: CommandSpec = { executable: task.profile.executable, args: ncuArgs, cwd: '.', environment: benchmark.environment }
      const result = await runCommand(command, task.profile.timeoutMs, execution.signal, policy(root, command.executable))
      if (result.exitCode !== 0) throw new Error(`ncu failed: ${result.stderr}`)
      const rawCsvPath = resolveInside(reportRoot, `${args.candidate_id}.csv`)
      await writeFile(rawCsvPath, result.stdout, 'utf8')
      return parseNcuCsv(result.stdout, task.source.kernelName, reportPath)
    },
  })

  registerTool(ctx, {
    name: 'apply_source_patch',
    description: 'Checkpoint declared task sources and apply a candidate unified diff inside an isolated workspace.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { task_path: { type: 'string' }, candidate_id: { type: 'string' }, patch: { type: 'string' } },
      required: ['task_path', 'candidate_id', 'patch'],
    },
    timeoutMs: 60_000, output: output(),
    async execute(raw, execution) {
      const args = z.object({ task_path: z.string().min(1), candidate_id: z.string().regex(/^[a-zA-Z0-9._-]+$/), patch: z.string().min(1) }).parse(raw)
      const task = await loadTask(args.task_path, workspaceRoot)
      const result = await applySourcePatch({ task, workspaceRoot, stateRoot, candidateId: args.candidate_id, patchText: args.patch, signal: execution.signal })
      if (result.success) candidateRoots.set(`${task.id}:${args.candidate_id}`, result.candidateRoot)
      return result
    },
  })

  for (const skill of skillDefinitions()) ctx.skills.register(skill)
}

function registerTool(ctx: Context, tool: ToolDefinition): void { ctx.tools.register(tool) }
function output(): ToolDefinition['output'] { return { schema: jsonObjectSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] } }
function taskParameters(): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, properties: { task_path: { type: 'string' }, candidate_id: { type: 'string' } }, required: ['task_path'] }
}

async function loadTask(taskPath: string, workspaceRoot: string): Promise<OptimizationTask> {
  const absolute = resolveInside(workspaceRoot, taskPath)
  const task = optimizationTaskSchema.parse(JSON.parse(await readFile(absolute, 'utf8')))
  validateTaskPaths(task, workspaceRoot)
  return task
}

function candidateRoot(task: OptimizationTask, candidateId: string, workspaceRoot: string, roots: ReadonlyMap<string, string>): string {
  return roots.get(`${task.id}:${candidateId}`) ?? resolveInside(workspaceRoot, task.source.root)
}

function commandInRoot(command: CommandSpec, extraArgs: readonly string[] = []): CommandSpec {
  return { ...command, cwd: '.', args: [...command.args, ...extraArgs] }
}

function policy(root: string, executable: string) {
  return { workspaceRoot: root, allowedExecutables: new Set([path.basename(executable).toLowerCase(), 'ncu', 'ncu.exe']) }
}

function parseLatency(stdout: string): number {
  const value: unknown = JSON.parse(stdout.trim())
  if (typeof value !== 'object' || value === null || !('latency_ms' in value) || typeof value.latency_ms !== 'number' || value.latency_ms <= 0) {
    throw new Error('benchmark must print JSON with a positive latency_ms number')
  }
  return value.latency_ms
}

function parseValidation(stdout: string, task: OptimizationTask): Record<string, unknown> {
  const value: unknown = JSON.parse(stdout.trim())
  const schema = z.object({ max_absolute_error: z.number().nonnegative(), max_relative_error: z.number().nonnegative(), mismatch_count: z.number().int().nonnegative() })
  const parsed = schema.parse(value)
  return {
    passed: parsed.max_absolute_error <= task.validation.atol && parsed.max_relative_error <= task.validation.rtol && parsed.mismatch_count === 0,
    maxAbsoluteError: parsed.max_absolute_error,
    maxRelativeError: parsed.max_relative_error,
    mismatchCount: parsed.mismatch_count,
    diagnostics: [],
  }
}

function findOutputArgument(args: readonly string[]): string | undefined {
  const index = args.findIndex(value => value === '-o')
  return index < 0 ? undefined : args[index + 1]
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
