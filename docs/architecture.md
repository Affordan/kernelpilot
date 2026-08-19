# 架构

KernelPilot 基于 DeepSeek Harness `0.1.0-rc.7`，参考上游提交 `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`。

## Harness 能力

| 能力 | Harness 机制 | KernelPilot 用法 |
|---|---|---|
| 插件 | Cordis `name`、`inject`、`apply` | 加载 `src/harness/plugin.ts` |
| 分发 | Bundle Patch | 使用 `cordis.patch.yml` |
| 工具 | `ctx.tools.register` | 注册 7 个 CUDA 工具 |
| Skills | `ctx.skills.register` | 按需加载 9 个 CUDA Skills |
| 子智能体 | Subagent/Fork | 生成独立优化假设 |
| 沙箱 | Sandbox 和 Approval | 限制文件与进程权限 |
| 会话 | Session | 保存模型和工具轨迹 |

## 结构

```text
DeepSeek Harness
├── Agent Loop
├── 子智能体
├── KernelPilot 插件
│   ├── 7 个受控工具
│   └── 9 个 CUDA Skills
└── Session

KernelPilot 插件
→ 本地执行后端
→ NVCC / Validator / Benchmark / NCU
→ 正确性门禁
→ 性能评估
→ 候选报告
```

优化核心不依赖 Cordis。Harness 适配层只使用公开的 Tool、Skill 和 Cordis API。

## 上下文

每轮只提供：

- 当前源码；
- 当前最佳指标；
- 性能诊断；
- 最近三次尝试；
- 相关 Skills；
- 优化目标；
- 剩余预算。

完整源码、NCU 原始报告和历史记录保存在磁盘。

## 会话

Harness Session 保存模型、工具和子智能体轨迹。

`JsonlEventStore` 保存优化事件、补丁、性能数据、验证结果和评估结论。两者分开是因为 rc.7 不支持插件动态注册新的 Session 事件类型。

## 已知限制

- Harness 仍处于预览阶段，API 可能变化；
- NCU 指标随 GPU 和版本变化；
- 当前没有 Web 服务；
- 模型响应时间取决于上游服务。
