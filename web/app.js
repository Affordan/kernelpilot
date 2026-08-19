const state = {
  tasks: [],
  runs: [],
  selectedTask: 'reduction',
  mode: 'baseline',
  current: null,
  events: null,
  startedAt: null,
  lineCount: 0,
}

const elements = {
  taskList: document.querySelector('#task-list'),
  start: document.querySelector('#start-button'),
  cancel: document.querySelector('#cancel-button'),
  message: document.querySelector('#form-message'),
  terminal: document.querySelector('#terminal'),
  clear: document.querySelector('#clear-button'),
  status: document.querySelector('#run-status'),
  caption: document.querySelector('#status-caption'),
  task: document.querySelector('#metric-task'),
  mode: document.querySelector('#metric-mode'),
  duration: document.querySelector('#metric-duration'),
  lines: document.querySelector('#metric-lines'),
  progress: document.querySelector('#progress-bar'),
  history: document.querySelector('#history-list'),
}

document.querySelectorAll('.mode').forEach(button => {
  button.addEventListener('click', () => {
    state.mode = button.dataset.mode
    document.querySelectorAll('.mode').forEach(item => {
      const active = item === button
      item.classList.toggle('active', active)
      item.setAttribute('aria-checked', String(active))
    })
  })
})

elements.start.addEventListener('click', startRun)
elements.cancel.addEventListener('click', cancelRun)
elements.clear.addEventListener('click', () => {
  elements.terminal.textContent = ''
  state.lineCount = 0
  elements.lines.textContent = '0'
})

setInterval(updateDuration, 1000)
void initialize()

async function initialize() {
  try {
    const [tasks, runs] = await Promise.all([request('/api/tasks'), request('/api/runs')])
    state.tasks = tasks
    state.runs = runs
    renderTasks()
    renderHistory()
    const running = runs.find(run => run.status === 'running')
    if (running) attachRun(running, true)
  } catch (error) {
    elements.message.textContent = formatError(error)
  }
}

function renderTasks() {
  elements.taskList.replaceChildren(...state.tasks.map(task => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `task-option${task.key === state.selectedTask ? ' active' : ''}`
    button.dataset.task = task.key
    button.setAttribute('aria-pressed', String(task.key === state.selectedTask))
    const title = document.createElement('strong')
    title.textContent = task.name
    const path = document.createElement('span')
    path.textContent = task.taskPath
    button.append(title, path)
    button.addEventListener('click', () => {
      state.selectedTask = task.key
      renderTasks()
    })
    return button
  }))
}

async function startRun() {
  elements.message.textContent = ''
  elements.start.disabled = true
  try {
    const run = await request('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: state.selectedTask, mode: state.mode }),
    })
    attachRun(run, false)
  } catch (error) {
    elements.message.textContent = formatError(error)
    elements.start.disabled = false
  }
}

function attachRun(run, preserveTerminal) {
  state.current = run
  state.startedAt = new Date(run.startedAt)
  state.lineCount = 0
  if (!preserveTerminal) elements.terminal.textContent = ''
  setRunStatus(run)
  elements.start.disabled = true
  elements.cancel.hidden = false
  state.events?.close()
  state.events = new EventSource(`/api/runs/${run.id}/events`)
  state.events.addEventListener('log', event => {
    const payload = JSON.parse(event.data)
    appendTerminal(payload.text)
  })
  state.events.addEventListener('status', event => {
    const next = JSON.parse(event.data)
    state.current = next
    setRunStatus(next)
    if (next.status !== 'running') finishRun(next)
  })
  state.events.onerror = async () => {
    if (!state.current || state.current.status !== 'running') return
    try {
      const latest = await request(`/api/runs/${state.current.id}`)
      state.current = latest
      setRunStatus(latest)
      if (latest.status !== 'running') finishRun(latest)
    } catch { /* 连接恢复交给 EventSource */ }
  }
}

function appendTerminal(text) {
  const cleaned = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '')
  elements.terminal.append(document.createTextNode(cleaned))
  state.lineCount += Math.max(1, cleaned.split('\n').length - 1)
  elements.lines.textContent = String(state.lineCount)
  elements.terminal.scrollTop = elements.terminal.scrollHeight
}

function setRunStatus(run) {
  const labels = { running: 'RUNNING', completed: 'PASSED', failed: 'FAILED', cancelled: 'CANCELLED' }
  elements.status.className = `run-status ${run.status}`
  elements.status.textContent = labels[run.status] ?? run.status.toUpperCase()
  elements.caption.textContent = run.status === 'running' ? '正在执行真实 GPU 流程' : statusText(run.status)
  elements.task.textContent = run.taskName
  elements.mode.textContent = run.mode === 'baseline' ? '环境检查' : '自动优化'
  elements.progress.className = run.status
}

async function finishRun(run) {
  state.events?.close()
  state.events = null
  elements.start.disabled = false
  elements.cancel.hidden = true
  const detail = await request(`/api/runs/${run.id}`)
  if (!elements.terminal.textContent && detail.logs) detail.logs.forEach(appendTerminal)
  state.runs = await request('/api/runs')
  renderHistory()
}

async function cancelRun() {
  if (!state.current) return
  elements.cancel.disabled = true
  try {
    await request(`/api/runs/${state.current.id}/cancel`, { method: 'POST' })
  } catch (error) {
    elements.message.textContent = formatError(error)
  } finally {
    elements.cancel.disabled = false
  }
}

function renderHistory() {
  if (!state.runs.length) {
    elements.history.innerHTML = '<p class="empty">暂无运行记录</p>'
    return
  }
  elements.history.replaceChildren(...state.runs.map(run => {
    const row = document.createElement('div')
    row.className = 'history-item'
    const title = document.createElement('button')
    title.type = 'button'
    title.textContent = run.taskName
    title.addEventListener('click', () => loadHistoricalRun(run))
    const mode = document.createElement('span')
    mode.textContent = run.mode === 'baseline' ? '环境检查' : '自动优化'
    const time = document.createElement('span')
    time.textContent = new Date(run.startedAt).toLocaleString('zh-CN', { hour12: false })
    const status = document.createElement('span')
    status.textContent = statusText(run.status)
    status.className = run.status === 'completed' ? 'ok' : run.status === 'running' ? '' : 'bad'
    row.append(title, mode, time, status)
    return row
  }))
}

async function loadHistoricalRun(run) {
  const detail = await request(`/api/runs/${run.id}`)
  elements.terminal.textContent = ''
  state.lineCount = 0
  detail.logs.forEach(appendTerminal)
  state.current = detail
  state.startedAt = new Date(detail.startedAt)
  setRunStatus(detail)
}

function updateDuration() {
  if (!state.startedAt) return
  const end = state.current?.endedAt ? new Date(state.current.endedAt) : new Date()
  const seconds = Math.max(0, Math.floor((end - state.startedAt) / 1000))
  elements.duration.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function statusText(status) {
  return ({ running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消' })[status] ?? status
}

async function request(url, options) {
  const response = await fetch(url, options)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? `请求失败：${response.status}`)
  return data
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error)
}
