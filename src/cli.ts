import path from 'node:path'
import { MockCandidatePlanner, MockExecutionBackend } from './backends/mock.js'
import { JsonlEventStore } from './core/events.js'
import { OptimizationEngine } from './core/orchestrator.js'
import { optimizationTaskSchema } from './domain/schema.js'

async function main(): Promise<void> {
  const command = process.argv[2]
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

