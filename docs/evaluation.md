# 评估规则

当前目标是降低 Kernel 延迟。

设基线延迟为 `T0`，候选延迟为 `Tc`：

```text
speedup = T0 / Tc
```

候选必须同时满足：

- 编译成功；
- 正确性验证通过；
- Benchmark 数据有效；
- 加速比达到 `minimumSpeedup`；
- 方差不超过 `maximumVariance`。

候选在隔离目录中执行。最终加速比始终相对原始基线计算。失败原因会保存在报告和事件日志中。

KernelPilot 没有模拟执行模式。所有结果来自本机 NVCC、GPU 和 NCU。

`evaluate_candidate` 只读取工具已记录的编译、验证和 Benchmark 结果，模型不能自行填写性能数据。
