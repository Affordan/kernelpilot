import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export const optimizationEventTypes = [
  'optimization/task_created',
  'optimization/baseline_created',
  'optimization/profile_finished',
  'optimization/diagnosis_created',
  'optimization/candidate_created',
  'optimization/compile_finished',
  'optimization/validation_finished',
  'optimization/benchmark_finished',
  'optimization/candidate_accepted',
  'optimization/candidate_rejected',
  'optimization/task_finished',
] as const

export type OptimizationEventType = typeof optimizationEventTypes[number]

export interface OptimizationEvent<T = unknown> {
  readonly type: OptimizationEventType
  readonly seq: number
  readonly time: number
  readonly taskId: string
  readonly data: T
}

export interface EventSink {
  readonly path: string
  append<T>(type: OptimizationEventType, taskId: string, data: T): Promise<OptimizationEvent<T>>
  readAll(): Promise<OptimizationEvent[]>
}

/** Plugin-owned append-only event store used because rc.7 has no out-of-tree SessionEvent type registry. */
export class JsonlEventStore implements EventSink {
  readonly path: string
  private nextSeq = 0
  private writeChain: Promise<void> = Promise.resolve()

  constructor(filePath: string) {
    this.path = path.resolve(filePath)
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.path), { recursive: true })
    const events = await this.readAll()
    this.nextSeq = events.length
  }

  async append<T>(type: OptimizationEventType, taskId: string, data: T): Promise<OptimizationEvent<T>> {
    const event: OptimizationEvent<T> = { type, seq: this.nextSeq, time: Date.now(), taskId, data }
    this.nextSeq += 1
    const serialized = `${JSON.stringify(event)}\n`
    this.writeChain = this.writeChain.then(async () => { await appendFile(this.path, serialized, 'utf8') })
    await this.writeChain
    return event
  }

  async readAll(): Promise<OptimizationEvent[]> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error: unknown) {
      if (isMissingFile(error)) return []
      throw error
    }
    return text.split(/\r?\n/).filter(Boolean).map((line, index) => parseEvent(line, index))
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function parseEvent(line: string, expectedSeq: number): OptimizationEvent {
  const value: unknown = JSON.parse(line)
  if (typeof value !== 'object' || value === null || !('type' in value) || !('seq' in value) || !('taskId' in value)) {
    throw new Error(`invalid optimization event at line ${expectedSeq + 1}`)
  }
  const event = value as OptimizationEvent
  if (!optimizationEventTypes.includes(event.type) || event.seq !== expectedSeq || typeof event.taskId !== 'string') {
    throw new Error(`invalid optimization event at line ${expectedSeq + 1}`)
  }
  return event
}

export interface ReplayedTaskState {
  readonly taskId: string
  readonly events: readonly OptimizationEvent[]
  readonly acceptedCandidateIds: readonly string[]
  readonly rejectedCandidateIds: readonly string[]
  readonly finished: boolean
}

/** Reconstruct the auditable decision state for one task from durable events. */
export function replayTask(events: readonly OptimizationEvent[], taskId: string): ReplayedTaskState {
  const taskEvents = events.filter(event => event.taskId === taskId)
  const acceptedCandidateIds: string[] = []
  const rejectedCandidateIds: string[] = []
  for (const event of taskEvents) {
    if (event.type === 'optimization/candidate_accepted') acceptedCandidateIds.push(candidateId(event))
    if (event.type === 'optimization/candidate_rejected') rejectedCandidateIds.push(candidateId(event))
  }
  return {
    taskId,
    events: taskEvents,
    acceptedCandidateIds,
    rejectedCandidateIds,
    finished: taskEvents.some(event => event.type === 'optimization/task_finished'),
  }
}

function candidateId(event: OptimizationEvent): string {
  if (typeof event.data !== 'object' || event.data === null || !('candidateId' in event.data) || typeof event.data.candidateId !== 'string') {
    throw new Error(`${event.type} event lacks candidateId`)
  }
  return event.data.candidateId
}

