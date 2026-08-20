import { ErrorState, formatDate, LoadingState, PageHeader } from '../components'
import { useApi } from '../api'
import type { SystemSnapshot } from '../types'

export function SystemPage() {
  const system = useApi<SystemSnapshot>('/api/system')
  return <section className="page"><PageHeader eyebrow="LOCAL TOOLCHAIN" title="系统环境" description="只读检查本机 GPU、CUDA 工具链和模型凭据状态。" actions={<button className="secondary" onClick={system.reload}>重新检查</button>} />{system.loading ? <LoadingState /> : system.error !== undefined ? <ErrorState message={system.error} retry={system.reload} /> : system.data === undefined ? null : <><div className="environment-summary"><span>平台</span><strong>{system.data.platform}</strong><small>检查时间：{formatDate(system.data.checkedAt)}</small></div><div className="diagnostic-grid">{system.data.tools.map(tool => <article className="panel diagnostic-card" key={tool.key}><div className={`diagnostic-icon ${tool.status}`}>{tool.status === 'available' ? '✓' : '!'}</div><div><span>{tool.key.toUpperCase()}</span><h2>{tool.name}</h2><strong>{tool.version ?? (tool.status === 'available' ? '已安装' : '未发现')}</strong><p>{tool.detail}</p></div></article>)}</div><article className="panel credentials-panel"><div className="panel-title"><div><span>ENV</span><h2>模型配置</h2></div><p>只显示是否存在</p></div><div><Credential label="DEEPSEEK_API_KEY" exists={system.data.credentials.deepseekApiKey} /><Credential label="DEEPSEEK_BASE_URL" exists={system.data.credentials.deepseekBaseUrl} /></div></article></>}</section>
}

function Credential({ label, exists }: { label: string; exists: boolean }) { return <div className="credential-row"><code>{label}</code><span className={exists ? 'exists' : 'missing'}>{exists ? '已配置' : '未配置'}</span></div> }
