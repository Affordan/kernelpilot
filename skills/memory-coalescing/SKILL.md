---
name: memory-coalescing
description: Diagnose and repair uncoalesced CUDA global-memory access.
---

# Memory coalescing

Use when the kernel is memory-bound and adjacent lanes touch strided or scattered addresses. Inspect DRAM throughput, sectors/request, L1/TEX sectors, long-scoreboard stalls, and source-level access expressions.

Prefer remapping lane-to-data ownership, transposing tiled layouts, or separating structure fields before adding caches. Preserve bounds checks and confirm that a warp's active lanes access the fewest naturally aligned sectors. Risks include changing output ordering, tail handling, and introducing divergent address calculations.

Validate odd sizes, partial warps, alignment offsets, and aliasing. Benchmark multiple sizes; report transaction metrics and latency, not just achieved bandwidth.

