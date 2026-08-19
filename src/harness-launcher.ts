import { spawn } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { optimizationTaskSchema } from './domain/schema.js'

async function main(): Promise<void> {
  const taskArgument = process.argv[2]
  if (taskArgument === undefined) throw new Error('usage: kernelpilot-optimize <task.json>')
  const taskPath = path.resolve(taskArgument)
  await access(taskPath)
  const task = optimizationTaskSchema.parse(JSON.parse(await readFile(taskPath, 'utf8')))
  const workspaceRoot = process.cwd()
  const relativeTask = path.relative(workspaceRoot, taskPath).replaceAll('\\', '/')
  if (relativeTask.startsWith('../') || path.isAbsolute(relativeTask)) throw new Error('task file must be inside the current workspace')
  loadProjectEnvironment(workspaceRoot)
  const launchRoot = path.join(workspaceRoot, '.kernelpilot', 'launch')
  await mkdir(launchRoot, { recursive: true })
  const patchPath = path.join(launchRoot, 'kernelpilot.patch.yml')
  await writeLaunchPatch(patchPath, workspaceRoot)
  const sources = await sourceContext(workspaceRoot, task.source.root, task.source.files)
  const require = createRequire(import.meta.url)
  const dshPackage = require.resolve('@deepseek-ai/dsh/package.json')
  const dshBin = path.join(path.dirname(dshPackage), 'lib', 'bin.js')
  const prompt = optimizationPrompt(relativeTask, task.id, task.budget.candidatesPerIteration, workspaceRoot, sources)
  const child = spawn(process.execPath, [dshBin, '--profile', 'headless', '--patch', patchPath, prompt], {
    cwd: launchRoot,
    env: process.env,
    shell: false,
    windowsHide: true,
    stdio: 'inherit',
  })
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => { resolve(code ?? 1) })
  })
  if (exitCode !== 0) throw new Error(`DeepSeek Harness exited with code ${exitCode}`)
}

function loadProjectEnvironment(workspaceRoot: string): void {
  try {
    process.loadEnvFile(path.join(workspaceRoot, '.env'))
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
}

async function writeLaunchPatch(patchPath: string, workspaceRoot: string): Promise<void> {
  const pluginPath = path.join(workspaceRoot, 'dist', 'harness', 'plugin.js')
  await access(pluginPath)
  const patch = [{
    insert: [{
      id: 'kernelpilot',
      name: pathToFileURL(pluginPath).href,
      inject: ['tools', 'skills'],
      config: { workspaceRoot, stateRoot: '.kernelpilot' },
    }],
  }]
  await writeFile(patchPath, `${JSON.stringify(patch, null, 2)}\n`, 'utf8')
}

async function sourceContext(workspaceRoot: string, sourceRoot: string, files: readonly string[]): Promise<string> {
  const sections: string[] = []
  for (const file of files) {
    const absolute = path.resolve(workspaceRoot, sourceRoot, file)
    const relative = path.relative(workspaceRoot, absolute)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`source file escapes workspace: ${file}`)
    sections.push(`--- ${file} ---\n${await readFile(absolute, 'utf8')}`)
  }
  return sections.join('\n\n')
}

function optimizationPrompt(taskPath: string, taskId: string, candidateCount: number, workspaceRoot: string, sources: string): string {
  return `Run KernelPilot optimization task ${taskId} from ${taskPath} in workspace ${workspaceRoot}.

Follow this execution protocol exactly:
You have a strict budget of 16 parent tool calls. Do not retry the same failed operation more than once.
1. Read the task and declared CUDA source. Compile, validate, benchmark, and profile candidate_id "baseline" with KernelPilot tools.
2. Use the profiler evidence and load only relevant CUDA skills.
3. Ask ${candidateCount} independent subagents for different optimization hypotheses. Each must return a hypothesis, expected metric effect, risks, selected skills, and a unified diff touching only task-declared source files.
4. For each proposal, call apply_source_patch with a unique candidate_id, then compile_cuda and validate_kernel. Run run_benchmark only after both succeed.
5. Call evaluate_candidate for every fully measured candidate. Never infer acceptance or speedup yourself; the evaluator result is authoritative.
6. Report baseline samples, profiler evidence, every candidate and rejection reason, the accepted best candidate if any, measured speedup, and final diff. Clearly state that all numbers came from this machine.

Do not edit the original source tree directly. Do not fabricate metrics or continue after the task budget is exhausted.`
  + `\n\nDeclared source snapshot:\n${sources}`
}

await main()
