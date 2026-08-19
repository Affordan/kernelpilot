---
name: reduction
description: Optimize hierarchical CUDA reductions with explicit numerical constraints.
---

# Reduction

Use for sum, max, norm, and related associative operations. Inspect latency, memory throughput, barrier stalls, occupancy, register pressure, and launch count.

Progress from coalesced per-thread accumulation to warp reduction and then block/grid aggregation. Consider multiple elements per thread and vector loads when aligned. Do not assume floating-point associativity; define accumulation precision and deterministic requirements.

Validate empty/minimal inputs if supported, arbitrary tails, NaN/Inf policy, adversarial magnitudes, and multiple shapes. Benchmark end-to-end launch count as well as the target kernel.

