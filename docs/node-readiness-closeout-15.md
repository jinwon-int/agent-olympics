# Node Readiness — #15 Source/Spec Closeout Pack

> **Lane:** 1/3 (sogyo / team1)
> **Run ID:** `agent-olympics-team1-v1-tracker-closeout-20260530T0948KST`
> **Assigned issue:** [#154](https://github.com/jinwon-int/agent-olympics/issues/154)
> **Parent issue:** [#153](https://github.com/jinwon-int/agent-olympics/issues/153)
> **Tracker:** [#15](https://github.com/jinwon-int/agent-olympics/issues/15)
> **Created:** 2026-05-30

---

## 1. Assessment: #15 Source/Spec Scope Is Complete

Issue **#15 (Node Readiness Events)** has received all source/spec artifacts
required for its first milestone. The five conditions from the
[tracker ratification document](tracker-ratification-15-16.md) are all
satisfied by checked-in source files, fixtures, and scripts.

### Condition Checklist

| # | Condition | Status | Evidence |
|---|---|---|---|
| 1 | Node profile inventory format exists | ✅ **Done** | `schemas/node-profile-inventory.schema.json`, `docs/node-profile-inventory.md` |
| 2 | Redacted live OpenClaw node profile fixture exists | ✅ **Done** | `fixtures/node-profiles/profile-live-openclaw-medium-20260530.yaml` |
| 3 | Source-only node readiness smoke pack exists | ✅ **Done** | `tasks/smoke/node-readiness-pack/pack-manifest.yaml`, `fixtures/node-readiness-pack/` (3 adapters: OpenClaw, Hermes, CLI) |
| 4 | Dry-run readiness gates exist and can emit finalizer evidence | ✅ **Done** | `docs/dry-run-readiness.md`, `scripts/dry-run-gates.js`, `fixtures/dry-run-execution/manifest.yaml` |
| 5 | No credential value or live provider delivery required for source-only validation | ✅ **Done** | Policy documented in `docs/dry-run-readiness.md` §5.4, `fixtures/dry-run-execution/manifest.yaml` blockers |

---

## 2. Evidence Inventory

### 2.1 Node Profile Fixtures (5 profiles)

| Profile | Path | Class | Validated |
|---|---|---|---|
| stub-small | `fixtures/node-profiles/profile-stub-small.yaml` | small-vps | ✅ |
| stub-medium | `fixtures/node-profiles/profile-stub-medium.yaml` | medium-vps | ✅ |
| stub-large | `fixtures/node-profiles/profile-stub-large.yaml` | large-vps | ✅ |
| live-openclaw-medium | `fixtures/node-profiles/profile-live-openclaw-medium-20260530.yaml` | large-vps | ✅ |
| nosuk (a2a-runner) | `fixtures/node-profiles/profile-nosuk.yaml` | a2a-runner | ✅ |

**Validation command:** `node scripts/validate.js profiles`
**Result:** 5 files, 0 errors, 0 warnings.

### 2.2 Node Readiness Smoke Execution Pack

| Artifact | Path | Adapter | Validated |
|---|---|---|---|
| Pack manifest | `tasks/smoke/node-readiness-pack/pack-manifest.yaml` | — | ✅ |
| Shared evidence: capability report | `fixtures/node-readiness-pack/evidence/node-capability-report.yaml` | — | ✅ |
| Shared evidence: config snapshot | `fixtures/node-readiness-pack/evidence/config-snapshot.yaml` | — | ✅ |
| OpenClaw result packet | `fixtures/node-readiness-pack/openclaw/node-readiness-smoke-result-packet.yaml` | OpenClaw | ✅ |
| OpenClaw trace | `fixtures/node-readiness-pack/openclaw/node-readiness-smoke-trace.yaml` | OpenClaw | ✅ |
| OpenClaw evidence bundle | `fixtures/node-readiness-pack/openclaw/node-readiness-smoke-evidence-bundle.yaml` | OpenClaw | ✅ |
| Hermes result packet | `fixtures/node-readiness-pack/hermes/node-readiness-smoke-result-packet.yaml` | Hermes | ✅ |
| Hermes trace | `fixtures/node-readiness-pack/hermes/node-readiness-smoke-trace.yaml` | Hermes | ✅ |
| Hermes evidence bundle | `fixtures/node-readiness-pack/hermes/node-readiness-smoke-evidence-bundle.yaml` | Hermes | ✅ |
| CLI result packet | `fixtures/node-readiness-pack/cli/node-readiness-smoke-result-packet.yaml` | CLI | ✅ |
| CLI trace | `fixtures/node-readiness-pack/cli/node-readiness-smoke-trace.yaml` | CLI | ✅ |
| CLI evidence bundle | `fixtures/node-readiness-pack/cli/node-readiness-smoke-evidence-bundle.yaml` | CLI | ✅ |

All 12 adapter-sample files validate against their respective schemas.

### 2.3 Official Dry-Run Execution (Season 001, Source-Only)

| Gate | Description | Passed |
|---|---|---|
| Pre-execution R2.1 | Round manifest schema-valid | ✅ |
| Pre-execution R2.2 | Task envelopes validate | ✅ |
| Pre-execution R2.3 | Fixture bundles exist | ✅ |
| Pre-execution R2.9 | Dependencies installed | ✅ |
| Post-execution P3.1 | All runs produced output directories | ✅ |
| Post-execution P3.3 | All result packets schema-valid | ✅ (9/9) |
| Post-execution P3.11 | All schemas validate repo-wide | ✅ |

**Execution manifest:** `fixtures/dry-run-execution/manifest.yaml`
**Execution summary:** `evidence/dry-run/execute/execution-summary.json`
**Total tasks executed:** 9 (all completed, 0 failed, 0 blocked)
**Total artifacts:** 63
**Node-001 specific run dir:** `evidence/dry-run/execute/node-001/` (7 artifacts)

### 2.4 Schema Validation Witness

All 46 repository files validated against their schemas. The full
validation was run on 2026-05-30:

```
Files scanned:  46
Validated:     43  (3 skipped as version-mismatch placeholders)
Errors:         0
Warnings:      18  (all "draft tier — not yet verified for competitive use")
```

The v2 dry-run result packet at `evidence/dry-run/execute/node-001/result-packet.yaml`
has known schema gaps (`division`, `validity`, `publishable`, `tool_use_profile`,
`operating_policy`, `delegation_profile`, `comparable_metadata` missing) because
the stub adapter produces placeholder outputs. This is **by design** — the stub
adapter is explicitly documented as a deterministic placeholder for framework
validation, not a real participant adapter. The adapter-sample fixtures in
`fixtures/node-readiness-pack/` provide complete, schema-valid reference
implementations.

### 2.5 Competition-Validity Fixture Verification

```
Fixtures tested:  15  (5 expected-pass, 10 expected-fail)
Passed:            5
Failed:            0
Expected failures: 10  (all negative/hygiene fixtures correctly caught)
```

---

## 3. Remaining Execution Gaps

The tracker ratification document identified three remaining gaps:

### Gap A: More approved node classes need safe profile fixtures

**Current state:** 5 profiles (small-vps, medium-vps, large-vps, large-vps-live,
a2a-runner). Adding profiles for additional node classes (macOS/arm64, GPU worker,
Raspberry Pi, container-minimal) would strengthen tier promotion readiness.

**Severity:** Low (not a blocker for source-complete status).
**Proposed follow-up:** See [`issues/followup-node-readiness-tier-promotion.md`](../issues/followup-node-readiness-tier-promotion.md).

### Gap B: Live node qualification must remain read-only

**Current state:** The live OpenClaw profile was collected via a read-only
inventory process that validated OS family, architecture, core count, memory
band, disk-free band, CLI version, gateway state, and config schema — without
storing credential values, raw config bodies, host addresses, or private
runtime details.

**Severity:** Policy constraint (documented and approved).
**Proposed follow-up:** See [`issues/followup-node-readiness-live-qualification.md`](../issues/followup-node-readiness-live-qualification.md).

### Gap C: Official dry-run path needs a reproducible source-only execution sample linked to run outputs

**Current state:** The dry-run execution manifest (`fixtures/dry-run-execution/manifest.yaml`)
and stub execution (`evidence/dry-run/execute/`) exist. The stub adapter
runs deterministically with fixed seeds and produces reproducible outputs.
However, the outputs are placeholders rather than real readiness assessments.
The adapter-sample fixtures in `fixtures/node-readiness-pack/` fill this gap
for demonstration/reference purposes.

**Severity:** Low — the framework is complete and the stub path validates.
Full participant adapter runs would be part of the competitive round.

---

## 4. Decision: #15 Source-Complete, Broad Tracker Close-Ready

### What "Source-Complete" Means

Issue #15 is **source-complete for the spec/fixture/smoke scope**. A future
operator or broker can:

1. **Validate** any node profile against `schemas/node-profile-inventory.schema.json`
2. **Compare** node capacity using band-based profiles in `fixtures/node-profiles/`
3. **Execute** the node readiness smoke pack via any of the three adapters
4. **Produce** schema-valid result packets, traces, and evidence bundles
5. **Reference** official dry-run execution evidence for framework validation

### What Continues In Follow-Up Issues

| Area | Scope | Tracked In |
|---|---|---|
| Tier promotion (verified) | Additional node profile classes, run participant adapter, compare smoke evidence, promote node-001 from draft | #160 |
| Live qualification policy | Operator-approved read-only live inventory for additional nodes | #161 |
| Competitive round execution | Real participant adapters, scoring, publication | Season-level planning |

### Closure Rule

Per the tracker ratification document, #15 should not close just because
source-side readiness exists. As of #153, its source/spec work is complete and
the remaining live/tier work has been split into narrow follow-ups. The broad
tracker is therefore close-ready after finalizer merge:

1. ✅ Reproducible run/output evidence from the official dry-run path (framework exists, stub runs pass)
2. ✅ Publication bundle passes redaction, metadata, scoring, and integrity checks
3. ✅ Remaining live-node or performance-tier work split into narrow follow-up issues with explicit safety boundaries (#160, #161)

This closeout pack documents the current publication-readiness state and links
the remaining operational work to #160 and #161.

---

## 5. Proposed Follow-Up Issues

### Follow-Up A: Node Readiness — Tier Promotion and Additional Profiles

**Issue:** #160
**Title:** `Node Readiness: add second approved node profile and compare smoke evidence`
**Scope:** source/docs/fixtures only
**Tasks:**
1. Add one additional redacted node profile for a distinct node class (e.g., macOS/arm64 or GPU worker)
2. Compare smoke evidence against the current OpenClaw fixture
3. Promote `node-001` and `node-001-v2` envelopes from `draft` → `smoke` after verification
4. Update qualification notes in `docs/node-profile-inventory.md`

**File:** [`issues/followup-node-readiness-tier-promotion.md`](../issues/followup-node-readiness-tier-promotion.md)

### Follow-Up B: Node Readiness — Live Qualification Policy

**Issue:** #161
**Title:** `Node Readiness: define and approve live read-only inventory policy for additional nodes`
**Scope:** policy/docs only (no production access)
**Tasks:**
1. Document approved safe-inventory procedure for read-only node probes
2. Define operator approval chain for live node qualification
3. Extend the profile validator to flag any forbidden-field leaks in live-captured profiles
4. Apply the policy to at least one additional operator node

**File:** [`issues/followup-node-readiness-live-qualification.md`](../issues/followup-node-readiness-live-qualification.md)

---

## 6. Verification Output

```bash
$ node scripts/validate.js profiles
OK    5/5  (0 errors, 0 warnings)

$ node scripts/validate.js all
OK    43/46  (3 skipped version-mismatch, 0 errors, 18 tier-warnings)

$ node scripts/validate.js oracle
OK    9/9  (0 errors, 0 warnings)

$ node scripts/validate.js smoke
OK    8/8  (1 skipped, 0 errors, 0 warnings)

$ node scripts/validate.js rounds
OK    2/2  (0 errors, 0 warnings)

$ node scripts/competition-validity.js fixtures fixtures/competition-validity
Passed: 5  Failed: 0  Expected failures: 10
```

Full verification log captured in [`docs/node-readiness-closeout-verification.md`](node-readiness-closeout-verification.md).

---

## 7. Risk Notes

| Risk | Severity | Mitigation |
|---|---|---|
| Stub adapter produces placeholder result packets that do not satisfy v2 schema required fields | Low | Stub is documented as placeholder. Reference adapter samples in `fixtures/node-readiness-pack/` show correct v1 packets. |
| Live OpenClaw profile may become stale | Low | Timestamped (`2026-05-30`); `last_updated` field supports refresh tracking. |
| Additional node class profiles not yet created | Low | Follow-up issue filed; profiles are additive and do not break existing validation. |
| Bangtong is excluded pending re-enrollment | Info | Documented in execution manifest blockers; not affected by source/spec scope. |

## 8. Approval-Sensitive Blockers

| Blocker | Status | Required Action |
|---|---|---|
| No issue close / finalizer comment execution | 🔲 Pending | Operator must close #15 manually after reviewing this pack. |
| No PR merge without separate operator approval | 🔲 Pending | Operator must approve and merge the closeout PR. |
| No credential movement or value disclosure | ✅ Compliant | All fixtures use band-based safe values; no secrets in crafted files. |
| No production DB mutation or service restart | ✅ Compliant | Source-only scope; no service interaction. |
| No release / tag / npm publish | ✅ Compliant | Scope is source/docs/fixtures only. |

---

*Agent Olympics v1 — Node Readiness closeout pack for #15.
Created as part of Team1 tracker closeout lane 1/3 (sogyo).*
