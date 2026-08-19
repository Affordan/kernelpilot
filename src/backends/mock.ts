import type { CandidateExecutionBackend, CandidatePlanner } from './types.js'
import type { BenchmarkResult, CompileResult, Diagnosis, OptimizationTask, ProfilerObservation, ValidationResult } from '../domain/schema.js'
import type { CandidateProposal } from '../domain/types.js'
import { summarizeSamples } from '../core/statistics.js'

const latencyByCandidate: Readonly<Record<string, readonly number[]>> = {
  baseline: [0.236, 0.235, 0.237, 0.236, 0.235],
  'candidate-vectorized': [0.188, 0.187, 0.189, 0.188, 0.188],
  'candidate-warp': [0.201, 0.202, 0.200, 0.201, 0.201],
}

/** Deterministic CI backend; every emitted performance number is marked synthetic. */
export class MockExecutionBackend implements CandidateExecutionBackend {
  readonly synthetic = true

  async initialize(_task: OptimizationTask, _signal: AbortSignal): Promise<void> {}
  async prepareCandidate(_task: OptimizationTask, _proposal: CandidateProposal, _signal: AbortSignal): Promise<void> {}

  async compile(_task: OptimizationTask, candidateId: string, _signal: AbortSignal): Promise<CompileResult> {
    return {
      success: candidateId !== 'candidate-broken',
      executable: `mock://${candidateId}`,
      stdout: 'mock compiler completed',
      stderr: '',
      warnings: [],
      durationMs: 1,
    }
  }

  async validate(_task: OptimizationTask, candidateId: string, _signal: AbortSignal): Promise<ValidationResult> {
    const passed = candidateId !== 'candidate-broken'
    return { passed, maxAbsoluteError: passed ? 0 : 1, maxRelativeError: passed ? 0 : 1, mismatchCount: passed ? 0 : 1, diagnostics: ['mock validation'] }
  }

  async benchmark(task: OptimizationTask, candidateId: string, _signal: AbortSignal): Promise<BenchmarkResult> {
    const samples = latencyByCandidate[candidateId] ?? [0.250, 0.251, 0.249]
    return summarizeSamples(samples, task.benchmark.bytesPerIteration, true)
  }

  async profile(task: OptimizationTask, _candidateId: string, _signal: AbortSignal): Promise<ProfilerObservation> {
    return {
      kernelName: task.source.kernelName,
      durationMs: 0.236,
      dramThroughputPct: 81.2,
      occupancyPct: 62.5,
      registersPerThread: 32,
      sharedMemoryBytes: 4096,
      warpStalls: { long_scoreboard: 38.4 },
      launch: { block: [256, 1, 1], grid: [256, 1, 1] },
      rawReportPath: 'mock://fixture.ncu-rep',
      missingMetrics: ['l1ThroughputPct', 'l2ThroughputPct'],
    }
  }
}

/** Deterministic planner proving the Best-of-N search path without an API key. */
export class MockCandidatePlanner implements CandidatePlanner {
  async diagnose(_task: OptimizationTask, _baseline: BenchmarkResult, _profile: ProfilerObservation, _signal: AbortSignal): Promise<Diagnosis> {
    return {
      bottleneck: 'memory_bandwidth',
      evidence: ['DRAM throughput is 81.2% of peak', 'long scoreboard stalls are 38.4%'],
      suspectedCauses: ['scalar global loads', 'block-wide reduction synchronization'],
      recommendedSkills: ['vectorized-memory-access', 'warp-shuffle', 'reduction'],
      confidence: 0.87,
    }
  }

  async propose(_task: OptimizationTask, parentId: string, _diagnosis: Diagnosis, count: number, _signal: AbortSignal): Promise<readonly CandidateProposal[]> {
    const proposals: CandidateProposal[] = [
      {
        id: 'candidate-vectorized', parentId, hypothesis: 'replace aligned scalar loads with float4 loads',
        expectedEffect: 'fewer global-memory transactions', risks: ['pointer and tail alignment'],
        selectedSkills: ['vectorized-memory-access'], patch: '--- a/kernel.cu\n+++ b/kernel.cu\n@@ mock @@\n-scalar\n+float4\n',
      },
      {
        id: 'candidate-warp', parentId, hypothesis: 'use warp shuffle for the final reduction',
        expectedEffect: 'fewer barriers and shared-memory round trips', risks: ['active mask handling'],
        selectedSkills: ['warp-shuffle', 'reduction'], patch: '--- a/kernel.cu\n+++ b/kernel.cu\n@@ mock @@\n-shared final\n+warp shuffle\n',
      },
    ]
    return proposals.slice(0, count)
  }
}
