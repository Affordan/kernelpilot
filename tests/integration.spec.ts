import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MockCandidatePlanner, MockExecutionBackend } from '../src/backends/mock.js'
import { JsonlEventStore, replayTask } from '../src/core/events.js'
import { OptimizationEngine } from '../src/core/orchestrator.js'
import { optimizationTaskSchema } from '../src/domain/schema.js'

describe('mock optimization integration', () => {
  it('runs baseline through Best-of-N selection and durable replay', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kernelpilot-'))
    try {
      const task = optimizationTaskSchema.parse({
        id: 'integration', source: { root: '.', files: ['reduction.cu'], kernelName: 'reduce_sum' }, build: { command: { executable: 'nvcc' } },
        validation: { command: { executable: 'reduction' }, atol: 1e-5, rtol: 1e-5 }, benchmark: { command: { executable: 'reduction' }, warmup: 1, repeat: 5 },
        objective: { kind: 'latency', minimumSpeedup: 1.03, maximumVariance: 0.0025 }, budget: { maxIterations: 1, maxCandidates: 2, timeoutMs: 10_000 },
      })
      const events = new JsonlEventStore(path.join(root, 'events.jsonl'))
      await events.initialize()
      const report = await new OptimizationEngine({ backend: new MockExecutionBackend(), planner: new MockCandidatePlanner(), events }).run(task)
      expect(report.mock).toBe(true)
      expect(report.candidates).toHaveLength(2)
      expect(report.bestCandidateId).toBe('candidate-vectorized')
      expect(report.speedup).toBeGreaterThan(1.2)
      expect(replayTask(await events.readAll(), task.id).finished).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

