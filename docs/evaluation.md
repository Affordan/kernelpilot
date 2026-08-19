# Evaluation and search

KernelPilot optimizes median kernel latency in version 0.1. Correctness and data validity are constraints, not weighted score terms.

For baseline latency `T0` and candidate latency `Tc`, speedup is `T0 / Tc`. A candidate is accepted only when compilation succeeds, correctness passes, repeated benchmark data is valid, speedup meets `minimumSpeedup`, and population variance does not exceed `maximumVariance`.

Candidates are evaluated in isolated workspaces. The current engine asks for two or three proposals, bounded by `maxCandidates` and the overall timeout. An accepted result may become the comparison point for later proposals, while the final report always gives speedup relative to the original baseline. Rejected candidates and their exact reasons remain in the report and event log.

KernelPilot has no simulated execution mode. Results come from the local NVCC-built executable and should record the GPU, CUDA, NCU, clocks/power conditions, input sizes, warmups, samples, variance, and raw report references. `evaluate_candidate` reads compile, validation, and benchmark results recorded by the tools, so the model cannot supply its own performance fields.
