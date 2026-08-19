import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { LocalExecutionBackend } from '../../src/backends/local.js'
import { optimizationTaskSchema } from '../../src/domain/schema.js'

const hasNvcc = spawnSync('nvcc', ['--version'], { windowsHide: true }).status === 0
const hasGpu = spawnSync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { windowsHide: true }).status === 0
const hasNcu = process.platform === 'win32'
  ? spawnSync('where.exe', ['ncu.bat'], { windowsHide: true }).status === 0
  : spawnSync('ncu', ['--version'], { windowsHide: true }).status === 0
const describeGpu = hasNvcc && hasGpu ? describe : describe.skip
const outputRoots: string[] = []

afterAll(async () => { await Promise.all(outputRoots.map(root => rm(root, { recursive: true, force: true }))) })

describeGpu('LocalExecutionBackend CUDA examples', () => {
  for (const example of ['reduction', 'elementwise']) {
    it(`compiles, validates, and benchmarks ${example}`, async () => {
      const testStateParent = path.resolve('.kernelpilot', 'tests')
      await mkdir(testStateParent, { recursive: true })
      const stateRoot = await mkdtemp(path.join(testStateParent, `${example}-`))
      outputRoots.push(stateRoot)

      const taskPath = path.resolve('examples', example, 'task.json')
      const task = optimizationTaskSchema.parse(JSON.parse(await readFile(taskPath, 'utf8')))
      const backend = new LocalExecutionBackend(process.cwd(), path.relative(process.cwd(), stateRoot))
      const signal = new AbortController().signal

      await backend.initialize(task, signal)
      const compilation = await backend.compile(task, 'baseline', signal)
      expect(compilation.success, compilation.stderr || compilation.stdout).toBe(true)

      const validation = await backend.validate(task, 'baseline', signal)
      expect(validation.passed, validation.diagnostics.join('\n')).toBe(true)
      expect(validation.mismatchCount).toBe(0)

      const benchmark = await backend.benchmark(task, 'baseline', signal)
      expect(benchmark.valid).toBe(true)
      expect(benchmark.samplesMs).toHaveLength(task.benchmark.repeat)
      expect(benchmark.medianMs).toBeGreaterThan(0)

      if (hasNcu && example === 'reduction') {
        const profile = await backend.profile(task, 'baseline', signal)
        expect(profile.kernelName).toContain(task.source.kernelName)
        expect(profile.rawReportPath).toMatch(/\.ncu-rep$/)
        expect(profile.durationMs).toBeGreaterThan(0)
      }
    }, 240_000)
  }
})
