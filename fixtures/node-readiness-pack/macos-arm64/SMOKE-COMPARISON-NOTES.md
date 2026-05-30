# Smoke Comparison: macOS/arm64 vs OpenClaw Linux — Node Readiness Pack

> **Target:** Compare expected result packet output from a macOS/arm64 node
> (using `fixtures/node-profiles/profile-candidate-macos-arm64.yaml`) against
> the existing OpenClaw Linux reference (`fixtures/node-readiness-pack/openclaw/`).
>
> **Method:** Static fixture-based comparison. No live macOS node was probed.
> The macOS output below is a **candidate projection** based on the candidate
> profile and the shared schema. It demonstrates that the schema supports
> heterogeneous node classes without structural changes.
>
> **This is not live evidence.** Promotion to `smoke` tier requires a live
> probe result under the policy defined in
> [docs/node-readiness-second-profile-promotion-checklist.md](../../../docs/node-readiness-second-profile-promotion-checklist.md).

---

## 1. Schema Conformance

Both the OpenClaw Linux reference and the projected macOS/arm64 output validate
against the same schemas:

| Schema | OpenClaw (Linux) | macOS/arm64 (projected) |
|--------|------------------|------------------------|
| `schemas/result-packet.schema.json` | ✅ Valid | ✅ Valid (same schema) |
| `schemas/evidence-bundle.schema.json` | ✅ Valid | ✅ Valid (same schema) |
| `schemas/node-profile-inventory.schema.json` | ✅ Valid (via `profile-live-openclaw-medium-20260530.yaml`) | ✅ Valid (via `profile-candidate-macos-arm64.yaml`) |

**Finding:** No schema changes are needed to support the macOS/arm64 class.
The existing schema uses safe band-based fields (cpu_class, memory_gb,
os_family, storage_class) that are architecture-agnostic.

---

## 2. Hardware Profile Comparison

| Field | OpenClaw (Linux) | macOS/arm64 (projected) | Delta |
|---|---|---|---|
| `hardware_profile.cpu_class` | `medium-vps` | `macos-arm64` | Expected — class label reflects node type |
| `hardware_profile.memory_gb` | `8` | `16` | Different capacity band |
| `hardware_profile.storage_class` | `hybrid-ssd-hdd` | `nvme` | Different storage medium |
| `hardware_profile.os_family` | `linux` | `darwin` | Different OS family |

All fields retain the same structure. Differences are in scalar values and
class labels — both are legitimate variations for the same schema.

---

## 3. Projected macOS/arm64 Result Packet

```yaml
# Candidate projection: macOS/arm64 node readiness smoke — completed
# STRUCTURALLY IDENTICAL to the OpenClaw Linux reference, but with
# hardware-profile values matching the candidate macos-arm64 profile.
# This projection has NOT been validated against a live node.
schema_version: 1
packet_id: pkt-macos-arm64-node-readiness-smoke-20260530
run_id: run-node-readiness-smoke-macos-arm64-20260530T120000KST
task_id: node-001
agent_id: smoke-agent
runtime: openclaw
runtime_version: 2026.5.27
model: gpt-4o
model_provider: openai
node: smoke-node
hardware_profile:
  cpu_class: macos-arm64
  memory_gb: 16
  storage_class: nvme
  os_family: darwin
configuration_profile:
  model_routing: default
  liveness: verified
  resource_limits: standard
  adapter_mode: agent
tool_use_profile:
  allowed:
    - read
    - write
    - exec
    - web_search
    - web_fetch
    - sessions_spawn
    - message
  used:
    - read
    - write
    - exec
    - web_search
    - web_fetch
operating_policy:
  approval_boundaries: documented
  secret_handling: redacted
  progress_reporting: required_for_long_tasks
  timeout_handling: timeout_after_600s_status_partial
started_at: "2026-05-30T12:00:00+09:00"
ended_at: "2026-05-30T12:12:00+09:00"
status: completed
publishable: true
summary: "macOS/arm64 adapter completed node readiness smoke pack. Node probe executed, capability matrix generated, 2 risks identified (no swap configured under unified memory, Docker Desktop not installed). Smoke tasks verified as passing preconditions."

actions:
  - id: act-001
    type: read
    target: task_envelope
    command_summary: Parse node-001 task envelope
    redacted: false
    evidence_id: ev-envelope
  - id: act-002
    type: exec
    target: node_probe
    command_summary: Run node capability probe via macOS-safe commands
    redacted: true
    redaction_reason: command_output_may_contain_paths
    evidence_id: ev-probe-output
  - id: act-003
    type: exec
    target: service_check
    command_summary: Check launchd service status for configured services
    redacted: false
    evidence_id: ev-service-status
  - id: act-004
    type: read
    target: config_file
    command_summary: Read safe config fields from gateway.yaml
    redacted: false
    evidence_id: ev-config-snapshot
  - id: act-005
    type: web_fetch
    target: network_probe
    command_summary: Verify outbound HTTPS connectivity and latency
    redacted: false
    evidence_id: ev-network-probe
  - id: act-006
    type: write
    target: output
    command_summary: Write node capability report and readiness findings
    redacted: false
    evidence_id: ev-node-capability-report

evidence:
  - id: ev-envelope
    kind: config_snippet
    source: task envelope
    summary: Input task envelope for node-001 readiness audit
    redacted: false
    content_ref: ../../../evidence/node-capability-report.yaml
  - id: ev-probe-output
    kind: command_output
    source: node capability probe (macOS)
    summary: Collected hardware, OS, and runtime info via macOS-safe commands (sw_vers, sysctl, system_profiler)
    redacted: true
    redaction_reason: command_output_may_contain_paths
    content_ref: ../../../evidence/node-capability-report.yaml
  - id: ev-service-status
    kind: command_output
    source: launchctl list
    summary: Service status for homebrew.mxcl.docker (stopped), ssh (running)
    redacted: false
  - id: ev-config-snapshot
    kind: config_snippet
    source: gateway.yaml
    summary: Non-secret configuration fields (runtime version, tool list, model routing)
    redacted: false
    content_ref: ../../../evidence/config-snapshot.yaml
  - id: ev-network-probe
    kind: probe_result
    source: curl to regional endpoint
    summary: Outbound HTTPS confirmed, DNS 10 ms, HTTP 18 ms
    redacted: false
  - id: ev-node-capability-report
    kind: report
    source: node capability probe
    summary: Node capability matrix and readiness verdict with 2 identified risks
    redacted: false
    content_ref: ../../../evidence/node-capability-report.yaml

findings:
  - claim: Node probe completed successfully. Hardware profile matches expected macos-arm64 class.
    evidence:
      - ev-probe-output
      - ev-envelope
    confidence: high
  - claim: Two configuration risks identified — Docker Desktop not installed and swap/page-ins not configured.
    evidence:
      - ev-probe-output
      - ev-node-capability-report
    confidence: high
  - claim: All smoke preconditions (gateway, model, tools, file-io, network) verified.
    evidence:
      - ev-config-snapshot
      - ev-network-probe
      - ev-service-status
    confidence: high

risks:
  - Docker Desktop or equivalent container runtime not installed; some task families may require it
  - Swap/page-ins disabled under unified memory architecture; macOS memory pressure may cause SIGTERM under high load
  - launchd service configuration may require user session for some agent capabilities

outputs:
  node_capability_report: "Node capability matrix generated and validated against schema."
  readiness_verdict: "NOT READY — requires container runtime installation before season tasks."
```

---

## 4. Evidence Bundle Comparison

Both adapters share the same evidence structure:

| # | Category | OpenClaw Linux | macOS/arm64 (projected) | Same? |
|---|----------|----------------|------------------------|-------|
| 1 | Envelope parse | ✅ config_snippet | ✅ config_snippet | Yes |
| 2 | Node probe | ✅ command_output (redacted) | ✅ command_output (redacted) | Yes |
| 3 | Service status | ✅ systemctl (sshd running, docker stopped) | ✅ launchctl (ssh running, docker stopped) | Structurally same, tool differs |
| 4 | Config snapshot | ✅ config_snippet | ✅ config_snippet | Yes |
| 5 | Network probe | ✅ probe_result (22 ms HTTP) | ✅ probe_result (18 ms HTTP) | Structurally same, values differ |
| 6 | Capability report | ✅ report | ✅ report | Yes |

**Finding:** The evidence bundle format is fully class-agnostic. The only
difference is that macOS uses `launchctl` instead of `systemctl` for service
inspection — both produce the same evidence structure.

---

## 5. Cross-Class Validation Command

```bash
# Validate all profiles (including the new candidate)
node scripts/validate.js profiles

# Validate the smoke pack result packets
node scripts/validate.js packets

# Validate evidence bundles
node scripts/validate.js bundles

# Validate all documents together
node scripts/validate.js all
```

No additional schema or validator changes are required to support the
macOS/arm64 class.

---

## 6. Conclusion

The existing node readiness schema and smoke pack **fully support** a
second node class (macOS/arm64) without structural changes. The
`profile-candidate-macos-arm64.yaml` fixture passes schema validation,
and the projected result packet demonstrates end-to-end schema
compatibility.

**What remains for production promotion:**

1. Operator approval of a live qualification policy (#161).
2. Read-only probe of an actual macOS/arm64 node.
3. Execution of the smoke pack on that node.
4. Formal update of the candidate profile to `live-validated` status.

Until then, this comparison serves as **source-controlled evidence** that
the schema is ready for heterogeneous node classes — only the live
validation step is missing.

---

*Agent Olympics v1 — Smoke Comparison Notes for Issue #160*
*See: [Promotion Checklist](../../../docs/node-readiness-second-profile-promotion-checklist.md)*
