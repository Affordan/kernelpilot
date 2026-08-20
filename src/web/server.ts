import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const tasks = [
  { key: 'reduction', name: 'Reduction FP32', taskPath: 'examples/reduction/task.json' },
  { key: 'elementwise', name: 'Elementwise SAXPY FP32', taskPath: 'examples/elementwise/task.json' },
] as const

type TaskKey = typeof tasks[number]['key']
type RunMode = 'baseline' | 'optimize'
type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

interface RunRecord {
  readonly id: string
  readonly task: TaskKey
  readonly taskName: string
  readonly mode: RunMode
  status: RunStatus
  readonly startedAt: string
  endedAt?: string
  exitCode?: number
  readonly logs: string[]
}

interface ActiveRun {
  readonly record: RunRecord
  readonly process: ChildProcessWithoutNullStreams
  readonly clients: Set<ServerResponse>
}

export interface KernelPilotWebOptions {
  readonly workspaceRoot: string
  readonly publicRoot?: string
  readonly launchRun?: (mode: RunMode, taskPath: string) => ChildProcessWithoutNullStreams
}

export function createKernelPilotWebServer(options: KernelPilotWebOptions): Server {
  const workspaceRoot = path.resolve(options.workspaceRoot)
  const publicRoot = path.resolve(options.publicRoot ?? path.join(workspaceRoot, 'web', 'dist'))
  const runs: RunRecord[] = []
  let active: ActiveRun | undefined
  const launchRun = options.launchRun ?? ((mode, taskPath) => {
    const script = mode === 'baseline' ? 'cli.js' : 'harness-launcher.js'
    const child = spawn(process.execPath, [path.join(workspaceRoot, 'dist', script), mode === 'baseline' ? 'baseline' : taskPath, ...(mode === 'baseline' ? [taskPath] : [])], {
      cwd: workspaceRoot,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdin.end()
    return child
  })

  return createServer((request, response) => {
    void route(request, response).catch((error: unknown) => {
      if (!response.headersSent) sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      else response.end()
    })
  })

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/api/tasks') {
      sendJson(response, 200, tasks)
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/runs') {
      sendJson(response, 200, runs.map(publicRun))
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/runs') {
      if (active?.record.status === 'running') {
        sendJson(response, 409, { error: '已有任务正在运行', run: publicRun(active.record) })
        return
      }
      const input = await readJson(request)
      const task = tasks.find(item => item.key === input.task)
      const mode = input.mode
      if (task === undefined || (mode !== 'baseline' && mode !== 'optimize')) {
        sendJson(response, 400, { error: '任务或运行模式无效' })
        return
      }
      const record: RunRecord = {
        id: randomUUID(), task: task.key, taskName: task.name, mode, status: 'running',
        startedAt: new Date().toISOString(), logs: [],
      }
      const processHandle = launchRun(mode, task.taskPath)
      const current: ActiveRun = { record, process: processHandle, clients: new Set() }
      active = current
      runs.unshift(record)
      if (runs.length > 20) runs.length = 20
      processHandle.stdout.on('data', (chunk: Buffer) => appendLog(current, chunk.toString('utf8')))
      processHandle.stderr.on('data', (chunk: Buffer) => appendLog(current, chunk.toString('utf8')))
      let finished = false
      const finish = (status: RunStatus, exitCode: number): void => {
        if (finished) return
        finished = true
        record.status = status
        record.exitCode = exitCode
        record.endedAt = new Date().toISOString()
        broadcast(current, 'status', publicRun(record))
        for (const client of current.clients) client.end()
        current.clients.clear()
        if (active === current) active = undefined
      }
      processHandle.once('error', error => {
        appendLog(current, `\n启动失败：${error.message}\n`)
        finish('failed', -1)
      })
      processHandle.once('close', code => finish(record.status === 'cancelled' ? 'cancelled' : code === 0 ? 'completed' : 'failed', code ?? -1))
      sendJson(response, 202, publicRun(record))
      return
    }

    const runMatch = url.pathname.match(/^\/api\/runs\/([a-f0-9-]+)$/)
    if (request.method === 'GET' && runMatch !== null) {
      const record = runs.find(item => item.id === runMatch[1])
      if (record === undefined) sendJson(response, 404, { error: '任务不存在' })
      else sendJson(response, 200, { ...publicRun(record), logs: record.logs })
      return
    }
    const eventMatch = url.pathname.match(/^\/api\/runs\/([a-f0-9-]+)\/events$/)
    if (request.method === 'GET' && eventMatch !== null) {
      const current = active?.record.id === eventMatch[1] ? active : undefined
      const record = runs.find(item => item.id === eventMatch[1])
      if (record === undefined) {
        sendJson(response, 404, { error: '任务不存在' })
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      for (const text of record.logs) writeEvent(response, 'log', { text })
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
      const current = active
      if (current === undefined || current.record.id !== cancelMatch[1]) {
        sendJson(response, 404, { error: '运行中的任务不存在' })
        return
      }
      current.record.status = 'cancelled'
      current.process.kill()
      sendJson(response, 202, publicRun(current.record))
      return
    }
    if (request.method === 'GET') {
      const asset = await readStaticAsset(publicRoot, url.pathname)
      if (asset !== undefined) {
        response.writeHead(200, { 'Content-Type': asset.contentType, 'Cache-Control': 'no-store' })
        response.end(asset.body)
        return
      }
    }
    sendJson(response, 404, { error: '页面不存在' })
  }
}

function appendLog(run: ActiveRun, text: string): void {
  run.record.logs.push(text)
  if (run.record.logs.length > 2000) run.record.logs.splice(0, run.record.logs.length - 2000)
  broadcast(run, 'log', { text })
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

function publicRun(record: RunRecord): Omit<RunRecord, 'logs'> {
  const { logs: _logs, ...result } = record
  return result
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Array<Buffer<ArrayBufferLike>> = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > 16 * 1024) throw new Error('请求内容过大')
    chunks.push(buffer)
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('请求格式错误')
  return value as Record<string, unknown>
}

async function readStaticAsset(publicRoot: string, pathname: string): Promise<{ readonly body: Buffer; readonly contentType: string } | undefined> {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1))
  const candidate = path.resolve(publicRoot, relative)
  if (path.relative(publicRoot, candidate).startsWith('..')) return undefined
  try {
    const body = await readFile(candidate)
    return { body, contentType: contentType(candidate) }
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  if (path.extname(relative) !== '') return undefined
  return { body: await readFile(path.join(publicRoot, 'index.html')), contentType: 'text/html; charset=utf-8' }
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

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const port = Number(process.env.KERNELPILOT_PORT ?? 4317)
  const server = createKernelPilotWebServer({ workspaceRoot: process.cwd() })
  server.listen(port, '127.0.0.1', () => process.stdout.write(`KernelPilot Web: http://127.0.0.1:${port}\n`))
}
