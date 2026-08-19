# KernelPilot contributor guide

KernelPilot is an out-of-tree DeepSeek Harness bundle for execution-feedback-driven CUDA kernel optimization. Keep the optimization core independent from the model runtime; the Harness adapter is a thin plugin layer over the same tested services.

## Layout

- `src/domain`: schemas and durable domain types.
- `src/core`: statistics, evaluation, context building, event replay, and search orchestration.
- `src/backends`: real process-backed and deterministic mock execution.
- `src/harness`: DeepSeek Harness Tool/Skill plugin adapter.
- `src/ncu`: Nsight Compute parsing.
- `skills`: progressively loaded CUDA skill bodies.
- `examples`: CUDA examples and task files.
- `tests`: unit, mock integration, and conditional GPU tests.
- `docs`: architecture and operator documentation.

## Commands

Use Node 22.19+ and pnpm 11.

```text
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm demo:mock
pnpm test:gpu
```

`test:gpu` self-skips unless `nvcc`, an NVIDIA GPU, and the requested example are available.

## Safety

- Never execute model-authored shell strings. Commands are executable-plus-argument arrays.
- Resolve and validate every source, build, report, and candidate path under its declared workspace.
- Do not download scripts, install system software, change system configuration, or edit another repository.
- Do not use destructive Git commands. Candidate edits happen in isolated candidate workspaces.
- Every child process needs an abort signal and timeout; always inspect the exit code.
- Correctness is a hard gate. Never accept or report speedup from invalid or synthetic data as real GPU performance.

## Definition of done

A change is complete when focused tests, `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass; documentation reflects behavior; `git diff --check` is clean; mock data is explicitly labeled; and GPU-only behavior is conditionally tested without making CI require a GPU.

