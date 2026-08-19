import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { LocalExecutionBackend } from './backends/local.js'
import { MockCandidatePlanner, MockExecutionBackend } from './backends/mock.js'
import { JsonlEventStore } from './core/events.js'
import { OptimizationEngine } from './core/orchestrator.js'
import { optimizationTaskSchema } from './domain/schema.js'

async function main(): Promise<void> {
  const command = process.argv[2]
  if (command === 'baseline') {
    const taskPath = process.argv[3]
    if (taskPath === undefined) throw new Error('usage: kernelpilot baseline <task.json>')
    const task = optimizationTaskSchema.parse(JSON.parse(await readFile(path.resolve(taskPath), 'utf8')))
    const backend = new LocalExecutionBackend(process.cwd())
    const signal = new AbortController().signal
    await backend.initialize(task, signal)
    const compile = await backend.compile(task, 'baseline', signal)
    if (!compile.success) throw new Error(`baseline compilation failed:\n${compile.stderr || compile.stdout}`)
    const validation = await backend.validate(task, 'baseline', signal)
    if (!validation.passed) throw new Error(`baseline correctness failed: ${JSON.stringify(validation)}`)
    const benchmark = await backend.benchmark(task, 'baseline', signal)
    process.stdout.write(`${JSON.stringify({
      taskId: task.id,
      compile: {
        success: compile.success,
        executable: compile.executable,
        durationMs: compile.durationMs,
        warningCount: compile.warnings.length,
      },
      validation,
      benchmark,
    }, null, 2)}\n`)
    return
  }
  if (command !== 'demo-mock') throw new Error('usage: kernelpilot demo-mock')
  const task = optimizationTaskSchema.parse({
    id: 'reduction-mock-demo',
    source: { root: 'examples/reduction', files: ['reduction.cu'], kernelName: 'reduce_sum' },
    build: { command: { executable: 'nvcc', args: [] }, nvccFlags: [], architecture: 'native' },
    validation: { command: { executable: './reduction' }, atol: 1e-5, rtol: 1e-5 },
    benchmark: { command: { executable: './reduction' }, warmup: 3, repeat: 5, timeoutMs: 30_000 },
    objective: { kind: 'latency', minimumSpeedup: 1.03, maximumVariance: 0.0025 },
    budget: { maxIterations: 1, maxCandidates: 2, candidatesPerIteration: 2, timeoutMs: 30_000 },
  })
  const store = new JsonlEventStore(path.join('.kernelpilot', 'sessions', `${task.id}.jsonl`))
  await store.initialize()
  const engine = new OptimizationEngine({ backend: new MockExecutionBackend(), planner: new MockCandidatePlanner(), events: store })
  const report = await engine.run(task)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

await main()
