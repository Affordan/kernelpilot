import { PageHeader } from '../components'

export function SettingsPage() { return <section className="page"><PageHeader eyebrow="PREFERENCES" title="控制台设置" description="管理本机显示和历史保留策略。" /><div className="empty-state"><span>···</span><strong>等待设置接口</strong><p>设置只保存在 .kernelpilot/web/。</p></div></section> }
