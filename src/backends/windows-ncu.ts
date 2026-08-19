import { access } from 'node:fs/promises'
import path from 'node:path'
import type { CommandSpec } from '../domain/schema.js'
import { runCommand } from './process.js'

/** Resolve the real Nsight Compute binary behind NVIDIA's Windows ncu.bat launcher. */
export async function resolveNcuExecutable(executable: string, stateRoot: string, signal: AbortSignal): Promise<string> {
  if (process.platform !== 'win32' || !isNcuName(executable)) return executable

  const explicit = path.isAbsolute(executable) ? executable : undefined
  if (explicit !== undefined) return await resolveNcuPath(explicit)

  const query: CommandSpec = { executable: 'where.exe', args: ['ncu.bat'], cwd: '.', environment: {} }
  const located = await runCommand(query, 10_000, signal, { workspaceRoot: stateRoot, allowedExecutables: new Set(['where.exe']) })
  const launcher = located.stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean)
  if (located.exitCode !== 0 || launcher === undefined) {
    throw new Error('Nsight Compute ncu was not found on PATH; install Nsight Compute or set profile.executable to ncu.exe')
  }
  return await resolveNcuPath(launcher)
}

function isNcuName(executable: string): boolean {
  const name = path.basename(executable).toLowerCase()
  return name === 'ncu' || name === 'ncu.exe' || name === 'ncu.bat'
}

async function resolveNcuPath(executable: string): Promise<string> {
  if (path.extname(executable).toLowerCase() === '.exe') {
    await access(executable)
    return executable
  }
  const binary = path.join(path.dirname(executable), 'target', 'windows-desktop-win7-x64', 'ncu.exe')
  try {
    await access(binary)
  } catch {
    throw new Error(`Nsight Compute launcher does not reference the expected ncu.exe: ${executable}`)
  }
  return binary
}
