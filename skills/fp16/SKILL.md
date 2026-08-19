---
name: fp16
description: Use CUDA half precision under explicit accuracy and accumulation rules.
---

# FP16

Use only when the task permits reduced storage or arithmetic precision. Inspect tensor/FP16 pipeline utilization, conversion instructions, bandwidth, and whether half2 vectorization applies.

Prefer FP32 accumulation for reductions unless error analysis authorizes otherwise. Define scaling, overflow, underflow, denormal, NaN, and rounding behavior. Conversions can erase the expected gain.

Validate extreme magnitudes, near-zero inputs, non-finite values if permitted, and application-specific error distributions—not only max error. Benchmark with and without conversion overhead.

