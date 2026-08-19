# KernelPilot

KernelPilot is an out-of-tree DeepSeek Harness bundle for execution-feedback-driven CUDA kernel optimization. It exposes compilation, correctness, repeated benchmarking, Nsight Compute profiling, and checkpointed source patching as guarded tools. A correctness-first evaluator selects only stable measured improvements.

The repository targets DeepSeek Harness `0.1.0-rc.7`, verified against upstream commit `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca` from 2026-08-17. It does not modify Harness core.

## What works

- Strict `OptimizationTask`, profiler, candidate, and result schemas.
- Best-of-2/3 candidate orchestration with compile and correctness hard gates.
- Robust metric-name-based NCU CSV parser with explicit missing-metric fallback.
- Allowlisted argv subprocesses, workspace path confinement, timeouts, isolated candidate checkpoints, and rollback.
- Five Harness tools: `compile_cuda`, `run_benchmark`, `profile_kernel`, `apply_source_patch`, and `validate_kernel`.
- Nine progressively loaded CUDA skills.
- Append-only optimization event log with replay, while Harness Session records model, tool, and subagent activity.
- Keyless Mock backend plus conditional real-GPU reduction and elementwise tests.

## Quick start

Requires Node 22.19+ and pnpm 11.

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm demo:mock
```

The demo output is explicitly synthetic. Its deterministic result is approximately:

```text
MOCK baseline median: 0.236 ms
MOCK candidate-vectorized: 0.188 ms, accepted
MOCK candidate-warp: 0.201 ms, accepted against the then-current best only if it clears the configured gate
MOCK best: candidate-vectorized, about 1.26x
```

These are fixture values used to validate control flow, not GPU measurements. The JSON report includes every sample, decision, hypothesis, patch, and `mock: true`.

## Harness loading

Pack/install this project into the Harness profile, then apply its additive bundle patch:

```text
dsh --profile headless --patch ./cordis.patch.yml "Optimize examples/reduction/task.json. Profile the baseline, ask two independent subagents for evidence-backed hypotheses, apply each patch in its own candidate, then compile, validate, benchmark, and select only through the acceptance gate."
```

The existing headless/base bundles provide the native Agent Loop, Session persistence, approval policy, sandbox, Skills service, and Subagent providers. KernelPilot adds domain tools and skills. See [architecture](docs/architecture.md) for the verified API mapping and current preview limitations.

## Real GPU example

```powershell
pnpm test:gpu
nvcc examples/reduction/reduction.cu -O3 -arch=native -o reduction.exe
./reduction.exe --validate
./reduction.exe
```

`test:gpu` self-skips without `nvcc` and `nvidia-smi`. No checked-in document claims a real speedup: performance depends on the GPU, clocks, workload, toolchain, and generated candidate.

## Task protocol

[`examples/reduction/task.json`](examples/reduction/task.json) declares source files, exact argv commands, tolerances, repeated benchmark policy, NCU metrics, acceptance thresholds, and search budget. Commands are never shell strings. Benchmark executables print `{"latency_ms": number}`; validators print max absolute/relative error and mismatch count as JSON.

## Development

See [AGENTS.md](AGENTS.md) for commands and Definition of Done. Design references: [tool design](docs/tool-design.md), [skills](docs/skills.md), and [evaluation](docs/evaluation.md).

