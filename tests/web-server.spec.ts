import { EventEmitter } from 'node:events'
import { readFile, rm } from 'node:fs/promises'
import { PassThrough } from 'node:stream'
import { randomUUID } from 'node:crypto'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { createKernelPilotWebServer } from '../src/web/server.js'

const servers: Array<ReturnType<typeof createKernelPilotWebServer>> = []
const stateRoots: string[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer))
  await Promise.all(stateRoots.splice(0).map(async root => await rm(root, { recursive: true, force: true })))
})

describe('KernelPilot Web API', () => {
  it('serves the React console and route fallback', async () => {
    const origin = await startServer()
    const [home, route] = await Promise.all([fetch(`${origin}/`), fetch(`${origin}/runs/example`)] )
    expect(home.status).toBe(200)
    expect(route.status).toBe(200)
    expect(await home.text()).toContain('KernelPilot')
  })

  it('lists fixed tasks, completes a run, and persists it', async () => {
    const stateRoot = newStateRoot()
    const origin = await startServer({ stateRoot, launchRun: () => fakeProcess() })
    const tasks = await json(await fetch(`${origin}/api/tasks`)) as Array<{ key: string }>
    expect(tasks.map(task => task.key)).toEqual(['reduction', 'elementwise'])

    const started = await fetch(`${origin}/api/runs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: 'reduction', mode: 'baseline' }),
    })
    expect(started.status).toBe(202)
    const run = await json(started) as { id: string }
    const completed = await waitForRun(origin, run.id)
    expect(completed.status).toBe('completed')
    expect(completed.logs).toContain('real output')

    const previousServer = servers.pop()
    if (previousServer === undefined) throw new Error('server is missing')
    await closeServer(previousServer)
    const restartedOrigin = await startServer({ stateRoot, launchRun: () => fakeProcess() })
    const history = await json(await fetch(`${restartedOrigin}/api/runs`)) as { items: Array<{ id: string }> }
    expect(history.items[0]?.id).toBe(run.id)
  })

  it('imports a validated task and blocks dangerous commands', async () => {
    const origin = await startServer()
    const source = JSON.parse(await readFile('examples/reduction/task.json', 'utf8')) as Record<string, unknown>
    source.id = 'custom-reduction'
    const created = await fetch(`${origin}/api/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: source }),
    })
    expect(created.status).toBe(201)

    const unsafe = structuredClone(source) as { id: string; build: { command: { executable: string } } }
    unsafe.id = 'unsafe-task'
    unsafe.build.command.executable = 'powershell.exe'
    const rejected = await fetch(`${origin}/api/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: unsafe }),
    })
    expect(rejected.status).toBe(400)
  })

  it('rejects unknown tasks and foreign origins', async () => {
    const origin = await startServer({ launchRun: () => fakeProcess() })
    const unknown = await fetch(`${origin}/api/runs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: '../secret', mode: 'optimize' }),
    })
    expect(unknown.status).toBe(400)

    const foreign = await fetch(`${origin}/api/runs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: JSON.stringify({ task: 'reduction', mode: 'baseline' }),
    })
    expect(foreign.status).toBe(403)
  })

  it('persists validated settings', async () => {
    const stateRoot = newStateRoot()
    const origin = await startServer({ stateRoot })
    const saved = await json(await fetch(`${origin}/api/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'light', logWrap: false, autoScroll: false, retention: 80 }),
    })) as { theme: string; retention: number }
    expect(saved).toMatchObject({ theme: 'light', retention: 80 })

    const invalid = await fetch(`${origin}/api/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'light', logWrap: false, autoScroll: false, retention: 2 }),
    })
    expect(invalid.status).toBe(400)
  })

  it('returns diagnostics without credential values', async () => {
    const origin = await startServer()
    const response = await fetch(`${origin}/api/system`)
    expect(response.status).toBe(200)
    const body = await response.text()
    const system = JSON.parse(body) as { tools: unknown[]; credentials: { deepseekApiKey: boolean } }
    expect(system.tools.length).toBeGreaterThan(0)
    expect(typeof system.credentials.deepseekApiKey).toBe('boolean')
    expect(body).not.toContain('sk-')
  })
})

function newStateRoot(): string {
  const relative = `.kernelpilot/test-web/${randomUUID()}`
  stateRoots.push(relative)
  return relative
}

async function startServer(overrides: Partial<Parameters<typeof createKernelPilotWebServer>[0]> = {}): Promise<string> {
  const stateRoot = overrides.stateRoot ?? newStateRoot()
  const server = createKernelPilotWebServer({ workspaceRoot: process.cwd(), ...overrides, stateRoot })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function closeServer(server: ReturnType<typeof createKernelPilotWebServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => { if (error === undefined) resolve(); else reject(error) }))
}

function fakeProcess(): ChildProcessWithoutNullStreams {
  const processHandle = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => boolean }
  processHandle.stdout = new PassThrough()
  processHandle.stderr = new PassThrough()
  processHandle.kill = () => true
  setImmediate(() => {
    processHandle.stdout.write('{"taskId":"reduction","benchmark":{"medianMs":0.12}}\n')
    processHandle.stdout.write('real output\n')
    processHandle.stdout.end()
    processHandle.emit('close', 0)
  })
  return processHandle as unknown as ChildProcessWithoutNullStreams
}

async function waitForRun(origin: string, id: string): Promise<{ status: string; logs: string }> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const run = await json(await fetch(`${origin}/api/runs/${id}`)) as { status: string; logs: string }
    if (run.status !== 'running') return run
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('run did not finish')
}

async function json(response: Response): Promise<unknown> { return await response.json() as unknown }
