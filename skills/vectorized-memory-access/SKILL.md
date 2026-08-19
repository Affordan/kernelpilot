---
name: vectorized-memory-access
description: Introduce aligned CUDA vector loads and stores safely.
---

# Vectorized memory access

Use for contiguous scalar traffic when base alignment and per-thread width can be proven. Inspect instruction counts, memory transactions, DRAM throughput, and tail frequency.

Consider `float2`/`float4`, `half2`, or explicit vector types. Prove pointer alignment at the API boundary, keep a scalar tail path, and avoid increasing register pressure enough to reduce useful occupancy. Vector access does not repair a bad warp-level access order.

Validate aligned and deliberately misaligned inputs, sizes not divisible by vector width, and aliasing. Benchmark sufficiently large inputs plus tail-heavy small inputs.

