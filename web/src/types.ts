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

export interface WebRunEvent { time: string; type: string; candidateId: string; data: unknown }
export interface CandidateAnalysis {
  id: string
  proposal?: unknown
  compile?: unknown
  validation?: unknown
  benchmark?: unknown
  profile?: unknown
  evaluation?: unknown
}
export interface RunAnalysis { baseline?: unknown; candidates: CandidateAnalysis[]; bestCandidateId: string | null; bestSpeedup: number | null }
export interface ArtifactSummary { id: string; name: string; type: 'diff' | 'ncu'; size: number }
export interface RunDetail extends RunSummary { logs: string; events: WebRunEvent[]; analysis: RunAnalysis }
export interface RunsResponse { items: RunSummary[]; total: number; nextCursor: string | null }
export interface Overview {
  activeRun: RunSummary | null
  taskCount: number
  runCount: number
  successRate: number | null
  bestSpeedup: number | null
  recentRuns: RunSummary[]
}
