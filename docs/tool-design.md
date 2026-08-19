# Tool design

All tools accept a workspace-relative `task_path`; candidate-scoped tools also accept `candidate_id`. Model-authored shell is never accepted. `OptimizationTask` owns executable-plus-argument arrays, allowed source files, timeouts, tolerances, and profiling filters.

`prepare_baseline` runs the declared compile, validation, repeated benchmark, and NCU profile as one bounded operation and records the real results. `compile_cuda` runs only the declared compiler command, checks the exit code, captures bounded stdout/stderr, extracts warnings, and reports duration. `run_benchmark` executes warmups then retains every repeated sample and calculates min, median, mean, p95, population variance, and optional effective bandwidth. `profile_kernel` invokes NCU non-interactively, saves the raw report and CSV reference, and sends only `ProfilerObservation` to the model. `validate_kernel` parses a golden-comparison JSON result and applies task tolerances. `apply_source_patch` permits only declared files, creates source checkpoints, records the diff, validates with `git apply --check`, and removes the isolated candidate workspace on failure. `evaluate_candidate` applies the acceptance gate only to compile, validation, and benchmark results recorded by those tools.

Every child process has a timeout, abort propagation, output cap, explicit cwd inside its workspace, exact argv, `shell: false`, and an executable allowlist. Candidate paths are validated with `path.relative`, including Windows drive and sibling-prefix cases.

Tool success means the process protocol completed. Compile failure and correctness failure are structured domain outcomes and remain inputs to the evaluator; infrastructure/protocol failures throw and become Harness tool errors.
