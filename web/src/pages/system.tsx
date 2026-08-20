import { PageHeader } from '../components'

export function SystemPage() { return <section className="page"><PageHeader eyebrow="LOCAL TOOLCHAIN" title="系统环境" description="检查本机 GPU 与 CUDA 工具链。" /><div className="empty-state"><span>···</span><strong>等待环境诊断接口</strong><p>这里不会显示任何凭据内容。</p></div></section> }
