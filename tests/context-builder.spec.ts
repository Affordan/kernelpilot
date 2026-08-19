import { describe, expect, it } from 'vitest'
import { buildOptimizationContext } from '../src/core/context-builder.js'
import { summarizeSamples } from '../src/core/statistics.js'
import { optimizationTaskSchema } from '../src/domain/schema.js'

const task = optimizationTaskSchema.parse({
  id: 'context', source: { root: '.', files: ['a.cu'], kernelName: 'a' }, build: { command: { executable: 'nvcc' } },
  validation: { command: { executable: 'a' }, atol: 0, rtol: 0 }, benchmark: { command: { executable: 'a' } },
  objective: { kind: 'latency' }, budget: { maxIterations: 5, maxCandidates: 10, timeoutMs: 1000 },
})

describe('buildOptimizationContext', () => {
  it('retains only the latest three attempts and remaining budget', () => {
    const attempts = Array.from({ length: 5 }, (_, index) => ({
      id: `c${index}`, parentId: 'baseline', hypothesis: `h${index}`, expectedEffect: 'faster', risks: [], selectedSkills: [], patch: '', state: 'rejected' as const, rejectionReasons: ['slow'],
    }))
    const context = buildOptimizationContext({ task, currentSource: { 'a.cu': 'code' }, bestMetrics: summarizeSamples([1]), attempts, skills: [], usedIterations: 2, usedCandidates: 5, elapsedMs: 250 })
    expect(context.recentAttempts.map(value => value.id)).toEqual(['c2', 'c3', 'c4'])
    expect(context.remainingBudget).toEqual({ iterations: 3, candidates: 5, timeoutMs: 750 })
  })
})

