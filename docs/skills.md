# CUDA Skills

Skill 是优化规则，不保证一定产生更快的代码。每个 Skill 包含：

- 适用条件；
- 相关 NCU 指标；
- 优化方法；
- 风险；
- 正确性检查；
- Benchmark 要求。

当前包含：

- memory-coalescing
- vectorized-memory-access
- shared-memory
- bank-conflict
- warp-shuffle
- reduction
- occupancy
- fp16
- rmsnorm

Harness 只加载当前诊断需要的 Skill。

每个候选必须给出优化假设、预期指标变化、风险、使用的 Skills 和统一 Diff。不同候选应采用不同优化方向。
