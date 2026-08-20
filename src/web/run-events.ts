import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveInside } from '../backends/process.js'

export type WebRunEventType = 'baseline' | 'candidate' | 'compile' | 'validation' | 'benchmark' | 'profile' | 'evaluation'

export interface WebRunEvent {
  readonly time: string
  readonly type: WebRunEventType
  readonly candidateId: string
  readonly data: unknown
}

export async function appendWebRunEvent(workspaceRoot: string, runId: string, type: WebRunEventType, candidateId: string, data: unknown): Promise<void> {
  if (!/^[a-f0-9-]{36}$/.test(runId)) return
  const root = resolveInside(path.resolve(workspaceRoot), '.kernelpilot/web/runs')
  await mkdir(root, { recursive: true })
  const event: WebRunEvent = { time: new Date().toISOString(), type, candidateId, data }
  await appendFile(resolveInside(root, `${runId}.events.jsonl`), `${JSON.stringify(event)}\n`, 'utf8')
}

export async function readWebRunEvents(workspaceRoot: string, runId: string): Promise<WebRunEvent[]> {
  if (!/^[a-f0-9-]{36}$/.test(runId)) return []
  const file = resolveInside(path.resolve(workspaceRoot), `.kernelpilot/web/runs/${runId}.events.jsonl`)
  let text: string
  try { text = await readFile(file, 'utf8') } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
  return text.split(/\r?\n/).filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line) as WebRunEvent] } catch { return [] }
  })
}
