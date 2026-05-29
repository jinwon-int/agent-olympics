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

## Judge Notes

Scoring guidance, answer keys, and judging methodology for all seven
events are documented in [docs/judge-notes-season-001.md](/docs/judge-notes-season-001.md).

## Running a Season

Each task envelope contains:
- A platform-neutral objective
- Explicit allowed and forbidden actions
- Required outputs for the result packet
- Hidden judge notes with answer keys (not visible to participants)
- A reference to the scoring rubric

Runners should:
1. Pick an event from this directory.
2. Prepare any fixture data referenced by the event.
3. Provide the participant with the task envelope.
4. Collect the result packet.
5. Score against the rubric and judge notes.
