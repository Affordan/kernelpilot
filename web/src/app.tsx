import { NavLink, Outlet, Route, Routes } from 'react-router-dom'

const routes = [
  ['/', '概览', 'OV'],
  ['/tasks', '任务', 'TK'],
  ['/runs', '运行历史', 'RN'],
  ['/system', '系统环境', 'SY'],
  ['/settings', '设置', 'ST'],
] as const

function Shell() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink className="brand" to="/" aria-label="KernelPilot 首页">
          <span className="brand-mark">KP</span>
          <span><strong>KernelPilot</strong><small>GPU OPTIMIZER</small></span>
        </NavLink>
        <nav aria-label="主导航">
          {routes.map(([to, label, code]) => (
            <NavLink key={to} end={to === '/'} to={to}>
              <span>{code}</span>{label}
            </NavLink>
          ))}
        </nav>
        <div className="runtime"><i />本地运行时<code>127.0.0.1</code></div>
      </aside>
      <main className="main-content"><Outlet /></main>
    </div>
  )
}

function Placeholder({ title, eyebrow }: { title: string; eyebrow: string }) {
  return (
    <section className="page page-placeholder">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>页面功能正在接入真实的本机 GPU 运行数据。</p>
    </section>
  )
}

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Placeholder title="优化控制台" eyebrow="CUDA EXECUTION FEEDBACK" />} />
        <Route path="tasks" element={<Placeholder title="优化任务" eyebrow="TASK REGISTRY" />} />
        <Route path="runs" element={<Placeholder title="运行历史" eyebrow="RUN HISTORY" />} />
        <Route path="runs/:id" element={<Placeholder title="运行详情" eyebrow="RUN DETAIL" />} />
        <Route path="system" element={<Placeholder title="系统环境" eyebrow="LOCAL TOOLCHAIN" />} />
        <Route path="settings" element={<Placeholder title="控制台设置" eyebrow="PREFERENCES" />} />
        <Route path="*" element={<Placeholder title="页面不存在" eyebrow="404" />} />
      </Route>
    </Routes>
  )
}
