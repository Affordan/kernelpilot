import { spawn } from 'node:child_process'
import path from 'node:path'
import type { CommandSpec, OptimizationTask } from '../domain/schema.js'

export interface ProcessResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
}

export interface ProcessPolicy {
  readonly workspaceRoot: string
  readonly allowedExecutables: ReadonlySet<string>
  readonly maximumOutputBytes?: number
}

/** Resolve a path and reject traversal, sibling-prefix confusion, and drive changes. */
export function resolveInside(root: string, candidate: string): string {
  const absoluteRoot = path.resolve(root)
  const absoluteCandidate = path.resolve(absoluteRoot, candidate)
  const relative = path.relative(absoluteRoot, absoluteCandidate)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`path escapes workspace: ${candidate}`)
  }
  return absoluteCandidate
}

/** Spawn one allowlisted argv command without a shell, with cooperative cancellation and output limits. */
export async function runCommand(spec: CommandSpec, timeoutMs: number, signal: AbortSignal, policy: ProcessPolicy): Promise<ProcessResult> {
  const executableName = path.basename(spec.executable).toLowerCase()
  if (!policy.allowedExecutables.has(executableName)) throw new Error(`executable is not allowlisted: ${executableName}`)
  const cwd = resolveInside(policy.workspaceRoot, spec.cwd)
  const started = performance.now()
  const outputLimit = policy.maximumOutputBytes ?? 4 * 1024 * 1024
  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(spec.executable, spec.args, {
      cwd,
      env: { ...process.env, ...spec.environment },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let settled = false
    const timer = setTimeout(() => { child.kill(); rejectOnce(new Error(`process timed out after ${timeoutMs} ms`)) }, timeoutMs)
    const abort = (): void => { child.kill(); rejectOnce(signal.reason instanceof Error ? signal.reason : new Error('process aborted')) }
    const rejectOnce = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(error)
    }
    const append = (current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> => {
      const next = Buffer.concat([current, chunk])
      if (next.length > outputLimit) {
        child.kill()
        rejectOnce(new Error(`process output exceeded ${outputLimit} bytes`))
      }
      return next
    }
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
    child.on('error', rejectOnce)
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      resolve({ exitCode: code ?? -1, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), durationMs: performance.now() - started })
    })
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

/** Validate every task-owned path before any process is started. */
export function validateTaskPaths(task: OptimizationTask, workspaceRoot: string): void {
  const sourceRoot = resolveInside(workspaceRoot, task.source.root)
  for (const file of task.source.files) resolveInside(sourceRoot, file)
  resolveInside(workspaceRoot, task.build.command.cwd)
  resolveInside(workspaceRoot, task.validation.command.cwd)
  resolveInside(workspaceRoot, task.benchmark.command.cwd)
}
