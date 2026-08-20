import { useMemo, useState } from 'react'
import { PageHeader, ErrorState, LoadingState, RunTable } from '../components'
import { useApi } from '../api'
import type { RunsResponse } from '../types'

export function RunsPage() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [mode, setMode] = useState('')
  const url = useMemo(() => {
    const params = new URLSearchParams({ limit: '100' })
    if (query.trim() !== '') params.set('q', query.trim())
    if (status !== '') params.set('status', status)
    if (mode !== '') params.set('mode', mode)
    return `/api/runs?${params}`
  }, [mode, query, status])
  const runs = useApi<RunsResponse>(url)

  return (
    <section className="page">
      <PageHeader eyebrow="RUN HISTORY" title="运行历史" description="筛选并检查本机保存的真实执行记录。" />
      <div className="filter-bar"><label><span>搜索</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="任务名称或运行 ID" /></label><label><span>状态</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="">全部</option><option value="running">运行中</option><option value="completed">已完成</option><option value="failed">失败</option><option value="cancelled">已取消</option><option value="interrupted">已中断</option></select></label><label><span>模式</span><select value={mode} onChange={event => setMode(event.target.value)}><option value="">全部</option><option value="baseline">环境检查</option><option value="optimize">自动优化</option></select></label></div>
      <article className="panel table-panel"><div className="panel-title"><div><span>{runs.data?.total ?? 0}</span><h2>运行记录</h2></div><button onClick={runs.reload}>刷新</button></div>{runs.loading ? <LoadingState /> : runs.error !== undefined ? <ErrorState message={runs.error} retry={runs.reload} /> : <RunTable runs={runs.data?.items ?? []} />}</article>
    </section>
  )
}
