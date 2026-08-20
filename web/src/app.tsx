import { useState } from 'react'
import { NavLink, Outlet, Route, Routes } from 'react-router-dom'
import { OverviewPage } from './pages/overview'
import { TasksPage } from './pages/tasks'
import { RunsPage } from './pages/runs'
import { RunDetailPage } from './pages/run-detail'
import { SystemPage } from './pages/system'
import { SettingsPage } from './pages/settings'

const routes = [
  ['/', '概览', 'OV'],
  ['/tasks', '任务', 'TK'],
  ['/runs', '运行历史', 'RN'],
  ['/system', '系统环境', 'SY'],
  ['/settings', '设置', 'ST'],
] as const

function Shell() {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div className="app-shell">
      <header className="mobile-header"><NavLink className="brand" to="/"><span className="brand-mark">KP</span><strong>KernelPilot</strong></NavLink><button aria-expanded={menuOpen} aria-controls="main-navigation" onClick={() => setMenuOpen(value => !value)}>{menuOpen ? '关闭' : '菜单'}</button></header>
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <NavLink className="brand desktop-brand" to="/" aria-label="KernelPilot 首页">
          <span className="brand-mark">KP</span><span><strong>KernelPilot</strong><small>GPU OPTIMIZER</small></span>
        </NavLink>
        <nav id="main-navigation" aria-label="主导航">
          {routes.map(([to, label, code]) => <NavLink key={to} end={to === '/'} to={to} onClick={() => setMenuOpen(false)}><span>{code}</span>{label}</NavLink>)}
        </nav>
        <div className="runtime"><i />本地运行时<code>127.0.0.1</code></div>
      </aside>
      {menuOpen ? <button className="menu-scrim" aria-label="关闭菜单" onClick={() => setMenuOpen(false)} /> : null}
      <main className="main-content"><Outlet /></main>
    </div>
  )
}

function NotFoundPage() { return <section className="page page-placeholder"><p className="eyebrow">404</p><h1>页面不存在</h1><NavLink className="primary compact" to="/">返回概览</NavLink></section> }

export function App() {
  return <Routes><Route element={<Shell />}><Route index element={<OverviewPage />} /><Route path="tasks" element={<TasksPage />} /><Route path="runs" element={<RunsPage />} /><Route path="runs/:id" element={<RunDetailPage />} /><Route path="system" element={<SystemPage />} /><Route path="settings" element={<SettingsPage />} /><Route path="*" element={<NotFoundPage />} /></Route></Routes>
}
