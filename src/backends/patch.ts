import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { OptimizationTask } from '../domain/schema.js'
import { resolveInside, runCommand } from './process.js'

export interface PatchResult {
  readonly success: boolean
  readonly candidateRoot: string
  readonly checkpointRoot: string
  readonly diffPath: string
  readonly diagnostics: string
}

function patchTargets(patchText: string): string[] {
  const targets = [...patchText.matchAll(/^\+\+\+\s+(?:b\/)?(.+)$/gm)].map(match => match[1]?.trim()).filter((value): value is string => value !== undefined)
  if (targets.length === 0) throw new Error('patch has no target headers')
  for (const target of targets) {
    if (target === '/dev/null' || path.isAbsolute(target) || target.split(/[\\/]/).includes('..')) {
      throw new Error(`unsafe patch target: ${target}`)
    }
  }
  return targets
}

/** Create an isolated source checkpoint and atomically discard it if git apply fails. */
export async function applySourcePatch(input: {
  readonly task: OptimizationTask
  readonly workspaceRoot: string
  readonly stateRoot: string
  readonly candidateId: string
  readonly patchText: string
  readonly signal: AbortSignal
}): Promise<PatchResult> {
  const taskRoot = resolveInside(input.workspaceRoot, input.task.source.root)
  const candidateRoot = resolveInside(input.stateRoot, path.join('candidates', input.task.id, input.candidateId))
  const checkpointRoot = resolveInside(input.stateRoot, path.join('checkpoints', input.task.id, input.candidateId))
  const diffPath = resolveInside(input.stateRoot, path.join('diffs', input.task.id, `${input.candidateId}.patch`))
  const targets = patchTargets(input.patchText)
  const allowed = new Set(input.task.source.files.map(file => path.normalize(file)))
  for (const target of targets) {
    if (!allowed.has(path.normalize(target))) throw new Error(`patch target is not declared by task: ${target}`)
  }
  await mkdir(candidateRoot, { recursive: true })
  await mkdir(checkpointRoot, { recursive: true })
  await mkdir(path.dirname(diffPath), { recursive: true })
  for (const file of input.task.source.files) {
    const source = resolveInside(taskRoot, file)
    const candidate = resolveInside(candidateRoot, file)
    const checkpoint = resolveInside(checkpointRoot, file)
    await mkdir(path.dirname(candidate), { recursive: true })
    await mkdir(path.dirname(checkpoint), { recursive: true })
    await copyFile(source, candidate)
    await copyFile(source, checkpoint)
  }
  await writeFile(diffPath, input.patchText, 'utf8')
  const command = { executable: 'git', args: ['apply', '--check', diffPath], cwd: '.', environment: {} }
  const policy = { workspaceRoot: candidateRoot, allowedExecutables: new Set(['git']) }
  const checked = await runCommand(command, 30_000, input.signal, policy)
  if (checked.exitCode !== 0) {
    await rollbackCandidate(candidateRoot, input.stateRoot)
    return { success: false, candidateRoot, checkpointRoot, diffPath, diagnostics: checked.stderr }
  }
  const applied = await runCommand({ ...command, args: ['apply', diffPath] }, 30_000, input.signal, policy)
  if (applied.exitCode !== 0) {
    await rollbackCandidate(candidateRoot, input.stateRoot)
    return { success: false, candidateRoot, checkpointRoot, diffPath, diagnostics: applied.stderr }
  }
  return { success: true, candidateRoot, checkpointRoot, diffPath, diagnostics: applied.stdout }
}

async function rollbackCandidate(candidateRoot: string, stateRoot: string): Promise<void> {
  resolveInside(stateRoot, path.relative(stateRoot, candidateRoot))
  await rm(candidateRoot, { recursive: true, force: true })
}

