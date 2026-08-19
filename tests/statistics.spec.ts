import { describe, expect, it } from 'vitest'
import { summarizeSamples } from '../src/core/statistics.js'

describe('summarizeSamples', () => {
  it('computes distribution values and bandwidth', () => {
    const result = summarizeSamples([3, 1, 2, 4], 8_000_000)
    expect(result.medianMs).toBe(2.5)
    expect(result.meanMs).toBe(2.5)
    expect(result.minMs).toBe(1)
    expect(result.p95Ms).toBe(4)
    expect(result.variance).toBe(1.25)
    expect(result.effectiveBandwidthGbps).toBe(3.2)
  })

  it('rejects invalid samples', () => {
    expect(() => summarizeSamples([])).toThrow(/non-empty/)
    expect(() => summarizeSamples([0])).toThrow(/positive/)
  })
})

