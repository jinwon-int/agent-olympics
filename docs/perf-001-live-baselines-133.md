# perf-001 Live Baseline Capture (#133)

This follow-up captures two authentic live `perf-001` result packets from an
approved node without mutating production services.

## Packets

| Runtime profile | Result packet | Node profile | Test throughput | Probe speedup |
|---|---|---|---:|---:|
| OpenClaw/Codex foreground | `results/perf-001-live-openclaw-codex-20260530.yaml` | `fixtures/node-profiles/profile-live-openclaw-medium-20260530.yaml` | 58.725 files/s | 2.138x |
| Plain CLI probe | `results/perf-001-live-cli-probe-20260530.yaml` | `fixtures/node-profiles/profile-live-openclaw-medium-20260530.yaml` | 52.922 files/s | 2.206x |

Both packets use the same live hardware profile. They should be compared as
runtime-profile baselines, not as separate hardware-class baselines.

## Read-Only Boundary

The workload phases were limited to repository inspection, v2 validation, the
project test command, and local diagnostic probes. The run did not perform a
production deploy, service restart, DB mutation, live canary, credential
rotation, or raw config dump.

## Static Baseline Comparison

Earlier static sample packets remain useful for broad hardware-class examples:

- `results/perf-001-baseline.yaml` — medium-vps sample.
- `results/perf-001-baseline-small.yaml` — small-vps sample.
- `results/perf-001-baseline-nosuk.yaml` — a2a-runner sample.

The new live packets are narrower and more current: they prove the workload can
be executed on an approved live node, with redacted packet metadata and raw
measurements separated from normalized scores. Because the measurements are
short and likely warm-cache influenced, they are suitable as live smoke
baselines and should not replace longer dedicated ranking runs.

## Validation

Run:

```bash
node scripts/validate.js packets-v2
node scripts/score.js validate results
npm test
```
