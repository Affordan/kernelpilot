# KernelPilot

KernelPilot 是基于 DeepSeek Harness 的 CUDA Kernel 自动优化工具，提供本地 Web 控制台和命令行。

## DeepSeek Harness 是什么

DeepSeek Harness 是 Agent 运行时，不是模型，也不是 Web 框架。它负责：

- 调用大模型；
- 运行 Agent Loop；
- 注册和执行工具；
- 加载 Skills；
- 调度子智能体；
- 保存会话；
- 管理沙箱和权限。

KernelPilot 作为 Harness 插件，提供 CUDA 编译、正确性验证、Benchmark、Nsight Compute 分析、源码补丁和候选评估能力。

## 工作流程

```text
读取任务
→ 编译并验证基线
→ Benchmark 和 NCU 分析
→ 生成多个优化候选
→ 隔离应用补丁
→ 编译和正确性验证
→ 重复 Benchmark
→ 选择最快的有效候选
```

性能结论只来自本机真实运行结果。

## 环境要求

- Node.js 22.19+
- pnpm 11
- NVIDIA GPU
- CUDA Toolkit：`nvcc`
- Nsight Compute：`ncu`
- Windows：Visual Studio C++ Build Tools

Windows 下会自动发现 MSVC 和 Nsight Compute。

## 安装

```powershell
pnpm install
```

## 启动 Web 控制台

```powershell
pnpm web
```

浏览器访问：

```text
http://127.0.0.1:4317
```

页面支持：

- 选择 Reduction 或 Elementwise；
- 运行环境检查或自动优化；
- 查看实时日志和运行状态；
- 取消当前任务；
- 查看本次服务启动后的历史记录。

服务只监听本机地址，不提供登录和远程访问。

## 命令行检查

无需模型密钥：

```powershell
pnpm baseline examples/reduction/task.json
```

该命令会完成真实编译、正确性验证和重复 Benchmark。

## 命令行自动优化

在 `.env` 中配置：

```text
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=...
```

然后运行：

```powershell
pnpm optimize:reduction
pnpm optimize:elementwise
```

启动器只在内存中读取 `.env`，不会修改该文件。

## 输出目录

所有运行产物位于 `.kernelpilot/`：

- `candidates/`：候选源码；
- `checkpoints/`：源码检查点；
- `diffs/`：候选补丁；
- `reports/`：NCU 报告；
- `workspaces/`：编译目录；
- `launch/`：Harness 启动目录。

原始示例源码不会被修改。

## 测试

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:gpu
pnpm build
```

`test:gpu` 会使用真实 GPU 编译、验证、Benchmark 和 NCU。缺少 CUDA 环境时自动跳过。

## 任务文件

[examples/reduction/task.json](examples/reduction/task.json) 定义：

- 源码和 Kernel 名称；
- NVCC 命令和编译参数；
- 正确性容差；
- Benchmark 次数和超时；
- NCU 指标；
- 最低加速比；
- 候选数量和总预算。

更多说明：

- [架构](docs/architecture.md)
- [工具](docs/tool-design.md)
- [Skills](docs/skills.md)
- [评估规则](docs/evaluation.md)
