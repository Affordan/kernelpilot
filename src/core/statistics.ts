import type { BenchmarkResult } from '../domain/schema.js'

function quantile(sorted: readonly number[], probability: number): number {
  const index = Math.ceil(probability * sorted.length) - 1
  return sorted[Math.max(0, index)] ?? Number.NaN
}

/** Calculate stable descriptive statistics from positive latency samples. */
export function summarizeSamples(samplesMs: readonly number[], bytesPerIteration?: number, synthetic = false): BenchmarkResult {
  if (samplesMs.length === 0 || samplesMs.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new TypeError('benchmark samples must be non-empty, finite, and positive')
  }
  const samples = [...samplesMs]
  const sorted = [...samples].sort((left, right) => left - right)
  const meanMs = samples.reduce((sum, value) => sum + value, 0) / samples.length
  const variance = samples.reduce((sum, value) => sum + (value - meanMs) ** 2, 0) / samples.length
  const middle = Math.floor(sorted.length / 2)
  const medianMs = sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? Number.NaN)
  return {
    samplesMs: samples,
    minMs: sorted[0] ?? Number.NaN,
    medianMs,
    meanMs,
    p95Ms: quantile(sorted, 0.95),
    variance,
    ...(bytesPerIteration === undefined ? {} : { effectiveBandwidthGbps: bytesPerIteration / (medianMs * 1e6) }),
    valid: Number.isFinite(medianMs) && Number.isFinite(variance),
    synthetic,
  }
}

