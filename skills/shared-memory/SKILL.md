---
name: shared-memory
description: Stage reusable CUDA data in shared memory with controlled synchronization.
---

# Shared memory

Use when global data is reused across threads or a cooperative tile avoids redundant loads. Inspect L1/L2 hit rates, global transactions, shared throughput, barrier stalls, occupancy, and shared bytes per block.

Load cooperatively, guard every out-of-range element, synchronize only when producer/consumer ordering requires it, and select a tile that does not destroy occupancy. Avoid shared memory for single-use streaming data.

Validate boundary tiles and divergent paths around barriers. Benchmark across shapes and compare both latency and barrier/shared-memory metrics.

