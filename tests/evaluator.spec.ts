import { describe, expect, it } from 'vitest'
import { evaluateCandidate } from '../src/core/evaluator.js'
import { optimizationTaskSchema } from '../src/domain/schema.js'
import { summarizeSamples } from '../src/core/statistics.js'

const task = optimizationTaskSchema.parse({
  id: 'test', source: { root: '.', files: ['kernel.cu'], kernelName: 'kernel' },
  build: { command: { executable: 'nvcc' } },
  validation: { command: { executable: './kernel' }, atol: 1e-5, rtol: 1e-5 },
  benchmark: { command: { executable: './kernel' } },
  objective: { kind: 'latency', minimumSpeedup: 1.03, maximumVariance: 0.01 },
  budget: { maxIterations: 1, maxCandidates: 2, timeoutMs: 10_000 },
})

describe('evaluateCandidate', () => {
  it('accepts only a valid, correct, stable speedup', () => {
    const decision = evaluateCandidate(task, {
      baseline: summarizeSamples([1, 1, 1]),
      compile: { success: true, stdout: '', stderr: '', warnings: [], durationMs: 1 },
      validation: { passed: true, maxAbsoluteError: 0, maxRelativeError: 0, mismatchCount: 0, diagnostics: [] },
      benchmark: summarizeSamples([0.8, 0.8, 0.8]),
    })
    expect(decision.accepted).toBe(true)
    expect(decision.speedup).toBe(1.25)
  })

  it('keeps correctness as a hard gate', () => {
    const decision = evaluateCandidate(task, {
      baseline: summarizeSamples([1]),
      compile: { success: true, stdout: '', stderr: '', warnings: [], durationMs: 1 },
      validation: { passed: false, maxAbsoluteError: 1, maxRelativeError: 1, mismatchCount: 1, diagnostics: [] },
      benchmark: summarizeSamples([0.1]),
    })
    expect(decision.accepted).toBe(false)
    expect(decision.reasons).toContain('correctness validation failed')
  })
})

