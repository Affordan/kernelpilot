# KernelPilot 开发规范

KernelPilot 是 DeepSeek Harness 的独立 CUDA 优化插件。优化核心不得依赖模型运行时，Harness 适配层只负责注册工具和 Skills。

## 目录

- `src/domain`：Schema 和领域类型；
- `src/core`：统计、评估、上下文、事件和搜索流程；
- `src/backends`：本地执行和工具链发现；
- `src/harness`：Harness 插件；
- `src/ncu`：NCU 解析；
- `skills`：CUDA Skills；
- `examples`：CUDA 示例和任务；
- `tests`：单元测试和真实 GPU 测试；
- `docs`：项目文档。

## 命令

使用 Node.js 22.19+ 和 pnpm 11。

```text
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm baseline examples/reduction/task.json
pnpm test:gpu
```

没有 `nvcc` 或 NVIDIA GPU 时，`test:gpu` 自动跳过。

## 安全要求

- 不执行模型生成的 Shell 命令；
- 子进程使用固定可执行文件和参数数组；
- 所有路径必须位于工作区；
- 不下载脚本，不修改系统配置和其他仓库；
- 不使用破坏性 Git 命令；
- 候选修改只发生在隔离目录；
- 所有子进程必须有超时、取消信号和退出码检查；
- 正确性是硬门禁；
- 只能报告真实 Benchmark 数据。

## 完成标准

提交前必须通过相关测试、`pnpm typecheck`、`pnpm lint`、`pnpm build` 和 `git diff --check`。GPU 功能必须有条件测试，文档必须与实现一致。
