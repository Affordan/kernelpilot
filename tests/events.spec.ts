import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JsonlEventStore, replayTask } from '../src/core/events.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('JsonlEventStore', () => {
  it('serializes and replays candidate decisions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kernelpilot-'))
    roots.push(root)
    const store = new JsonlEventStore(path.join(root, 'events.jsonl'))
    await store.initialize()
    await store.append('optimization/task_created', 'task', {})
    await store.append('optimization/candidate_accepted', 'task', { candidateId: 'c1' })
    await store.append('optimization/task_finished', 'task', {})
    const replayed = replayTask(await store.readAll(), 'task')
    expect(replayed.acceptedCandidateIds).toEqual(['c1'])
    expect(replayed.finished).toBe(true)
  })
})

