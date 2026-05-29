# Platform-Neutral Adapter Fields

This document defines the **common fields** that every adapter result
packet must contain, regardless of adapter runtime (Hermes, CLI, Human
Baseline, OpenClaw, or future adapters).

These fields are the minimum contract all adapters share.  Adapter-
specific fields (documented in capability declarations under
`fixtures/adapters/capabilities/`) are additive — they sit alongside
these common fields but are not required by the common contract.

## Why Platform-Neutral Fields?

1. **Interchangeability.** The judge harness, dashboard, and runner
   should be able to process result packets from any adapter using the
   same code paths.  Platform-neutral fields guarantee a shared schema
   surface.

2. **Validation.** The `result-packet.schema.json` can enforce a core
   set of required fields that every adapter must provide, while
   allowing optional adapter-specific extensions via `additionalProperties`.

3. **Comparability.** When comparing Hermes vs CLI vs Human Baseline
   performance on the same task, the common fields provide the apples-
   to-apples basis for comparison.

## Required Common Fields

These fields are required in every result packet, per the
[Adapter Execution Contract](adapter-execution-contract.md) and the
`result-packet.schema.json` schema.

### Top-Level Fields

| Field | Type | Description |
|---|---|---|
| `schema_version` | integer (1) | Schema version identifier. |
| `packet_id` | string | Unique identifier for this result packet. |
| `envelope_id` | string | The task envelope whose execution produced this packet. |
| `adapter` | object | Describes the adapter that produced the packet (see below). |
| `status` | string | One of: `completed`, `partial`, `blocked`, `failed`, `disqualified`. |
| `summary` | string | One-paragraph safe summary of what was done and the outcome. |
| `evidence` | array of objects | Evidence items supporting the findings. ≥ 1 required. |
| `findings` | array of objects | Structured findings. ≥ 1 required. |
| `outputs` | object | Key-value pairs covering all `required_outputs` from the task envelope. |
| `started_at` | string (ISO 8601) | Wall-clock timestamp when the adapter started work. |
| `ended_at` | string (ISO 8601) | Wall-clock timestamp when the adapter completed work. |

### `adapter` Object Fields

| Field | Type | Description |
|---|---|---|
| `runtime` | string | Adapter type: `"hermes"`, `"cli"`, `"human-baseline"`, `"openclaw"`. |
| `agent_id` | string | Self-chosen agent identifier. |
| `version` | string (optional) | Adapter implementation version. |

### Per-Evidence Fields (inside `evidence[]`)

| Field | Type | Description |
|---|---|---|
| `evidence_id` | string | Unique identifier within the result packet. |
| `kind` | string | Evidence kind (see evidence-bundle.schema.json for allowed values). |
| `description` | string | Human-readable description of this evidence item. |
| `content_ref` | string | Path or URL to the evidence content. |
| `redacted` | boolean | Whether the evidence has been redacted. |

### Per-Finding Fields (inside `findings[]`)

| Field | Type | Description |
|---|---|---|
| `finding_id` | string | Unique identifier within the result packet. |
| `rule` | string | Rule identifier that this finding relates to. |
| `severity` | string | Severity level (`info`, `warning`, `error`, `critical`). |
| `description` | string | Human-readable description of the finding. |
| `passed` | boolean | Whether the associated check passed. |
| `recommendation` | string (optional) | Recommended follow-up action. |

## Status Semantics (Adapter-Neutral)

| Status | Meaning | Used When |
|---|---|---|
| `completed` | All required outputs produced successfully | All clear, no red flags |
| `partial` | Some outputs present, some missing or incomplete | Timeout, skipped subtask, graceful degradation |
| `blocked` | Adapter could not proceed due to external factors | Missing prerequisites, network down, permission denied |
| `failed` | Adapter ran but produced wrong/invalid results | Wrong output, contradiction, unrecoverable error |
| `disqualified` | Adapter violated rules (leaked credentials, etc.) | Credential leak, sandbox escape, rule violation |

## Status Mapping by Adapter

Each adapter maps its internal states to the common five-status model.
The mapping is documented in the adapter's capability declaration:

- [Hermes Status Mapping](../fixtures/adapters/capabilities/hermes.yaml)
- [CLI Status Mapping](../fixtures/adapters/capabilities/cli.yaml)
- [Human Baseline Status Mapping](../fixtures/adapters/capabilities/human-baseline.yaml)

## Optional Common Fields

These fields may appear in any adapter's result packet but are not
always required by the schema:

| Field | Type | Description |
|---|---|---|
| `metadata` | object | Extra key-value pairs for dashboards and diagnostics. |
| `trace_ref` | string | Reference to an associated trace record. |
| `node_profile_ref` | string | Reference to the node profile used. |
| `parent_packet_id` | string | For merged/aggregated packets: the parent's packet ID. |

## Adapter-Specific Fields (Not Common)

The fields below are **not** platform-neutral.  They exist only in
specific adapter result packets, documented in the capability
declarations.

| Adapter | Additional Fields |
|---|---|
| **Hermes** | `workflow_id`, `workflow_plan`, `worker_assignments`, `worker_state_transitions`, `memory_retrieval_summary`, `tool_trace_summary`, `final_commander_report`, `contradictions` |
| **CLI** | `working_directory`, `exit_codes`, `command_durations_ms`, `git_diff`, `test_results`, `terminal_history`, `file_change_list` |
| **Human Baseline** | `operator_action_log`, `operator_notes`, `reference_material_consulted`, `screen_recordings`, `artifact_references` |

## Related Documents

- [Adapter Execution Contract](adapter-execution-contract.md) — Full contract.
- [Adapter Compatibility Fixtures](adapter-compatibility-fixtures.md) —
  Shared fixture data and capability declarations.
- [Result Packet Schema](../schemas/result-packet.schema.json) —
  JSON Schema for validation.
- [Evidence Bundle Schema](../schemas/evidence-bundle.schema.json) —
  JSON Schema for evidence bundles.
