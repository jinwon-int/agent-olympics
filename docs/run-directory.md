# Run Directory Layout & Artifact Lifecycle

Each competition run produces a dedicated directory holding the participant's output artifacts, evidence, and metadata. This document defines the directory layout, artifact types, lifecycle states, retention rules, scrubbing requirements, and how artifacts reference each other.

## Directory Layout

Run directories live under `runs/<season>/<round>/` as specified by the round manifest's `run_directory` field.

```
runs/
  <season>/
    <round>/
      <run-id>/
        manifest.yaml            — Required. Artifact manifest (this file).
        result-packet.yaml       — Required. Participant's result submission.
        trace.yaml               — Optional. Ordered action trace.
        judge-record.yaml        — Optional (post-scoring). Judge evaluation.
        evidence-bundle.yaml     — Required. Evidence bundle manifest.
        scoreboard.yaml          — Optional (post-scoring). Per-run score row.
        evidence/                — Directory of evidence content files.
          <evidence-id>.txt
          <evidence-id>.json
          ...
```

### Run ID Convention

Run IDs follow the template defined in the round manifest. The default template is:

```
run-{task_id}-{agent_id}-{timestamp}
```

where `{timestamp}` uses the format `YYYYMMDDTHHmmss` in the round's timezone with an uppercase timezone suffix (e.g., `KST`, `UTC`).

**Examples:**
- `run-ops-001-nosuk-20260529T185400KST`
- `run-code-001-sogyo-20260530T090000UTC`

The run ID must match the run directory name and the `run_id` field in the artifact manifest.

## Artifact Types

| Kind | File | Required | Contents |
|---|---|---|---|
| `manifest` | `manifest.yaml` | Yes | Artifact inventory, checksums, lifecycle state, retention rules |
| `result_packet` | `result-packet.yaml` | Yes | Participant's result submission (see [result-packet.md](result-packet.md)) |
| `trace` | `trace.yaml` | Recommended | Ordered action journal (see `trace-record.schema.json`) |
| `judge_record` | `judge-record.yaml` | After scoring | Judge evaluation and score (see `judge-record.schema.json`) |
| `evidence_bundle` | `evidence-bundle.yaml` | Yes | Evidence item references (see `evidence-bundle.schema.json`) |
| `evidence_file` | `evidence/<id>.*` | When evidence has local content | Raw evidence content files |
| `scoreboard` | `scoreboard.yaml` | After scoring | Dimension scores for the round scoreboard |
| `log` | `evidence/*.log` | Optional | Raw log files captured during the run |
| `transcript` | `evidence/transcript.*` | Optional | Session transcript excerpts |
| `config_snapshot` | `evidence/config.*` | Optional | Configuration snapshots |
| `fixture_copy` | `evidence/fixture.*` | Optional | Copy of fixture data used |

## Lifecycle States

A run directory transitions through these states, tracked in `manifest.yaml`'s `status` and `status_history` fields.

```
                  ┌─────────────┐
                  │   pending   │  — Directory created, no artifacts yet
                  └──────┬──────┘
                         │
                  ┌──────▼──────┐
                  │   running   │  — Agent executing, partial artifacts may exist
                  └──────┬──────┘
                     ┌───┴───┐
                     │       │
              ┌──────▼──┐ ┌──▼──────┐
              │completed│ │ failed  │  — Agent finished or stopped
              └────┬─────┘ └──┬──────┘
                   │          │
                   └────┬─────┘
                        │
                 ┌──────▼──────┐
                 │   scored    │  — Judge evaluation written
                 └──────┬──────┘
                        │
                 ┌──────▼──────┐
                 │  archived   │  — Immutable, read-only, may be scrubbed
                 └─────────────┘
```

An optional terminal state `disqualified` replaces `scored` when the run violates competition rules.

### State Transitions

| From | To | Trigger |
|---|---|---|
| `pending` | `running` | Round engine starts agent execution |
| `running` | `completed` | Agent returns a result packet, or harness stops with output |
| `running` | `failed` | Agent fails without producing a complete result packet |
| `completed` or `failed` | `scored` | Judge writes judge-record.yaml and scoreboard entry |
| `scored` | `archived` | Post-season archival, run directory is locked |
| *any* | `disqualified` | Competition-validity checks find a rule violation |

## Artifact References

Artifacts reference each other through consistent identifiers. The manifest's `references` field provides the canonical path map.

### Result Packet → Evidence

The result-packet.yaml references evidence items by `evidence[].id`. Each ID must match a corresponding item in `evidence-bundle.yaml`.

```yaml
# result-packet.yaml
evidence:
  - id: ev-001
    kind: log
    source: gateway journal
    summary: "Diagnosis result details"
```

```yaml
# evidence-bundle.yaml
items:
  - id: ev-001
    kind: log
    summary: "Diagnosis result details"
    content_ref: evidence/gateway-journal.txt
    checksum:
      algorithm: sha256
      value: "a1b2..."
```

### Evidence Bundle → Content Files

The evidence bundle's `items[].content_ref` may be:
- A **relative path** from the run directory to a file in `evidence/`.
- An **absolute URL** for externally-hosted content.
- A `data:` URI for inline content (small items only).

Relative paths must resolve to existing files within the run directory.

### Manifest → All Artifacts

The manifest's `artifacts[]` array lists every file in the run directory with its checksum, size, and retention class. This enables automated verification:

```yaml
artifacts:
  - path: result-packet.yaml
    kind: result_packet
    content_type: text/yaml
    size_bytes: 2840
    checksum:
      algorithm: sha256
      value: "abc123..."
    retention: season
  - path: evidence/gateway-journal.txt
    kind: evidence_file
    content_type: text/plain
    size_bytes: 4280
    checksum:
      algorithm: sha256
      value: "def456..."
    retention: round
```

## Hashes and Integrity

### When to Hash

| Artifact Type | Hash Required? | Recommended Algorithm |
|---|---|---|
| manifest.yaml | Self-checksum is skipped (self-referential) | sha256 for visibility |
| result-packet.yaml | Yes | sha256 |
| evidence-bundle.yaml | Yes | sha256 |
| trace.yaml | Recommended | sha256 |
| judge-record.yaml | Yes | sha256 |
| scoreboard.yaml | Recommended | sha256 |
| evidence files | Recommended | sha256 |
| Large files (>10 MB) | Recommended | sha256 |

### Hash Verification

The `scripts/verify-artifacts.js` script performs content hash verification:

```bash
node scripts/verify-artifacts.js runs/season-001/round-001/run-ops-001-nosuk-20260529T185400KST
```

This script:
1. Loads `manifest.yaml` from the run directory.
2. For each artifact with a checksum, computes the actual hash and compares.
3. Reports mismatches as errors, missing hashes as warnings.
4. Verifies evidence content_ref paths resolve to existing files.
5. Checks cross-references (evidence IDs, path consistency).

## Retention and Scrubbing

### Retention Classes

| Class | Duration | Examples | Cleanup Rule |
|---|---|---|---|
| `ephemeral` | Until run completes | Temp files, intermediate outputs, cached fixture copies | May be deleted immediately after run completes |
| `round` | Until the round is archived | Raw evidence files, log files, large transcripts | May be deleted after round archival, provided scrubbing is done |
| `season` | Until the season concludes | Result packets, evidence bundles, manifests, judge records | Preserved for the full season; reviewed before deletion |
| `permanent` | Indefinite | Canonical results, published record entries, scoreboard anchors | Never auto-deleted; requires explicit curator action |

### Scrubbing Rules

1. **Before any automated deletion**, artifacts marked `scrubbing_required: true` must have `redacted: true` and a redaction rule documented.
2. **Raw logs and transcripts** often contain transient identifiers or message content. Set their retention to `round` and mark for scrubbing.
3. **Result packets and evidence bundles** should have summaries and redaction rules that describe the policy, never the secret value itself.
4. **The manifest itself** is never deleted — even after all artifacts are scrubbed, the manifest remains as a tombstone record.
5. **Automated scrubbers** must never delete the manifest.yaml file. The manifest is the authoritative record of what existed, what was removed, and why.

### Cleanup Sequence

When a round is archived and retention cleanup runs:

1. Identify artifacts with `ephemeral` retention → delete immediately.
2. Identify artifacts with `round` retention and `redacted: true` → safe to delete.
3. Identify artifacts with `round` retention and `redacted: false` → warn; do not delete.
4. Keep all `season` and `permanent` artifacts.
5. Update manifest.yaml: remove deleted entries from `artifacts[]`, add a `scrubbed_at` timestamp to `run_metadata`.

## Validation

Two validation layers cover run directories:

### Schema Validation (validate.js)

The `validate.js` script validates individual YAML files against their JSON schemas, including the new `artifact-manifest.schema.json`.

```bash
node scripts/validate.js artifact-manifest runs/season-001/round-001/run-*/manifest.yaml
```

### Competition-Validity (competition-validity.js)

The `competition-validity.js` script performs cross-artifact integrity checks:

```bash
node scripts/competition-validity.js run-artifacts runs/season-001/round-001/
```

Checks include:
- Every run directory has a valid `manifest.yaml`.
- All artifacts listed in the manifest exist on disk.
- All files in the run directory are listed in the manifest.
- Checksums match when present.
- Evidence IDs in result-packet.yaml resolve in evidence-bundle.yaml.
- Content refs in evidence-bundle.yaml resolve to existing files.

## Examples

### Minimal Valid Run Directory

```
runs/season-001/round-001/run-ops-001-nosuk-20260529T185400KST/
├── manifest.yaml
├── result-packet.yaml
├── evidence-bundle.yaml
└── evidence/
    └── gateway-log.txt
```

### Complete Scored Run Directory

```
runs/season-001/round-001/run-code-001-sogyo-20260530T090000UTC/
├── manifest.yaml
├── result-packet.yaml
├── trace.yaml
├── evidence-bundle.yaml
├── judge-record.yaml
├── scoreboard.yaml
└── evidence/
    ├── git-diff.txt
    ├── test-output.log
    ├── tsconfig-snippet.txt
    └── ci-output.txt
```

## Related

- [artifact-manifest.schema.json](../schemas/artifact-manifest.schema.json) — Manifest JSON Schema
- [scripts/verify-artifacts.js](../scripts/verify-artifacts.js) — Hash verification script
- [scripts/competition-validity.js](../scripts/competition-validity.js) — Cross-artifact integrity validator
- [result-packet.md](result-packet.md) — Result packet format
- [evidence-bundle.schema.json](../schemas/evidence-bundle.schema.json) — Evidence bundle schema
- [round-manifest.schema.json](../schemas/round-manifest.schema.json) — Round manifest schema
