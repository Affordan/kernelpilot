# CUDA skills

Skills encode a diagnostic workflow rather than a guaranteed rewrite. Every body identifies applicability, profiler evidence, strategy, risk, correctness cases, and benchmark policy.

The bundled catalog contains memory coalescing, vectorized access, shared memory, bank conflicts, warp shuffle, reduction, occupancy, FP16, and RMSNorm. The Harness Skills registry advertises summaries; the agent loads only names recommended by the current diagnosis. `buildOptimizationContext` receives only those selected bodies.

A candidate must state its hypothesis, expected metric change, risks, selected skills, and unified diff. Independent subagents should explore different hypotheses; using multiple agents to repeat the same rewrite is not Best-of-N search.

