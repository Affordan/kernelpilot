import { Link, NavLink, Route, Routes } from 'react-router-dom'

const github = 'https://github.com/Affordan/kernelpilot'

function Layout({ children }: { children: React.ReactNode }) {
  return <><header><Link className="logo" to="/"><span>KP</span><strong>KernelPilot</strong></Link><nav><NavLink to="/features">功能</NavLink><NavLink to="/install">安装</NavLink><a href={github}>GitHub ↗</a></nav></header><main>{children}</main><footer><strong>KernelPilot</strong><span>真实数据 · 隔离候选 · 正确性硬门禁</span><a href={github}>MIT License</a></footer></>
}

function Home() { return <><section className="hero"><p>DEEPSEEK HARNESS / CUDA EXECUTION FEEDBACK</p><h1>用真实执行反馈<br/><em>优化 CUDA Kernel</em></h1><div><p>本机完成编译、正确性验证、Benchmark、Nsight Compute 分析和候选选择。</p><span><Link to="/install">开始使用</Link><a href={github}>查看源码</a></span></div></section><section className="proof"><div><span>01</span><strong>真实 GPU</strong><p>性能结论只来自本机重复 Benchmark。</p></div><div><span>02</span><strong>正确性优先</strong><p>编译和验证失败的候选不会进入评分。</p></div><div><span>03</span><strong>可审计</strong><p>保存候选、Diff、指标和拒绝原因。</p></div></section><section className="workflow"><p>WORKFLOW</p><h2>从基线到有效候选</h2><ol><li>编译与验证基线</li><li>Benchmark 与 NCU 分析</li><li>生成隔离候选</li><li>重新验证与测量</li><li>选择最快有效结果</li></ol></section></> }

function Features() { const items = [['本地 Web 控制台','任务、历史、实时日志、指标与产物集中管理。'],['DeepSeek Harness','让 Agent 基于工具和 Skills 执行有边界的优化流程。'],['Nsight Compute','使用真实硬件指标定位带宽、占用率和访存问题。'],['隔离执行','候选只在 .kernelpilot 工作区编译和验证。'],['结构化决策','记录候选假设、验证结果、速度和拒绝原因。'],['命令安全','固定工具、参数数组、路径约束和请求来源校验。']]; return <section className="inner"><p>CAPABILITIES</p><h1>为 CUDA 优化而生</h1><div className="feature-grid">{items.map(([title,copy],index)=><article key={title}><span>{String(index+1).padStart(2,'0')}</span><h2>{title}</h2><p>{copy}</p></article>)}</div></section> }

function Install() { return <section className="inner install"><p>LOCAL FIRST</p><h1>在本机启动</h1><div className="requirements"><article><h2>环境</h2><ul><li>Node.js 22.19+</li><li>pnpm 11</li><li>NVIDIA GPU</li><li>CUDA Toolkit 与 Nsight Compute</li><li>Windows C++ Build Tools</li></ul></article><article><h2>启动 Web</h2><pre><code>git clone {github}{'\n'}cd kernelpilot{'\n'}pnpm install{'\n'}pnpm web</code></pre><p>浏览器访问 <code>http://127.0.0.1:4317</code></p></article></div><div className="notice"><strong>本地执行</strong><p>Vercel 只托管此产品站。CUDA 编译、模型凭据和运行产物始终留在本机。</p></div></section> }

function Missing() { return <section className="inner"><p>404</p><h1>页面不存在</h1><Link className="back" to="/">返回首页</Link></section> }

export function Site() { return <Layout><Routes><Route index element={<Home/>}/><Route path="features" element={<Features/>}/><Route path="install" element={<Install/>}/><Route path="*" element={<Missing/>}/></Routes></Layout> }
