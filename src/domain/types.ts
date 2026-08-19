import type { BenchmarkResult, CompileResult, Diagnosis, ProfilerObservation, ValidationResult } from './schema.js'

export interface CandidateProposal {
  readonly id: string
  readonly parentId: string
  readonly hypothesis: string
  readonly expectedEffect: string
  readonly risks: readonly string[]
  readonly selectedSkills: readonly string[]
  readonly patch: string
}

export type CandidateState = 'created' | 'compile_failed' | 'validation_failed' | 'benchmark_invalid' | 'regressed' | 'accepted' | 'rejected'

export interface OptimizationCandidate extends CandidateProposal {
  readonly compile?: CompileResult
  readonly validation?: ValidationResult
  readonly benchmark?: BenchmarkResult
  readonly profiler?: ProfilerObservation
  readonly score?: number
  readonly speedup?: number
  readonly state: CandidateState
  readonly rejectionReasons: readonly string[]
}

export interface OptimizationReport {
  readonly taskId: string
  readonly mock: boolean
  readonly baseline: BenchmarkResult
  readonly diagnosis: Diagnosis
  readonly candidates: readonly OptimizationCandidate[]
  readonly bestCandidateId: string
  readonly bestBenchmark: BenchmarkResult
  readonly speedup: number
  readonly eventLogPath: string
}

