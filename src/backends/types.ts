import type { BenchmarkResult, CompileResult, Diagnosis, OptimizationTask, ProfilerObservation, ValidationResult } from '../domain/schema.js'
import type { CandidateProposal } from '../domain/types.js'

export interface CandidateExecutionBackend {
  initialize(task: OptimizationTask, signal: AbortSignal): Promise<void>
  prepareCandidate(task: OptimizationTask, proposal: CandidateProposal, signal: AbortSignal): Promise<void>
  compile(task: OptimizationTask, candidateId: string, signal: AbortSignal): Promise<CompileResult>
  validate(task: OptimizationTask, candidateId: string, signal: AbortSignal): Promise<ValidationResult>
  benchmark(task: OptimizationTask, candidateId: string, signal: AbortSignal): Promise<BenchmarkResult>
  profile(task: OptimizationTask, candidateId: string, signal: AbortSignal): Promise<ProfilerObservation>
}

export interface CandidatePlanner {
  diagnose(task: OptimizationTask, baseline: BenchmarkResult, profile: ProfilerObservation, signal: AbortSignal): Promise<Diagnosis>
  propose(task: OptimizationTask, parentId: string, diagnosis: Diagnosis, count: number, signal: AbortSignal): Promise<readonly CandidateProposal[]>
}
