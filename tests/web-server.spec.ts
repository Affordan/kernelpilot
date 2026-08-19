import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { createKernelPilotWebServer } from '../src/web/server.js'

const servers: Array<ReturnType<typeof createKernelPilotWebServer>> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async server => await new Promise<void>(resolve => server.close(() => resolve()))))
})

describe('KernelPilot Web API', () => {
  it('serves the web console', async () => {
    const server = createKernelPilotWebServer({ workspaceRoot: process.cwd() })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const response = await fetch(`http://127.0.0.1:${port}/`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('KernelPilot')
  })

  it('lists fixed tasks and completes a run', async () => {
    const server = createKernelPilotWebServer({ workspaceRoot: process.cwd(), launchRun: () => fakeProcess() })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const origin = `http://127.0.0.1:${port}`

    const tasks = await json(await fetch(`${origin}/api/tasks`)) as Array<{ key: string }>
    expect(tasks.map(task => task.key)).toEqual(['reduction', 'elementwise'])

    const started = await fetch(`${origin}/api/runs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: 'reduction', mode: 'baseline' }),
    })
    expect(started.status).toBe(202)
    const run = await json(started) as { id: string }
    await new Promise(resolve => setTimeout(resolve, 10))
    const completed = await json(await fetch(`${origin}/api/runs/${run.id}`)) as { status: string; logs: string[] }
    expect(completed.status).toBe('completed')
    expect(completed.logs.join('')).toContain('real output')
  })

  it('rejects unknown tasks', async () => {
    const server = createKernelPilotWebServer({ workspaceRoot: process.cwd(), launchRun: () => fakeProcess() })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const response = await fetch(`http://127.0.0.1:${port}/api/runs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: '../secret', mode: 'optimize' }),
    })
    expect(response.status).toBe(400)
  })
})

function fakeProcess(): ChildProcessWithoutNullStreams {
  const processHandle = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => boolean }
  processHandle.stdout = new PassThrough()
  processHandle.stderr = new PassThrough()
  processHandle.kill = () => true
  setImmediate(() => {
    processHandle.stdout.write('real output\n')
    processHandle.stdout.end()
    processHandle.emit('close', 0)
  })
  return processHandle as unknown as ChildProcessWithoutNullStreams
}

async function json(response: Response): Promise<unknown> {
  const value: unknown = await response.json()
  return value
}
