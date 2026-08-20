import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { optimizationTaskSchema, type OptimizationTask } from '../domain/schema.js'
import { resolveInside, validateTaskPaths } from '../backends/process.js'
import { resolveNcuExecutable } from '../backends/windows-ncu.js'
import { appendWebRunEvent, readWebRunEvents, type WebRunEvent } from './run-events.js'

const builtInTasks = [
  { key: 'reduction', name: 'Reduction FP32', taskPath: 'examples/reduction/task.json' },
  { key: 'elementwise', name: 'Elementwise SAXPY FP32', taskPath: 'examples/elementwise/task.json' },
] as const

type RunMode = 'baseline' | 'optimize'
type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

interface RegisteredTask {
  readonly key: string
  readonly name: string
  readonly taskPath: string
  readonly builtIn: boolean
  readonly task: OptimizationTask
}

interface RunRecord {
  readonly id: string
  readonly task: string
  readonly taskName: string
  readonly taskPath: string
  readonly mode: RunMode
  status: RunStatus
  readonly startedAt: string
  endedAt?: string
  exitCode?: number
  logCount: number
  result?: unknown
}

interface ActiveRun {
  readonly record: RunRecord
  readonly process: ChildProcessWithoutNullStreams
  readonly clients: Set<ServerResponse>
  persistence: Promise<void>
}

interface RunIndex {
  readonly version: 1
  readonly runs: RunRecord[]
}

const webSettingsSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']),
  logWrap: z.boolean(),
  autoScroll: z.boolean(),
  retention: z.number().int().min(20).max(500),
})
type WebSettings = z.infer<typeof webSettingsSchema>

export interface KernelPilotWebOptions {
  readonly workspaceRoot: string
  readonly publicRoot?: string
  readonly stateRoot?: string
  readonly retention?: number
  readonly launchRun?: (mode: RunMode, taskPath: string, runId: string) => ChildProcessWithoutNullStreams
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export function createKernelPilotWebServer(options: KernelPilotWebOptions): Server {
  const workspaceRoot = path.resolve(options.workspaceRoot)
  const publicRoot = path.resolve(options.publicRoot ?? path.join(workspaceRoot, 'web', 'dist'))
  const stateRoot = resolveInside(workspaceRoot, options.stateRoot ?? '.kernelpilot/web')
  const taskRoot = resolveInside(stateRoot, 'tasks')
  const runRoot = resolveInside(stateRoot, 'runs')
  const indexPath = resolveInside(stateRoot, 'runs.json')
  const settingsPath = resolveInside(stateRoot, 'settings.json')
  let settings: WebSettings = { theme: 'dark', logWrap: true, autoScroll: true, retention: Math.max(20, Math.min(500, options.retention ?? 100)) }
  const tasks = new Map<string, RegisteredTask>()
  const runs: RunRecord[] = []
  let active: ActiveRun | undefined
  let persistChain = Promise.resolve()

  const launchRun = options.launchRun ?? ((mode, taskPath, runId) => {
    const script = mode === 'baseline' ? 'cli.js' : 'harness-launcher.js'
    const args = mode === 'baseline' ? ['baseline', taskPath] : [taskPath]
    const child = spawn(process.execPath, [path.join(workspaceRoot, 'dist', script), ...args], {
      cwd: workspaceRoot,
      env: { ...process.env, KERNELPILOT_WEB_RUN_ID: runId },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdin.end()
    return child
  })

  const ready = initialize()
  const server = createServer((request, response) => {
    void ready.then(async () => await route(request, response)).catch((error: unknown) => {
      if (!response.headersSent) {
        const status = error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : 500
        sendJson(response, status, { error: error instanceof Error ? error.message : String(error) })
      } else response.end()
    })
  })
  return server

  async function initialize(): Promise<void> {
    await Promise.all([mkdir(taskRoot, { recursive: true }), mkdir(runRoot, { recursive: true })])
    try { settings = webSettingsSchema.parse(JSON.parse(await readFile(settingsPath, 'utf8')) as unknown) } catch (error: unknown) { if (!isMissing(error) && !(error instanceof z.ZodError)) throw error }
    for (const definition of builtInTasks) {
      const task = await readTask(resolveInside(workspaceRoot, definition.taskPath))
      tasks.set(definition.key, { ...definition, builtIn: true, task })
    }
    for (const file of await readdir(taskRoot)) {
      if (!file.endsWith('.json')) continue
      try {
        const taskPath = resolveInside(taskRoot, file)
        const task = await readTask(taskPath)
        validateImportedTask(task, workspaceRoot)
        const key = customTaskKey(task.id)
        tasks.set(key, { key, name: task.id, taskPath: workspaceRelative(workspaceRoot, taskPath), builtIn: false, task })
      } catch { /* 忽略损坏的自定义任务文件，避免阻塞控制台启动 */ }
    }
    try {
      const stored = JSON.parse(await readFile(indexPath, 'utf8')) as unknown
      if (isRunIndex(stored)) runs.push(...stored.runs)
    } catch (error: unknown) {
      if (!isMissing(error)) throw error
    }
    let changed = false
    for (const run of runs) {
      if (run.status === 'running') {
        run.status = 'interrupted'
        run.endedAt = new Date().toISOString()
        changed = true
      }
    }
    if (changed) await persistRuns()
  }

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/api/overview') {
      const completed = runs.filter(run => run.status === 'completed')
      sendJson(response, 200, {
        activeRun: active === undefined ? null : publicRun(active.record),
        taskCount: tasks.size,
        runCount: runs.length,
        successRate: runs.length === 0 ? null : completed.length / runs.length,
        bestSpeedup: bestSpeedup(runs),
        recentRuns: runs.slice(0, 5).map(publicRun),
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/system') {
      sendJson(response, 200, await systemSnapshot(workspaceRoot, stateRoot))
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/settings') {
      sendJson(response, 200, settings)
      return
    }
    if (request.method === 'PUT' && url.pathname === '/api/settings') {
      assertWriteRequest(request, true)
      settings = webSettingsSchema.parse(await readJson(request, 16 * 1024))
      await writeJsonAtomic(settingsPath, settings)
      await trimRuns()
      await persistRunsQueued()
      sendJson(response, 200, settings)
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/tasks') {
      sendJson(response, 200, [...tasks.values()].map(publicTask))
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/tasks') {
      assertWriteRequest(request, true)
      const input = await readJson(request, 64 * 1024)
      const task = optimizationTaskSchema.parse(input.task)
      validateImportedTask(task, workspaceRoot)
      const key = customTaskKey(task.id)
      if (tasks.has(key)) throw new HttpError(409, '任务 ID 已存在')
      const taskPath = resolveInside(taskRoot, `${task.id}.json`)
      await writeJsonAtomic(taskPath, task)
      const record: RegisteredTask = { key, name: task.id, taskPath: workspaceRelative(workspaceRoot, taskPath), builtIn: false, task }
      tasks.set(key, record)
      sendJson(response, 201, publicTask(record))
      return
    }
    const taskMatch = url.pathname.match(/^\/api\/tasks\/([a-zA-Z0-9._-]+)$/)
    if (taskMatch !== null) {
      const task = tasks.get(taskMatch[1] ?? '')
      if (task === undefined) throw new HttpError(404, '任务不存在')
      if (request.method === 'GET') {
        sendJson(response, 200, publicTask(task))
        return
      }
      if (task.builtIn) throw new HttpError(403, '内置任务不可修改')
      if (active?.record.task === task.key) throw new HttpError(409, '运行中的任务不可修改')
      if (request.method === 'PUT') {
        assertWriteRequest(request, true)
        const input = await readJson(request, 64 * 1024)
        const updated = optimizationTaskSchema.parse(input.task)
        if (customTaskKey(updated.id) !== task.key) throw new HttpError(400, '任务 ID 不可修改')
        validateImportedTask(updated, workspaceRoot)
        await writeJsonAtomic(resolveInside(workspaceRoot, task.taskPath), updated)
        const record: RegisteredTask = { ...task, name: updated.id, task: updated }
        tasks.set(task.key, record)
        sendJson(response, 200, publicTask(record))
        return
      }
      if (request.method === 'DELETE') {
        assertWriteRequest(request, false)
        await rm(resolveInside(workspaceRoot, task.taskPath), { force: true })
        tasks.delete(task.key)
        response.writeHead(204).end()
        return
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/runs') {
      const filtered = filterRuns(url)
      const offset = positiveInteger(url.searchParams.get('cursor'), 0, 0, 100_000)
      const limit = positiveInteger(url.searchParams.get('limit'), 20, 1, 100)
      const items = filtered.slice(offset, offset + limit).map(publicRun)
      sendJson(response, 200, { items, total: filtered.length, nextCursor: offset + items.length < filtered.length ? String(offset + items.length) : null })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/runs') {
      assertWriteRequest(request, true)
      const input = await readJson(request, 16 * 1024)
      const record = await startRun(input.task, input.mode)
      sendJson(response, 202, publicRun(record))
      return
    }
    const runMatch = url.pathname.match(/^\/api\/runs\/([a-f0-9-]+)$/)
    if (request.method === 'GET' && runMatch !== null) {
      const record = runById(runMatch[1])
      const events = await readWebRunEvents(workspaceRoot, record.id)
      sendJson(response, 200, { ...publicRun(record), logs: await readRunLog(record.id), events, analysis: buildAnalysis(events, record.result) })
      return
    }
    const eventMatch = url.pathname.match(/^\/api\/runs\/([a-f0-9-]+)\/events$/)
    if (request.method === 'GET' && eventMatch !== null) {
      const record = runById(eventMatch[1])
      const current = active?.record.id === record.id ? active : undefined
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      const existing = await readRunLog(record.id)
      if (existing.length > 0) writeEvent(response, 'log', { text: existing })
      writeEvent(response, 'status', publicRun(record))
      if (current === undefined) response.end()
      else {
        current.clients.add(response)
        request.once('close', () => current.clients.delete(response))
      }
      return
    }
    const cancelMatch = url.pathname.match(/^\/api\/runs\/([a-f0-9-]+)\/cancel$/)
    if (request.method === 'POST' && cancelMatch !== null) {
      assertWriteRequest(request, false)
      const current = active
      if (current === undefined || current.record.id !== cancelMatch[1]) throw new HttpError(404, '运行中的任务不存在')
      current.record.status = 'cancelled'
      await persistRunsQueued()
      current.process.kill()
      broadcast(current, 'status', publicRun(current.record))
      sendJson(response, 202, publicRun(current.record))
      return
    }
    const rerunMatch = url.pathname.match(/^\/api\/runs\/([a-f0-9-]+)\/rerun$/)
    if (request.method === 'POST' && rerunMatch !== null) {
      assertWriteRequest(request, false)
      const previous = runById(rerunMatch[1])
      const record = await startRun(previous.task, previous.mode)
      sendJson(response, 202, publicRun(record))
      return
    }
    const logsMatch = url.pathname.match(/^\/api\/runs\/([a-f0-9-]+)\/logs$/)
    if (request.method === 'GET' && logsMatch !== null) {
      const record = runById(logsMatch[1])
      const body = await readRunLog(record.id)
      response.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="kernelpilot-${record.id}.log"`,
        'Cache-Control': 'no-store',
      })
      response.end(body)
      return
    }
    const artifactsMatch = url.pathname.match(/^\/api\/runs\/([a-f0-9-]+)\/artifacts$/)
    if (request.method === 'GET' && artifactsMatch !== null) {
      const record = runById(artifactsMatch[1])
      const artifacts = await artifactsFor(record)
      sendJson(response, 200, artifacts.map(({ file: _file, ...artifact }) => artifact))
      return
    }
    const artifactMatch = url.pathname.match(/^\/api\/runs\/([a-f0-9-]+)\/artifacts\/([a-f0-9]{16})$/)
    if (request.method === 'GET' && artifactMatch !== null) {
      const record = runById(artifactMatch[1])
      const artifact = (await artifactsFor(record)).find(item => item.id === artifactMatch[2])
      if (artifact === undefined) throw new HttpError(404, '产物不存在')
      response.writeHead(200, {
        'Content-Type': contentType(artifact.file),
        'Content-Disposition': `attachment; filename="${artifact.name.replaceAll('"', '')}"`,
        'Cache-Control': 'no-store',
      })
      response.end(await readFile(artifact.file))
      return
    }
    if (request.method === 'GET') {
      const asset = await readStaticAsset(publicRoot, url.pathname)
      if (asset !== undefined) {
        response.writeHead(200, { 'Content-Type': asset.contentType, 'Cache-Control': asset.immutable ? 'public, max-age=31536000, immutable' : 'no-store' })
        response.end(asset.body)
        return
      }
    }
    throw new HttpError(404, '页面不存在')
  }

  async function startRun(taskValue: unknown, modeValue: unknown): Promise<RunRecord> {
    if (active !== undefined) throw new HttpError(409, '已有任务正在运行')
    const task = typeof taskValue === 'string' ? tasks.get(taskValue) : undefined
    const mode = modeValue === 'baseline' || modeValue === 'optimize' ? modeValue : undefined
    if (task === undefined || mode === undefined) throw new HttpError(400, '任务或运行模式无效')
    const record: RunRecord = {
      id: randomUUID(), task: task.key, taskName: task.name, taskPath: task.taskPath, mode, status: 'running',
      startedAt: new Date().toISOString(), logCount: 0,
    }
    const processHandle = launchRun(mode, task.taskPath, record.id)
    const current: ActiveRun = { record, process: processHandle, clients: new Set(), persistence: Promise.resolve() }
    active = current
    runs.unshift(record)
    const initialPersistence = trimRuns().then(async () => await persistRunsQueued())
    current.persistence = initialPersistence
    processHandle.stdout.on('data', (chunk: Buffer) => appendLog(current, chunk.toString('utf8')))
    processHandle.stderr.on('data', (chunk: Buffer) => appendLog(current, chunk.toString('utf8')))
    let finished = false
    const finish = async (status: RunStatus, exitCode: number): Promise<void> => {
      if (finished) return
      finished = true
      record.exitCode = exitCode
      record.endedAt = new Date().toISOString()
      await current.persistence
      record.status = status
      if (mode === 'baseline' && status === 'completed') {
        record.result = parseJsonOutput(await readRunLog(record.id))
        if (record.result !== undefined) await appendWebRunEvent(workspaceRoot, record.id, 'baseline', 'baseline', record.result)
      }
      await persistRunsQueued()
      broadcast(current, 'status', publicRun(record))
      for (const client of current.clients) client.end()
      current.clients.clear()
      if (active === current) active = undefined
    }
    processHandle.once('error', error => {
      appendLog(current, `\n启动失败：${error.message}\n`)
      void finish('failed', -1)
    })
    processHandle.once('close', code => void finish(record.status === 'cancelled' ? 'cancelled' : code === 0 ? 'completed' : 'failed', code ?? -1))
    await initialPersistence
    return record
  }

  function appendLog(run: ActiveRun, text: string): void {
    run.record.logCount += countLines(text)
    run.persistence = run.persistence.then(async () => await appendFile(runLogPath(run.record.id), text, 'utf8'))
    broadcast(run, 'log', { text })
  }

  function filterRuns(url: URL): RunRecord[] {
    const status = url.searchParams.get('status')
    const task = url.searchParams.get('task')
    const mode = url.searchParams.get('mode')
    const query = url.searchParams.get('q')?.trim().toLowerCase()
    return runs.filter(run => (status === null || run.status === status)
      && (task === null || run.task === task)
      && (mode === null || run.mode === mode)
      && (query === undefined || query === '' || `${run.taskName} ${run.id}`.toLowerCase().includes(query)))
  }

  function runById(id: string | undefined): RunRecord {
    const record = runs.find(item => item.id === id)
    if (record === undefined) throw new HttpError(404, '运行记录不存在')
    return record
  }

  async function trimRuns(): Promise<void> {
    const removed = runs.splice(settings.retention)
    await Promise.all(removed.flatMap(run => [
      rm(runLogPath(run.id), { force: true }),
      rm(resolveInside(runRoot, `${run.id}.events.jsonl`), { force: true }),
    ]))
  }

  function persistRunsQueued(): Promise<void> {
    persistChain = persistChain.then(persistRuns)
    return persistChain
  }

  async function persistRuns(): Promise<void> {
    await writeJsonAtomic(indexPath, { version: 1, runs } satisfies RunIndex)
  }

  function runLogPath(id: string): string { return resolveInside(runRoot, `${id}.log`) }
  async function readRunLog(id: string): Promise<string> {
    try { return await readFile(runLogPath(id), 'utf8') } catch (error: unknown) { if (isMissing(error)) return ''; throw error }
  }

  async function artifactsFor(record: RunRecord): Promise<Array<{ id: string; name: string; type: 'diff' | 'ncu'; size: number; file: string }>> {
    const taskId = tasks.get(record.task)?.task.id
    if (taskId === undefined) return []
    const roots = [
      { root: resolveInside(workspaceRoot, `.kernelpilot/diffs/${taskId}`), type: 'diff' as const },
      { root: resolveInside(workspaceRoot, `.kernelpilot/reports/${taskId}`), type: 'ncu' as const },
    ]
    const artifacts: Array<{ id: string; name: string; type: 'diff' | 'ncu'; size: number; file: string }> = []
    for (const source of roots) {
      let files: string[]
      try { files = await readdir(source.root) } catch (error: unknown) { if (isMissing(error)) continue; throw error }
      for (const name of files) {
        const file = resolveInside(source.root, name)
        const metadata = await stat(file)
        if (!metadata.isFile() || metadata.mtimeMs + 1000 < new Date(record.startedAt).getTime()) continue
        const id = createHash('sha256').update(`${source.type}:${name}`).digest('hex').slice(0, 16)
        artifacts.push({ id, name, type: source.type, size: metadata.size, file })
      }
    }
    return artifacts
  }
}

function publicTask(record: RegisteredTask): Record<string, unknown> {
  return {
    key: record.key,
    name: record.name,
    taskPath: record.taskPath,
    builtIn: record.builtIn,
    id: record.task.id,
    kernelName: record.task.source.kernelName,
    architecture: record.task.build.architecture,
    minimumSpeedup: record.task.objective.minimumSpeedup,
    task: record.task,
  }
}

function publicRun(record: RunRecord): Omit<RunRecord, 'taskPath'> {
  const { taskPath: _taskPath, ...result } = record
  return result
}

function validateImportedTask(task: OptimizationTask, workspaceRoot: string): void {
  validateTaskPaths(task, workspaceRoot)
  const compiler = path.basename(task.build.command.executable).toLowerCase()
  if (compiler !== 'nvcc' && compiler !== 'nvcc.exe') throw new HttpError(400, 'Build 仅允许 nvcc')
  const profiler = path.basename(task.profile.executable).toLowerCase()
  if (!['ncu', 'ncu.exe', 'ncu.bat'].includes(profiler)) throw new HttpError(400, 'Profiler 仅允许 ncu')
  if (Object.keys(task.build.command.environment).length > 0
    || Object.keys(task.validation.command.environment).length > 0
    || Object.keys(task.benchmark.command.environment).length > 0) throw new HttpError(400, '自定义任务不可声明环境变量')
  const outputIndex = task.build.command.args.findIndex(argument => argument === '-o')
  const output = outputIndex < 0 ? undefined : task.build.command.args[outputIndex + 1]
  if (output === undefined) throw new HttpError(400, 'Build 必须使用 -o 声明输出文件')
  const expected = normalizeExecutable(output)
  if (normalizeExecutable(task.validation.command.executable) !== expected || normalizeExecutable(task.benchmark.command.executable) !== expected) {
    throw new HttpError(400, '验证和 Benchmark 只能运行本次构建输出')
  }
}

function normalizeExecutable(value: string): string {
  if (path.isAbsolute(value) || value.includes('..')) throw new HttpError(400, '可执行文件路径无效')
  return path.normalize(value).replace(/^\.([\\/])/, '').toLowerCase()
}

function customTaskKey(id: string): string { return `custom-${id}` }
function workspaceRelative(workspaceRoot: string, file: string): string { return path.relative(workspaceRoot, file).replaceAll('\\', '/') }
async function readTask(file: string): Promise<OptimizationTask> { return optimizationTaskSchema.parse(JSON.parse(await readFile(file, 'utf8'))) }

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
}

function parseJsonOutput(text: string): unknown {
  const start = text.indexOf('{')
  if (start < 0) return undefined
  try { return JSON.parse(text.slice(start)) } catch { return undefined }
}

function buildAnalysis(events: readonly WebRunEvent[], fallback: unknown): Record<string, unknown> {
  const baselineEvent = events.find(event => event.type === 'baseline')
  const baseline = baselineEvent?.data ?? fallback
  const candidateIds = [...new Set(events.filter(event => event.candidateId !== 'baseline').map(event => event.candidateId))]
  const candidates = candidateIds.map(candidateId => {
    const candidateEvents = events.filter(event => event.candidateId === candidateId)
    return {
      id: candidateId,
      proposal: candidateEvents.find(event => event.type === 'candidate')?.data,
      compile: candidateEvents.find(event => event.type === 'compile')?.data,
      validation: candidateEvents.find(event => event.type === 'validation')?.data,
      benchmark: candidateEvents.find(event => event.type === 'benchmark')?.data,
      profile: candidateEvents.find(event => event.type === 'profile')?.data,
      evaluation: candidateEvents.find(event => event.type === 'evaluation')?.data,
    }
  })
  const accepted = candidates.filter(candidate => typeof candidate.evaluation === 'object' && candidate.evaluation !== null
    && 'accepted' in candidate.evaluation && candidate.evaluation.accepted === true)
  const best = accepted.sort((left, right) => numericSpeedup(right.evaluation) - numericSpeedup(left.evaluation))[0]
  return { baseline, candidates, bestCandidateId: best?.id ?? null, bestSpeedup: best === undefined ? null : numericSpeedup(best.evaluation) }
}

function numericSpeedup(value: unknown): number {
  return typeof value === 'object' && value !== null && 'speedup' in value && typeof value.speedup === 'number' ? value.speedup : 0
}

function bestSpeedup(runs: readonly RunRecord[]): number | null {
  let best: number | null = null
  for (const run of runs) {
    if (typeof run.result !== 'object' || run.result === null || !('speedup' in run.result) || typeof run.result.speedup !== 'number') continue
    best = best === null ? run.result.speedup : Math.max(best, run.result.speedup)
  }
  return best
}

function countLines(text: string): number { return Math.max(1, text.split('\n').length - 1) }
function positiveInteger(value: string | null, fallback: number, minimum: number, maximum: number): number {
  if (value === null) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback
}

function assertWriteRequest(request: IncomingMessage, requiresJson: boolean): void {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin !== undefined && host !== undefined && origin !== `http://${host}`) throw new HttpError(403, '请求来源无效')
  if (requiresJson && !request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new HttpError(415, '仅支持 application/json')
}

interface DiagnosticItem {
  readonly key: string
  readonly name: string
  readonly status: 'available' | 'missing' | 'error'
  readonly version?: string
  readonly detail?: string
}

async function systemSnapshot(workspaceRoot: string, stateRoot: string): Promise<Record<string, unknown>> {
  const [gpu, cuda, ncu, msvc] = await Promise.all([
    diagnostic('gpu', 'NVIDIA GPU', 'nvidia-smi', ['--query-gpu=name,driver_version', '--format=csv,noheader'], workspaceRoot, output => {
      const [name, version] = output.split(/\r?\n/)[0]?.split(',').map(value => value.trim()) ?? []
      return { ...(version === undefined ? {} : { version }), ...(name === undefined ? {} : { detail: name }) }
    }),
    diagnostic('cuda', 'CUDA Toolkit', 'nvcc', ['--version'], workspaceRoot, output => optionalVersion(/release\s+([\d.]+)/i.exec(output)?.[1])),
    ncuDiagnostic(workspaceRoot, stateRoot),
    diagnostic('msvc', 'MSVC Build Tools', 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe', ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'catalog_productDisplayVersion'], workspaceRoot, output => ({ version: output.trim() })),
  ])
  const userAgent = process.env.npm_config_user_agent ?? ''
  const pnpmVersion = /pnpm\/([^\s]+)/.exec(userAgent)?.[1]
  let envText = ''
  try { envText = await readFile(path.join(workspaceRoot, '.env'), 'utf8') } catch (error: unknown) { if (!isMissing(error)) throw error }
  return {
    platform: `${process.platform} ${process.arch}`,
    checkedAt: new Date().toISOString(),
    tools: [
      gpu, cuda, ncu, msvc,
      { key: 'node', name: 'Node.js', status: 'available', version: process.version } satisfies DiagnosticItem,
      { key: 'pnpm', name: 'pnpm', status: pnpmVersion === undefined ? 'missing' : 'available', ...(pnpmVersion === undefined ? {} : { version: pnpmVersion }) } satisfies DiagnosticItem,
    ],
    credentials: {
      deepseekApiKey: hasEnvironmentKey('DEEPSEEK_API_KEY', envText),
      deepseekBaseUrl: hasEnvironmentKey('DEEPSEEK_BASE_URL', envText),
    },
  }
}

async function ncuDiagnostic(workspaceRoot: string, stateRoot: string): Promise<DiagnosticItem> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const executable = await resolveNcuExecutable('ncu', stateRoot, controller.signal)
    return await diagnostic('ncu', 'Nsight Compute', executable, ['--version'], workspaceRoot, output => optionalVersion(/Version\s+([\d.]+)/i.exec(output)?.[1]))
  } catch (error) {
    return { key: 'ncu', name: 'Nsight Compute', status: 'missing', detail: error instanceof Error ? error.message : String(error) }
  } finally { clearTimeout(timeout) }
}

async function diagnostic(key: string, name: string, executable: string, args: readonly string[], cwd: string, parse: (output: string) => { version?: string; detail?: string }): Promise<DiagnosticItem> {
  try {
    const output = await runDiagnostic(executable, args, cwd)
    const parsed = parse(output)
    return { key, name, status: 'available', ...parsed }
  } catch (error) {
    return { key, name, status: 'missing', detail: error instanceof Error ? error.message : String(error) }
  }
}

function optionalVersion(version: string | undefined): { version?: string } { return version === undefined ? {} : { version } }

async function runDiagnostic(executable: string, args: readonly string[], cwd: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: process.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const timer = setTimeout(() => { child.kill(); finish(new Error(`诊断超时：${path.basename(executable)}`)) }, 12_000)
    const finish = (error?: Error, output?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error === undefined) resolve(output ?? '')
      else reject(error)
    }
    const append = (chunk: Buffer): void => {
      size += chunk.length
      if (size > 64 * 1024) { child.kill(); finish(new Error('诊断输出过大')); return }
      chunks.push(chunk)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', error => finish(error))
    child.once('close', code => finish(code === 0 ? undefined : new Error(`${path.basename(executable)} 退出码 ${code ?? -1}`), Buffer.concat(chunks).toString('utf8')))
  })
}

function hasEnvironmentKey(key: string, envText: string): boolean {
  if ((process.env[key] ?? '').trim() !== '') return true
  return envText.split(/\r?\n/).some(line => line.trim().startsWith(`${key}=`) && line.slice(line.indexOf('=') + 1).trim() !== '')
}

async function readJson(request: IncomingMessage, maximumBytes: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > maximumBytes) throw new HttpError(413, '请求内容过大')
    chunks.push(buffer)
  }
  let value: unknown
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new HttpError(400, '请求 JSON 无效') }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, '请求格式错误')
  return value as Record<string, unknown>
}

function broadcast(run: ActiveRun, event: string, data: unknown): void {
  for (const client of run.clients) writeEvent(client, event, data)
}

function writeEvent(response: ServerResponse, event: string, data: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(data))
}

async function readStaticAsset(publicRoot: string, pathname: string): Promise<{ readonly body: Buffer; readonly contentType: string; readonly immutable: boolean } | undefined> {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1))
  const candidate = path.resolve(publicRoot, relative)
  if (path.relative(publicRoot, candidate).startsWith('..')) return undefined
  try {
    const body = await readFile(candidate)
    return { body, contentType: contentType(candidate), immutable: relative.startsWith('assets/') }
  } catch (error: unknown) {
    if (!isMissing(error)) throw error
  }
  if (path.extname(relative) !== '') return undefined
  return { body: await readFile(path.join(publicRoot, 'index.html')), contentType: 'text/html; charset=utf-8', immutable: false }
}

function contentType(file: string): string {
  const extension = path.extname(file).toLowerCase()
  if (extension === '.html') return 'text/html; charset=utf-8'
  if (extension === '.js') return 'text/javascript; charset=utf-8'
  if (extension === '.css') return 'text/css; charset=utf-8'
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.json') return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

function isMissing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT' }

function isRunIndex(value: unknown): value is RunIndex {
  return typeof value === 'object' && value !== null && 'version' in value && value.version === 1
    && 'runs' in value && Array.isArray(value.runs)
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const port = Number(process.env.KERNELPILOT_PORT ?? 4317)
  const server = createKernelPilotWebServer({ workspaceRoot: process.cwd() })
  server.listen(port, '127.0.0.1', () => process.stdout.write(`KernelPilot Web: http://127.0.0.1:${port}\n`))
}
