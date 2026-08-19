import type { OptimizationTask, BenchmarkResult, CompileResult, ValidationResult } from '../domain/schema.js'

export interface EvaluationInput {
  readonly baseline: BenchmarkResult
  readonly compile: CompileResult
  readonly validation: ValidationResult
  readonly benchmark?: BenchmarkResult
}

export interface EvaluationDecision {
  readonly accepted: boolean
  readonly score: number
  readonly speedup: number
  readonly reasons: readonly string[]
}

/** Apply correctness-first candidate acceptance with latency as the only score. */
export function evaluateCandidate(task: OptimizationTask, input: EvaluationInput): EvaluationDecision {
  const reasons: string[] = []
  if (!input.compile.success) reasons.push('compile failed')
  if (!input.validation.passed) reasons.push('correctness validation failed')
  if (input.benchmark === undefined || !input.benchmark.valid) reasons.push('benchmark invalid or missing')
  const speedup = input.benchmark?.valid === true ? input.baseline.medianMs / input.benchmark.medianMs : 0
  if (speedup < task.objective.minimumSpeedup) {
    reasons.push(`speedup ${speedup.toFixed(4)} is below ${task.objective.minimumSpeedup.toFixed(4)}`)
  }
  if (input.benchmark !== undefined && input.benchmark.variance > task.objective.maximumVariance) {
    reasons.push(`variance ${input.benchmark.variance.toFixed(6)} exceeds ${task.objective.maximumVariance.toFixed(6)}`)
  }
  const accepted = reasons.length === 0
  return { accepted, score: accepted ? speedup : 0, speedup, reasons }
}

