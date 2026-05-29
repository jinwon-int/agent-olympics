# Hermes Adapter

This document describes the Hermes adapter for Agent Olympics. It covers:

1. [Adapter Metadata](#1-adapter-metadata) — What the adapter itself declares
2. [Run Artifact Mapping](#2-run-artifact-mapping) — How Hermes workflow data maps to Agent Olympics formats
3. [Supported Task/Result Capabilities](#3-supported-taskresult-capabilities) — Event families × adapter modes × result statuses
4. [Validation Examples](#4-validation-examples) — Fixture patterns and expected outcomes
5. [Usage Examples](#5-usage-examples) — CLI invocation patterns

---

## 1. Adapter Metadata

The Hermes adapter declares structured metadata that makes Hermes workflow orchestration data first-class. This metadata is embedded in the adapter source at `adapters/hermes-adapter.js` as the `ADAPTER_METADATA` constant and is also written into output artifacts for traceability.

### 1.1 Identity and Versioning

| Field | Value | Description |
|---|---|---|
| `adapter` | `hermes` | Adapter identifier, used in `result-packet.adapter` and `comparable_metadata.participant.adapter` |
| `adapter_version` | `1.0.0` | SemVer of this adapter implementation |
| `adapter_vendor` | `agent-olympics` | Project responsible for the adapter |
| `adapter_type` | `orchestrator` | Type: `orchestrator` (decomposes tasks into sub-tasks and dispatches workers) |

### 1.2 Supported Schema Versions

| Envelope | Result Packet | Trace | Evidence Bundle | Manifest |
|---|---|---|---|---|
| v1, v2 | v1, v2 | v1 | v1 | v1 |

### 1.3 Supported Event Families

The adapter can process tasks from these event families:

| Family | Description | Priority for Hermes |
|---|---|---|
| `ops` | Operations relay — diagnostics, incident response, monitoring | Primary |
| `code` | Code assist — writing, reviewing, debugging | Supported |
| `smoke` | Smoke test — readiness verification, capability reports | Supported |
| `node` | Node readiness — hardware/software capability matrix | Supported |
| `wiki` | Wiki/runbook — durable knowledge capture | Supported |
| `general` | General purpose agent tasks | Fallback |
| `coord` | Coordination drills — multi-agent orchestration | Extended |

### 1.4 Required Environment Variables

Variables the adapter expects at runtime (described by name and purpose; values are never exposed in output artifacts):

| Variable | Purpose |
|---|---|
| `HERMES_ORCHESTRATOR_URL` | Orchestrator endpoint for workflow management |
| `HERMES_API_KEY` | API key for orchestrator authentication (**always redacted**) |
| `AGENT_OLYMPICS_TASK_DIR` | Task envelope and fixture directory |

### 1.5 Optional Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `HERMES_WORKER_TIMEOUT_SECONDS` | Max per-worker runtime before forced timeout | `300` |
| `HERMES_MAX_CONCURRENT_WORKERS` | Max parallel workers | `3` |
| `HERMES_WORKER_POOL` | Worker pool configuration reference | `stub` |
| `AGENT_OLYMPICS_RUN_DIR` | Override output directory | Auto-created under `results/` |

### 1.6 Redaction Rules

The adapter applies these value-free redaction rules to protect secrets:

| Rule ID | Pattern Description | Scope | Reason |
|---|---|---|---|
| `rr-hermes-001` | Credential-like strings in worker command output or API response | `worker_output` | `hermes_credential_in_worker_output` |
| `rr-hermes-002` | Private memory content in retrieval summaries | `memory_retrieval` | `hermes_memory_content` |
| `rr-hermes-003` | Sensitive parameter values in workflow invocation arguments | `workflow_arguments` | `hermes_workflow_arguments` |
| `rr-hermes-004` | Worker session tokens and credentials in trace entries | `worker_trace` | `prevent_worker_credential_exposure_in_trace` |

### 1.7 Evidence Capabilities

The adapter can produce these evidence kinds. Each maps to a Hermes orchestrator data source:

| Evidence Kind | Source in Hermes | Description |
|---|---|---|
| `workflow_plan` | Workflow engine | Task decomposition plan with step dependencies and worker assignments |
| `worker_trace` | Worker execution log | Individual worker trace with tool calls and results |
| `memory_summary` | Worker memory retrieval | Memory retrieval summary (redacted, no private content) |
| `commander_report` | Commander synthesis | Synthesized findings after all workers complete |
| `contradiction_log` | Evidence merger | Log of contradictory worker evidence and resolution status |
| `worker_assignment` | Worker pool | Worker identifier and assigned subtask description |
| `workflow_state` | Workflow engine | State transition timeline (pending → running → completed) |
| `config_snippet` | Environment / config | Configuration snippet (no secrets) |
| `probe_result` | Worker readiness probe | Workflow or worker readiness check result |
| `artifact_hash` | Content hashing | SHA-256 for tamper detection |

### 1.8 Timeout Handling

| Parameter | Value |
|---|---|
| Default timeout | 900 seconds (15 minutes) |
| Maximum timeout | 3600 seconds (1 hour) |
| Timeout result status | `partial` |
| Grace period | 60 seconds (per-worker) |
| Evidence on timeout | `workflow_state` (last captured workflow state) |
| Action on timeout | Force-terminate all workers and capture partial results |

### 1.9 Adapter Modes

| Mode | Description | Default Workers | Allowed Profiles |
|---|---|---|---|
| `orchestrator` | Full workflow decomposition with worker dispatch and result synthesis | 3 | `stub-small-vps`, `stub-medium-vps` |
| `coordinator` | Simplified dispatch without hierarchical evidence merging | 2 | `stub-small-vps` |
| `simulation` | Deterministic output using fixture data without live workers | 1 | `stub-small-vps` |

### 1.10 Hermes-Specific Status Mapping

The Hermes adapter maps internal workflow states to standard result packet statuses:

| Internal State | Result Status |
|---|---|
| `workflow_completed_all_outputs_present` | `completed` |
| `workflow_completed_some_outputs_missing` | `partial` |
| `workflow_timed_out` | `partial` |
| `workflow_blocked_worker_assignment` | `blocked` |
| `workflow_blocked_memory_retrieval` | `blocked` |
| `workflow_blocked_missing_plugin` | `blocked` |
| `workflow_produced_wrong_result` | `failed` |
| `workflow_contradictory_unresolved` | `failed` |
| `value_exposure_detected` | `disqualified` |

Note: `disqualified` is a status unique to Hermes, triggered when a value exposure is detected in worker output.

---

## 2. Run Artifact Mapping

This section defines how Hermes workflow orchestration data maps to the standard Agent Olympics submission formats.

### 2.1 Hermes → Result Packet

The result packet captures the final outcome of the orchestrated workflow. Every Hermes run produces one.

| Result Packet Field | Hermes Source | Adapter Handling |
|---|---|---|
| `schema_version` | Derived from envelope | v2 preferred; v1 fallback |
| `adapter` | Constant | `"hermes"` |
| `runtime` | `HERMES_ORCHESTRATOR_URL` or constant | `"hermes"` |
| `runtime_version` | Runtime config / orchestrator | From `--runtime-version` or `1.0.0` |
| `model`, `model_provider` | Commander model routing | From `--model` / `--model-provider` |
| `node` | Hardware label | Declared (safe profile ref: `orchestrator-node`) |
| `hardware_profile` | Node capability matrix | Safe, non-secret hardware summary |
| `configuration_profile` | Session config + worker settings | Model routing, worker count, concurrency |
| `tool_use_profile` | Tool trace analysis | Tools allowed vs tools used (incl `delegate`) |
| `operating_policy` | Adapter mode + safety config | Approval, delegation, timeout, contradiction resolution |
| `started_at`, `ended_at` | Workflow lifecycle | ISO 8601 timestamps |
| `status` | Workflow outcome | `completed` / `partial` / `failed` / `blocked` / `disqualified` |
| `publishable` | Redaction review | `false` by default |
| `comparable_metadata` | Runtime + model + node + config + workflow | Safe labels only, no secrets; includes `workflow` block with `workflow_id`, `step_count`, `worker_count` |
| `raw_measurements` | Orchestrator instrumentation | Wall time, worker count, memory retrievals, cache hit rate, tool calls, contradictions |
| `summary` | Commander synthesis | Human-readable outcome description |
| `actions[]` | Orchestrator event log | Each action = one orchestrator-level event (plan, delegate, collect, synthesize), with redaction |
| `evidence[]` | Workflow plan + worker traces + memory summaries | Evidence items with safe summaries |
| `findings[]` | Commander reasoning | Claims with evidence references and confidence |
| `outputs` | Task-specific deliverables | From envelope's `required_outputs` |
| `risks` | Operator judgment | Risk notes for judge review |

**Mapping details:**

- **`runtime_version`** — Should be obtained from the Hermes orchestrator version endpoint. The adapter records it as a string with semver format (e.g. `"1.0.0"`).
- **`comparable_metadata.workflow`** — Hermes-specific block containing the workflow ID, step count, worker count, and worker profiles. No secrets.
- **`comparable_metadata.artifact_hashes`** — SHA-256 hashes of the three output files (result packet, trace, evidence bundle) for tamper detection.
- **`raw_measurements.memory_cache_hit_ratio`** — Ratio of memory keys found vs requested across all workers.
- **`raw_measurements.contradictions_detected`** — Number of contradictory evidence pairs found during worker result merging.
- **`actions[].redacted`** — Set to `true` when the action or its output contained sensitive data. The corresponding `redaction_reason` is always value-free.
- **`operating_policy.contradiction_resolution`** — `automated_resolved` when no contradictions, `requires_human_in_loop` when contradictions are detected.

### 2.2 Hermes → Trace Record

The trace record is an ordered journal of every significant orchestrator-level action. Each Hermes orchestration event becomes a trace entry.

| Trace Entry Field | Hermes Source | Adapter Handling |
|---|---|---|
| `seq` | Monotonic counter | Orchestrator event index |
| `timestamp` | Event time | ISO 8601 |
| `action` | Event type | `plan` for workflow decomposition, `delegate` for worker dispatch, `collect` for result collection, `analyze` for contradictions, `synthesize` for commander report, `api_call` for orchestrator API, `read`/`write` for file ops |
| `target` | Event target | Workflow, worker pool, orchestrator, contradiction |
| `summary` | Event result | Safe, human-readable. **Redacted if sensitive.** |
| `redacted` | Contains secrets? | `true` if redaction rules triggered |
| `redaction_reason` | Rule identifier | Value-free reason, e.g. `hermes_credential_in_worker_output` |
| `duration_ms` | Event timing | Wall-clock milliseconds |
| `evidence_ref` | Cross-reference | Links to evidence bundle item ID |
| `result_summary` | Event output | Safe summary of what the call produced |

**Example trace entry mapping from Hermes dispatch:**

```yaml
# Hermes orchestrator event:
#   Action: Dispatch 3 workers with subtasks
#   Workers: [worker-alpha (connectivity), worker-beta (config), worker-gamma (logs)]
#   Duration: 800ms
#
# Maps to:
- seq: 3
  timestamp: "2026-05-29T09:00:05+09:00"
  action: delegate
  target: worker_pool
  summary: "Dispatch 3 workers with assigned subtasks"
  redacted: true
  redaction_reason: "hermes_workflow_arguments"
  duration_ms: 800
  result_summary: "Workers dispatched: stub-small-vps, stub-medium-vps"
  evidence_ref: "ev-worker-assignments"
```

### 2.3 Hermes → Evidence Bundle

The evidence bundle collects all artifacts referenced by the result packet and trace. Each item maps to a saved file or external URL. Hermes produces unique evidence types that capture the multi-worker orchestration context.

| Evidence Bundle Field | Hermes Source | Adapter Handling |
|---|---|---|
| `id` | Consistent reference | Matches `evidence_id` and `evidence_ref` in result packet and trace |
| `kind` | Artifact type | `workflow_plan`, `worker_trace`, `memory_summary`, `contradiction_log`, `commander_report`, `config_snippet`, `probe_result` |
| `source` | Origin | Describes where the evidence came from |
| `summary` | Description | Safe, human-readable |
| `content_ref` | File path | Relative path from run directory |
| `content_type` | MIME type | `application/x-yaml`, `text/plain`, `application/json` |
| `size_bytes` | File size | Integer |
| `checksum` | File hash | `sha256` hex digest |
| `redacted` | Has secrets? | Boolean |
| `redaction_rule` | Rule applied | Value-free reason string |
| `metadata` | Extra info | Arbitrary key-value pairs (cache hit ratio, worker count, etc.) |

**Evidence files produced by the Hermes adapter:**

| File | Content | Evidence Kind |
|---|---|---|
| `evidence/workflow-plan.yaml` | Task decomposition plan with step dependencies | `workflow_plan` |
| `evidence/worker-traces.yaml` | Consolidated worker tool traces | `worker_trace` |
| `evidence/memory-summary.yaml` | Memory retrieval summaries per worker | `memory_summary` |
| `evidence/contradiction-log.yaml` | Contradictory evidence log (if any) | `contradiction_log` |
| `evidence/commander-report.yaml` | Synthesized commander report | `commander_report` |

### 2.4 Hermes → Artifact Manifest

The artifact manifest (`manifest.yaml`) records the complete run directory structure with file types, sizes, checksums, and retention policy. Same structure as the OpenClaw adapter, with Hermes-specific evidence files included.

---

## 3. Supported Task/Result Capabilities

This section defines which event families, adapter modes, and result statuses are supported, along with required evidence for each combination.

### 3.1 Event Family × Adapter Mode Matrix

| Event Family | orchestrator | coordinator | simulation | Description |
|---|---|---|---|---|
| `ops` | ✅ | ✅ | ✅ | Operations relay |
| `code` | ✅ | ❌ | ✅ | Code assist |
| `smoke` | ✅ | ❌ | ✅ | Smoke test |
| `node` | ✅ | ❌ | ✅ | Node readiness |
| `wiki` | ✅ | ❌ | ✅ | Wiki/runbook |
| `general` | ✅ | ✅ | ✅ | General purpose |
| `coord` | ✅ | ✅ | ❌ | Coordination drills |

### 3.2 Result Status × Event Family

Allowed statuses per event family:

| Event Family | completed | partial | failed | blocked | disqualified |
|---|---|---|---|---|---|
| `ops` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `code` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `smoke` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `node` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `wiki` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `general` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `coord` | ✅ | ✅ | ✅ | ❌ | ✅ |

### 3.3 Required Evidence per Status, by Event Family

#### ops (Operations)

| Status | Required Evidence Kinds |
|---|---|
| `completed` | `workflow_plan`, `worker_trace`, `commander_report`, `memory_summary`, `config_snippet` |
| `partial` | `workflow_plan`, `worker_trace`, `commander_report`, `workflow_state` |
| `failed` | `workflow_plan`, `worker_trace`, `contradiction_log` |
| `blocked` | `workflow_plan`, `workflow_state` |
| `disqualified` | `workflow_plan`, `contradiction_log`, `workflow_state` |

#### code (Code Assist)

| Status | Required Evidence Kinds |
|---|---|
| `completed` | `workflow_plan`, `worker_trace`, `commander_report`, `memory_summary`, `artifact_hash` |
| `partial` | `workflow_plan`, `worker_trace`, `commander_report` |
| `failed` | `workflow_plan`, `worker_trace`, `contradiction_log` |

#### smoke (Smoke Test)

| Status | Required Evidence Kinds |
|---|---|
| `completed` | `workflow_plan`, `commander_report`, `probe_result`, `config_snippet` |
| `failed` | `workflow_plan`, `commander_report`, `contradiction_log` |

#### node (Node Readiness)

| Status | Required Evidence Kinds |
|---|---|
| `completed` | `workflow_plan`, `commander_report`, `config_snippet`, `probe_result` |
| `failed` | `workflow_plan`, `worker_trace`, `contradiction_log` |

#### wiki (Wiki/Runbook)

| Status | Required Evidence Kinds |
|---|---|
| `completed` | `workflow_plan`, `worker_trace`, `commander_report`, `memory_summary`, `artifact_hash` |
| `partial` | `workflow_plan`, `worker_trace`, `commander_report`, `workflow_state` |
| `failed` | `workflow_plan`, `worker_trace`, `contradiction_log` |

#### general (General Purpose)

| Status | Required Evidence Kinds |
|---|---|
| `completed` | `workflow_plan`, `worker_trace`, `commander_report`, `memory_summary` |
| `partial` | `workflow_plan`, `worker_trace`, `workflow_state` |
| `failed` | `workflow_plan`, `worker_trace`, `contradiction_log` |
| `blocked` | `workflow_plan`, `workflow_state` |

#### coord (Coordination Drills)

| Status | Required Evidence Kinds |
|---|---|
| `completed` | `workflow_plan`, `worker_trace`, `commander_report`, `memory_summary`, `contradiction_log` |
| `partial` | `workflow_plan`, `worker_trace`, `commander_report`, `workflow_state` |
| `failed` | `workflow_plan`, `worker_trace`, `contradiction_log` |
| `disqualified` | `workflow_plan`, `contradiction_log`, `workflow_state` |

### 3.4 Adapter Mode × Required Evidence (always active)

These evidence kinds are required regardless of event family when using a specific mode:

| Mode | Additional Required Evidence |
|---|---|
| `orchestrator` | `workflow_plan`, `worker_assignment`, `commander_report` |
| `coordinator` | `workflow_plan`, `worker_assignment` |
| `simulation` | `workflow_plan`, `commander_report` |

---

## 4. Validation Examples

The adapter ships with validation fixtures in `fixtures/hermes-validity/` that test the complete adapter output pipeline.

### 4.1 Fixture Directory Structure

```
fixtures/hermes-validity/
├── README.md
├── positive/
│   ├── ops-completed-result-packet.yaml      # ops task, completed, all evidence present
│   ├── ops-completed-trace.yaml               # matching trace record
│   ├── ops-completed-evidence-bundle.yaml     # matching evidence bundle
│   ├── ops-completed-manifest.yaml            # matching manifest
│   ├── code-completed-result-packet.yaml      # code task, completed
│   ├── code-completed-trace.yaml
│   ├── code-completed-evidence-bundle.yaml
│   └── code-completed-manifest.yaml
└── negative/
    ├── missing-evidence-result-packet.yaml    # missing required evidence for completed status
    ├── redaction-reason-leak-result-packet.yaml  # redaction_reason contains leaked secret
    ├── status-invalid-result-packet.yaml      # invalid status value
    └── mode-family-mismatch.yaml              # mode doesn't support this event family
```

### 4.2 Positive Fixture Scenarios

Each positive fixture validates that the adapter output:
1. Passes JSON Schema validation for the respective schema
2. Contains required fields and evidence
3. Follows redaction rules (value-free reasons)
4. Has consistent cross-references (run_id, evidence IDs)
5. Uses safe, non-secret summaries
6. Properly encodes Hermes-specific fields (workflow, contradictions, memory)

### 4.3 Negative Fixture Scenarios

| Fixture | What It Tests | Expected Failure |
|---|---|---|
| `missing-evidence-result-packet.yaml` | Omitted required evidence for `completed` status | Competition-validity check: evidence reference integrity |
| `redaction-reason-leak-result-packet.yaml` | `redaction_reason` contains credential-like string | Competition-validity check: credential leak detection |
| `status-invalid-result-packet.yaml` | Status = `unknown_value` | Schema validation failure (not in enum) |
| `mode-family-mismatch.yaml` | Mode `coordinator` used with event family `code` | Adapter validation: mode not in supported list |

### 4.4 Running Validation

```bash
# Validate all Hermes fixtures
node scripts/validate.js fixtures/hermes-validity

# Validate a single fixture file
node scripts/validate.js fixtures/hermes-validity/positive/ops-completed-result-packet.yaml

# Run competition-validity checks on fixture output
node scripts/competition-validity.js fixtures fixtures/hermes-validity
```

---

## 5. Usage Examples

### 5.1 Basic ops task run (orchestrator mode)

```bash
node adapters/hermes-adapter.js tasks/season-001/ops-001.yaml \
  --agent-id sogyo \
  --runtime hermes \
  --runtime-version 1.0.0 \
  --mode orchestrator \
  --event-family ops \
  --model gpt-5.x \
  --model-provider openai
```

### 5.2 Simulation mode with deterministic output

```bash
node adapters/hermes-adapter.js tasks/stub-test/stub-hello-envelope.yaml \
  --agent-id sogyo \
  --mode simulation \
  --event-family general \
  --seed hermes-ci \
  --run-dir /tmp/hermes-run
```

### 5.3 Code task with contradictory evidence

```bash
node adapters/hermes-adapter.js tasks/stub-test/stub-hello-envelope.yaml \
  --agent-id sogyo \
  --mode orchestrator \
  --event-family code \
  --seed hermes-contra \
  --contradictory
```

### 5.4 Failure simulation (for CI)

```bash
node adapters/hermes-adapter.js tasks/stub-test/stub-hello-envelope.yaml \
  --agent-id sogyo \
  --mode orchestrator \
  --event-family ops \
  --exit 1 \
  --seed hermes-fail
```

### 5.5 Publishable result

```bash
node adapters/hermes-adapter.js tasks/stub-test/stub-hello-envelope.yaml \
  --agent-id sogyo \
  --mode simulation \
  --event-family smoke \
  --seed hermes-smoke \
  --publishable
```

### 5.6 All flags reference

```text
Usage: node adapters/hermes-adapter.js <envelope-path> [options]

Options:
  --run-dir <path>          Output directory (default: auto-created)
  --agent-id <string>       Agent identifier (default: sogyo)
  --runtime <string>        Runtime identifier (default: hermes)
  --runtime-version <str>   Hermes runtime version (default: 1.0.0)
  --mode <mode>             Adapter mode: orchestrator, coordinator, simulation
  --event-family <family>   Event family: ops, code, smoke, node, wiki, general, coord
  --model <name>            Model name (default: gpt-5.x)
  --model-provider <name>   Model provider (default: openai)
  --exit <code>             Simulated exit code: 0|1|2|3 (default: 0)
  --seed <string>           Deterministic seed for stable output IDs
  --timestamp <time>        ISO timestamp override
  --publishable             Mark result as publishable (default: false)
  --contradictory           Simulate contradictory worker evidence (default: false)
```

### 5.7 Output artifacts

| File | Schema | Purpose |
|---|---|---|
| `result-packet.yaml` | `result-packet.schema.json` | v2 result packet with Hermes workflow execution data |
| `trace.yaml` | `trace-record.schema.json` | v1 trace record with orchestrator journal |
| `evidence-bundle.yaml` | `evidence-bundle.schema.json` | v1 evidence bundle with workflow plan, worker traces, memory summaries |
| `manifest.yaml` | `artifact-manifest.schema.json` | Run directory manifest with checksums |
| `run.yaml` | (run metadata) | Run orchestration metadata |
| `envelope-copy.yaml` | (input copy) | Deterministic copy of the input envelope |
| `adapter.log` | (plain text) | Captured run output |
| `evidence/workflow-plan.yaml` | (YAML) | Task decomposition plan |
| `evidence/worker-traces.yaml` | (YAML) | Consolidated worker traces |
| `evidence/memory-summary.yaml` | (YAML) | Memory retrieval summaries (redacted) |
| `evidence/contradiction-log.yaml` | (YAML) | Contradictory evidence log (conditional) |
| `evidence/commander-report.yaml` | (YAML) | Synthesized commander report (conditional) |

---

## Related Documents

- [Adapter Execution Contract](adapter-execution-contract.md) — formal execution contract with Hermes addenda
- [Result Packet](result-packet.md) — standard result packet schema reference
- [OpenClaw Adapter](openclaw-adapter.md) — sibling runtime adapter (reference implementation)
- [Adapter Compatibility Fixtures](adapter-compatibility-fixtures.md) — fixture conventions and usage
- [Hermes capability declaration](../fixtures/adapters/capabilities/hermes.yaml) — declared adapter capabilities

---

*Document maintained by Team1, lane 1/3 (sogyo). See also: [Adapter Execution Contract](adapter-execution-contract.md), [Result Packet](result-packet.md), [Hermes validation fixtures](../fixtures/hermes-validity/README.md).*
