import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { LocalExecutionBackend } from './backends/local.js'
import { optimizationTaskSchema } from './domain/schema.js'

async function main(): Promise<void> {
  const command = process.argv[2]
  if (command !== 'baseline') throw new Error('usage: kernelpilot baseline <task.json>')
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
}

await main()
