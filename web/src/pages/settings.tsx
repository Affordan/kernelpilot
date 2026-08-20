import { useEffect, useState } from 'react'
import { ErrorState, LoadingState, PageHeader } from '../components'
import { jsonRequest, request, useApi } from '../api'
import type { WebSettings } from '../types'

export function SettingsPage() {
  const source = useApi<WebSettings>('/api/settings')
  const [settings, setSettings] = useState<WebSettings>()
  const [message, setMessage] = useState<string>()
  const [saving, setSaving] = useState(false)
  useEffect(() => setSettings(source.data), [source.data])

  function update<K extends keyof WebSettings>(key: K, value: WebSettings[K]): void {
    setSettings(current => current === undefined ? current : { ...current, [key]: value })
  }

  async function save(): Promise<void> {
    if (settings === undefined) return
    setSaving(true)
    setMessage(undefined)
    try {
      const saved = await request<WebSettings>('/api/settings', jsonRequest('PUT', settings))
      setSettings(saved)
      applyTheme(saved.theme)
      setMessage('设置已保存')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setSaving(false) }
  }

  return <section className="page"><PageHeader eyebrow="PREFERENCES" title="控制台设置" description="设置保存在本机 .kernelpilot/web/，不修改环境变量。" />{source.loading ? <LoadingState /> : source.error !== undefined ? <ErrorState message={source.error} retry={source.reload} /> : settings === undefined ? null : <article className="panel settings-panel"><Setting title="界面主题" description="跟随系统时自动匹配明暗外观"><select value={settings.theme} onChange={event => update('theme', event.target.value as WebSettings['theme'])}><option value="dark">深色</option><option value="light">浅色</option><option value="system">跟随系统</option></select></Setting><Setting title="日志自动换行" description="长行适配终端宽度"><input type="checkbox" checked={settings.logWrap} onChange={event => update('logWrap', event.target.checked)} /></Setting><Setting title="日志自动滚动" description="运行中跟随最新输出"><input type="checkbox" checked={settings.autoScroll} onChange={event => update('autoScroll', event.target.checked)} /></Setting><Setting title="历史保留数量" description="仅清理 Web 索引和日志副本，范围 20–500"><input type="number" min={20} max={500} value={settings.retention} onChange={event => update('retention', Number(event.target.value))} /></Setting><div className="settings-actions"><span role="status">{message}</span><button className="primary compact" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存设置'}</button></div></article>}</section>
}

function Setting({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <label className="setting-row"><span><strong>{title}</strong><small>{description}</small></span><span>{children}</span></label> }

export function applyTheme(theme: WebSettings['theme']): void {
  const resolved = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme
  document.documentElement.dataset.theme = resolved
}
