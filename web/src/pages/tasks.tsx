import { useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { jsonRequest, request, useApi } from '../api'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../components'
import type { RunMode, RunSummary, TaskSummary } from '../types'

export function TasksPage() {
  const tasks = useApi<TaskSummary[]>('/api/tasks')
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<TaskSummary>()
  const [json, setJson] = useState('')
  const [message, setMessage] = useState<string>()
  const [busy, setBusy] = useState(false)

  function openEditor(task?: TaskSummary): void {
    setEditing(task)
    setJson(task === undefined ? '{\n  "id": "my-kernel"\n}' : JSON.stringify(task.task, null, 2))
    setMessage(undefined)
  }

  async function save(): Promise<void> {
    setBusy(true)
    setMessage(undefined)
    try {
      const task: unknown = JSON.parse(json)
      const url = editing === undefined ? '/api/tasks' : `/api/tasks/${editing.key}`
      await request<TaskSummary>(url, jsonRequest(editing === undefined ? 'POST' : 'PUT', { task }))
      setEditing(undefined)
      setJson('')
      tasks.reload()
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  async function remove(task: TaskSummary): Promise<void> {
    if (task.builtIn) return
    setBusy(true)
    try {
      await request<unknown>(`/api/tasks/${task.key}`, { method: 'DELETE' })
      tasks.reload()
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  async function start(task: TaskSummary, mode: RunMode): Promise<void> {
    setBusy(true)
    setMessage(undefined)
    try {
      const run = await request<RunSummary>('/api/runs', jsonRequest('POST', { task: task.key, mode }))
      void navigate(`/runs/${run.id}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  function loadFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    if (file === undefined) return
    void file.text().then(text => { setEditing(undefined); setJson(text); setMessage(undefined) })
    event.target.value = ''
  }

  return (
    <section className="page">
      <PageHeader eyebrow="TASK REGISTRY" title="优化任务" description="管理经过约束校验的本机 CUDA 优化任务。" actions={<><input ref={input} hidden type="file" accept="application/json,.json" onChange={loadFile} /><button className="secondary" onClick={() => input.current?.click()}>导入 JSON</button><button className="primary compact" onClick={() => openEditor()}>新建任务</button></>} />
      {message === undefined ? null : <p className="inline-error" role="alert">{message}</p>}
      {json === '' ? null : <article className="panel editor-panel"><div className="panel-title"><div><span>JSON</span><h2>{editing === undefined ? '导入任务' : `编辑 ${editing.name}`}</h2></div><button onClick={() => setJson('')}>关闭</button></div><textarea aria-label="任务 JSON" spellCheck={false} value={json} onChange={event => setJson(event.target.value)} /><div className="editor-actions"><button className="secondary" onClick={() => setJson('')}>取消</button><button className="primary compact" disabled={busy} onClick={() => void save()}>{busy ? '校验中…' : '校验并保存'}</button></div></article>}
      {tasks.loading ? <LoadingState /> : tasks.error !== undefined ? <ErrorState message={tasks.error} retry={tasks.reload} /> : tasks.data?.length === 0 ? <EmptyState title="没有任务" description="导入工作区内可执行的 task.json。" /> : (
        <div className="task-grid">{tasks.data?.map(task => <article className="panel task-card" key={task.key}>
          <div className="task-kind">{task.builtIn ? 'BUILT-IN' : 'CUSTOM'}</div><h2>{task.name}</h2><code>{task.taskPath}</code>
          <dl><div><dt>Kernel</dt><dd>{task.kernelName}</dd></div><div><dt>架构</dt><dd>{task.architecture}</dd></div><div><dt>最低加速</dt><dd>{task.minimumSpeedup.toFixed(2)}×</dd></div></dl>
          <div className="card-actions"><button disabled={busy} onClick={() => void start(task, 'baseline')}>环境检查</button><button className="primary compact" disabled={busy} onClick={() => void start(task, 'optimize')}>自动优化</button></div>
          {task.builtIn ? null : <div className="sub-actions"><button onClick={() => openEditor(task)}>编辑</button><button className="danger-link" disabled={busy} onClick={() => void remove(task)}>删除</button></div>}
        </article>)}</div>
      )}
    </section>
  )
}
