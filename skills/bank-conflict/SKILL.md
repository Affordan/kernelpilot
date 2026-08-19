---
name: bank-conflict
description: Diagnose and remove CUDA shared-memory bank conflicts.
---

# Bank conflicts

Use when shared-memory traffic or replay is high despite modest data volume, especially for column access, transposes, or power-of-two strides. Inspect shared load/store transactions per request, wavefronts, and MIO/shared stall reasons.

Map lane addresses to banks before changing code. Consider padding the minor dimension, transposing ownership, swizzling indices, or using warp shuffles. Padding changes shared allocation and may reduce occupancy.

Validate every tile edge and mapping. Benchmark the same launch geometry and confirm conflict metrics fall; shared throughput alone is not proof.

