# Node Readiness — Second Profile Promotion Checklist

> **Documentation for:** [Issue #160](https://github.com/jinwon-int/agent-olympics/issues/160)
> **Candidate fixture:** `fixtures/node-profiles/profile-candidate-macos-arm64.yaml`
> **Current tier:** `draft`
> **Target tier:** `smoke`
> **Blocking policy:** [Issue #161](https://github.com/jinwon-int/agent-olympics/issues/161) (Live Qualification Policy)

---

## What This Document Is

This checklist defines the **acceptance gates** that a candidate node profile
must pass before:

1. Its associated task envelopes (`node-001`, `node-001-v2`) can be promoted
   from `draft` to `smoke` tier.
2. Competition judges can rely on it for cross-class node-readiness scoring.

This document is a **source-controlled promotion policy artifact**. It does
not grant live approval itself — that requires a separate approval process
(see [Blocking Policy](#blocking-policy)).

---

## Candidate Profile

| Field | Value |
|---|---|
| **profile_id** | `candidate-macos-arm64-20260530` |
| **profile_class** | `macos-arm64` |
| **os_family** | `darwin` |
| **CPU** | arm64, 8–12 cores |
| **Memory** | 8–24 GB unified |
| **Runner limits** | 2 concurrent, 60 min tasks |
| **Distinct from existing** | All existing profiles are Linux/x86-64. This is the first darwin/arm64 profile. |

---

## Promotion Gates

### Gate 1: Schema Validation ✅ (can pass now)

The candidate profile YAML must pass `node scripts/validate.js profiles`
without errors.

**How to verify:**
```bash
node scripts/validate.js fixtures/node-profiles/profile-candidate-macos-arm64.yaml
```

**Current status:** Can be run and expected to pass — the profile was written
to comply with the schema.

---

### Gate 2: Forbidden-Field Scan ✅ (can pass now)

The validator runs `detectSecrets` and `scanForbiddenPatterns` on every
profile. The candidate must produce zero `FAIL` results for:

- IP addresses, hostnames, domains
- Absolute paths (`/home/...`, `/etc/...`, `/Users/...`)
- API key patterns (`sk-...`, `ghp_...`)
- Private key material (`-----BEGIN...`)
- Credential-like key names

**How to verify:** Same as Gate 1 — the validator reports these.
```bash
node scripts/validate.js profiles
```

**Current status:** Can be verified immediately with the same command.

---

### Gate 3: Cross-Class Result Packet Schema Conformance ✅ (can verify now)

The node readiness smoke pack produces result packets in the same schema
regardless of node class. The existing `fixtures/node-readiness-pack/openclaw/`
reference shows a Linux/x86-64 completion. A darwin/arm64 completion should
produce a structurally identical result packet but with different values in
`hardware_profile` and `configuration_profile`.

**What to check:**

| Field | OpenClaw (Linux) | macOS/arm64 (expected) | Same schema? |
|---|---|---|---|
| `hardware_profile.cpu_class` | `medium-vps` | `macos-arm64` | Yes — class label differs |
| `hardware_profile.memory_gb` | `8` | `16` (example) | Yes — value differs |
| `hardware_profile.storage_class` | `hybrid-ssd-hdd` | `nvme` | Yes — value differs |
| `hardware_profile.os_family` | `linux` | `darwin` | Yes — value differs |
| `configuration_profile.liveness` | `verified` | `verified` | Yes — same |
| `tool_use_profile.allowed` | `[read, write, exec, ...]` | `[read, write, exec, ...]` | Yes — same |
| `evidence` (array) | 6 items | 6 items | Yes — same structure |
| `risks` (array) | 3 items | varies by node | Yes — same structure |

**Where to reference:** The existing safe fixtures in
`fixtures/node-readiness-pack/evidence/` contain generic evidence content
(`node-capability-report.yaml`, `config-snapshot.yaml`) that is
**class-independent** and can be reused.

**Current status:** Schema compatibility is proven by inspection. A full
end-to-end demonstration requires Gate 4.

---

### Gate 4: Live Probe (requires operator approval) 🔴 BLOCKED

The candidate profile must be validated against a **real macOS node** via a
read-only live probe. This requires:

1. **Operator approval** under the Live Qualification Policy defined in
   [#161](https://github.com/jinwon-int/agent-olympics/issues/161).
2. **Read-only probe execution** on an approved macOS node.
3. **Redaction verification** — the captured probe output must be reviewed
   for any IP addresses, hostnames, absolute paths, UUIDs, serial numbers,
   or credentials before the profile YAML is updated.
4. **Smoke pack execution** — run the `node-readiness-pack` on the live
   node and produce a result packet, trace, and evidence bundle.

**How to verify:**
```bash
# Step 1 — operator approval (see Blocking Policy)
# Step 2 — on approved macOS node:
node scripts/validate.js profiles --live-mode
# Step 3 — run smoke pack:
pack_id=smoke-node-readiness-pack-v1  # via orchestration
# Step 4 — commit the updated profile:
git add fixtures/node-profiles/profile-candidate-macos-arm64.yaml
```

**Current status:** 🔴 **BLOCKED** — no operator-approved macOS node
available on this lane.

---

### Gate 5: Evidence Comparison (requires Gate 4) 🔴 BLOCKED

A formal evidence comparison document must demonstrate that the macOS/arm64
smoke pack results are structurally identical to the OpenClaw Linux reference.

**Comparison dimensions:**

1. **Schema conformance** — both result packets validate against the same
   `result-packet.schema.json`.
2. **Evidence completeness** — both contain the same evidence categories
   (probe output, service check, config snapshot, network probe, capability
   report).
3. **Risk detection** — both flag distinct hardware-relevant risks
   (e.g., macOS might flag "no swap configured" under unified memory,
   Linux flags "Docker disabled").
4. **Redaction consistency** — both apply redaction to probe output
   commands that may contain local paths.

**Current status:** 🔴 **BLOCKED** on Gate 4.

---

### Gate 6: Envelope Tier Promotion (requires Gates 4+5) 🔴 BLOCKED

After Gates 4 and 5 pass, update:

- `tasks/season-001/node-001-agent-readiness-audit.yaml`: set `tier: smoke`
- `tasks/season-001/node-001-agent-readiness-audit-v2.yaml`: set `tier: smoke`

This signals that the envelopes have been verified against two distinct node
classes and judges can rely on cross-class evidence.

**Current status:** 🔴 **BLOCKED** on Gates 4 and 5.

---

## Blocking Policy

### Primary Blocker: No Live Qualification Policy (#161)

The competition does not yet have a documented, operator-approved **Live
Qualification Policy** for read-only node inventory. Until
[#161](https://github.com/jinwon-int/agent-olympics/issues/161) is resolved,
no live macOS (or any second-class) node can be probed and validated.

**Close condition for #161:**
> A documented, operator-approved live qualification policy exists in
> docs/node-profile-inventory.md (or docs/live-node-qualification-policy.md).
> The profile validator can run a live-probe redaction check.
> At least one additional live profile is committed following the policy.

### Secondary Blocker: No macOS Node

Even if #161 were resolved, a **qualifying macOS node** must be made
available for read-only probing. This requires:

- A macOS/arm64 host (physical or VM) with OpenClaw or compatible runtime
  installed.
- Operator approval per the yet-to-be-documented live qualification policy.
- No credential exposure, no config mutation, no production service
  restart on the target node.

### Tertiary Blocker: Hermes/CLI Adapter Parity

The existing node readiness pack has sample outputs for OpenClaw, Hermes,
and CLI adapters (see `fixtures/node-readiness-pack/`). A production
promotion should include adapter samples for the macOS class as well.
This is a lower-priority concern that can be deferred until Gates 4+5
are unblocked.

---

## Summary Status

| Gate | Description | Status | Blocker |
|---|---|---|---|
| 1 | Schema validation | ✅ Can verify now | None |
| 2 | Forbidden-field scan | ✅ Can verify now | None |
| 3 | Cross-class schema conformance | ✅ Can verify now (static analysis) | None |
| 4 | Live probe on macOS node | 🔴 Blocked | No live policy (#161) + no macOS node |
| 5 | Evidence comparison | 🔴 Blocked | Gate 4 |
| 6 | Envelope tier promotion | 🔴 Blocked | Gates 4+5 |

**Verdict: Tier promotion cannot happen yet.** The source fixture path
(`profile-candidate-macos-arm64.yaml`) is committed and passes static
validation, but the remaining gates require a live qualification policy
([#161](https://github.com/jinwon-int/agent-olympics/issues/161)) and
an approved live macOS probe before `node-001` envelopes can be promoted
from `draft` to `smoke`.

---

## Pre-work Completed on This Lane

- [x] Candidate profile fixture written with safe band-based values
- [x] Promotion gates documented
- [x] Blocker conditions captured with close condition references
- [x] Cross-class schema comparison documented against OpenClaw reference
- [x] Validated that the candidate profile passes `node scripts/validate.js profiles`
- [x] Confirmed no OpenClaw runtime/bootstrap files leaked into the branch

---

*Agent Olympics v1 — Second Profile Promotion Checklist for Issue #160*
*See also: [Issue #161 (Live Qualification Policy)](../../issues/followup-node-readiness-live-qualification.md)*
*See also: [Node Profile Inventory](node-profile-inventory.md)*
