import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { RunMode, RunStatus, RunSummary } from './types'

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
      {actions === undefined ? null : <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function StatusBadge({ status }: { status: RunStatus }) {
  return <span className={`status-badge ${status}`}>{statusLabel(status)}</span>
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="empty-state"><span>∅</span><strong>{title}</strong><p>{description}</p></div>
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="error-state" role="alert"><strong>加载失败</strong><p>{message}</p>{retry === undefined ? null : <button onClick={retry}>重试</button>}</div>
}

export function LoadingState() { return <div className="loading-state" role="status"><i /><span>读取本机数据…</span></div> }

export function RunTable({ runs }: { runs: RunSummary[] }) {
  if (runs.length === 0) return <EmptyState title="暂无运行记录" description="启动任务后，真实 GPU 结果会显示在这里。" />
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>任务</th><th>模式</th><th>开始时间</th><th>耗时</th><th>状态</th></tr></thead>
        <tbody>{runs.map(run => (
          <tr key={run.id}>
            <td><Link className="table-link" to={`/runs/${run.id}`}>{run.taskName}<small>{run.id.slice(0, 8)}</small></Link></td>
            <td>{modeLabel(run.mode)}</td>
            <td>{formatDate(run.startedAt)}</td>
            <td>{formatDuration(run.startedAt, run.endedAt)}</td>
            <td><StatusBadge status={run.status} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

export function modeLabel(mode: RunMode): string { return mode === 'baseline' ? '环境检查' : '自动优化' }
export function statusLabel(status: RunStatus): string {
  return ({ running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' } as const)[status]
}
export function formatDate(value: string): string { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
export function formatDuration(startedAt: string, endedAt?: string): string {
  const seconds = Math.max(0, Math.floor(((endedAt === undefined ? Date.now() : new Date(endedAt).getTime()) - new Date(startedAt).getTime()) / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
