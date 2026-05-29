# Agent Olympics 2026 — Season 001 Task Pack

This directory contains the first official season pack for Agent
Olympics 2026. It includes seven events covering all event families.

## Events

| ID | Title | Event Family | Time (min) | Tier |
|---|---|---|---|---|
| [ops-001](ops-001-telegram-final-reply.yaml) | Telegram final reply does not appear | Ops Relay | 30 | smoke |
| [ops-002](ops-002-clean-reinstall-drift.yaml) | Decide whether clean reinstall is needed | Ops Relay | 35 | draft |
| [node-001](node-001-agent-readiness-audit.yaml) | Audit node agent readiness for mission execution | Node Readiness | 45 | draft |
| [perf-001](perf-001-node-throughput-baseline.yaml) | Measure node throughput on a controlled mission workload | Performance Trial | 60 | draft |
| [code-001](code-001-typescript-regression.yaml) | TypeScript regression fix with targeted tests | Code Sprint | 60 | draft |
| [knowledge-001](knowledge-001-wiki-closeout.yaml) | Convert an incident transcript into a wiki-ready closeout | Wiki Marathon | 45 | draft |
| [coord-001](coord-001-commander-report.yaml) | Merge contradictory node reports into a commander report | Coordination Drill | 50 | draft |

Tier definitions:

| Tier | Meaning |
|---|---|
| draft | Task exists but has not been independently solved. |
| smoke | Task runs through the harness on at least one adapter. |
| verified | Human or trusted baseline agent completed it and judge result matched rubric. |
| retired | Task withdrawn due to leakage, ambiguity, drift, or evaluator mismatch. |

See [Task Verification](/docs/task-verification.md) for promotion workflow.

## File Structure: Public vs Private

Season 001 envelopes are maintained in two schema versions. The
**v2 envelopes are the participant-facing public files** and should be
used for all new competition runs. The v1 files are retained for
backward compatibility and historical traceability.

### Public files (safe to share with participants)

| File | Purpose |
|---|---|
| `tasks/season-001/*-v2.yaml` | Participant-facing task envelopes (v2). No judge notes or answer keys. |
| `docs/judge-notes-season-001.md` | Human-readable judge methodology (reference — judges only, but contains no answer key material in the public section) |
| `rubrics/agent-olympics-v1.yaml` | Scoring rubric with dimension definitions |
| `schemas/task-envelope-v2.schema.json` | Schema for v2 task envelopes |

The v2 envelopes reference external judge and oracle files but do
**not** contain inline answer keys, scoring guidance, or judge-only
notes. Operators may distribute v2 envelope files to participants
without leaking private judging material.

### Private files (judge / operator only — do not share with participants)

| File | Purpose |
|---|---|
| `oracle/season-001/*.yaml` | Structured answer keys, expected answer categories, scoring guidance per task, evidence hints, and answer key checks. |
| `tasks/season-001/*.yaml` (no `-v2` suffix) | v1 envelopes that contain inline `hidden_judge_notes` with answer keys and judge guidance. |

### v1 vs v2 Envelope Comparison

| Aspect | v1 Envelope | v2 Envelope |
|---|---|---|
| Schema version | `schema_version: 1` | `schema_version: 2` |
| Judge notes | Inline `hidden_judge_notes` field | External `judge_notes_ref` and `oracle_ref` |
| Participant-safe? | No — contains answer keys | Yes — no inline judge material |
| Migration tracking | N/A | `v1_compat` block traces origin |
| Use case | Historical reference; backward-compatible validators | All new competition runs |

### Using v2 Envelopes

To run a season-001 event with public-safe envelopes:

1. Pick a `* -v2.yaml` envelope from this directory.
2. Prepare any fixture data referenced by the event.
3. Provide the participant with **only** the v2 envelope (not the v1 file,
   not the oracle file, not the full judge notes).
4. Collect the result packet.
5. Refer to `oracle/season-001/<task-id>.yaml` and
   `docs/judge-notes-season-001.md` for scoring guidance.

## Oracle files

Structured answer keys live in [oracle/season-001/](/oracle/season-001/).
Each oracle file contains:

- Expected answer categories (structured, not free-text)
- Per-category scoring guidance with point ranges
- Evidence hints for each expected answer
- Strong answer markers
- Machine-readable answer key checks

Oracle files are referenced by v2 envelopes via the `oracle_ref` field.
They are **private** and must never be shared with participants.

## Available Oracle Files

| Task ID | Oracle File |
|---|---|
| ops-001 | [oracle/season-001/ops-001-telegram-final-reply.yaml](/oracle/season-001/ops-001-telegram-final-reply.yaml) |
| ops-002 | [oracle/season-001/ops-002-clean-reinstall-drift.yaml](/oracle/season-001/ops-002-clean-reinstall-drift.yaml) |
| node-001 | [oracle/season-001/node-001-agent-readiness-audit.yaml](/oracle/season-001/node-001-agent-readiness-audit.yaml) |
| perf-001 | [oracle/season-001/perf-001-node-throughput-baseline.yaml](/oracle/season-001/perf-001-node-throughput-baseline.yaml) |
| code-001 | [oracle/season-001/code-001-typescript-regression.yaml](/oracle/season-001/code-001-typescript-regression.yaml) |
| knowledge-001 | [oracle/season-001/knowledge-001-wiki-closeout.yaml](/oracle/season-001/knowledge-001-wiki-closeout.yaml) |
| coord-001 | [oracle/season-001/coord-001-commander-report.yaml](/oracle/season-001/coord-001-commander-report.yaml) |

## v2 Envelopes

| Task ID | v2 Envelope |
|---|---|
| ops-001 | [ops-001-telegram-final-reply-v2.yaml](ops-001-telegram-final-reply-v2.yaml) |
| ops-002 | [ops-002-clean-reinstall-drift-v2.yaml](ops-002-clean-reinstall-drift-v2.yaml) |
| node-001 | [node-001-agent-readiness-audit-v2.yaml](node-001-agent-readiness-audit-v2.yaml) |
| perf-001 | [perf-001-node-throughput-baseline-v2.yaml](perf-001-node-throughput-baseline-v2.yaml) |
| code-001 | [code-001-typescript-regression-v2.yaml](code-001-typescript-regression-v2.yaml) |
| knowledge-001 | [knowledge-001-wiki-closeout-v2.yaml](knowledge-001-wiki-closeout-v2.yaml) |
| coord-001 | [coord-001-commander-report-v2.yaml](coord-001-commander-report-v2.yaml) |

## Validation

Validate all envelopes (v1 + v2) with:

```bash
node scripts/validate.js envelopes
node scripts/validate.js envelopes-v2
```

Validate oracle files with:

```bash
node scripts/validate.js oracle
```

## Judge Notes

Scoring guidance, answer keys, and judging methodology for all seven
events are documented in [docs/judge-notes-season-001.md](/docs/judge-notes-season-001.md).

## Running a Season

Each task envelope contains:
- A platform-neutral objective
- Explicit allowed and forbidden actions
- Required outputs for the result packet
- A reference to the scoring rubric

Runners should:
1. Pick an event from this directory.
2. Prepare any fixture data referenced by the event.
3. Provide the participant with the **v2 task envelope** only.
4. Collect the result packet.
5. Score against the rubric and oracle file.
