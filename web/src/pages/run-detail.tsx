import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { jsonRequest, request, useApi } from '../api'
import { EmptyState, ErrorState, formatDate, formatDuration, LoadingState, modeLabel, PageHeader, StatusBadge } from '../components'
import type { ArtifactSummary, CandidateAnalysis, RunDetail, RunSummary, WebSettings } from '../types'

type Tab = 'summary' | 'logs' | 'candidates' | 'artifacts'

export function RunDetailPage() {
  const { id = '' } = useParams()
  const detail = useApi<RunDetail>(`/api/runs/${id}`)
  const artifacts = useApi<ArtifactSummary[]>(`/api/runs/${id}/artifacts`)
  const settings = useApi<WebSettings>('/api/settings')
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('summary')
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
      if (payload.status !== 'running') { detail.reload(); artifacts.reload() }
    })
    return () => events.close()
  }, [artifacts.reload, detail.data?.status, detail.reload, id])
  useEffect(() => { if (settings.data?.autoScroll !== false && terminal.current !== null) terminal.current.scrollTop = terminal.current.scrollHeight }, [logs, settings.data?.autoScroll, tab])

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
        <div className="run-facts"><article><span>状态</span><StatusBadge status={detail.data.status} /></article><article><span>耗时</span><strong>{formatDuration(detail.data.startedAt, detail.data.endedAt)}</strong></article><article><span>候选</span><strong>{detail.data.analysis.candidates.length}</strong></article><article><span>最佳加速</span><strong>{detail.data.analysis.bestSpeedup === null ? '—' : `${detail.data.analysis.bestSpeedup.toFixed(2)}×`}</strong></article></div>
        <div className="detail-tabs" role="tablist" aria-label="运行详情">
          {([['summary','指标'],['logs','日志'],['candidates','候选与 Diff'],['artifacts','产物']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}</button>)}
        </div>
        {tab === 'summary' ? <SummaryPanel detail={detail.data} /> : null}
        {tab === 'logs' ? <article className={`panel terminal-panel ${settings.data?.logWrap === false ? 'no-wrap' : ''}`}><div className="terminal-tools"><div><i /><i /><i /><span>kernelpilot/runtime</span></div><label>搜索日志<input value={query} onChange={event => setQuery(event.target.value)} placeholder="错误或关键字" /></label><a href={`/api/runs/${id}/logs`} download>下载</a><button onClick={() => void navigator.clipboard.writeText(logs)}>复制</button></div><pre ref={terminal} tabIndex={0} aria-label="运行日志">{visibleLogs || '等待输出…'}</pre></article> : null}
        {tab === 'candidates' ? <CandidatesPanel candidates={detail.data.analysis.candidates} bestId={detail.data.analysis.bestCandidateId} /> : null}
        {tab === 'artifacts' ? <ArtifactsPanel id={id} artifacts={artifacts.data ?? []} loading={artifacts.loading} error={artifacts.error} retry={artifacts.reload} /> : null}
      </>}
    </section>
  )
}

function SummaryPanel({ detail }: { detail: RunDetail }) {
  const baseline = benchmarkFrom(detail.analysis.baseline)
  const candidates = detail.analysis.candidates.map(candidate => ({ candidate, benchmark: record(candidate.benchmark) })).filter(item => item.benchmark !== undefined)
  const medianValues = [numberField(baseline, 'medianMs'), ...candidates.map(item => numberField(item.benchmark, 'medianMs'))].filter((value): value is number => value !== undefined)
  const maximum = Math.max(...medianValues, 1)
  return <div className="analysis-grid"><article className="panel metric-panel"><div className="panel-title"><div><span>GPU</span><h2>延迟对比</h2></div><p>越短越好</p></div>{baseline === undefined ? <EmptyState title="暂无结构化指标" description="运行完成后从真实输出读取。" /> : <div className="metric-bars"><MetricBar label="Baseline" value={numberField(baseline, 'medianMs')} maximum={maximum} unit="ms" />{candidates.map(item => <MetricBar key={item.candidate.id} label={item.candidate.id} value={numberField(item.benchmark, 'medianMs')} maximum={maximum} unit="ms" />)}</div>}</article><article className="panel metric-panel"><div className="panel-title"><div><span>STAT</span><h2>Baseline 统计</h2></div></div>{baseline === undefined ? <EmptyState title="暂无统计" description="Baseline 尚未产生有效结果。" /> : <dl className="stat-list"><Metric name="Median" value={formatNumber(numberField(baseline, 'medianMs'), ' ms')} /><Metric name="Mean" value={formatNumber(numberField(baseline, 'meanMs'), ' ms')} /><Metric name="P95" value={formatNumber(numberField(baseline, 'p95Ms'), ' ms')} /><Metric name="Variance" value={formatNumber(numberField(baseline, 'variance'))} /><Metric name="Bandwidth" value={formatNumber(numberField(baseline, 'effectiveBandwidthGbps'), ' GB/s')} /></dl>}</article></div>
}

function MetricBar({ label, value, maximum, unit }: { label: string; value: number | undefined; maximum: number; unit: string }) {
  const width = value === undefined ? 0 : Math.max(2, value / maximum * 100)
  return <div className="metric-bar"><div><span>{label}</span><strong>{value === undefined ? '—' : `${value.toFixed(4)} ${unit}`}</strong></div><i><b style={{ width: `${width}%` }} /></i></div>
}

function Metric({ name, value }: { name: string; value: string }) { return <div><dt>{name}</dt><dd>{value}</dd></div> }

function CandidatesPanel({ candidates, bestId }: { candidates: CandidateAnalysis[]; bestId: string | null }) {
  if (candidates.length === 0) return <EmptyState title="暂无候选" description="环境检查模式不会生成优化候选。" />
  return <div className="candidate-list">{candidates.map(candidate => {
    const proposal = record(candidate.proposal)
    const evaluation = record(candidate.evaluation)
    const validation = record(candidate.validation)
    const accepted = booleanField(evaluation, 'accepted')
    return <article className={`panel candidate-card ${bestId === candidate.id ? 'best' : ''}`} key={candidate.id}><header><div><span>{bestId === candidate.id ? 'BEST' : 'CANDIDATE'}</span><h2>{candidate.id}</h2></div><StatusBadge status={accepted === true ? 'completed' : accepted === false ? 'failed' : 'interrupted'} /></header><div className="candidate-body"><div className="candidate-copy"><h3>优化假设</h3><p>{stringField(proposal, 'hypothesis') ?? '未提供'}</p><dl><Metric name="加速比" value={formatNumber(numberField(evaluation, 'speedup'), '×')} /><Metric name="正确性" value={booleanField(validation, 'passed') === true ? '通过' : '未通过或未运行'} /></dl><h3>拒绝原因</h3><p>{arrayField(evaluation, 'reasons').join('；') || '无'}</p></div><div className="diff-view"><div>UNIFIED DIFF</div><pre>{stringField(proposal, 'patch') ?? '未记录 Diff'}</pre></div></div></article>
  })}</div>
}

function ArtifactsPanel({ id, artifacts, loading, error, retry }: { id: string; artifacts: ArtifactSummary[]; loading: boolean; error: string | undefined; retry: () => void }) {
  if (loading) return <LoadingState />
  if (error !== undefined) return <ErrorState message={error} retry={retry} />
  if (artifacts.length === 0) return <EmptyState title="暂无产物" description="自动优化产生的 Diff 与 NCU 报告会显示在这里。" />
  return <div className="artifact-list">{artifacts.map(artifact => <a className="panel" key={artifact.id} href={`/api/runs/${id}/artifacts/${artifact.id}`} download><span>{artifact.type === 'diff' ? 'DIFF' : 'NCU'}</span><strong>{artifact.name}</strong><small>{formatBytes(artifact.size)} · 下载</small></a>)}</div>
}

function record(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function benchmarkFrom(value: unknown): Record<string, unknown> | undefined { const outer = record(value); return record(outer?.benchmark) ?? outer }
function numberField(value: Record<string, unknown> | undefined, key: string): number | undefined { const field = value?.[key]; return typeof field === 'number' ? field : undefined }
function stringField(value: Record<string, unknown> | undefined, key: string): string | undefined { const field = value?.[key]; return typeof field === 'string' ? field : undefined }
function booleanField(value: Record<string, unknown> | undefined, key: string): boolean | undefined { const field = value?.[key]; return typeof field === 'boolean' ? field : undefined }
function arrayField(value: Record<string, unknown> | undefined, key: string): string[] { const field = value?.[key]; return Array.isArray(field) ? field.filter((item): item is string => typeof item === 'string') : [] }
function formatNumber(value: number | undefined, suffix = ''): string { return value === undefined ? '—' : `${value.toFixed(4)}${suffix}` }
function formatBytes(value: number): string { return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB` }
