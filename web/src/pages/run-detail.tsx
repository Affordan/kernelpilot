import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { jsonRequest, request, useApi } from '../api'
import { ErrorState, formatDate, formatDuration, LoadingState, modeLabel, PageHeader, StatusBadge } from '../components'
import type { RunDetail, RunSummary } from '../types'

export function RunDetailPage() {
  const { id = '' } = useParams()
  const detail = useApi<RunDetail>(`/api/runs/${id}`)
  const navigate = useNavigate()
  const [logs, setLogs] = useState('')
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState<string>()
  const terminal = useRef<HTMLPreElement>(null)

  useEffect(() => { if (detail.data !== undefined) setLogs(detail.data.logs) }, [detail.data])
  useEffect(() => {
    if (detail.data?.status !== 'running') return
    const events = new EventSource(`/api/runs/${id}/events`)
    events.addEventListener('log', event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { text: string }
      setLogs(current => current + payload.text)
    })
    events.addEventListener('status', event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as RunSummary
      if (payload.status !== 'running') detail.reload()
    })
    return () => events.close()
  }, [detail.data?.status, detail.reload, id])
  useEffect(() => { if (terminal.current !== null) terminal.current.scrollTop = terminal.current.scrollHeight }, [logs])

  const visibleLogs = useMemo(() => query.trim() === '' ? logs : logs.split('\n').filter(line => line.toLowerCase().includes(query.trim().toLowerCase())).join('\n'), [logs, query])

  async function action(kind: 'cancel' | 'rerun'): Promise<void> {
    setMessage(undefined)
    try {
      const run = await request<RunSummary>(`/api/runs/${id}/${kind}`, jsonRequest('POST'))
      if (kind === 'rerun') void navigate(`/runs/${run.id}`)
      else detail.reload()
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }

  return (
    <section className="page">
      <Link className="back-link" to="/runs">← 返回运行历史</Link>
      {detail.loading ? <LoadingState /> : detail.error !== undefined ? <ErrorState message={detail.error} retry={detail.reload} /> : detail.data === undefined ? null : <>
        <PageHeader eyebrow={`RUN / ${detail.data.id.slice(0, 8)}`} title={detail.data.taskName} description={`${modeLabel(detail.data.mode)} · ${formatDate(detail.data.startedAt)}`} actions={<>{detail.data.status === 'running' ? <button className="danger" onClick={() => void action('cancel')}>取消任务</button> : <button className="primary compact" onClick={() => void action('rerun')}>重新运行</button>}</>} />
        {message === undefined ? null : <p className="inline-error" role="alert">{message}</p>}
        <div className="run-facts"><article><span>状态</span><StatusBadge status={detail.data.status} /></article><article><span>耗时</span><strong>{formatDuration(detail.data.startedAt, detail.data.endedAt)}</strong></article><article><span>日志行</span><strong>{detail.data.logCount}</strong></article><article><span>退出码</span><strong>{detail.data.exitCode ?? '—'}</strong></article></div>
        <article className="panel terminal-panel"><div className="terminal-tools"><div><i /><i /><i /><span>kernelpilot/runtime</span></div><label>搜索日志<input value={query} onChange={event => setQuery(event.target.value)} placeholder="错误或关键字" /></label><a href={`/api/runs/${id}/logs`} download>下载</a><button onClick={() => void navigator.clipboard.writeText(logs)}>复制</button></div><pre ref={terminal} tabIndex={0} aria-label="运行日志">{visibleLogs || '等待输出…'}</pre></article>
      </>}
    </section>
  )
}
