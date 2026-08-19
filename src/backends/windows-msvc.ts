import { access, mkdir, writeFile } from 'node:fs/promises'
import type { CommandSpec } from '../domain/schema.js'
import { runCommand } from './process.js'

const VSWHERE = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe'

/** Discover an x64 MSVC developer environment without mutating the parent process. */
export async function discoverMsvcEnvironment(stateRoot: string, signal: AbortSignal): Promise<Readonly<Record<string, string>>> {
  if (process.platform !== 'win32') return {}
  try {
    await access(VSWHERE)
  } catch {
    throw new Error('Visual Studio Installer vswhere.exe was not found; install the Desktop development with C++ workload')
  }
  await mkdir(stateRoot, { recursive: true })
  const query: CommandSpec = {
    executable: VSWHERE,
    args: ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
    cwd: '.',
    environment: {},
  }
  const located = await runCommand(query, 10_000, signal, { workspaceRoot: stateRoot, allowedExecutables: new Set(['vswhere.exe']) })
  const installation = located.stdout.trim()
  if (located.exitCode !== 0 || installation.length === 0) {
    throw new Error('Visual Studio C++ Build Tools were not found; install the Desktop development with C++ workload')
  }
  const vcvars = `${installation}\\VC\\Auxiliary\\Build\\vcvars64.bat`
  await access(vcvars)
  const wrapper = `${stateRoot}\\capture-msvc-environment.cmd`
  await writeFile(wrapper, `@echo off\r\ncall "${vcvars}" >nul\r\nif errorlevel 1 exit /b 1\r\nset\r\n`, 'utf8')
  const capture: CommandSpec = { executable: 'cmd.exe', args: ['/d', '/c', wrapper], cwd: '.', environment: {} }
  const result = await runCommand(capture, 30_000, signal, { workspaceRoot: stateRoot, allowedExecutables: new Set(['cmd.exe']) })
  if (result.exitCode !== 0) throw new Error(`failed to initialize the MSVC environment: ${result.stderr}`)
  return parseEnvironment(result.stdout)
}

function parseEnvironment(text: string): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    environment[line.slice(0, separator)] = line.slice(separator + 1)
  }
  if (!Object.keys(environment).some(key => key.toLowerCase() === 'path')) {
    throw new Error('MSVC environment capture did not produce PATH')
  }
  return environment
}

