import type { Diagnosis, OptimizationTask, BenchmarkResult } from '../domain/schema.js'
import type { OptimizationCandidate } from '../domain/types.js'

export interface OptimizationContext {
  readonly objective: OptimizationTask['objective']
  readonly remainingBudget: { iterations: number; candidates: number; timeoutMs: number }
  readonly currentSource: Readonly<Record<string, string>>
  readonly bestMetrics: BenchmarkResult
  readonly diagnosis?: Diagnosis
  readonly recentAttempts: readonly Pick<OptimizationCandidate, 'id' | 'hypothesis' | 'state' | 'rejectionReasons'>[]
  readonly relevantSkills: readonly { name: string; content: string }[]
}

/** Build a bounded model context rather than replaying raw profiler and source history. */
export function buildOptimizationContext(input: {
  readonly task: OptimizationTask
  readonly currentSource: Readonly<Record<string, string>>
  readonly bestMetrics: BenchmarkResult
  readonly diagnosis?: Diagnosis
  readonly attempts: readonly OptimizationCandidate[]
  readonly skills: readonly { name: string; content: string }[]
  readonly usedIterations: number
  readonly usedCandidates: number
  readonly elapsedMs: number
}): OptimizationContext {
  const recentAttempts = input.attempts.slice(-3).map(attempt => ({
    id: attempt.id,
    hypothesis: attempt.hypothesis,
    state: attempt.state,
    rejectionReasons: attempt.rejectionReasons,
  }))
  return {
    objective: input.task.objective,
    remainingBudget: {
      iterations: Math.max(0, input.task.budget.maxIterations - input.usedIterations),
      candidates: Math.max(0, input.task.budget.maxCandidates - input.usedCandidates),
      timeoutMs: Math.max(0, input.task.budget.timeoutMs - input.elapsedMs),
    },
    currentSource: input.currentSource,
    bestMetrics: input.bestMetrics,
    ...(input.diagnosis === undefined ? {} : { diagnosis: input.diagnosis }),
    recentAttempts,
    relevantSkills: input.skills,
  }
}

