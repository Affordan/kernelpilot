---
name: occupancy
description: Balance CUDA occupancy against registers, shared memory, and useful work.
---

# Occupancy

Use when achieved occupancy or eligible warps is low and latency hiding limits the kernel. Inspect registers per thread, shared bytes per block, blocks/SM, active warps, spills, and stall reasons.

Vary block size, reduce unnecessary live ranges, control unrolling, or change tile dimensions. Treat occupancy as a diagnostic, not the objective: lower occupancy can win when it enables reuse or instruction reduction. Avoid register caps that introduce local-memory spills.

Validate every launch shape and benchmark a small matrix of block sizes. Report latency together with registers, spills, and achieved occupancy.

