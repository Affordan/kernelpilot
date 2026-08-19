import path from 'node:path'
import type { CandidateExecutionBackend, CandidatePlanner } from '../backends/types.js'
import type { OptimizationTask } from '../domain/schema.js'
import type { OptimizationCandidate, OptimizationReport } from '../domain/types.js'
import type { EventSink } from './events.js'
import { evaluateCandidate } from './evaluator.js'

export interface OptimizationEngineDependencies {
  readonly backend: CandidateExecutionBackend
  readonly planner: CandidatePlanner
  readonly events: EventSink
}

/** Runs bounded Best-of-N search while keeping compilation and correctness as hard gates. */
export class OptimizationEngine {
  constructor(private readonly dependencies: OptimizationEngineDependencies) {}

  async run(task: OptimizationTask, externalSignal?: AbortSignal): Promise<OptimizationReport> {
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort(new Error('optimization budget timeout')) }, task.budget.timeoutMs)
    const forwardAbort = (): void => { controller.abort(externalSignal?.reason) }
    externalSignal?.addEventListener('abort', forwardAbort, { once: true })
    try {
      return await this.execute(task, controller.signal)
    } finally {
      clearTimeout(timeout)
      externalSignal?.removeEventListener('abort', forwardAbort)
    }
  }

  private async execute(task: OptimizationTask, signal: AbortSignal): Promise<OptimizationReport> {
    const { backend, planner, events } = this.dependencies
    await events.append('optimization/task_created', task.id, { task })
    await backend.initialize(task, signal)

    const baselineCompile = await backend.compile(task, 'baseline', signal)
    if (!baselineCompile.success) throw new Error(`baseline compilation failed: ${baselineCompile.stderr}`)
    const baselineValidation = await backend.validate(task, 'baseline', signal)
    if (!baselineValidation.passed) throw new Error('baseline correctness validation failed')
    const baseline = await backend.benchmark(task, 'baseline', signal)
    if (!baseline.valid) throw new Error('baseline benchmark is invalid')
    await events.append('optimization/baseline_created', task.id, { compile: baselineCompile, validation: baselineValidation, benchmark: baseline })

    const profile = await backend.profile(task, 'baseline', signal)
    await events.append('optimization/profile_finished', task.id, { candidateId: 'baseline', profile })
    const diagnosis = await planner.diagnose(task, baseline, profile, signal)
    await events.append('optimization/diagnosis_created', task.id, { diagnosis })

    const requested = Math.min(task.budget.candidatesPerIteration, task.budget.maxCandidates)
    const proposals = await planner.propose(task, 'baseline', diagnosis, requested, signal)
    if (proposals.length < 2) throw new Error('Best-of-N search requires at least two candidate proposals')

    const candidates: OptimizationCandidate[] = []
    let bestCandidateId = 'baseline'
    let bestBenchmark = baseline
    for (const proposal of proposals.slice(0, task.budget.maxCandidates)) {
      signal.throwIfAborted()
      await events.append('optimization/candidate_created', task.id, { candidate: proposal })
      await backend.prepareCandidate(task, proposal, signal)
      const compile = await backend.compile(task, proposal.id, signal)
      await events.append('optimization/compile_finished', task.id, { candidateId: proposal.id, compile })
      if (!compile.success) {
        const candidate: OptimizationCandidate = { ...proposal, compile, state: 'compile_failed', rejectionReasons: ['compile failed'] }
        candidates.push(candidate)
        await events.append('optimization/candidate_rejected', task.id, { candidateId: proposal.id, reasons: candidate.rejectionReasons })
        continue
      }

      const validation = await backend.validate(task, proposal.id, signal)
      await events.append('optimization/validation_finished', task.id, { candidateId: proposal.id, validation })
      if (!validation.passed) {
        const candidate: OptimizationCandidate = { ...proposal, compile, validation, state: 'validation_failed', rejectionReasons: ['correctness validation failed'] }
        candidates.push(candidate)
        await events.append('optimization/candidate_rejected', task.id, { candidateId: proposal.id, reasons: candidate.rejectionReasons })
        continue
      }

      const benchmark = await backend.benchmark(task, proposal.id, signal)
      await events.append('optimization/benchmark_finished', task.id, { candidateId: proposal.id, benchmark })
      const decision = evaluateCandidate(task, { baseline: bestBenchmark, compile, validation, benchmark })
      const candidate: OptimizationCandidate = {
        ...proposal,
        compile,
        validation,
        benchmark,
        score: decision.score,
        speedup: baseline.medianMs / benchmark.medianMs,
        state: decision.accepted ? 'accepted' : 'rejected',
        rejectionReasons: decision.reasons,
      }
      candidates.push(candidate)
      if (decision.accepted) {
        bestCandidateId = proposal.id
        bestBenchmark = benchmark
        await events.append('optimization/candidate_accepted', task.id, { candidateId: proposal.id, decision })
      } else {
        await events.append('optimization/candidate_rejected', task.id, { candidateId: proposal.id, reasons: decision.reasons })
      }
    }

    const speedup = baseline.medianMs / bestBenchmark.medianMs
    await events.append('optimization/task_finished', task.id, { bestCandidateId, speedup })
    return {
      taskId: task.id,
      baseline,
      diagnosis,
      candidates,
      bestCandidateId,
      bestBenchmark,
      speedup,
      eventLogPath: path.resolve(events.path),
    }
  }
}
