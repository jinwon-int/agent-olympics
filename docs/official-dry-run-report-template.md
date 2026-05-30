# Official Dry-Run Report Template

> **Use for:** Season 001 official source-only dry-run closeout.
> **Related:** #146, #147, #148, #149.

## Run Identity

| Field | Value |
|---|---|
| Run id | `<official-dry-run-id>` |
| Source commit | `<commit>` |
| Finalizer PR | `<pr>` |
| Round manifest | `<rounds/...yaml>` |
| Operators | `<names or handles>` |
| Publication state | `publishable` / `provisional` / `blocked` |

## Pre-Run Readiness Gates

| Gate | Command Or Evidence | Status |
|---|---|---|
| R1 Schema validation | `node scripts/validate.js all-v2` | `<pass/fail>` |
| R2 Oracle validation | `node scripts/validate.js oracle` | `<pass/fail>` |
| R3 Round manifest validation | `node scripts/validate.js rounds` | `<pass/fail>` |
| R4 Fixture validation | `node scripts/validate.js fixtures` | `<pass/fail>` |
| R5 Profile validation | `node scripts/validate.js profiles` | `<pass/fail>` |
| R6 Competition validity | `node scripts/competition-validity.js fixtures` | `<pass/fail>` |
| R7 Dry-run readiness | `node scripts/dry-run-gates.js readiness ...` | `<pass/fail>` |
| R8 Redaction review | `node scripts/dry-run-gates.js redaction-check ...` | `<pass/fail>` |
| R9 Metadata safety | `node scripts/dry-run-gates.js safe-metadata ...` | `<pass/fail>` |
| R10 Test suite | `npm test` | `<pass/fail>` |

## Post-Run Publication Gates

| Gate | Command Or Evidence | Status |
|---|---|---|
| P1 Run directories exist | `runs/season-001/...` | `<pass/fail>` |
| P2 Result packets exist | `results/*.yaml` | `<pass/fail>` |
| P3 Score validation | `node scripts/score.js validate results` | `<pass/fail>` |
| P4 Score generation | `node scripts/score.js score results` | `<pass/fail>` |
| P5 Scoreboard generation | `node scripts/score.js aggregate` or equivalent | `<pass/fail>` |
| P6 Publication gate | `node scripts/dry-run-gates.js publication ...` | `<pass/fail>` |
| P7 Harness conversion | `node scripts/harness-to-packet.js <report>` | `<pass/fail>` |
| P8 Web data snapshot | `web/public/data/scoreboard.json` | `<pass/fail/na>` |
| P9 Appeals/integrity record | GitHub/Wiki closeout references | `<pass/fail>` |
| P10 Tracker ratification | `docs/tracker-ratification-15-16.md` | `<pass/fail>` |

## Lane Evidence

| Lane | Issue | PR Or Evidence | Finalizer Decision |
|---|---:|---|---|
| Node readiness execution | #147 | `<pr/evidence>` | `<integrated/reconstructed/blocked>` |
| Perf harness publication | #148 | `<pr/evidence>` | `<integrated/reconstructed/blocked>` |
| Publication bundle | #149 | `<pr/evidence>` | `<integrated/reconstructed/blocked>` |

## Caveats

- Source-only execution does not prove live provider delivery.
- Source-only performance measurements should not be promoted to official
  hardware tiers without approved live node runs.
- Bangtong remains excluded until server replacement and re-enrollment.
- Any private oracle, hidden judge note, credential value, or live delivery
  evidence must remain out of the public bundle.

## Sign-Off

| Role | Sign-Off | Notes |
|---|---|---|
| Finalizer | `<name/date>` | `<notes>` |
| Reviewer | `<name/date>` | `<notes>` |
| Operator approval | `<link or not required>` | `<notes>` |

## Attachments

- Finalizer PR.
- Worker PRs and issue comments.
- Validation command output.
- Generated dry-run evidence JSON files.
- Scoreboard or publication snapshot.
- Wiki closeout PR.
