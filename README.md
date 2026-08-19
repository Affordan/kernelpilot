# KernelPilot

KernelPilot is an out-of-tree DeepSeek Harness bundle for execution-feedback-driven CUDA kernel optimization. It exposes compilation, correctness, repeated benchmarking, Nsight Compute profiling, and checkpointed source patching as guarded tools. A correctness-first evaluator selects only stable measured improvements.

The repository targets DeepSeek Harness `0.1.0-rc.7`, verified against upstream commit `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca` from 2026-08-17. It does not modify Harness core.

## What works

- Strict `OptimizationTask`, profiler, candidate, and result schemas.
- Best-of-2/3 candidate orchestration with compile and correctness hard gates.
- Robust metric-name-based NCU CSV parser with explicit missing-metric fallback.
- Allowlisted argv subprocesses, workspace path confinement, timeouts, isolated candidate checkpoints, and rollback.
- Seven Harness tools, including atomic `prepare_baseline` and authoritative `evaluate_candidate`, backed by real local execution.
- Nine progressively loaded CUDA skills.
- Append-only optimization event log with replay, while Harness Session records model, tool, and subagent activity.
- A Windows-aware local backend with automatic MSVC discovery and conditional real-GPU reduction and elementwise tests.

## Quick start

Requires Node 22.19+, pnpm 11, an NVIDIA GPU, CUDA Toolkit with `nvcc`, Nsight Compute with `ncu`, and on Windows Visual Studio C++ Build Tools. KernelPilot discovers the x64 MSVC environment automatically.

```powershell
pnpm install
pnpm baseline examples/reduction/task.json
```

This compiles the declared source with NVCC, validates it, and prints repeated local benchmark samples. No model or API credential is needed for this baseline check.

To run agent-driven optimization, configure the provider environment expected by the DeepSeek Harness headless profile in `.env`, then run:

```powershell
pnpm optimize:reduction
# or
pnpm optimize:elementwise
```

The launcher loads `.env` into memory, builds the plugin, and starts Harness from `.kernelpilot/launch` so Harness does not parse the project file itself. It never rewrites `.env`. Candidate sources, diffs, checkpoints, NCU reports, and session data stay under `.kernelpilot/`; original example sources are not edited.

## Harness loading

The package also exposes an additive bundle patch for an existing Harness installation:

```text
dsh --profile headless --patch ./cordis.patch.yml "Optimize examples/reduction/task.json. Profile the baseline, ask two independent subagents for evidence-backed hypotheses, apply each patch in its own candidate, then compile, validate, benchmark, and select only through the acceptance gate."
```

The existing headless/base bundles provide the native Agent Loop, Session persistence, approval policy, sandbox, Skills service, and Subagent providers. KernelPilot adds domain tools and skills. See [architecture](docs/architecture.md) for the verified API mapping and current preview limitations.

## Verification

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:gpu
pnpm build
```

`test:gpu` self-skips without `nvcc` and `nvidia-smi`; when available, it uses the production local backend to compile, validate, and benchmark both examples. Performance depends on the GPU, clocks, workload, toolchain, and generated candidate, so only results printed by a local run should be treated as measurements.

## Task protocol

[`examples/reduction/task.json`](examples/reduction/task.json) declares source files, exact argv commands, tolerances, repeated benchmark policy, NCU metrics, acceptance thresholds, and search budget. Commands are never shell strings. Benchmark executables print `{"latency_ms": number}`; validators print max absolute/relative error and mismatch count as JSON.

## Development

See [AGENTS.md](AGENTS.md) for commands and Definition of Done. Design references: [tool design](docs/tool-design.md), [skills](docs/skills.md), and [evaluation](docs/evaluation.md).
