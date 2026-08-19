import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CandidateExecutionBackend } from './types.js'
import type { BenchmarkResult, CommandSpec, CompileResult, OptimizationTask, ProfilerObservation, ValidationResult } from '../domain/schema.js'
import type { CandidateProposal } from '../domain/types.js'
import { summarizeSamples } from '../core/statistics.js'
import { parseNcuCsv } from '../ncu/parser.js'
import { applySourcePatch } from './patch.js'
import { resolveInside, runCommand, validateTaskPaths } from './process.js'
import { discoverMsvcEnvironment } from './windows-msvc.js'
import { resolveNcuExecutable } from './windows-ncu.js'

/** Real nvcc/validator/benchmark/NCU backend operating in isolated workspaces. */
export class LocalExecutionBackend implements CandidateExecutionBackend {
  private readonly workspaceRoot: string
  private readonly stateRoot: string
  private readonly candidateRoots = new Map<string, string>()
  private msvcEnvironment?: Promise<Readonly<Record<string, string>>>

  constructor(workspaceRoot: string, stateRoot = '.kernelpilot') {
    this.workspaceRoot = path.resolve(workspaceRoot)
    this.stateRoot = resolveInside(this.workspaceRoot, stateRoot)
  }

  async initialize(task: OptimizationTask, signal: AbortSignal): Promise<void> {
    validateTaskPaths(task, this.workspaceRoot)
    const baselineRoot = this.candidatePath(task, 'baseline')
    await this.copyTaskSources(task, baselineRoot)
    this.candidateRoots.set(this.key(task, 'baseline'), baselineRoot)
    const compiler = path.basename(task.build.command.executable).toLowerCase()
    if (process.platform === 'win32' && (compiler === 'nvcc' || compiler === 'nvcc.exe')) {
      this.msvcEnvironment = discoverMsvcEnvironment(resolveInside(this.stateRoot, 'toolchains'), signal)
      await this.msvcEnvironment
    }
  }

  async prepareCandidate(task: OptimizationTask, proposal: CandidateProposal, signal: AbortSignal): Promise<void> {
    const result = await applySourcePatch({
      task,
      workspaceRoot: this.workspaceRoot,
      stateRoot: this.stateRoot,
      candidateId: proposal.id,
      patchText: proposal.patch,
      signal,
    })
    if (!result.success) throw new Error(`candidate patch failed: ${result.diagnostics}`)
    this.candidateRoots.set(this.key(task, proposal.id), result.candidateRoot)
  }

  async compile(task: OptimizationTask, candidateId: string, signal: AbortSignal): Promise<CompileResult> {
    const root = this.root(task, candidateId)
    const environment = await this.commandEnvironment(task.build.command.environment)
    const command: CommandSpec = {
      ...task.build.command,
      args: [...task.build.command.args, ...task.build.nvccFlags],
      environment,
    }
    const result = await runCommand(command, task.benchmark.timeoutMs, signal, this.policy(root, command.executable))
    const output = outputArgument(command.args)
    return {
      success: result.exitCode === 0,
      ...(result.exitCode === 0 && output !== undefined ? { executable: resolveInside(root, path.join(command.cwd, output)) } : {}),
      stdout: result.stdout,
      stderr: result.stderr,
      warnings: result.stderr.split(/\r?\n/).filter(line => /warning/i.test(line)),
      durationMs: result.durationMs,
    }
  }

  async validate(task: OptimizationTask, candidateId: string, signal: AbortSignal): Promise<ValidationResult> {
    const root = this.root(task, candidateId)
    const result = await runCommand(task.validation.command, task.benchmark.timeoutMs, signal, this.policy(root, task.validation.command.executable))
    if (result.exitCode !== 0) throw new Error(`validation process failed: ${result.stderr || result.stdout}`)
    const value: unknown = JSON.parse(result.stdout.trim())
    if (!isValidationProtocol(value)) throw new Error('validator must print max_absolute_error, max_relative_error, and mismatch_count JSON fields')
    return {
      passed: value.max_absolute_error <= task.validation.atol
        && value.max_relative_error <= task.validation.rtol
        && value.mismatch_count === 0,
      maxAbsoluteError: value.max_absolute_error,
      maxRelativeError: value.max_relative_error,
      mismatchCount: value.mismatch_count,
      diagnostics: [],
    }
  }

  async benchmark(task: OptimizationTask, candidateId: string, signal: AbortSignal): Promise<BenchmarkResult> {
    const root = this.root(task, candidateId)
    const command = task.benchmark.command
    for (let index = 0; index < task.benchmark.warmup; index += 1) {
      await this.benchmarkSample(root, command, task.benchmark.timeoutMs, signal)
    }
    const samples: number[] = []
    for (let index = 0; index < task.benchmark.repeat; index += 1) {
      samples.push(await this.benchmarkSample(root, command, task.benchmark.timeoutMs, signal))
    }
    return summarizeSamples(samples, task.benchmark.bytesPerIteration)
  }

  async profile(task: OptimizationTask, candidateId: string, signal: AbortSignal): Promise<ProfilerObservation> {
    const root = this.root(task, candidateId)
    const profilerExecutable = await resolveNcuExecutable(task.profile.executable, this.stateRoot, signal)
    const reportRoot = resolveInside(this.stateRoot, path.join('reports', task.id))
    await mkdir(reportRoot, { recursive: true })
    const reportBase = resolveInside(reportRoot, candidateId)
    const reportPath = `${reportBase}.ncu-rep`
    const args = ['--csv', '--page', 'raw', '--export', reportBase, '--force-overwrite']
    if (task.profile.kernelFilter !== undefined) args.push('--kernel-name', task.profile.kernelFilter)
    if (task.profile.metrics.length > 0) args.push('--metrics', task.profile.metrics.join(','))
    args.push(task.benchmark.command.executable, ...task.benchmark.command.args)
    const command: CommandSpec = {
      executable: profilerExecutable,
      args,
      cwd: task.benchmark.command.cwd,
      environment: task.benchmark.command.environment,
    }
    const result = await runCommand(command, task.profile.timeoutMs, signal, this.policy(root, command.executable))
    if (result.exitCode !== 0) throw new Error(`Nsight Compute failed: ${result.stderr || result.stdout}`)
    const csv = result.stdout.length > 0 ? result.stdout : result.stderr
    const rawCsvPath = resolveInside(reportRoot, `${candidateId}.csv`)
    await writeFile(rawCsvPath, csv, 'utf8')
    return parseNcuCsv(csv, task.source.kernelName, reportPath)
  }

  private async benchmarkSample(root: string, command: CommandSpec, timeoutMs: number, signal: AbortSignal): Promise<number> {
    const result = await runCommand(command, timeoutMs, signal, this.policy(root, command.executable))
    if (result.exitCode !== 0) throw new Error(`benchmark failed: ${result.stderr || result.stdout}`)
    const value: unknown = JSON.parse(result.stdout.trim())
    if (typeof value !== 'object' || value === null || !('latency_ms' in value) || typeof value.latency_ms !== 'number' || value.latency_ms <= 0) {
      throw new Error('benchmark must print JSON with a positive latency_ms field')
    }
    return value.latency_ms
  }

  private async commandEnvironment(taskEnvironment: Readonly<Record<string, string>>): Promise<Record<string, string>> {
    const msvc = this.msvcEnvironment === undefined ? {} : await this.msvcEnvironment
    return { ...msvc, ...taskEnvironment }
  }

  private policy(root: string, executable: string) {
    return { workspaceRoot: root, allowedExecutables: new Set([path.basename(executable).toLowerCase()]) }
  }

  private root(task: OptimizationTask, candidateId: string): string {
    const root = this.candidateRoots.get(this.key(task, candidateId))
    if (root === undefined) throw new Error(`candidate workspace is not prepared: ${candidateId}`)
    return root
  }

  private key(task: OptimizationTask, candidateId: string): string { return `${task.id}:${candidateId}` }
  private candidatePath(task: OptimizationTask, candidateId: string): string {
    return resolveInside(this.stateRoot, path.join('workspaces', task.id, candidateId))
  }

  private async copyTaskSources(task: OptimizationTask, destinationRoot: string): Promise<void> {
    const sourceRoot = resolveInside(this.workspaceRoot, task.source.root)
    for (const file of task.source.files) {
      const destination = resolveInside(destinationRoot, file)
      await mkdir(path.dirname(destination), { recursive: true })
      await copyFile(resolveInside(sourceRoot, file), destination)
    }
  }
}

function outputArgument(args: readonly string[]): string | undefined {
  const index = args.findIndex(value => value === '-o')
  return index < 0 ? undefined : args[index + 1]
}

function isValidationProtocol(value: unknown): value is { max_absolute_error: number; max_relative_error: number; mismatch_count: number } {
  return typeof value === 'object' && value !== null
    && 'max_absolute_error' in value && typeof value.max_absolute_error === 'number' && value.max_absolute_error >= 0
    && 'max_relative_error' in value && typeof value.max_relative_error === 'number' && value.max_relative_error >= 0
    && 'mismatch_count' in value && typeof value.mismatch_count === 'number' && Number.isInteger(value.mismatch_count) && value.mismatch_count >= 0
}
