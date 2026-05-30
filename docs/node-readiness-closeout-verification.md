# Node Readiness #15 Closeout — Verification Output

> **Generated:** 2026-05-30
> **Runner:** OpenClaw A2A Docker Runner
> **Command context:** `cd /work/repo`

---

## 1. Node Profile Validation

```bash
$ node scripts/validate.js profiles
Validating 5 node profile file(s)...

OK    fixtures/node-profiles/profile-live-openclaw-medium-20260530.yaml  (node-profile)
OK    fixtures/node-profiles/profile-nosuk.yaml  (node-profile)
OK    fixtures/node-profiles/profile-stub-large.yaml  (node-profile)
OK    fixtures/node-profiles/profile-stub-medium.yaml  (node-profile)
OK    fixtures/node-profiles/profile-stub-small.yaml  (node-profile)

--- Summary ---
Files:     5
Errors:    0
Warnings:  0
```

## 2. Full Schema Validation

```bash
$ node scripts/validate.js all
Validating 46 file(s)...

OK    tasks/examples/code-001-typescript-regression.yaml  (task-envelope v1)
OK    tasks/examples/coord-001-commander-report.yaml  (task-envelope v1)
OK    tasks/examples/knowledge-001-wiki-closeout.yaml  (task-envelope v1)
OK    tasks/examples/node-001-agent-readiness-audit.yaml  (task-envelope v1)
OK    tasks/examples/ops-001-telegram-final-reply.yaml  (task-envelope v1)
OK    tasks/examples/ops-002-clean-reinstall-drift.yaml  (task-envelope v1)
OK    tasks/examples/perf-001-node-throughput-baseline.yaml  (task-envelope v1)
OK    tasks/season-001/code-001-typescript-regression-v2.yaml  (task-envelope v2) - with tier warnings
OK    tasks/season-001/code-001-typescript-regression.yaml  (task-envelope v1) - with tier warnings
OK    tasks/season-001/coord-001-commander-report-v2.yaml  (task-envelope v2) - with tier warnings
OK    tasks/season-001/coord-001-commander-report.yaml  (task-envelope v1) - with tier warnings
OK    tasks/season-001/knowledge-001-wiki-closeout-v2.yaml  (task-envelope v2) - with tier warnings
OK    tasks/season-001/knowledge-001-wiki-closeout.yaml  (task-envelope v1) - with tier warnings
OK    tasks/season-001/node-001-agent-readiness-audit-v2.yaml  (task-envelope v2) - with tier warnings
OK    tasks/season-001/node-001-agent-readiness-audit.yaml  (task-envelope v1) - with tier warnings
OK    tasks/season-001/ops-001-telegram-final-reply-v2.yaml  (task-envelope v2) - with tier warnings
OK    tasks/season-001/ops-001-telegram-final-reply.yaml  (task-envelope v1) - with tier warnings
OK    tasks/season-001/ops-002-clean-reinstall-drift-v2.yaml  (task-envelope v2) - with tier warnings
OK    tasks/season-001/ops-002-clean-reinstall-drift.yaml  (task-envelope v1) - with tier warnings
OK    tasks/season-001/ops-003-approval-gate-v2.yaml  (task-envelope v2) - with tier warnings
OK    tasks/season-001/ops-003-approval-gate.yaml  (task-envelope v1) - with tier warnings
OK    tasks/season-001/perf-001-node-throughput-baseline-v2.yaml  (task-envelope v2) - with tier warnings
OK    tasks/season-001/perf-001-node-throughput-baseline.yaml  (task-envelope v1) - with tier warnings
OK    tasks/season-001/tool-001-precision-triage-v2.yaml  (task-envelope v2) - with tier warnings
OK    tasks/season-001/tool-001-precision-triage.yaml  (task-envelope v1) - with tier warnings
OK    tasks/smoke/smoke-001-gateway-liveness.yaml  (task-envelope v1)
OK    tasks/smoke/smoke-002-model-roundtrip.yaml  (task-envelope v1)
OK    tasks/smoke/smoke-003-tool-readiness.yaml  (task-envelope v1)
OK    tasks/smoke/smoke-004-file-sanity.yaml  (task-envelope v1)
OK    tasks/smoke/smoke-005-config-inspection.yaml  (task-envelope v1)
OK    tasks/smoke/smoke-006-network-diagnostic.yaml  (task-envelope v1)
OK    tasks/smoke/smoke-007-node-capability.yaml  (task-envelope v1)
OK    tasks/stub-test/stub-hello-envelope.yaml  (task-envelope v1)
OK    results/ops-001-yukson-evidence-bundle.yaml  (evidence-bundle v1)
OK    results/ops-001-yukson-judge.yaml  (judge-record v1)
OK    results/ops-001-yukson-trace.yaml  (trace-record v1)
OK    results/ops-001-yukson.yaml  (result-packet v1)
OK    results/perf-001-baseline-nosuk.yaml  (result-packet v2)
OK    results/perf-001-baseline-small.yaml  (result-packet v1)
OK    results/perf-001-baseline-sogyo.yaml  (result-packet v1)
OK    results/perf-001-baseline.yaml  (result-packet v1)
OK    results/perf-001-live-cli-probe-20260530.yaml  (result-packet v2)
OK    results/perf-001-live-openclaw-codex-20260530.yaml  (result-packet v2)

--- Summary ---
Files scanned:  46
Validated:     43
Skipped (ver): 3
Errors:        0
Warnings:      18
```

All 18 warnings are tier-related (`"draft" — not yet verified for competitive use`).
No structural, schema, or semantic errors.

## 3. Adapter-Sample Validation

```bash
$ node scripts/validate.js fixtures/node-readiness-pack/openclaw/node-readiness-smoke-result-packet.yaml
OK    (result-packet v1)

$ node scripts/validate.js fixtures/node-readiness-pack/openclaw/node-readiness-smoke-trace.yaml
OK    (trace-record v1)

$ node scripts/validate.js fixtures/node-readiness-pack/openclaw/node-readiness-smoke-evidence-bundle.yaml
OK    (evidence-bundle v1)
```

All 12 adapter-sample files (OpenClaw × 3, Hermes × 3, CLI × 3, shared × 3)
pass validation.

## 4. Dry-Run Trace and Evidence Bundle Validation

```bash
$ node scripts/validate.js evidence/dry-run/execute/node-001/trace.yaml
OK    (trace-record v1)

$ node scripts/validate.js evidence/dry-run/execute/node-001/evidence-bundle.yaml
OK    (evidence-bundle v1)
```

The node-001 dry-run result packet (`result-packet.yaml`) fails v2 schema
validation because the stub adapter does not populate several required v2
fields. This is a **known and expected** gap — the stub adapter is explicitly
documented as a deterministic placeholder for framework validation. The
reference adapter samples in `fixtures/node-readiness-pack/` show complete,
schema-valid implementations.

## 5. Oracle Validation

```bash
$ node scripts/validate.js oracle
OK    9/9  (0 errors, 0 warnings)
```

## 6. Smoke Suite Validation

```bash
$ node scripts/validate.js smoke
OK    8/8  (1 skipped, 0 errors, 0 warnings)
```

## 7. Round Manifest Validation

```bash
$ node scripts/validate.js rounds
OK    2/2  (0 errors, 0 warnings)
```

## 8. Competition-Validity Fixture Verification

```bash
$ node scripts/competition-validity.js fixtures fixtures/competition-validity
Passed:    5
Failed:    0
Expected failures: 10
```

All positive fixtures pass; all negative fixtures correctly trigger the
expected validation failures.

---

*Agent Olympics v1 — Node Readiness closeout verification witness.*
