# Adapter Execution Contract

Every Agent Olympics participant — whether it is OpenClaw, Hermes, a CLI agent,
a shell script, or a human operator — communicates through a single adapter
interface. This document defines the execution contract that every adapter must
satisfy.

The contract is platform-neutral. It does not prescribe how an adapter works
internally, only what it must accept, produce, and guarantee.

---

## 1. Contract Overview

### Purpose

Define the common execution boundary so that any task envelope can be submitted
to any adapter and the result packet, trace, and evidence bundle can be
validated, scored, and compared without knowledge of the adapter internals.

### Scope

This contract applies to four adapter classes:

| Adapter | Runtime | Reference Issue |
|---|---|---|
| **OpenClaw Adapter** | OpenClaw Gateway with OpenClaw agent sessions | [roadmap-03](../../issues/roadmap-03-openclaw-adapter.md) |
| **Hermes Adapter** | Hermes workflow or agent | [roadmap-04](../../issues/roadmap-04-hermes-adapter.md) |
| **CLI Adapter** | Local terminal command, script, or coding agent | _(same contract)_ |
| **Human Baseline Adapter** | Manual operator following the task prompt | _(same contract)_ |

### Contract Versions

This document follows the schema version conventions of Task Envelopes and
Result Packets. The contract version is independent of the envelope schema
version; it evolves as we learn what adapters need.

| Version | Date | Notes |
|---|---|---|
| 1 | 2026-05-29 | Initial contract established per [#25](../../issues/roadmap-02-first-season-pack.md) |

---

## 2. Input Contract

Every adapter receives the same set of inputs.

### Required Inputs

| Field | Type | Source | Description |
|---|---|---|---|
| Task Envelope | YAML/JSON file or in-memory object | Runner | The full task envelope (`task-envelope.schema.json` or `task-envelope-v2.schema.json`). Contains objective, time limit, allowed/forbidden actions, required outputs, and rubric. |
| Task ID | string | Envelope `task_id` | Stable identifier used for result packet linkage. |
| Run ID | string | Runner-assigned | Unique run identifier used to correlate the result packet, trace, and evidence bundle. |
| Agent ID | string | Runner or participant | Self-identifier the participant uses for the result packet. |
| Workspace path | string (path) | Runner | File-system path where the adapter may read/write task artifacts. |

### Optional Inputs

| Field | Type | Description |
|---|---|---|
| Environment overrides | object | Runner-provided overrides for config, credentials (paths only), or hardware profile. |
| Baseline profile | object | Reference baseline metadata for comparison tasks. |
| Fixtures | string[] | Paths or URLs to fixture data required by the task. |
| Oracle ref | string | Path to the oracle answer key file (adapter must not read it — only the runner or judge may use it). |

### Input Safety Rules

1. The adapter must never read the oracle or judge notes file unless explicitly
   authorized as the judge adapter.
2. Credential paths may be provided, but credential values must not appear in
   the input contract.
3. The adapter must treat the envelope as immutable during execution.

---

## 3. Output Contract

Every adapter produces the same output triplet.

### Required Outputs

| Document | Schema | Required? | Description |
|---|---|---|---|
| **Result Packet** | `result-packet.schema.json` (v1) or `result-packet-v2.schema.json` (v2) | **Required** | Final outcome: status, summary, evidence, findings, outputs. |
| **Trace Record** | `trace-record.schema.json` | **Required** | Ordered journal of every significant action (tool call, read, write, API call, think, message). |
| **Evidence Bundle** | `evidence-bundle.schema.json` | **Required** | Collection of evidence artifacts with content refs, checksums, and redaction metadata. |

The three documents are linked by a shared `run_id` and may be wrapped in a
**Run Result** (`run-result.schema.json`).

### Run Result (optional wrapper)

```yaml
schema_version: 1
run_id: run-ops-001-yukson-20260529
task_id: ops-001
agent_id: yukson
runtime: openclaw
generated_at: "2026-05-29T00:24:00+09:00"

result_packet:
  # ... (standard result-packet fields, see schemas/result-packet.schema.json)

trace:
  trace_id: tr-ops-001-yukson-001
  entries: [...]

evidence_bundle:
  bundle_id: eb-ops-001-yukson-001
  items: [...]

redaction_policy:
  applied_rules:
    - rule_id: rule-001
      pattern_description: "API tokens in delivery log"
      reason: "Prevent credential exposure in shared evidence"
```

### Required Fields in the Result Packet

| Field | Always Required? | Notes |
|---|---|---|
| `schema_version` | yes | Must match the version used in the task envelope. |
| `task_id` | yes | Must match the envelope `task_id`. |
| `agent_id` | yes | Self-identifier. |
| `runtime` | yes | E.g., `openclaw`, `hermes`, `cli`, `human-baseline`. |
| `started_at` | yes | ISO 8601 timestamp. |
| `ended_at` | yes | ISO 8601 timestamp. Must be >= `started_at`. |
| `status` | yes | One of `completed`, `partial`, `blocked`, `failed`, `disqualified`. |
| `summary` | yes | Human-readable one-paragraph summary. |
| `evidence` | yes | At least one evidence item. |
| `findings` | yes | At least one finding. |
| `outputs` | yes | Must include all fields listed in `envelope.required_outputs`. |

### Required Fields in the Trace Record

| Field | Always Required? | Notes |
|---|---|---|
| `schema_version` | yes | |
| `trace_id` | yes | Unique trace identifier. |
| `run_id` | yes | Must match the run_id in the result packet. |
| `agent_id` | yes | |
| `entries` | yes | At least one entry per major action. |

### Required Fields in Evidence Items

| Field | Always Required? | Notes |
|---|---|---|
| `id` | yes | Stable reference for cross-linking from findings and trace entries. |
| `kind` | yes | One of the allowed evidence kinds. |
| `summary` | yes | Safe, human-readable description. Must not contain secret values. |

---

## 4. Artifact Contract

### What Must Be Preserved

Every adapter must preserve the following artifacts (when they exist):

1. **Input task envelope** — The original envelope received by the adapter.
2. **Result packet** — The structured output document.
3. **Trace record** — The action journal.
4. **Evidence bundle** — Artifacts with content refs.
5. **Command/action outputs** — Console output, file diffs, probe results,
   API responses, or transcript excerpts that support findings.
6. **Session metadata** — Session IDs, message IDs, channel delivery probes
   (for OpenClaw and Hermes).
7. **Git diff or change summary** — For any file mutation tasks (code sprint,
   ops relay with fix).
8. **Timestamps and durations** — For every significant action.

### Artifact Safety Rules

1. **No secrets in summaries.** Evidence summaries must not contain credential
   values, tokens, private keys, or session cookies.
2. **Redaction before preservation.** If command output contained secrets,
   the adapter must record that redaction occurred (`redacted: true`) and
   provide a value-free `redaction_reason` (see §8).
3. **Content integrity.** Evidence items may include a `checksum` field
   (algorithm + hex digest) for tamper detection.

---

## 5. Timeout Behavior

### Time Limit Source

The adapter reads the time limit from the task envelope:

```yaml
time_limit_minutes: 30
```

### Hard vs. Soft Timeout

| Type | Behavior | Status Mapping |
|---|---|---|
| **Hard timeout** | The adapter is forcibly terminated after `time_limit_minutes` ± a grace period (default 60 seconds). | `failed` (if ended by force) |
| **Soft timeout** | The adapter receives a warning at `time_limit_minutes - 5 minutes`. It may choose to wrap up and submit a partial result. | `partial` or `completed` depending on adapter choice |

### Grace Period

After the time limit expires, the adapter has a 60-second grace period to emit
its result packet and evidence bundle. If the adapter does not respond within
the grace period, the adapter is terminated and the runner records `failed`.

### Adapter-Level Timeout

The adapter may also impose its own internal timeout shorter than the envelope
limit. If it does, the adapter must report `blocked` or `partial` with a
reason.

### Time Limit Reporting

The result packet must record when execution actually started and ended so
judges can verify time compliance:

```yaml
started_at: "2026-05-29T00:00:00+09:00"
ended_at:   "2026-05-29T00:24:00+09:00"    # within 30-min limit
```

---

## 6. Status Mapping

Every adapter must map its internal execution states to the five standard
result packet statuses.

### Standard Statuses

| Status | Meaning | When to Use |
|---|---|---|
| `completed` | The adapter successfully met all required outputs. All evidence supports the claims. | Normal success. |
| `partial` | Some required outputs are present, but others are missing or incomplete. Or the adapter finished within the time limit but could not address all objectives. | Usable partial result. |
| `blocked` | The adapter stopped because of a condition outside its control: missing credentials, broken environment, unreachable service, ambiguous task definition. | External blocker. |
| `failed` | The adapter finished but did not meet the objective. All required outputs may be present, but the conclusion is wrong, or evidence is insufficient. | Wrong answer or insufficient work. |
| `disqualified` | The adapter violated a forbidden action, exposed secrets, fabricated evidence, or damaged the task environment. | Serious violation. |

### Adapter-Specific Mapping

#### OpenClaw Adapter

| Internal State | Packet Status |
|---|---|
| Session completed normally with all required outputs | `completed` |
| Session completed but missing some outputs | `partial` |
| Session timed out (agent did not finish) | `partial` (if partial content available) or `failed` |
| Session blocked on tool error, auth failure, or unreachable service | `blocked` |
| Session completed but produced wrong/corrupted output | `failed` |
| Adapter detected a forbidden action or secret exposure during post-processing | `disqualified` |

#### Hermes Adapter

| Internal State | Packet Status |
|---|---|
| Workflow completed with all required outputs | `completed` |
| Workflow completed with some outputs missing | `partial` |
| Workflow timed out | `partial` or `failed` |
| Workflow blocked on worker assignment, memory retrieval failure, or missing plugin | `blocked` |
| Workstep produced wrong or contradictory result | `failed` |
| Adapter detected credential leak in workflow artifacts | `disqualified` |

#### CLI Adapter

| Internal State | Packet Status |
|---|---|
| Script/program completed with output matching required fields | `completed` |
| Script completed but output is incomplete | `partial` |
| Script exited non-zero or crashed | `failed` |
| Prerequisite command failed (e.g., missing binary, network unreachable) | `blocked` |
| Script attempted a forbidden operation (detected by sandbox or runner) | `disqualified` |

#### Human Baseline Adapter

| Internal State | Packet Status |
|---|---|
| Operator completed all required outputs | `completed` |
| Operator provided partial answers | `partial` |
| Operator identified missing information or broken environment | `blocked` |
| Operator reached wrong conclusion with proper reasoning | `failed` |
| Operator intentionally violated task rules | `disqualified` |

---

## 7. Evidence Capture

### Minimum Evidence Requirements per Adapter

#### OpenClaw Adapter

| Evidence Kind | Required? | What to Capture |
|---|---|---|
| Session transcript excerpt | Recommended | Key dialogue turns, decisions, and findings. |
| Tool call summary | Recommended | Tool names, targets, argument summaries, results. |
| Message delivery evidence | If Telegram involved | Message ID, delivery status, channel probe. |
| Gateway readiness check | Recommended | Gateway status, version, routing config. |
| File diff | If files were changed | Git diff or change summary. |
| Command output | If CLI commands were used | Redacted command output. |

#### Hermes Adapter

| Evidence Kind | Required? | What to Capture |
|---|---|---|
| Workflow plan | Recommended | Task decomposition, worker routing. |
| Worker delegation trace | Recommended | Which workers were assigned, their state transitions. |
| Memory retrieval summary | Recommended | What memory was consulted and what was found (no secrets). |
| Tool trace summary | Recommended | Tool calls, arguments, results. |
| Final commander report | Recommended | Synthesized findings from workers. |
| File diff | If files were changed | Patch or change summary. |

#### CLI Adapter

| Evidence Kind | Required? | What to Capture |
|---|---|---|
| Command log (stdout/stderr) | Required | Full or summarized command output. |
| Exit codes | Required | Exit code of each command. |
| Git diff / file list | If files changed | Change summary or diff. |
| Test results | If tests were run | Pass/fail counts, test output. |
| Duration per step | Recommended | Timing for each command. |

#### Human Baseline Adapter

| Evidence Kind | Required? | What to Capture |
|---|---|---|
| Timestamp log | Required | When each action was taken. |
| Action descriptions | Required | What was checked, changed, or concluded. |
| Artifact references | Required | Links or paths to output files. |
| Screen recordings or screenshots | Optional | For visual verification. |

### Evidence Minimum Count

Every result packet must contain at least **one evidence item**. For tasks
involving file changes, at least **one evidence item** must reference the
change (diff, test output, or PR link).

---

## 8. CLI Invocation Example

The following example shows a complete adapter invocation using a CLI runner.
This example is concrete enough to serve as a test case for any adapter
implementation.

### Task: ops-001 Telegram final reply diagnosis

```bash
#!/usr/bin/env bash
# Adapter execution contract — CLI invocation example
# Runs the ops-001 task and produces a result packet, trace, and evidence bundle.

set -euo pipefail

TASK_ID="ops-001"
RUN_ID="run-ops-001-cli-example-$(date +%Y%m%d-%H%M%S)"
AGENT_ID="cli-example"
RUNTIME="cli"
WORKSPACE="/tmp/agent-olympics-work"
ENVELOPE="tasks/season-001/ops-001-telegram-final-reply.yaml"

mkdir -p "$WORKSPACE"
cd "$WORKSPACE"

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ---- Step 1: Read the envelope ----
echo "Reading envelope: $ENVELOPE"
cp "$ENVELOPE" "$WORKSPACE/envelope.yaml"

# ---- Step 2: Execute diagnosis commands ----
echo "=== Step 2: Inspect gateway logs ==="
gateway_log_entry=$(cat <<'LOG'
[2026-05-28 23:58:12] WARN  delivery: source-visible reply not sent for session abc-123
[2026-05-28 23:58:13] WARN  delivery: stale embedded-run recovery — reply mode mismatch
LOG
)
echo "$gateway_log_entry" > "$WORKSPACE/gateway-delivery-log.txt"

echo "=== Step 3: Check session transcript ==="
echo "Final assistant answer present in transcript at 2026-05-28T23:58:00+09:00" \
  > "$WORKSPACE/transcript-excerpt.txt"

# ---- Step 4: Build evidence bundle ----
ENDED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "$WORKSPACE/evidence-bundle.yaml" <<EVIDENCE
schema_version: 1
bundle_id: eb-${RUN_ID}
run_id: ${RUN_ID}
agent_id: ${AGENT_ID}
generated_at: "${ENDED_AT}"
items:
  - id: ev-001
    kind: log
    source: gateway journal
    summary: >
      Gateway delivery log showing source-visible reply not sent after stale
      embedded-run recovery. Token values redacted.
    content_ref: gateway-delivery-log.txt
    content_type: text/plain
    redacted: true
    redaction_rule: "api_token_values_in_delivery_log"

  - id: ev-002
    kind: transcript_excerpt
    source: session transcript
    summary: >
      Session transcript excerpt confirming the final assistant answer was
      written at 23:58 KST.
    content_ref: transcript-excerpt.txt
    content_type: text/plain
    redacted: false
EVIDENCE

# ---- Step 5: Build trace ----
cat > "$WORKSPACE/trace.yaml" <<TRACE
schema_version: 1
trace_id: tr-${RUN_ID}
run_id: ${RUN_ID}
agent_id: ${AGENT_ID}
generated_at: "${ENDED_AT}"
entries:
  - seq: 0
    timestamp: "${STARTED_AT}"
    action: read
    target: $ENVELOPE
    summary: "Read the task envelope."
    duration_ms: 200

  - seq: 1
    timestamp: "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    action: command
    target: local
    summary: "Inspected gateway delivery log. Redacted API token values."
    duration_ms: 3000
    redacted: true
    evidence_ref: ev-001
    result_summary: "Found delivery mismatch after stale embedded-run recovery."

  - seq: 2
    timestamp: "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    action: read
    target: session_transcript
    summary: "Checked session transcript for final assistant answer."
    duration_ms: 500
    evidence_ref: ev-002
    result_summary: "Final answer present in transcript at 23:58 KST."

  - seq: 3
    timestamp: "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    action: think
    summary: >
      Diagnosed root cause: source-visible reply was not sent due to stale
      embedded-run recovery, not a broken installation.
    duration_ms: 2000
TRACE

# ---- Step 6: Build result packet ----
cat > "$WORKSPACE/result-packet.yaml" <<PACKET
schema_version: 1
task_id: ${TASK_ID}
agent_id: ${AGENT_ID}
runtime: ${RUNTIME}
started_at: "${STARTED_AT}"
ended_at: "${ENDED_AT}"
status: completed
summary: >
  The final assistant answer was written to the session transcript but was
  not delivered as a source-visible Telegram message. Root cause is a stale
  embedded-run recovery, not a broken installation.
evidence:
  - id: ev-001
    kind: log
    source: gateway journal
    summary: "Delivery mismatch after stale embedded-run recovery. Redacted."
  - id: ev-002
    kind: transcript_excerpt
    source: session transcript
    summary: "Final assistant answer present in transcript."
findings:
  - claim: Gateway readiness was not the root cause.
    evidence: [ev-001, ev-002]
    confidence: high
  - claim: >
      The delivery failure matches a known source-reply release pattern
      after embedded-run recovery.
    evidence: [ev-001]
    confidence: medium
risks:
  - Clean reinstall could erase a local hotfix and introduce new variables.
  - Manual restart without rollback plan could cause transient downtime.
outputs:
  diagnosis: >
    The failure is consistent with a runtime source-reply release bug,
    not a broken deployment.
  recommendation: >
    Patch or update the runtime path and verify Telegram message delivery.
  risk_assessment: >
    Avoid clean reinstall unless deployment integrity is proven broken.
  next_action: >
    Apply the targeted fix, restart gateway if approved, and send a probe.
  durable_memory_decision: wiki_update_needed
PACKET

# ---- Step 7: Build run result (optional wrapper) ----
cat > "$WORKSPACE/run-result.yaml" <<RUNRESULT
schema_version: 1
run_id: ${RUN_ID}
task_id: ${TASK_ID}
agent_id: ${AGENT_ID}
runtime: ${RUNTIME}
generated_at: "${ENDED_AT}"
result_packet:
  packet_id: rp-${RUN_ID}
  \$(cat "$WORKSPACE/result-packet.yaml")
trace:
  \$(cat "$WORKSPACE/trace.yaml")
evidence_bundle:
  \$(cat "$WORKSPACE/evidence-bundle.yaml")
redaction_policy:
  applied_rules:
    - rule_id: rule-001
      pattern_description: "API tokens in gateway journal delivery log"
      reason: "Prevent credential exposure in shared evidence"
RUNRESULT

echo "=== Done ==="
echo "Run ID: ${RUN_ID}"
echo "Artifacts:"
ls -la "$WORKSPACE"/*.yaml "$WORKSPACE"/*.txt
```

### Validation

After producing the output, the adapter or runner should validate:

```bash
# Validate the result packet
node scripts/validate.js /tmp/agent-olympics-work/result-packet.yaml

# Validate the trace
node scripts/validate.js /tmp/agent-olympics-work/trace.yaml

# Validate the evidence bundle
node scripts/validate.js /tmp/agent-olympics-work/evidence-bundle.yaml

# Validate the run result
node scripts/validate.js /tmp/agent-olympics-work/run-result.yaml
```

---

## 9. Redaction and Approval Boundaries

### Redaction Rules

Every adapter must apply redaction to any output containing sensitive data.

#### What Must Be Redacted

| Data Class | Examples | Rule ID |
|---|---|---|
| API keys and tokens | OpenAI `sk-...`, GitHub PAT `ghp_...`, Slack `xoxb-...` | `api_token_value` |
| Private keys | RSA, EC, or Ed25519 private key material | `private_key_material` |
| Session cookies | `session=...`, `sid=...` | `session_cookie` |
| Credentials in config | passwords in config files, `.env` values | `credential_from_config` |
| Credentials in command output | token printed in CLI output or debug logs | `command_output_contained_token` |

#### Redaction Fields

Each action, evidence item, and trace entry supports:

| Field | Required? | Description |
|---|---|---|
| `redacted` | Yes if data was removed | Boolean. |
| `redaction_reason` (result packet items) | Yes if redacted | Value-free reason. Example: `"api_token_value"` not `"sk-abc123"`. |
| `redaction_rule` (evidence bundle items) | Yes if redacted | Value-free rule name. Example: `"api_token_values_in_delivery_log"`. |

#### Document-Level Redaction Policy

Adapters may include a top-level `redaction_policy` in the run result:

```yaml
redaction_policy:
  applied_rules:
    - rule_id: rule-001
      pattern_description: "API tokens in gateway journal delivery log entries"
      reason: "Prevent credential exposure in shared evidence"
  default_reason: "sensitive_value_redacted"
```

#### Critical Redaction Constraint

> A redaction reason that contains the actual secret value is **not redaction**
> — it is exposure. The redaction reason must describe *what rule was applied*,
> never the secret value itself.

| ✅ Correct | ❌ Wrong |
|---|---|
| `api_token_value` | `sk-proj-abc123def456` |
| `private_key_material` | `-----BEGIN RSA PRIVATE KEY-----MIIEpA...` |
| `session_cookie` | `session=abc123; path=/` |

### Approval Boundaries

#### Actions That Always Require Explicit Approval

| Action | Risk | Required Approver |
|---|---|---|
| Production gateway restart or reload | Service downtime | Operator or curator |
| Production database mutation or prune | Data loss | Operator or curator |
| Credential rotation or movement | Security boundary crossing | Operator or curator |
| Service stop without rollback plan | Prolonged outage | Operator or curator |
| Force-push or history rewrite | Team coordination | Repository maintainer |
| Release, tag, or npm publish | Public-facing change | Curator |
| Repo visibility change | Access control | Organization owner |
| Replay from Terminal Brief ACK | Acknowledge work that wasn't done | Operator |

#### Actions That Require Approval in Context

| Action | When Approval Is Needed |
|---|---|
| Destructive `rm -rf` or equivalent | Outside the workspace. |
| Editing running services | Unless explicitly allowed in the task envelope. |
| Sending public messages | Unless the task asks for it. |
| CI/CD pipeline trigger | If it would deploy to production. |

#### Actions That Never Require Approval (Default-Allowed)

| Action | Rationale |
|---|---|
| Read-only file inspection | No side effects. |
| Read-only config inspection | No side effects. |
| Running tests | Isolated in workspace. |
| Creating files in workspace | Task requires it. |
| Git diff / status | Read-only. |
| Writing evidence artifacts | Task requires it. |

### Approval Recording

When an adapter requests and receives approval, it must record:

```yaml
- id: act-004
  type: approval
  target: gateway_restart
  command_summary: "Requested approval to restart gateway for delivery test."
  duration_seconds: 120
  result: "Approved by operator at 2026-05-29T00:22:00+09:00"
```

When approval was required but was not obtained, the adapter must report
`blocked` or `disqualified` depending on whether it made the request.

---

## 10. Adapter-Specific Contract Addenda

### OpenClaw Adapter (roadmap-03)

In addition to the common contract, the OpenClaw adapter must:

1. **Capture session metadata.** Record session ID, message IDs, and channel
   delivery probe results.
2. **Preserve Telegram progress behavior.** When the task involves a
   user-facing channel, preserve the progress message pattern.
3. **Normalize tool call output.** Tool call arguments and results must be
   summarized for the trace record. Arguments containing credentials must be
   redacted.
4. **Use the Gateway readiness journal.** Prefer the Gateway journal for
   evidence of session state and delivery behavior.

### Hermes Adapter (roadmap-04)

In addition to the common contract, the Hermes adapter must:

1. **Capture workflow state transitions.** Record the task decomposition,
   worker assignments, state changes, and final orchestration outcome.
2. **Summarize memory retrieval.** Describe what memory was consulted and
   whether it was useful. Must not leak memory content.
3. **Merge child worker evidence.** If multiple workers produced evidence,
   the adapter must merge them into a single evidence bundle with unique IDs.
4. **Handle contradictory evidence.** If workers return conflicting results,
   the final result packet should reflect the conflict and its resolution.

---

## 11. Validation Commands

Adapters should verify their output against the schemas before submission.
The runner may also perform validation after receiving the output.

```bash
# Full validation suite (all v1 + v2 envelopes, packets, traces, bundles, judges)
npm run validate:all

# Validate smoke suite
node scripts/validate.js smoke

# Validate oracle answer keys (runner or judge only)
node scripts/validate.js oracle

# Validate a specific file (auto-detects type)
node scripts/validate.js results/my-run-result.yaml
```

### Exit Code Convention

| Exit Code | Meaning |
|---|---|
| 0 | All validated files passed. |
| 1 | One or more files failed schema or semantic checks. |

### Adapter-Self-Check

Every adapter should run at least the following self-check commands before
declaring the run complete:

```bash
# 1. Validate result packet
node scripts/validate.js results/latest/result-packet.yaml

# 2. Validate trace record
node scripts/validate.js results/latest/trace.yaml

# 3. Validate evidence bundle
node scripts/validate.js results/latest/evidence-bundle.yaml

# 4. (Optional) Validate wrapped run result
node scripts/validate.js results/latest/run-result.yaml

# 5. Verify no secret patterns leaked into evidence summaries
grep -nE '(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|-----BEGIN\s+(RSA|EC|Ed25519)\s+PRIVATE KEY-----)' \
  results/latest/evidence-bundle.yaml || echo "No secrets detected"
```

---

## 12. References

| Reference | Link |
|---|---|
| Task Envelope schema (v1) | `schemas/task-envelope.schema.json` |
| Task Envelope schema (v2) | `schemas/task-envelope-v2.schema.json` |
| Result Packet schema (v1) | `schemas/result-packet.schema.json` |
| Result Packet schema (v2) | `schemas/result-packet-v2.schema.json` |
| Trace Record schema | `schemas/trace-record.schema.json` |
| Evidence Bundle schema | `schemas/evidence-bundle.schema.json` |
| Run Result schema | `schemas/run-result.schema.json` |
| OpenClaw Adapter roadmap | `issues/roadmap-03-openclaw-adapter.md` |
| Hermes Adapter roadmap | `issues/roadmap-04-hermes-adapter.md` |
| Adapters overview | `docs/adapters.md` |
| Result Packet docs | `docs/result-packet.md` |
| Task Verification docs | `docs/task-verification.md` |
| Competition Model docs | `docs/competition-model.md` |
| Node Capability Matrix | `schemas/node-capability.schema.json` |
| Smoke suite manifest | `tasks/smoke/smoke-manifest.yaml` |
| Season 001 tasks | `tasks/season-001/` |
