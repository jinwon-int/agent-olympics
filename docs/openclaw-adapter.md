# OpenClaw Adapter

This document describes the OpenClaw adapter for Agent Olympics. It covers:

1. [Adapter Metadata](#1-adapter-metadata) — What the adapter itself declares
2. [Run Artifact Mapping](#2-run-artifact-mapping) — How OpenClaw runtime data maps to Agent Olympics formats
3. [Supported Task/Result Capabilities](#3-supported-taskresult-capabilities) — Event families × adapter modes × result statuses
4. [Validation Examples](#4-validation-examples) — Fixture patterns and expected outcomes
5. [Usage Examples](#5-usage-examples) — CLI invocation patterns

---

## 1. Adapter Metadata

The OpenClaw adapter declares structured metadata that makes OpenClaw runtime execution data first-class. This metadata is embedded in the adapter source at `adapters/openclaw-adapter.js` as the `ADAPTER_METADATA` constant and is also written into output artifacts for traceability.

### 1.1 Identity and Versioning

| Field | Value | Description |
|---|---|---|
| `adapter` | `openclaw` | Adapter identifier, used in `result-packet.adapter` and `comparable_metadata.participant.adapter` |
| `adapter_version` | `1.0.0` | SemVer of this adapter implementation |
| `adapter_vendor` | `agent-olympics` | Project responsible for the adapter |
| `adapter_type` | `runtime` | Type: `runtime` (executes tasks) |

### 1.2 Supported Schema Versions

| Envelope | Result Packet | Trace | Evidence Bundle | Manifest |
|---|---|---|---|---|
| v1, v2 | v1, v2 | v1 | v1 | v1 |

### 1.3 Supported Event Families

The adapter can process tasks from these event families:

| Family | Description | Priority for OpenClaw |
|---|---|---|
| `ops` | Operations relay — diagnostics, incident response, monitoring | Primary |
| `code` | Code assist — writing, reviewing, debugging | Supported |
| `smoke` | Smoke test — readiness verification, capability reports | Supported |
| `node` | Node readiness — hardware/software capability matrix | Supported |
| `wiki` | Wiki/runbook — durable knowledge capture | Supported |
| `general` | General purpose agent tasks | Fallback |

### 1.4 Required Environment Variables

Variables the adapter expects at runtime (described by name and purpose; values are never exposed in output artifacts):

| Variable | Purpose |
|---|---|
| `OPENCLAW_GATEWAY_URL` | Gateway endpoint for session management |
| `OPENCLAW_API_KEY` | API key for gateway authentication (**always redacted**) |
| `AGENT_OLYMPICS_TASK_DIR` | Task envelope and fixture directory |

### 1.5 Optional Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `OPENCLAW_SESSION_LABEL` | Custom label for the created session | Auto-generated from task ID |
| `OPENCLAW_TIMEOUT_SECONDS` | Max session runtime before forced timeout | `600` |
| `OPENCLAW_MODEL` | Model override for the session | From task envelope or `gpt-5.x` |
| `OPENCLAW_MODEL_PROVIDER` | Model provider override | `openai` |
| `AGENT_OLYMPICS_RUN_DIR` | Override output directory | Auto-created under `results/` |

### 1.6 Redaction Rules

The adapter applies these value-free redaction rules to protect secrets:

| Rule ID | Pattern Description | Scope | Reason |
|---|---|---|---|
| `rr-openclaw-001` | API keys and bearer tokens in gateway journal entries | `gateway_journal` | `prevent_credential_exposure_in_gateway_logs` |
| `rr-openclaw-002` | Session cookies and auth tokens in delivery probe responses | `delivery_probe` | `prevent_auth_material_exposure_in_delivery_evidence` |
| `rr-openclaw-003` | Secret values in command output summaries | `tool_call_output` | `command_output_contained_sensitive_data` |
| `rr-openclaw-004` | Database connection strings and hostnames in session metadata | `session_metadata` | `prevent_infrastructure_exposure_in_session_metadata` |

### 1.7 Evidence Capabilities

The adapter can produce these evidence kinds. Each maps to an OpenClaw runtime data source:

| Evidence Kind | Source in OpenClaw | Description |
|---|---|---|
| `session_id` | Gateway session response | OpenClaw session UUID |
| `message_id` | Message delivery response | Telegram/gateway message delivery ID |
| `gateway_readiness` | Gateway readiness journal (redacted) | Gateway readiness poll result |
| `delivery_probe` | Channel delivery probe | Probe result for Telegram, gateway, etc. |
| `tool_call_summary` | Session tool trace | Tool call with action, target, duration, redaction |
| `command_summary` | exec tool output | Shell command summary with exit code and output status |
| `session_transcript` | Session message log | Transcript excerpt (redacted, safe lines only) |
| `wiki_pr_ref` | GitHub/git | Link to a Wiki PR or issue for durable knowledge |
| `gateway_log` | Gateway journal log | Log line (redacted for secrets) |
| `config_snippet` | Environment / config | Configuration snippet (no secrets) |
| `probe_result` | Delivery probe API | Gateway or channel probe result |
| `artifact_hash` | Content hashing | SHA-256 for tamper detection |

### 1.8 Timeout Handling

| Parameter | Value |
|---|---|
| Default timeout | 600 seconds (10 minutes) |
| Maximum timeout | 3600 seconds (1 hour) |
| Timeout result status | `partial` |
| Grace period | 30 seconds |
| Evidence on timeout | `session_transcript` (last captured transcript) |
| Action on timeout | Force-terminate session and capture partial results |

### 1.9 Adapter Modes

| Mode | Description | Model Routing | Allowed Tools |
|---|---|---|---|
| `openstack` | Open stack — configurable model, tools, and routing within safety rules | Configurable | All tools available |
| `closedstack` | Closed stack — fixed model, tool budget, and runtime limits | Fixed | `read`, `write`, `exec`, `message`, `web_search`, `web_fetch` |
| `human_baseline` | Human baseline — manual steps documented as trace entries | None (`manual`) | Manual only |

---

## 2. Run Artifact Mapping

This section defines how OpenClaw runtime execution data maps to the standard Agent Olympics submission formats.

### 2.1 OpenClaw → Result Packet

The result packet captures the final outcome. Every OpenClaw session produces one.

| Result Packet Field | OpenClaw Source | Adapter Handling |
|---|---|---|
| `schema_version` | Derived from envelope | v2 preferred; v1 fallback |
| `adapter` | Constant | `"openclaw"` |
| `runtime` | `OPENCLAW_GATEWAY_URL` or constant | `"openclaw"` |
| `runtime_version` | Runtime config / gateway | From `--runtime-version` or `2.14.0` |
| `model`, `model_provider` | Session model routing | From `--model` / `--model-provider` |
| `node` | Hardware label | Declared (safe profile ref) |
| `hardware_profile` | Node capability matrix | Safe, non-secret hardware summary |
| `configuration_profile` | Session config | Model routing, liveness, resource limits |
| `tool_use_profile` | Tool trace analysis | Tools allowed vs tools used |
| `operating_policy` | Adapter mode + safety config | Approval, redaction, delegation, timeout |
| `started_at`, `ended_at` | Session lifecycle | ISO 8601 timestamps |
| `status` | Session outcome | `completed` / `partial` / `failed` / `blocked` |
| `publishable` | Redaction review | `false` by default |
| `comparable_metadata` | Runtime + model + node + config | Safe labels only, no secrets |
| `raw_measurements` | Session instrumentation | Wall time, tool calls, model calls, tokens, probes |
| `summary` | Session output | Human-readable outcome description |
| `actions[]` | Tool call log | Each action = one OpenClaw tool invocation, with redaction |
| `evidence[]` | Gateway journal + probes + tool trace | Evidence items with safe summaries |
| `findings[]` | Agent reasoning | Claims with evidence references and confidence |
| `outputs` | Task-specific deliverables | From envelope's `required_outputs` |
| `risks` | Operator judgment | Risk notes for judge review |

**Mapping details:**

- **`runtime_version`** — Should be obtained from the Gateway version endpoint. The adapter records it as a string with semver format (e.g. `"2.14.0"`).
- **`comparable_metadata.runtime`** — Contains only the runtime name and version. No hostnames, tokens, or credentials.
- **`comparable_metadata.artifact_hashes`** — SHA-256 hashes of the three output files (result packet, trace, evidence bundle) for tamper detection.
- **`raw_measurements.gateway_ready_seconds`** — Time from session creation request to gateway ready probe response.
- **`raw_measurements.session_message_count`** — Number of messages in the session transcript.
- **`actions[].redacted`** — Set to `true` when the tool call or its output contained sensitive data. The corresponding `redaction_reason` is always value-free.
- **`actions[].evidence_id`** — Cross-references an evidence bundle item for the full artifact.

### 2.2 OpenClaw → Trace Record

The trace record is an ordered journal of every significant action. Each OpenClaw tool call or session event becomes a trace entry.

| Trace Entry Field | OpenClaw Source | Adapter Handling |
|---|---|---|
| `seq` | Monotonic counter | Session message index |
| `timestamp` | Event time | ISO 8601 |
| `action` | Tool type | `command` for exec, `read`/`write` for file ops, `api_call` for gateway, `message` for delivery, `think` for context |
| `target` | Tool target | URL, command, file path, channel |
| `summary` | Tool result | Safe, human-readable. **Redacted if sensitive.** |
| `redacted` | Contains secrets? | `true` if redaction rules triggered |
| `redaction_reason` | Rule identifier | Value-free reason, e.g. `command_output_contained_sensitive_data` |
| `duration_ms` | Tool timing | Wall-clock milliseconds |
| `evidence_ref` | Cross-reference | Links to evidence bundle item ID |
| `result_summary` | Tool output | Safe summary of what the call produced |
| `error` | Failure info | Error message (must not contain secrets) |

**Example trace entry mapping from an OpenClaw exec call:**

```yaml
# OpenClaw tool call:
#   Tool: exec("systemctl status telegram-bot")
#   Output: "● telegram-bot.service - loaded, running"
#   Duration: 1200ms
#
# Maps to:
- seq: 6
  timestamp: "2026-05-29T00:10:00+09:00"
  action: command
  target: local
  summary: "Check telegram-bot service status"
  redacted: true
  redaction_reason: "command_output_contained_sensitive_data"
  duration_ms: 1200
  result_summary: "Service status retrieved, output redacted for secrets"
```

### 2.3 OpenClaw → Evidence Bundle

The evidence bundle collects all artifacts referenced by the result packet and trace. Each item maps to a saved file or external URL.

| Evidence Bundle Field | OpenClaw Source | Adapter Handling |
|---|---|---|
| `id` | Consistent reference | Matches `evidence_id` and `evidence_ref` in result packet and trace |
| `kind` | Artifact type | `log` (journal), `command_output` (tool), `probe_result` (delivery), `transcript_excerpt` (session), `config_snippet` (envelope) |
| `source` | Origin | Describes where the evidence came from |
| `summary` | Description | Safe, human-readable |
| `content_ref` | File path | Relative path from run directory |
| `content_type` | MIME type | `text/plain`, `application/json`, `application/x-yaml`, `text/url` |
| `size_bytes` | File size | Integer |
| `checksum` | File hash | `sha256` hex digest |
| `redacted` | Has secrets? | Boolean |
| `redaction_rule` | Rule applied | Value-free reason string |
| `metadata` | Extra info | Arbitrary key-value pairs (log level, source range, etc.) |

**Evidence files produced by the adapter:**

| File | Content | Evidence Kind |
|---|---|---|
| `evidence/gateway-journal.txt` | Gateway readiness log (redacted) | `log` |
| `evidence/delivery-probe.json` | Delivery probe result | `probe_result` |
| `trace.yaml` | Full trace record (cross-referenced) | `command_output` |

### 2.4 OpenClaw → Artifact Manifest

The artifact manifest (`manifest.yaml`) records the complete run directory structure with file types, sizes, checksums, and retention policy.

| Manifest Field | OpenClaw Source | Adapter Handling |
|---|---|---|
| `manifest_id` | Generated | Pattern: `^am-.*$` |
| `run_id` | Match result packet | Shared across all artifacts |
| `status_history[]` | Run lifecycle | Tracks pending → running → completed/failed |
| `artifacts[].path` | File listing | All output files |
| `artifacts[].kind` | File type | `result_packet`, `trace`, `evidence_bundle`, `run_manifest`, `evidence_file` |
| `artifacts[].checksum` | Content hashing | SHA-256 |
| `artifacts[].retention` | Policy | `season` (default) or `permanent` (evidence bundle) |
| `references` | Cross-doc links | Paths to result packet, trace, evidence bundle |
| `retention_policy` | Operator config | Default retention, cleanup window, scrubbing |
| `run_metadata` | Runner + adapter info | Runner version, adapter version, mode, event family |

---

## 3. Supported Task/Result Capabilities

This section defines which event families, adapter modes, and result statuses are supported, along with required evidence for each combination.

### 3.1 Event Family × Adapter Mode Matrix

| Event Family | openstack | closedstack | human_baseline | Description |
|---|---|---|---|---|
| `ops` | ✅ | ✅ | ✅ | Operations relay |
| `code` | ✅ | ✅ | ❌ | Code assist |
| `smoke` | ✅ | ✅ | ❌ | Smoke test |
| `node` | ✅ | ✅ | ❌ | Node readiness |
| `wiki` | ✅ | ✅ | ✅ | Wiki/runbook |
| `general` | ✅ | ✅ | ✅ | General purpose |

### 3.2 Result Status × Event Family

Allowed statuses per event family:

| Event Family | completed | partial | failed | blocked |
|---|---|---|---|---|
| `ops` | ✅ | ✅ | ✅ | ✅ |
| `code` | ✅ | ✅ | ✅ | ❌ |
| `smoke` | ✅ | ❌ | ✅ | ❌ |
| `node` | ✅ | ❌ | ✅ | ❌ |
| `wiki` | ✅ | ✅ | ✅ | ❌ |
| `general` | ✅ | ✅ | ✅ | ✅ |

### 3.3 Required Evidence per Status, by Event Family

#### ops (Operations)

| Status | Required Evidence Kinds |
|---|---|
| `completed` | `session_id`, `tool_call_summary`, `gateway_readiness`, `gateway_log`, `delivery_probe` |
| `partial` | `session_id`, `tool_call_summary`, `gateway_readiness`, `session_transcript` |
| `failed` | `session_id`, `tool_call_summary`, `gateway_log` |
| `blocked` | `session_id`, `session_transcript` |

#### code (Code Assist)

| Status | Required Evidence Kinds |
|---|---|
| `completed` | `session_id`, `tool_call_summary`, `command_summary`, `artifact_hash` |
| `partial` | `session_id`, `tool_call_summary`, `session_transcript` |
| `failed` | `session_id`, `tool_call_summary` |

#### smoke (Smoke Test)

| Status | Required Evidence Kinds |
|---|---|
| `completed` | `session_id`, `gateway_readiness`, `config_snippet`, `probe_result` |
| `failed` | `session_id`, `gateway_log` |

#### node (Node Readiness)

| Status | Required Evidence Kinds |
|---|---|
| `completed` | `session_id`, `config_snippet`, `probe_result` |
| `failed` | `session_id`, `gateway_log` |

#### wiki (Wiki/Runbook)

| Status | Required Evidence Kinds |
|---|---|
| `completed` | `session_id`, `wiki_pr_ref`, `tool_call_summary`, `artifact_hash` |
| `partial` | `session_id`, `session_transcript`, `tool_call_summary` |
| `failed` | `session_id`, `tool_call_summary` |

#### general (General Purpose)

| Status | Required Evidence Kinds |
|---|---|
| `completed` | `session_id`, `tool_call_summary`, `gateway_readiness` |
| `partial` | `session_id`, `tool_call_summary`, `session_transcript` |
| `failed` | `session_id`, `tool_call_summary` |
| `blocked` | `session_id` |

### 3.4 Adapter Mode × Required Evidence (always active)

These evidence kinds are required regardless of event family when using a specific mode:

| Mode | Additional Required Evidence |
|---|---|
| `openstack` | `session_id`, `tool_call_summary`, `gateway_readiness` |
| `closedstack` | `session_id`, `tool_call_summary`, `gateway_readiness`, `artifact_hash` |
| `human_baseline` | `session_id`, `session_transcript`, `message_id` |

---

## 4. Validation Examples

The adapter ships with validation fixtures in `fixtures/openclaw-validity/` that test the complete adapter output pipeline.

### 4.1 Fixture Directory Structure

```
fixtures/openclaw-validity/
├── README.md
├── positive/
│   ├── ops-completed-result-packet.yaml      # ops task, completed, all evidence present
│   ├── ops-completed-trace.yaml               # matching trace record
│   ├── ops-completed-evidence-bundle.yaml     # matching evidence bundle
│   ├── ops-completed-manifest.yaml            # matching manifest
│   ├── code-completed-result-packet.yaml      # code task, completed
│   ├── code-completed-trace.yaml
│   ├── code-completed-evidence-bundle.yaml
│   ├── code-completed-manifest.yaml
│   ├── wiki-partial-result-packet.yaml        # wiki task, partial
│   ├── wiki-partial-trace.yaml
│   ├── wiki-partial-evidence-bundle.yaml
│   └── wiki-partial-manifest.yaml
└── negative/
    ├── missing-evidence-result-packet.yaml    # missing required evidence for status
    ├── redaction-reason-leak-result-packet.yaml  # redaction_reason contains secret
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

### 4.3 Negative Fixture Scenarios

| Fixture | What It Tests | Expected Failure |
|---|---|---|
| `missing-evidence-result-packet.yaml` | Omitted required evidence for `completed` status | Competition-validity check: evidence reference integrity |
| `redaction-reason-leak-result-packet.yaml` | `redaction_reason` contains `sk-...` pattern | Competition-validity check: credential leak detection |
| `status-invalid-result-packet.yaml` | Status = `unknown_value` | Schema validation failure (not in enum) |
| `mode-family-mismatch.yaml` | Mode `human_baseline` used with event family `code` | Adapter validation: mode not in supported list |

### 4.4 Running Validation

```bash
# Validate all fixtures
node scripts/validate.js fixtures

# Validate a single fixture file
node scripts/validate.js fixtures/openclaw-validity/positive/ops-completed-result-packet.yaml

# Run competition-validity checks on fixture output
node scripts/competition-validity.js fixtures fixtures/openclaw-validity
```

---

## 5. Usage Examples

### 5.1 Basic ops task run

```bash
node adapters/openclaw-adapter.js tasks/season-001/ops-001.yaml \
  --agent-id sogyo \
  --runtime openclaw \
  --runtime-version 2.14.0 \
  --mode openstack \
  --event-family ops \
  --model gpt-5.x \
  --model-provider openai
```

### 5.2 Closed stack code task with deterministic output

```bash
node adapters/openclaw-adapter.js tasks/season-001/code-001.yaml \
  --agent-id sogyo \
  --mode closedstack \
  --event-family code \
  --seed ci-v1 \
  --run-dir /tmp/code-run
```

### 5.3 Failure simulation (for CI)

```bash
node adapters/openclaw-adapter.js tasks/season-001/ops-001.yaml \
  --agent-id sogyo \
  --mode openstack \
  --event-family ops \
  --exit 1 \
  --seed test-fail
```

### 5.4 Publishable result

```bash
node adapters/openclaw-adapter.js tasks/smoke/smoke-001.yaml \
  --agent-id sogyo \
  --mode closedstack \
  --event-family smoke \
  --seed smoke-ci \
  --publishable
```

### 5.5 All flags reference

```text
Usage: node adapters/openclaw-adapter.js <envelope-path> [options]

Options:
  --run-dir <path>          Output directory (default: auto-created)
  --agent-id <string>       Agent identifier (default: sogyo)
  --runtime <string>        Runtime identifier (default: openclaw)
  --runtime-version <str>   OpenClaw runtime version (default: 2.14.0)
  --mode <mode>             Adapter mode: openstack, closedstack, human_baseline
  --event-family <family>   Event family: ops, code, smoke, node, wiki, general
  --model <name>            Model name (default: gpt-5.x)
  --model-provider <name>   Model provider (default: openai)
  --exit <code>             Simulated exit code: 0|1|2 (default: 0)
  --seed <string>           Deterministic seed for stable output IDs
  --timestamp <time>        ISO timestamp override
  --publishable             Mark result as publishable (default: false)
```

### 5.6 Output artifacts

| File | Schema | Purpose |
|---|---|---|
| `result-packet.yaml` | `result-packet.schema.json` | v2 result packet with OpenClaw execution data |
| `trace.yaml` | `trace-record.schema.json` | v1 trace record with session journal |
| `evidence-bundle.yaml` | `evidence-bundle.schema.json` | v1 evidence bundle with gateway logs, probes |
| `manifest.yaml` | `artifact-manifest.schema.json` | Run directory manifest with checksums |
| `run.yaml` | (run metadata) | Run orchestration metadata |
| `envelope-copy.yaml` | (input copy) | Deterministic copy of the input envelope |
| `adapter.log` | (plain text) | Captured run output |
| `evidence/gateway-journal.txt` | (plain text, redacted) | Gateway readiness log |
| `evidence/delivery-probe.json` | (JSON) | Delivery probe result |

---

*Document maintained by Team1, lane 1/3 (sogyo). See also: [Adapter Execution Contract](adapter-execution-contract.md), [Result Packet](result-packet.md), [competition-validity fixtures](../fixtures/competition-validity/README.md).*
