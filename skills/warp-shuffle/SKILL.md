---
name: warp-shuffle
description: Replace eligible intra-warp exchange with CUDA shuffle operations.
---

# Warp shuffle

Use for reductions, scans, broadcasts, or lane exchange confined to active lanes of one warp. Inspect barrier stalls, shared transactions, instruction count, and eligible warps.

Use an accurate active mask, define the participating width, and never read from an inactive source lane. Combine warp results through shared memory only when the block spans multiple warps. Risks are partial-warp bugs and changed reduction order.

Validate sizes below, equal to, and above warp size plus non-multiples of 32. Apply tolerance appropriate to the new floating-point association and benchmark small and large reductions.

