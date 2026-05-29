# Season 001 — Official Dry Run Go/No-Go and Publication Readiness

This document defines the operator-facing go/no-go layer for running an official
Season 001 dry run before the competition round is declared valid, publishable,
and finalizable.

---

## 1. Overview

A Season 001 dry run transitions through three logical phases:

```
 Qualification/Readiness
        │
        ▼  (all gates pass → Go)
    Execution (agent runs tasks)
        │
        ▼  (all gates pass → Publishable)
   Publication Readiness
        │
        ▼  (finalizer evidence satisfied → Done)
   Broker Finalization
```

Each phase has concrete command gates that operators (workers, judges, brokers)
run to produce evidence. No phase may advance until all its gates pass.

---

## 2. Qualification / Readiness Gates

These gates determine whether a dry run may **begin**. They check that the
round, its manifests, fixtures, and participant metadata are complete and
internally consistent.

### Gate 2.1 — Round Manifest is Schema-Valid

```bash
node scripts/validate.js rounds/<round-manifest>.yaml
```

**Expected:** Exit 0, no errors.
**Evidence:** Terminal output captured to `evidence/dry-run/gate-2-1-round-schema.txt`.

### Gate 2.2 — All Task Envelopes Resolve

```bash
node scripts/validate.js smoke     # for smoke-round tasks
# or
node scripts/validate.js envelopes # for all envelopes
```

**Expected:** Exit 0, no missing envelope paths.
**Evidence:** Terminal output captured to `evidence/dry-run/gate-2-2-envelopes.txt`.

### Gate 2.3 — All Fixture Bundles Exist

```bash
node scripts/validate.js fixtures
```

**Expected:** Exit 0, no missing fixture directories.
**Evidence:** Terminal output captured to `evidence/dry-run/gate-2-3-fixtures.txt`.

### Gate 2.4 — Oracle Files Are Valid (Private)

```bash
node scripts/validate.js oracle
```

**Expected:** Exit 0, all oracle files parse against the oracle schema.
**Evidence:** Terminal output captured to `evidence/dry-run/gate-2-4-oracle.txt`.

### Gate 2.5 — Participant Metadata Is Complete

All participants declared in the round manifest have `agent_id`, `runtime`,
and `label` populated. The round manifest's `participants[]` array has no
duplicate `agent_id` values.

**Check (no script — manual or gateway inspects the manifest):**
```bash
node -e '
const yaml = require("js-yaml");
const fs = require("fs");
const m = yaml.load(fs.readFileSync("rounds/season-001-round-001.yaml", "utf8"));
const ids = m.participants.map(p => p.agent_id);
const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
console.log("Participants:", ids.join(", "));
if (dups.length) { console.log("DUPLICATE agent_ids:", dups); process.exit(1); }
console.log("All participants OK.");
'
```

**Expected:** All participants listed, no duplicates.
**Evidence:** Command output and manifest excerpt.

### Gate 2.6 — Run Directory Is Ready

The round manifest's `run_directory` path is writable and does not collide
with a previous round's run directory.

```bash
node scripts/round.js plan rounds/<round-manifest>.yaml
```

**Expected:** Plan output lists all expected run directories without error.
**Evidence:** Terminal output captured to `evidence/dry-run/gate-2-6-run-dir.txt`.

### Gate 2.7 — No Pending Appeals or Contested Issues

Check the parent issue (#138) and round issue (#141) for unresolved appeals
or blocker labels.

```bash
# Manual check — inspect issue labels and comments for:
# - "blocked" label
# - "appeal" status
# - Any unresolved "needs decision" markers
```

**Expected:** No open blockers or contested issues.
**Evidence:** Issue screenshot or label list.

### Readiness Summary Command

```bash
node scripts/dry-run-gates.js readiness --manifest rounds/<round-manifest>.yaml
```

**Expected:** All gates pass (exit 0).
**Evidence:** JSON output written to `evidence/dry-run/readiness-evidence.json`.

---

## 3. Publication Readiness Gates

These gates determine whether a completed dry run's results may be **published**
to a leaderboard or web result page. They run after all agents have finished and
automated scoring is complete.

### Gate 3.1 — All Run Directories Have a Terminal State

Every expected run directory is present and its manifest shows a terminal
state (`completed`, `failed`, `partial`, `blocked`, or `disqualified`).

```bash
node scripts/competition-validity.js engine-outputs runs/season-001/round-001/
```

**Expected:** All runs are accounted for; no run is still `pending` or `running`.
**Evidence:** Terminal output captured to `evidence/dry-run/gate-3-1-terminal-states.txt`.

### Gate 3.2 — No Run Is Disqualified by Secret Exposure

```bash
node scripts/competition-validity.js all runs/season-001/round-001/
```

**Expected:** No disqualification-level findings.
**Evidence:** Full competition-validity report.

### Gate 3.3 — All Result Packets Pass Schema Validation

```bash
node scripts/validate.js packets
```

**Expected:** All result packets are valid (exit 0).
**Evidence:** Terminal output captured to `evidence/dry-run/gate-3-3-packets.txt`.

### Gate 3.4 — Scoreboard Was Generated

```bash
node -e 'const fs=require("fs");
const sb=JSON.parse(fs.readFileSync("results/scoreboard.json","utf8"));
console.log("Scoreboard entries:", sb.entries.length);
console.log("Rounds:", new Set(sb.entries.map(e=>e.task_id)).size);
console.log("Participants:", new Set(sb.entries.map(e=>e.agent_id)).size);
'
```

**Expected:** Scoreboard exists with matching entries for each task × participant.
**Evidence:** Summary output captured to `evidence/dry-run/gate-3-4-scoreboard.txt`.

### Gate 3.5 — Web Result Data Bridge Fields Are Complete

```bash
make validate-web-fields 2>&1 || node -e '
const sb = JSON.parse(require("fs").readFileSync("results/scoreboard.json", "utf8"));
let missing = 0;
for (const e of sb.entries) {
  if (!e.agent_id) { missing++; console.log("MISSING agent_id in " + e.entry_id); }
  if (!e.score && e.judge_type !== "pending") { missing++; console.log("MISSING score in " + e.entry_id); }
  if (!e.packet_ref) { missing++; console.log("MISSING packet_ref in " + e.entry_id); }
  if (!e.task_id) { missing++; console.log("MISSING task_id in " + e.entry_id); }
}
console.log(missing === 0 ? "All web-display fields present" : missing + " entries missing fields");
process.exit(missing > 0 ? 1 : 0);
'
```

**Expected:** All web-display fields present on every entry.
**Evidence:** Terminal output captured to `evidence/dry-run/gate-3-5-web-fields.txt`.

### Gate 3.6 — Redaction Review Complete

Every result packet marked as `publishable: true` has been reviewed:

- All `redacted: true` items have a value-free `redaction_reason`.
- No credential patterns (`sk-...`, `ghp_...`, private keys, JWTs) remain in
  unredacted string fields.
- `oracle_ref` and `judge_notes_ref` do not appear in participant-facing
  artifacts.

```bash
node scripts/dry-run-gates.js redaction-check --results-dir results/
```

**Expected:** No redaction violations.
**Evidence:** JSON report written to `evidence/dry-run/redaction-check.json`.

### Gate 3.7 — Comparison Metadata Is Safe

All `comparable_metadata` and `hardware_profile` fields contain safe labels
only — no raw hostnames, IPs, credentials, or endpoint URLs.

```bash
node scripts/dry-run-gates.js safe-metadata --results-dir results/
```

**Expected:** No unsafe metadata found.
**Evidence:** JSON report written to `evidence/dry-run/safe-metadata.json`.

### Publication Summary Command

```bash
node scripts/dry-run-gates.js publication --results-dir results/
```

**Expected:** All publication gates pass (exit 0).
**Evidence:** JSON output written to `evidence/dry-run/publication-evidence.json`.

---

## 4. Validation Checklist

Use this checklist during a dry run review. Each item must be checked and
signed off by the operator (worker or broker).

### Pre-Run (Readiness)

| # | Check | Command / Source | Pass |
|---|---|---|---|
| R1 | Round manifest is schema-valid | `node scripts/validate.js rounds/<manifest>` | ☐ |
| R2 | All task envelopes validate | `node scripts/validate.js smoke` | ☐ |
| R3 | All fixture bundles exist | `node scripts/validate.js fixtures` | ☐ |
| R4 | Oracle files are valid | `node scripts/validate.js oracle` | ☐ |
| R5 | Participant metadata complete | `node -e '...'` (see Gate 2.5) | ☐ |
| R6 | Run directory ready | `node scripts/round.js plan <manifest>` | ☐ |
| R7 | No blocked issues or pending appeals | Manual issue check | ☐ |
| R8 | Run directory has no stale state | `ls runs/<season>/<round>/ 2>/dev/null; no leftover dirs` | ☐ |
| R9 | npm dependencies installed | `ls node_modules/ajv 2>/dev/null` | ☐ |
| R10 | Package lock is up to date | `npm ls 2>&1 | head -5` | ☐ |

### Post-Run (Publication)

| # | Check | Command / Source | Pass |
|---|---|---|---|
| P1 | All runs reached terminal state | `node scripts/competition-validity.js engine-outputs ...` | ☐ |
| P2 | No disqualification findings | `node scripts/competition-validity.js all ...` | ☐ |
| P3 | All result packets are schema-valid | `node scripts/validate.js packets` | ☐ |
| P4 | Scoreboard generated | `results/scoreboard.json` exists | ☐ |
| P5 | Web-display fields present | `make validate-web-fields` | ☐ |
| P6 | Redaction review complete | `node scripts/dry-run-gates.js redaction-check` | ☐ |
| P7 | Comparison metadata is safe | `node scripts/dry-run-gates.js safe-metadata` | ☐ |
| P8 | Blind scoreboard (if applicable) | `node scripts/score.js run --blind` | ☐ |
| P9 | Web consumer generates output | `node scripts/web-result-consumer.js results/scoreboard.json` | ☐ |
| P10 | Competition-validity fixtures pass | `node scripts/competition-validity.js fixtures fixtures/competition-validity` | ☐ |

---

## 5. Broker Finalizer Evidence Requirements

The broker-of-record (agent **seoseo**) is responsible for finalizing a dry
run — declaring it complete, publishing results, and archiving run artifacts.
Before seoseo may finalize, all of the following evidence must be present in
the run record.

### 5.1 Required Evidence Items

| Evidence ID | Must Show | Source |
|---|---|---|
| `finalizer-readiness-report` | All readiness gates passed (exit 0) | `node scripts/dry-run-gates.js readiness` output |
| `finalizer-publication-report` | All publication gates passed (exit 0) | `node scripts/dry-run-gates.js publication` output |
| `finalizer-competition-validity` | No competition-validity violations | `node scripts/competition-validity.js all ...` output |
| `finalizer-scoreboard` | Scoreboard JSON is present and parsable | `results/scoreboard.json` |
| `finalizer-web-fields` | All web-display fields populated | `make validate-web-fields` output |
| `finalizer-redaction-check` | No redaction or secret-leak violations | `node scripts/dry-run-gates.js redaction-check` output |
| `finalizer-metadata-safety` | No unsafe metadata in comparable blocks | `node scripts/dry-run-gates.js safe-metadata` output |
| `finalizer-schema-validate-all` | All schemas validate repo-wide | `node scripts/validate.js all` output |
| `finalizer-checklist-signed` | Operator signs off every checklist item | Signed checklist (see §4) |

### 5.2 Evidence Format

Each evidence item must be a source-only file in the run record or evidence
directory:

```
evidence/dry-run/
  ├── readiness-evidence.json
  ├── publication-evidence.json
  ├── competition-validity.txt
  ├── scoreboard-summary.txt
  ├── web-fields.txt
  ├── redaction-check.json
  ├── safe-metadata.json
  ├── schema-validate-all.txt
  └── checklist-signed.txt
```

The broker-of-record may also reference evidence items by their `id` in a
result packet or evidence bundle under the `finalizer-` prefix.

### 5.3 Finalizer Gate Script

The broker can run the single gate command to verify all requirements at once:

```bash
node scripts/dry-run-gates.js finalizer-ready \
  --manifest rounds/<manifest>.yaml \
  --results-dir results/ \
  --runs-dir runs/<season>/<round>/
```

This runs all readiness and publication gates, validates the scoreboard, and
checks redaction hygiene — then exits 0 only if **all** requirements are met.
It produces a single JSON evidence file at
`evidence/dry-run/finalizer-evidence.json`.

### 5.4 Source-Only Constraint

All evidence produced for finalization must be **source-only** — generated from
files, schemas, fixtures, and scripts inside this repository. No live network
calls, production node access, or secret material may be used to produce
finalizer evidence. The broker must not rely on external infrastructure
status, live Telegram/GitHub probes, or credentials obtained outside the
competition.

If a finalizer gate requires data that cannot be produced source-only, that
gate must be documented as a **manual confirmation** step with the constraint
clearly noted.

### 5.5 Broker Sign-Off

Once all evidence is gathered and verified, the broker records finalization by:

1. Adding a `finalized_at` timestamp and `finalized_by` (broker agent_id) to
   the round manifest's lifecycle `status_history`.
2. Marking the round lifecycle as `archived`.
3. Updating the parent issue (#138) with the finalization evidence summary
   and links to each evidence artifact.

---

## 6. Concrete Command Gates Summary

All gates in a single quick-reference table:

| Phase | Gate | Command | Exit 0 Meaning |
|---|---|---|---|
| Readiness | Manifest | `node scripts/validate.js rounds/<manifest>` | Manifest is valid |
| Readiness | Envelopes | `node scripts/validate.js smoke` | All task envelopes valid |
| Readiness | Fixtures | `node scripts/validate.js fixtures` | All fixture bundles exist |
| Readiness | Oracle | `node scripts/validate.js oracle` | Oracle files valid |
| Readiness | Plan | `node scripts/round.js plan <manifest>` | Dry-run plan succeeds |
| Readiness | Dependencies | `ls node_modules/ajv` | Dependencies installed |
| Readiness | **All** | `node scripts/dry-run-gates.js readiness --manifest <manifest>` | All readiness gates pass |
| Publication | Terminal | `node scripts/competition-validity.js engine-outputs <runs-dir>` | All runs terminal |
| Publication | Validity | `node scripts/competition-validity.js all <runs-dir>` | No violations |
| Publication | Packets | `node scripts/validate.js packets` | All packets valid |
| Publication | Scoreboard | `node -e '...check results/scoreboard.json...'` | Scoreboard valid |
| Publication | Web fields | `make validate-web-fields` | All display fields present |
| Publication | Redaction | `node scripts/dry-run-gates.js redaction-check --results-dir <dir>` | No redaction violations |
| Publication | Metadata | `node scripts/dry-run-gates.js safe-metadata --results-dir <dir>` | Metadata is safe |
| Publication | **All** | `node scripts/dry-run-gates.js publication --results-dir <dir>` | All publication gates pass |
| Finalizer | **Full** | `node scripts/dry-run-gates.js finalizer-ready --manifest <m> --results-dir <d> --runs-dir <r>` | All gates pass, broker can finalize |

---

## 7. Related Documents

| Document | Relation |
|---|---|
| [Competition Model](competition-model.md) | Round lifecycle and competition-validity checks |
| [Scoring](scoring.md) | Judge/scoreboard pipeline and auto-judge dimensions |
| [Web Result Data Bridge](web-result-data-bridge.md) | Scoreboard → web display field mappings |
| [Rules](rules.md) | Publication rules, appeals, and disqualification |
| [Task Verification](task-verification.md) | Task readiness tiers and promotion workflow |
| [Result Packet](result-packet.md) | Redaction, publication metadata, and evidence rules |
| [Run Directory / Artifact Lifecycle](run-directory.md) | Run directory layout and lifecycle states |
| [Issue #141](https://github.com/jinwon-int/agent-olympics/issues/141) | This lane's target issue |
| [Issue #138](https://github.com/jinwon-int/agent-olympics/issues/138) | Parent coordination issue |

---

*This document is part of the Agent Olympics Season Ops dry-run readiness pack.
It defines the operator-facing go/no-go layer for running an official Season 001
dry run. Created for lane 3/3 (yukson / team1).*
