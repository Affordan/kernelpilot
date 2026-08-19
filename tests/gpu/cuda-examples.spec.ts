import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'

function visualStudioEnvironmentScript(): string | undefined {
  if (process.platform !== 'win32') return undefined
  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe'
  const installation = spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8', windowsHide: true })
  const root = installation.stdout.trim()
  return installation.status === 0 && root !== '' ? path.join(root, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat') : undefined
}

const vcvars = visualStudioEnvironmentScript()
const hasNvcc = spawnSync('nvcc', ['--version'], { windowsHide: true }).status === 0
const hasGpu = spawnSync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { windowsHide: true }).status === 0
const hasHostCompiler = process.platform !== 'win32' || vcvars !== undefined || spawnSync('where.exe', ['cl.exe'], { windowsHide: true }).status === 0
const describeGpu = hasNvcc && hasGpu && hasHostCompiler ? describe : describe.skip
const outputRoots: string[] = []

afterAll(async () => { await Promise.all(outputRoots.map(root => rm(root, { recursive: true, force: true }))) })

describeGpu('CUDA examples', () => {
  for (const example of ['reduction', 'elementwise']) {
    it(`compiles and validates ${example}`, async () => {
      const outputRoot = await mkdtemp(path.join(tmpdir(), `kernelpilot-${example}-`))
      outputRoots.push(outputRoot)
      const source = path.resolve('examples', example, `${example}.cu`)
      const executable = path.join(outputRoot, `${example}.exe`)
      let compilation: ReturnType<typeof spawnSync>
      if (process.platform === 'win32' && vcvars !== undefined) {
        const wrapper = path.join(outputRoot, 'compile.cmd')
        await writeFile(wrapper, `@echo off\r\ncall "${vcvars}" >nul\r\nif errorlevel 1 exit /b 1\r\nnvcc "${source}" -O3 -arch=native -o "${executable}"\r\n`, 'utf8')
        compilation = spawnSync('cmd.exe', ['/d', '/c', wrapper], { encoding: 'utf8', windowsHide: true, timeout: 120_000 })
      } else {
        compilation = spawnSync('nvcc', [source, '-O3', '-arch=native', '-o', executable], { encoding: 'utf8', windowsHide: true, timeout: 120_000 })
      }
      expect(compilation.status, `stdout:\n${String(compilation.stdout)}\nstderr:\n${String(compilation.stderr)}\nerror:${String(compilation.error)}`).toBe(0)
      const validation = spawnSync(executable, ['--validate'], { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
      expect(validation.status, validation.stderr).toBe(0)
      const result = JSON.parse(validation.stdout) as { mismatch_count: number }
      expect(result.mismatch_count).toBe(0)
    }, 180_000)
  }
})
