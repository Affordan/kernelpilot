import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { jsonRequest, request, useApi } from '../api'
import { ErrorState, LoadingState, PageHeader, RunTable, StatusBadge } from '../components'
import type { Overview, RunMode, RunSummary, TaskSummary } from '../types'

export function OverviewPage() {
  const overview = useApi<Overview>('/api/overview')
  const tasks = useApi<TaskSummary[]>('/api/tasks')
  const navigate = useNavigate()
  const [task, setTask] = useState('reduction')
  const [mode, setMode] = useState<RunMode>('baseline')
  const [starting, setStarting] = useState(false)
  const [message, setMessage] = useState<string>()

  async function start(): Promise<void> {
    setStarting(true)
    setMessage(undefined)
    try {
      const run = await request<RunSummary>('/api/runs', jsonRequest('POST', { task, mode }))
      void navigate(`/runs/${run.id}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally { setStarting(false) }
  }

  return (
    <section className="page">
      <PageHeader eyebrow="CUDA EXECUTION FEEDBACK" title="概览" description="从真实编译、验证和性能证据进入下一次优化。" />
      {overview.loading ? <LoadingState /> : overview.error !== undefined ? <ErrorState message={overview.error} retry={overview.reload} /> : overview.data === undefined ? null : (
        <>
          <div className="metric-grid">
            <article><span>运行总数</span><strong>{overview.data.runCount}</strong><small>本机持久记录</small></article>
            <article><span>成功率</span><strong>{overview.data.successRate === null ? '—' : `${Math.round(overview.data.successRate * 100)}%`}</strong><small>完成 / 全部运行</small></article>
            <article><span>最佳加速</span><strong>{overview.data.bestSpeedup === null ? '—' : `${overview.data.bestSpeedup.toFixed(2)}×`}</strong><small>真实 Benchmark</small></article>
            <article><span>任务数量</span><strong>{overview.data.taskCount}</strong><small>内置与自定义</small></article>
          </div>
          <div className="dashboard-grid">
            <article className="panel quick-start">
              <div className="panel-title"><div><span>01</span><h2>快速启动</h2></div><p>一次只运行一个 GPU 任务</p></div>
              {tasks.loading ? <LoadingState /> : tasks.error !== undefined ? <ErrorState message={tasks.error} retry={tasks.reload} /> : (
                <div className="form-stack">
                  <label>任务<select value={task} onChange={event => setTask(event.target.value)}>{tasks.data?.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label>
                  <fieldset><legend>运行模式</legend><div className="segmented">
                    <button className={mode === 'baseline' ? 'active' : ''} onClick={() => setMode('baseline')}><strong>环境检查</strong><span>编译 · 验证 · Benchmark</span></button>
                    <button className={mode === 'optimize' ? 'active' : ''} onClick={() => setMode('optimize')}><strong>自动优化</strong><span>Harness · NCU · 候选</span></button>
                  </div></fieldset>
                  <button className="primary" disabled={starting || tasks.data?.length === 0} onClick={() => void start()}>{starting ? '正在启动…' : '启动运行 →'}</button>
                  {message === undefined ? null : <p className="inline-error" role="alert">{message}</p>}
                </div>
              )}
            </article>
            <article className="panel active-run">
              <div className="panel-title"><div><span>02</span><h2>当前运行</h2></div></div>
              {overview.data.activeRun === null ? <div className="idle-orbit"><i /><strong>IDLE</strong><span>GPU 队列空闲</span></div> : (
                <div className="active-summary"><StatusBadge status={overview.data.activeRun.status} /><h3>{overview.data.activeRun.taskName}</h3><p>{overview.data.activeRun.id}</p><button onClick={() => void navigate(`/runs/${overview.data?.activeRun?.id ?? ''}`)}>查看实时详情</button></div>
              )}
            </article>
          </div>
          <article className="panel recent-panel"><div className="panel-title"><div><span>03</span><h2>最近运行</h2></div><button onClick={() => void navigate('/runs')}>查看全部</button></div><RunTable runs={overview.data.recentRuns} /></article>
        </>
      )}
    </section>
  )
}
