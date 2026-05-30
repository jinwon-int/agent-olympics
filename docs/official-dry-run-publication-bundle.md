# Official Dry-Run Publication Bundle

> **Scope:** Season 001 source-only official dry run.
> **Parent round:** #146.
> **Related trackers:** #15, #16, #38, #40, #41, #145.

This bundle defines the artifacts a finalizer must collect before publishing a
Season 001 dry-run result. It is intentionally source-only: it records fixture,
run, scoring, and evidence files without requiring production deploys, service
restarts, live provider sends, database mutation, credential changes, release
publishing, or Terminal Brief ACK/replay.

## Bundle Manifest

The publication candidate should include these artifacts:

| ID | Artifact | Required | Producer | Notes |
|---|---|---:|---|---|
| A1 | `rounds/season-001-round-001.yaml` | Yes | source | Round 001 task list and official scope. |
| A2 | `rounds/season-001-round-002.yaml` | Yes | source | Round 002 task list and official scope. |
| A3 | `docs/dry-run-readiness.md` | Yes | source | Readiness gates and finalizer commands. |
| A4 | `docs/official-dry-run-report-template.md` | Yes | finalizer | Human closeout/checklist template. |
| A5 | `docs/tracker-ratification-15-16.md` | Yes | finalizer | Evidence-backed #15/#16 status. |
| A6 | `runs/season-001/**/run.yaml` | Yes | execution | Run lifecycle states and artifact pointers. |
| A7 | `results/*.yaml` | Yes | execution | v2 result packets. |
| A8 | `traces/**/*.yaml` | Yes | execution | Trace-level evidence when available. |
| A9 | `evidence/dry-run/*.json` | Yes | finalizer | Gate output from dry-run readiness/publication scripts. |
| A10 | `web/public/data/scoreboard.json` | Optional | scoring | Static consumer snapshot if regenerated. |
| A11 | `docs/perf-001-repeatable-harness.md` | Yes | source | Repeatable performance harness reference. |
| A12 | `results/perf-harness-packet-*.yaml` | Optional | harness | Generated from repeat harness reports. |

## Scoreboard Snapshot

A publication candidate may include a scoreboard snapshot when score aggregation
has been rerun. The snapshot must keep raw measurements separate from scored
values and must not contain private oracle material.

Required scoreboard metadata:

- `generated_at` or equivalent build timestamp.
- Source commit used for the dry run.
- Round id and task ids represented in the snapshot.
- Participant/runtime labels that are safe to publish.
- Validity state for every entry.
- Caveats for source-only, cache, hardware, or container-runtime effects.

## Appeals And Integrity Gates

Before publication, the finalizer should confirm:

- Result packets pass schema and competition-validity checks.
- Every redacted item or action has a value-free `redaction_reason`.
- Private oracle and hidden judge notes are absent from public artifacts.
- Tool disclosure, division, operating policy, delegation, and comparable
  metadata fields are present for v2 packets.
- Any issue closure or tracker ratification is backed by file paths, commands,
  and PR/commit evidence.

## Finalizer Evidence Checklist

The finalizer report should record:

| Check | Evidence |
|---|---|
| Source commit | Finalizer PR merge commit. |
| Integrated lanes | Worker PRs or reconstructed issue evidence. |
| Validation commands | Exact commands and pass/fail result. |
| Generated artifacts | File paths under `results/`, `runs/`, `traces/`, `evidence/`, and `web/`. |
| Publication decision | Publishable, provisional, or blocked. |
| Tracker decision | #15/#16 close, keep open, or split follow-up. |
| Safety boundary | Confirmation that no production/live/credential/release boundary was crossed. |

## Publication Decision States

- `publishable`: all required artifacts exist, validation passes, and caveats are
  explicit.
- `provisional`: source and validation are present, but live agent execution or
  broader node coverage is still pending.
- `blocked`: validation fails, private material is present, or approval-sensitive
  action would be required.

For this round, the expected state is `provisional` unless a finalizer also
executes the official dry-run manifest and regenerates publication artifacts.
