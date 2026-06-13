# Stage 3 code-001 fleet rerun summary

Base commit: `5709d66` (#246 terminal toolset auto-probe).

Pre-run gate: each Linux node was updated with `git pull origin main`, `/work/agent-codebench` was reset from `fixtures/season-001/code-001/target-repo`, repo dependencies were installed where needed, and the shipping bench gate passed (`npm test` exit 0 with 4 tests; `npm run report` exit 1 with the expected `metrics.retries` TypeError) before wrapper execution. Android/Termux nodes were not run because `/work` is unavailable.

Wrapper command shape: `HERMES_NODE=<node> HERMES_EVENT_FAMILY=code bash adapters/wrappers/hermes-mission-wrapper.sh tasks/season-001/code-001-typescript-regression-v2.yaml runs/stage3-rerun/code-001-<agent> <agent>`. No `HERMES_TOOLSETS` / `HERMES_EXEC_TOOLSET` override was supplied; terminal was auto-derived from `hermes tools list`.

## Gate results

- soonwook (vps6): status=completed; toolsets=file,terminal; toolsets_source=tools_list_exec; parse_fallback=0; hermes_status=250; post_test=0; post_report=0; changed=3 files
- sogyo (vps1): status=completed; toolsets=file,terminal; toolsets_source=tools_list_exec; parse_fallback=0; hermes_status=250; post_test=0; post_report=0; changed=3 files
- nosuk (vps2): status=completed; toolsets=file,terminal; toolsets_source=tools_list_exec; parse_fallback=0; hermes_status=250; post_test=0; post_report=0; changed=3 files
- dungae (vps0): status=completed; toolsets=file,terminal; toolsets_source=tools_list_exec; parse_fallback=0; hermes_status=250; post_test=0; post_report=0; changed=3 files
- bangtong (vps3): status=completed; toolsets=file,terminal; toolsets_source=tools_list_exec; parse_fallback=0; hermes_status=250; post_test=0; post_report=0; changed=2 files
- jingun (vps8): status=completed; toolsets=file,terminal; toolsets_source=tools_list_exec; parse_fallback=0; hermes_status=250; post_test=0; post_report=0; changed=3 files
- seoseo (vps4): status=completed; toolsets=file,terminal; toolsets_source=tools_list_exec; parse_fallback=0; hermes_status=250; post_test=0; post_report=0; changed=3 files
- yukson (vps5): status=completed; toolsets=file,terminal; toolsets_source=tools_list_exec; parse_fallback=0; hermes_status=250; post_test=0; post_report=0; changed=3 files
- gwakga (vps7): status=completed; toolsets=file,terminal; toolsets_source=tools_list_exec; parse_fallback=0; hermes_status=0; post_test=0; post_report=0; changed=3 files
- gongyung: NOT-RUN — Android/Termux: /work unavailable for code-001 bench
- daegyo: NOT-RUN — Android/Termux: /work unavailable for code-001 bench

All 9 Linux runs passed the pre-scoring toolset cohort gate: `toolsets=file,terminal`, `toolsets_source=tools_list_exec`, `parse_fallback=0`. No `probe_*_file` fallback node was admitted. `hermes_status=250` appears on 8 nodes after parseable mission output and is treated the same class as the known shutdown quirk; artifacts remain parseable and validated. gwakga returned `hermes_status=0`.
