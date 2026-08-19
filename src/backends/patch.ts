import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { OptimizationTask } from '../domain/schema.js'
import { resolveInside } from './process.js'

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
  const patchText = normalizePatchHunkCounts(input.patchText)
  const targets = patchTargets(patchText)
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
  await writeFile(diffPath, patchText, 'utf8')
  try {
    for (const target of targets) {
      input.signal.throwIfAborted()
      const candidate = resolveInside(candidateRoot, target)
      const source = await readFile(candidate, 'utf8')
      await writeFile(candidate, applyUnifiedDiffToText(source, patchText, target), 'utf8')
    }
  } catch (error: unknown) {
    await rollbackCandidate(candidateRoot, input.stateRoot)
    return { success: false, candidateRoot, checkpointRoot, diffPath, diagnostics: error instanceof Error ? error.message : String(error) }
  }
  return { success: true, candidateRoot, checkpointRoot, diffPath, diagnostics: '' }
}

/** Recalculate model-authored unified-diff hunk counts without changing paths or content. */
export function normalizePatchHunkCounts(patchText: string): string {
  const lines = patchText.replaceAll('\r\n', '\n').split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index]?.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/)
    if (header === null || header === undefined) continue
    let oldCount = 0
    let newCount = 0
    let cursor = index + 1
    while (cursor < lines.length) {
      const line = lines[cursor] ?? ''
      if (line.startsWith('@@ ') || line.startsWith('diff --git ') || (line.startsWith('--- ') && lines[cursor + 1]?.startsWith('+++ '))) break
      if (line.startsWith(' ') || line.startsWith('-')) oldCount += 1
      if (line.startsWith(' ') || line.startsWith('+')) newCount += 1
      cursor += 1
    }
    lines[index] = `@@ -${header[1]},${oldCount} +${header[2]},${newCount} @@${header[3] ?? ''}`
    index = cursor - 1
  }
  return lines.join('\n')
}

interface ParsedHunk {
  readonly oldStart: number
  readonly lines: readonly string[]
}

/** Apply one target's hunks only when their complete old context matches uniquely. */
export function applyUnifiedDiffToText(sourceText: string, patchText: string, target: string): string {
  const normalizedTarget = path.normalize(target)
  const lines = patchText.replaceAll('\r\n', '\n').split('\n')
  const hunks: ParsedHunk[] = []
  let selected = false
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.startsWith('+++ ')) {
      const candidate = lines[index]?.slice(4).replace(/^b\//, '').trim()
      selected = candidate !== undefined && path.normalize(candidate) === normalizedTarget
      continue
    }
    if (!selected) continue
    const header = lines[index]?.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/)
    if (header === null || header === undefined) continue
    const body: string[] = []
    let cursor = index + 1
    while (cursor < lines.length) {
      const line = lines[cursor] ?? ''
      if (line.startsWith('@@ ') || line.startsWith('diff --git ') || line.startsWith('--- ')) break
      if (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-') || line.startsWith('\\ No newline')) body.push(line)
      cursor += 1
    }
    hunks.push({ oldStart: Number(header[1]), lines: body })
    index = cursor - 1
  }
  if (hunks.length === 0) throw new Error(`patch contains no hunks for ${target}`)

  const newline = sourceText.includes('\r\n') ? '\r\n' : '\n'
  const sourceEndsWithNewline = sourceText.endsWith('\n')
  const sourceLines = sourceText.replaceAll('\r\n', '\n').split('\n')
  if (sourceEndsWithNewline) sourceLines.pop()
  let delta = 0
  let minimumPosition = 0
  for (const hunk of hunks) {
    const oldLines = hunk.lines.filter(line => line.startsWith(' ') || line.startsWith('-')).map(line => line.slice(1))
    const newLines = hunk.lines.filter(line => line.startsWith(' ') || line.startsWith('+')).map(line => line.slice(1))
    const expected = Math.max(minimumPosition, hunk.oldStart - 1 + delta)
    const position = locateOldContext(sourceLines, oldLines, expected, minimumPosition)
    sourceLines.splice(position, oldLines.length, ...newLines)
    delta += newLines.length - oldLines.length
    minimumPosition = position + newLines.length
  }
  return `${sourceLines.join(newline)}${sourceEndsWithNewline ? newline : ''}`
}

function locateOldContext(source: readonly string[], oldLines: readonly string[], expected: number, minimum: number): number {
  if (matchesAt(source, oldLines, expected)) return expected
  const matches: number[] = []
  for (let index = minimum; index <= source.length - oldLines.length; index += 1) {
    if (matchesAt(source, oldLines, index)) matches.push(index)
  }
  if (matches.length !== 1) throw new Error(`patch context matched ${matches.length} locations; expected exactly one`)
  return matches[0] ?? -1
}

function matchesAt(source: readonly string[], expected: readonly string[], index: number): boolean {
  return index >= 0 && expected.every((line, offset) => source[index + offset] === line)
}

async function rollbackCandidate(candidateRoot: string, stateRoot: string): Promise<void> {
  resolveInside(stateRoot, path.relative(stateRoot, candidateRoot))
  await rm(candidateRoot, { recursive: true, force: true })
}
