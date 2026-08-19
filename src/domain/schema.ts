import { z } from 'zod'

const nonEmpty = z.string().trim().min(1)
const relativePath = nonEmpty.refine(value => !value.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(value), 'must be relative')

export const commandSchema = z.object({
  executable: nonEmpty,
  args: z.array(z.string()).default([]),
  cwd: relativePath.default('.'),
  environment: z.record(z.string(), z.string()).default({}),
})

export const optimizationTaskSchema = z.object({
  id: nonEmpty.regex(/^[a-zA-Z0-9._-]+$/),
  source: z.object({
    root: nonEmpty,
    files: z.array(relativePath).min(1),
    kernelName: nonEmpty,
  }),
  build: z.object({
    command: commandSchema,
    nvccFlags: z.array(z.string()).default([]),
    architecture: nonEmpty.default('native'),
  }),
  validation: z.object({
    command: commandSchema,
    atol: z.number().nonnegative(),
    rtol: z.number().nonnegative(),
  }),
  benchmark: z.object({
    command: commandSchema,
    warmup: z.number().int().nonnegative().default(5),
    repeat: z.number().int().positive().default(30),
    timeoutMs: z.number().int().positive().default(60_000),
    bytesPerIteration: z.number().positive().optional(),
  }),
  profile: z.object({
    executable: nonEmpty.default('ncu'),
    kernelFilter: nonEmpty.optional(),
    metrics: z.array(nonEmpty).default([]),
    timeoutMs: z.number().int().positive().default(120_000),
  }).default({ executable: 'ncu', metrics: [], timeoutMs: 120_000 }),
  objective: z.object({
    kind: z.literal('latency'),
    minimumSpeedup: z.number().gte(1).default(1.03),
    maximumVariance: z.number().nonnegative().default(0.0025),
  }),
  budget: z.object({
    maxIterations: z.number().int().positive(),
    maxCandidates: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
    candidatesPerIteration: z.number().int().min(2).max(3).default(2),
  }),
})

export const benchmarkResultSchema = z.object({
  samplesMs: z.array(z.number().positive()).min(1),
  minMs: z.number().positive(),
  medianMs: z.number().positive(),
  meanMs: z.number().positive(),
  p95Ms: z.number().positive(),
  variance: z.number().nonnegative(),
  effectiveBandwidthGbps: z.number().nonnegative().optional(),
  valid: z.boolean(),
  synthetic: z.boolean().default(false),
})

export const profilerObservationSchema = z.object({
  kernelName: nonEmpty,
  durationMs: z.number().nonnegative().optional(),
  effectiveBandwidthGbps: z.number().nonnegative().optional(),
  dramThroughputPct: z.number().nonnegative().optional(),
  l1ThroughputPct: z.number().nonnegative().optional(),
  l2ThroughputPct: z.number().nonnegative().optional(),
  occupancyPct: z.number().nonnegative().optional(),
  registersPerThread: z.number().nonnegative().optional(),
  sharedMemoryBytes: z.number().nonnegative().optional(),
  warpStalls: z.record(z.string(), z.number().nonnegative()).default({}),
  launch: z.object({
    grid: z.tuple([z.number().int().positive(), z.number().int().positive(), z.number().int().positive()]).optional(),
    block: z.tuple([z.number().int().positive(), z.number().int().positive(), z.number().int().positive()]).optional(),
  }).default({}),
  rawReportPath: nonEmpty.optional(),
  missingMetrics: z.array(z.string()).default([]),
})

export const diagnosisSchema = z.object({
  bottleneck: z.enum(['memory_bandwidth', 'latency', 'compute', 'occupancy', 'synchronization', 'unknown']),
  evidence: z.array(nonEmpty),
  suspectedCauses: z.array(nonEmpty),
  recommendedSkills: z.array(nonEmpty),
  confidence: z.number().min(0).max(1),
})

export const validationResultSchema = z.object({
  passed: z.boolean(),
  maxAbsoluteError: z.number().nonnegative(),
  maxRelativeError: z.number().nonnegative(),
  mismatchCount: z.number().int().nonnegative(),
  diagnostics: z.array(z.string()).default([]),
})

export const compileResultSchema = z.object({
  success: z.boolean(),
  executable: z.string().optional(),
  stdout: z.string(),
  stderr: z.string(),
  warnings: z.array(z.string()),
  durationMs: z.number().nonnegative(),
})

export type CommandSpec = z.infer<typeof commandSchema>
export type OptimizationTask = z.infer<typeof optimizationTaskSchema>
export type BenchmarkResult = z.infer<typeof benchmarkResultSchema>
export type ProfilerObservation = z.infer<typeof profilerObservationSchema>
export type Diagnosis = z.infer<typeof diagnosisSchema>
export type ValidationResult = z.infer<typeof validationResultSchema>
export type CompileResult = z.infer<typeof compileResultSchema>
