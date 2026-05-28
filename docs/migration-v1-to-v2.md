# Migration Guide: Task Envelope v1 → v2

This document describes the changes in Agent Olympics Task Standard v2
and provides a migration sketch for converting v1 envelopes, result packets,
and judge records to v2.

## Why v2?

v1 worked well for Season 001, but operational experience revealed several
improvement areas:

1. **Judge notes leakage risk** — `hidden_judge_notes` was inlined in the
   public task envelope. Accidental sharing of the full envelope exposed
   answer keys to participants.
2. **No structured oracle** — Answer keys, expected answer categories, and
   scoring guidance were mixed into one text block and were not
   machine-readable.
3. **No migration tracking** — When envelopes evolved, there was no way to
   trace which v1 envelope a v2 envelope was derived from.
4. **No tooling discovery** — Schema versions lacked `schema_description`,
   making it hard for automated tooling to detect which version was in use
   and how to handle it.

## What Changed

### 1. Public/Private Separation

**v1:** `hidden_judge_notes` was an inline field in the task envelope.

```yaml
# v1 — judge notes inlined in public envelope
schema_version: 1
task_id: ops-001
hidden_judge_notes: |
  ANSWER KEY: ...
```

**v2:** Judge notes and oracle answer keys are external files referenced
by path. The public task envelope never contains answer key material.

```yaml
# v2 — external references
schema_version: 2
task_id: ops-001
judge_notes_ref: docs/judge-notes-season-001.md
oracle_ref: oracle/season-001/ops-001-telegram-final-reply.yaml
```

The `hidden_judge_notes` field is removed from the v2 schema. The
field `judge_notes_ref` links to the human-readable judge notes document,
and `oracle_ref` links to a structured answer key file.

### 2. Oracle Directory

A new top-level `oracle/` directory holds structured answer key files:

```
oracle/
  season-001/
    ops-001-telegram-final-reply.yaml
    ops-002-clean-reinstall-drift.yaml
    ...
```

Each oracle file contains:
- Expected answer categories (structured, not free-text)
- Per-category scoring guidance with point ranges
- Evidence hints for each expected answer
- Strong answer markers for automated matching
- Machine-readable answer key checks (`oracle_schema_version: 1`)

### 3. Schema Description

Both v1 and v2 schemas now support an optional `schema_description` field
that helps tooling detect and describe the schema version:

```yaml
schema_version: 2
schema_description: "Agent Olympics Task Envelope v2 — public/private separation"
```

### 4. Migration Metadata (`v1_compat`)

v2 schemas add a `v1_compat` object that records the v1 source:

```yaml
v1_compat:
  original_task_id: ops-001
  schema_version_1_path: tasks/season-001/ops-001-telegram-final-reply.yaml
  migrated_at: "2026-05-29T00:00:00+09:00"
  migration_notes: >
    Extracted inline hidden_judge_notes to oracle/season-001/... and
    replaced with judge_notes_ref and oracle_ref.
```

This allows bidirectional traceability: from a v2 envelope you can find
its v1 origin, and from a v1 envelope you can check if a v2 migration exists.

### 5. Oracle Cross-Referencing (Result Packet + Judge Record v2)

**Result Packet v2** adds:
- `oracle_ref` — which oracle file the packet was prepared against
- `oracle_match` on findings — whether the finding matches the expected
  answer (for automated judge tooling)
- `oracle_question_id` on actions — which oracle question the action
  addresses

**Judge Record v2** adds:
- `oracle_ref` — which oracle file was used
- `oracle_checks` — structured per-question comparison between result
  and oracle, with `match` status (`exact`, `partial`, `missing`,
  `incorrect`) and points awarded

This makes it possible to automate parts of the judging pipeline by
comparing result packet findings against oracle answer keys.

## Migration Sketch: v1 Envelope → v2 Envelope

Follow these steps to migrate a v1 task envelope to v2:

### Step 1: Extract judge notes

```bash
# Read the v1 envelope and extract the hidden_judge_notes field
# Convert it to a structured oracle YAML file
mkdir -p oracle/season-001/
```

### Step 2: Create the oracle file

Create `oracle/season-001/<task-id>.yaml` with structured answer key:

```yaml
oracle_schema_version: 1
oracle_id: oracle-<task-id>
task_id: <task-id>
expected_answer_categories:
  - id: <category-id>
    label: "Human readable label"
    description: "Full description"
    evidence_hints: [...]
scoring_guidance:
  correctness:
    max_points: 30
    full: "Full score criteria"
    partial: "Partial score criteria"
strong_answer_markers:
  - marker_name: description
answer_key_checks:
  - question_id: q-001
    question: "What is the root cause?"
    expected: "Expected answer pattern"
```

### Step 3: Create the v2 envelope

Copy the v1 envelope and:
1. Set `schema_version: 2`
2. Add `schema_description`
3. Remove `hidden_judge_notes`
4. Add `judge_notes_ref` and `oracle_ref`
5. Optionally add `v1_compat` block

```yaml
schema_version: 2
schema_description: "Agent Olympics Task Envelope v2 — public/private separation"
# ... (all other fields unchanged from v1)
judge_notes_ref: docs/judge-notes-season-001.md
oracle_ref: oracle/season-001/<task-id>.yaml
v1_compat:
  original_task_id: <task-id>
  schema_version_1_path: tasks/season-001/<task-id>.yaml
  migration_notes: "Extracted hidden_judge_notes to oracle/..."
```

### Step 4: Validate

```bash
node scripts/validate.js tasks/season-001/<task-id>-v2.yaml
```

## Example Migration

A completed migration example is available at:

| v1 Source | v2 Migration | Oracle File |
|---|---|---|
| `tasks/season-001/ops-001-telegram-final-reply.yaml` | `tasks/season-001/ops-001-telegram-final-reply-v2.yaml` | `oracle/season-001/ops-001-telegram-final-reply.yaml` |

## Backward Compatibility

v2 envelopes are **not** backward-compatible with v1-only validators because
`schema_version: 2` will fail v1 schema `const: 1` checks.

However:
- v2 validators can validate v1 envelopes (the v2 schema is a superset with
  migration-friendly additions).
- v2 adds `additionalProperties: false` for stricter field control, but the
  required fields are unchanged from v1.
- The v1 task files remain valid and can continue to be used. Migration to
  v2 is optional per event coordinator.

## Further Reading

- `schemas/task-envelope-v2.schema.json` — v2 envelope schema
- `schemas/result-packet-v2.schema.json` — v2 result packet schema
- `schemas/judge-record-v2.schema.json` — v2 judge record schema
- `oracle/season-001/ops-001-telegram-final-reply.yaml` — example oracle file
- `tasks/season-001/ops-001-telegram-final-reply-v2.yaml` — migrated v2 envelope
- `docs/task-envelope.md` — general task envelope documentation
