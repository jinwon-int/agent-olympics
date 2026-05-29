# Agent Olympics MVP Round Engine

This document describes the **round engine** — the orchestrator/CLI skeleton for
defining, planning, and executing competition rounds.

## Concepts

### Round

A **round** is one competition cycle: a curated set of tasks, a list of
participants, deterministic run identifiers and directory layouts, and a
lifecycle state machine. Rounds are the unit of orchestration.

### Run

A **run** is one participant attempting one task within a round. Each run
produces a result packet, trace record, and evidence bundle linked by a shared
`run_id`.

### Comparable Submission Metadata

Each round manifest participant entry may include `adapter`, `runtime_version`,
`model`, `model_provider`, `node`, and `config_profile` fields. These are
carried forward into result packets as `comparable_metadata` and into the
scoreboard as `submission_metadata`. This enables comparing agent runs by
runtime, model, node, and configuration profile without exposing secrets.

All participant metadata fields must be safe labels or references — never raw
credentials, hostnames, IP addresses, or endpoint URLs.

### Manifest

The **round manifest** (`rounds/<round_id>.yaml`) is the source of truth for
all round metadata. It lives in the repository and is version-controlled.

## Round Manifest

See [`schemas/round-manifest.schema.json`](../schemas/round-manifest.schema.json)
for the full JSON Schema.

### Example

```yaml
schema_version: 1
round_id: season-001-round-001
season: season-001
title: "Season 001 — Smoke Round"
description: "First smoke round: validate harness readiness with all seven events."
created_at: "2026-05-29T17:00:00+09:00"
lifecycle:
  status: pending
  status_history:
    - status: pending
      timestamp: "2026-05-29T17:00:00+09:00"
      note: "Round created"
tasks:
  - task_id: ops-001
    title: "Telegram final reply does not appear"
    envelope_path: tasks/season-001/ops-001-telegram-final-reply-v2.yaml
    time_limit_minutes: 30
    fixture_bundle_ref: fixtures/season-001/ops-001/
    oracle_ref: oracle/season-001/ops-001-telegram-final-reply.yaml
    judge_notes_ref: docs/judge-notes-season-001.md
    order: 1
  - task_id: code-001
    title: "TypeScript regression fix with targeted tests"
    envelope_path: tasks/season-001/code-001-typescript-regression-v2.yaml
    time_limit_minutes: 60
    fixture_bundle_ref: fixtures/season-001/code-001/
    oracle_ref: oracle/season-001/code-001-typescript-regression.yaml
    order: 1
participants:
  - agent_id: sogyo
    runtime: openclaw
    label: "sogyo (OpenClaw)"
    enabled: true
  - agent_id: seoseo
    runtime: openclaw
    label: "seoseo (OpenClaw / Broker)"
    enabled: true
run_directory: runs/season-001/round-001/
```

## Run ID Generation

Run IDs are deterministic and follow the template:

```
run-{task_id}-{agent_id}-{timestamp}
```

Example: `run-ops-001-sogyo-20260529T1727KST`

The timestamp uses a compact ISO-like format without colons (safe for file
paths): `YYYYMMDDTHHmmssTZD`.

## Run Directory Layout

```
runs/
  <season>/
    <round_id>/
      run-<task_id>-<participant>-<timestamp>/
        manifest.yaml          # Run-level manifest (run_id, task_id, agent_id, timestamps, lifecycle)
        envelope.yaml          # Copy or symlink of the task envelope
        fixtures/              # Fixture data prepared for this run
        result-packet.yaml     # Participant output (populated after run)
        trace.yaml             # Trace record (populated after run)
        evidence/              # Evidence bundle artifacts (populated after run)
        judge-record.yaml      # Judge scoring record (populated after scoring)
```

## Lifecycle States

| State | Description | Transitions |
|---|---|---|
| `pending` | Round defined, not started | → `fixture_preparation` |
| `fixture_preparation` | Preparing fixture data for tasks | → `running` |
| `running` | Participants are executing tasks | → `completed`, `pending` (retry) |
| `completed` | All participants finished execution | → `scored`, `running` (re-run) |
| `scored` | Judges scored all run results | → `archived` |
| `archived` | Final immutable state | (none) |

## CLI Entrypoint

```bash
node scripts/round.js <command> [options]
```

### Commands

| Command | Description |
|---|---|
| `init <manifest>` | Validate and initialize a round manifest; create run directories |
| `plan <manifest>` | Dry-run: print what would happen without creating anything |
| `list [season]` | List available rounds, optionally filtered by season |
| `status <round_id>` | Show lifecycle status for a round |
| `validate <manifest>` | Validate a round manifest against the schema |

### Options

| Flag | Description |
|---|---|
| `--verbose, -v` | Verbose output |
| `--strict` | Fail on warnings |
| `--help` | Show usage |

### Plan Output

The `plan` command prints:

- Round ID and season
- Number of tasks and participants
- Total combinations (tasks × participants)
- Expected run directory paths (without creating them)
- Fixture bundle checks (warn if a bundle path does not exist)
- Envelope schema validation status
- Current lifecycle state

## Integration with Existing Schemas

The round engine integrates with existing Agent Olympics schemas:

- **Task Envelope v2** (`schemas/task-envelope-v2.schema.json`) — `rounds` reference
  envelope paths for task definitions.
- **Result Packet** (`schemas/result-packet.schema.json`) — Run output uses the existing
  result packet schema.
- **Run Result** (`schemas/run-result.schema.json`) — Complete run bundles are wrapped
  in the run result schema.
- **Fixture Bundle** (`schemas/fixture-bundle.schema.json`) — Tasks reference fixture
  bundles for data preparation.
- **Season Fixture Manifest** (`schemas/season-fixture-manifest.schema.json`) —
  Season-level fixture discovery.
- **Judge Record** (`schemas/judge-record.schema.json`) — Scoring output.

## Validation

Validate round manifests with:

```bash
node scripts/validate.js rounds
# or
node scripts/validate.js <path-to-round-manifest>
```

The validator checks:

1. **Schema conformance** — Round manifest matches `round-manifest.schema.json`.
2. **Envelope existence** — Each `envelope_path` resolves to a valid file.
3. **Envelope validity** — Each referenced envelope validates against the task envelope schema.
4. **Fixture bundle existence** — Each `fixture_bundle_ref` resolves to an existing directory.
5. **Participant uniqueness** — No duplicate `agent_id` values.

## Reference

- [Competition Model](../docs/competition-model.md) — Overall competition lifecycle.
- [Task Envelope](../docs/task-envelope.md) — Envelope format reference.
- [Result Packet](../docs/result-packet.md) — Submission format reference.
- [Adapter Execution Contract](../docs/adapter-execution-contract.md) — Adapter interface.
- [Task Verification](../docs/task-verification.md) — Task readiness tiers.
- [Season 001 Fixtures](../fixtures/season-001/README.md) — Fixture bundle guide.
