# Architecture

## Verified upstream surface

KernelPilot was designed from DeepSeek Harness `0.1.0-rc.7` source at commit `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`, not from remembered APIs.

| Need | rc.7 public mechanism | KernelPilot use |
|---|---|---|
| Composition | Cordis plugin exports `name`, `inject`, and `apply`; `ctx.effect`-owned registries | `src/harness/plugin.ts` is loaded beside core plugins |
| Distribution | `package.json.dsh.bundle.patch` plus `cordis.patch.yml` | Additive bundle inserts one plugin row |
| Tools | `ctx.tools.register(ToolDefinition)`; schema enters prompt; calls traverse pre/execute/post waterfalls | Seven domain tools return canonical JSON values; evaluation uses recorded tool results |
| Skills | `ctx.skills.register(SkillRegistration)`; full bodies load on demand | Nine CUDA skills are registered, never permanently injected into the persona |
| Subagents | `ctx.subagents` providers plus `@deepseek-ai/dsh-tool-subagent`; headless bundle offers spawn/fork providers | Orchestrator prompt delegates independent hypotheses through native subagent tools |
| Sandbox | `ctx.sandbox`, sandbox policy, filesystem/subprocess providers, approvals | Harness confines the agent; KernelPilot additionally uses argv allowlists and path checks |
| Session | append-only Session events and persistence; tool/subagent activity is already durable | Native trajectory plus plugin-owned optimization event stream |

## Repository organization

```text
Harness Agent Loop / native Subagents
              |
       KernelPilot plugin
       /              \
 seven guarded tools  nine CUDA skills
       |
 OptimizationEngine -- CandidatePlanner
       |
CandidateExecutionBackend
       +-- nvcc / validator / benchmark / NCU processes
       |
 correctness hard gate -> latency evaluator -> report
       |
 append-only optimization JSONL
```

The domain core does not import Cordis. Tests can run without a model, API key, CUDA, or NCU. The Harness adapter imports only the public Cordis, Tool, and Skill packages.

## Context policy

`buildOptimizationContext` includes current source, best metrics, diagnosis, the last three attempts, relevant loaded skills, objective, and remaining budget. Raw NCU reports and old source trees remain referenced on disk. This bounds prompt growth without discarding audit data.

## Session adjustment and uncertainty

rc.7 declares `SessionEventMap` through TypeScript declaration merging, but persistence validates event names against a build-time generated `KNOWN_SESSION_EVENT_TYPES` set. There is no public out-of-tree runtime registration API and `Session.append()` cannot mark a newly appended plugin event envelope `ignorable: true`. Treating custom names as normal Session events would therefore create logs a stock rc.7 build can refuse to reload.

KernelPilot uses both supported layers:

1. Harness Session records every user/model/tool/subagent event and therefore the model-visible trajectory.
2. `JsonlEventStore` records the optimization domain events, source diffs, metrics, validations, and decisions and can replay task state.

If upstream adds a public Session event vocabulary registry, the event sink can be replaced without changing the orchestrator. Until then, the dual log is the safe out-of-tree design.

## Remaining preview uncertainties

- Package/version APIs are developer-preview and may change after rc.7.
- Profile installation UX may evolve; the bundle metadata and patch format are current rc.7 contracts.
- NCU metric availability varies by GPU and version. The parser aliases semantic metrics and reports missing fields rather than inventing values.
- Model-produced patches require a planner prompt/provider configuration. The keyless engine uses an injected deterministic planner to validate all execution and decision machinery.
