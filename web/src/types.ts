export type RunMode = 'baseline' | 'optimize'
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface TaskSummary {
  key: string
  name: string
  taskPath: string
  builtIn: boolean
  id: string
  kernelName: string
  architecture: string
  minimumSpeedup: number
  task: Record<string, unknown>
}

export interface RunSummary {
  id: string
  task: string
  taskName: string
  mode: RunMode
  status: RunStatus
  startedAt: string
  endedAt?: string
  exitCode?: number
  logCount: number
  result?: unknown
}

export interface RunDetail extends RunSummary { logs: string }
export interface RunsResponse { items: RunSummary[]; total: number; nextCursor: string | null }
export interface Overview {
  activeRun: RunSummary | null
  taskCount: number
  runCount: number
  successRate: number | null
  bestSpeedup: number | null
  recentRuns: RunSummary[]
}
