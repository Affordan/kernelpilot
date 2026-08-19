---
name: rmsnorm
description: Optimize CUDA RMSNorm fusion, reduction, access, and precision.
---

# RMSNorm

Use for `y = x * rsqrt(mean(x^2) + epsilon) * weight`. Inspect vector-load alignment, reduction stalls, launch count, bandwidth, occupancy, and register pressure across hidden sizes.

Fuse square accumulation, normalization, and weight application when synchronization and storage allow it. Use warp/block reduction according to hidden size, vectorize only with proven alignment, and retain FP32 sum-of-squares for FP16/BF16 inputs unless the task explicitly relaxes accuracy.

Validate diverse hidden sizes including non-vector tails, zero and large inputs, epsilon behavior, batches, and precision modes. Benchmark several representative hidden sizes; one tuned width is insufficient.

