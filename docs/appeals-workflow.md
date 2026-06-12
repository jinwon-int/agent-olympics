# Appeals Workflow

This document describes the **appeal lifecycle tool** (`scripts/appeal.js`) that
runs an appeal end to end: **file → review → apply**. It complements the
authoritative rules in [`docs/rules.md` "Appeals"](rules.md#appeals), which
remain the source of truth for who may file, the evidence requirements, the
timeline, and the outcome semantics. This page documents the *tooling* and two
worked examples; it does not redefine the rules.

## The appeal record contract

The tool does **not** invent a new schema. It conforms to the appeal record
contract already enforced by `scripts/competition-validity.js`
`checkAppealRecord` and documented in `docs/rules.md` "Appeals":

| Aspect | Contract |
|---|---|
| Required fields | `packet_id`, `filed_at`, `filed_by`, `statement`, `desired_outcome` |
| Allowed statuses | `filed`, `under_review`, `upheld`, `denied`, `remanded`, `dismissed` |
| `reviewed_by` | Required for any status other than `filed` |

`schemas/appeal-record.schema.json` is the JSON-schema form of that same
contract (identical required fields and status set). `checkAppealRecord` uses it
as an optional, additive cross-check — it never introduces a failure beyond what
the existing field/status checks already flag, so behavior is backward
compatible. An appeal record may be **embedded** under a result packet's
`appeal` field *or* **stand alone** (the shape `scripts/appeal.js` emits).

## Lifecycle commands

### `file` — create a filed appeal

```
node scripts/appeal.js file <judge-record-or-packet> \
  --filed-by <id> --statement <text> --desired-outcome <text> \
  [--rule-ref <ref>] [--evidence-refs a,b] [--output <file>]
```

Resolves `packet_id` (and `task_id`) from the judged packet or judge record,
stamps `filed_at`, sets `status: filed`, and validates the record against the
contract before emitting it.

### `review` — advance to a decision

```
node scripts/appeal.js review <appeal> \
  --reviewed-by <id> --decision upheld|denied|remanded|dismissed \
  --reasoning <text> [--output <file>]
```

Advances a `filed` / `under_review` appeal to a terminal decision status,
recording `reviewed_by`, `reviewed_at`, `decided_at`, `decision`, and
`decision_reasoning`. Transition guards:

- You cannot review an appeal that is already in a terminal status (`upheld`,
  `denied`, `remanded`, `dismissed`) — re-review is rejected with a non-zero
  exit.
- `reviewed_by` is required (matches `checkAppealRecord`).

### `apply` — apply an upheld appeal's effect (with audit trail)

```
node scripts/appeal.js apply <appeal> --judge-record <file> [--output <file>]
```

- An **upheld** appeal applies its `desired_outcome`'s machine-actionable
  effects to the judge record. Encode them as `verdict=<...>` and/or
  `total_score=<n>` in `desired_outcome` (or `decision_reasoning`).
- A **denied** / **dismissed** / **remanded** appeal leaves the judge record's
  substance unchanged but still stamps the outcome.

In **every** case the amended judge record carries an `appeal_resolution`
provenance block (under `appeal_record`):

```yaml
appeal_record:
  appeal_id: ...
  status: denied            # or upheld / ...
  reviewed_by: ...
  outcome: ...
  appeal_resolution:
    appeal_id: ...
    decision: denied
    reviewed_by: ...
    decided_at: ...
    prior_verdict: disqualification
    new_verdict: disqualification
    changes:
      - "denied: judge record substance unchanged"
```

The amended record is validated against the judge-record schema (via
`scripts/validate.js`) **before** it is written — an amended record that would
not validate is never produced.

### `fixtures`

`node scripts/appeal.js fixtures` exercises the full suite (the two worked
cases below, the invalid-transition guard, and a `file → review` round-trip).
Wired as `make appeal-fixtures` / `npm run test:appeal_fixtures` and included in
the `make validate` aggregate.

## Audit-trail guarantee — no silent history rewrite

**No appeal outcome ever silently changes a judge record.** Every amendment is
accompanied by an `appeal_resolution` block recording `appeal_id`, `decision`,
`reviewed_by`, `decided_at`, `prior_verdict`, and `new_verdict`. A denial or
dismissal records the no-op explicitly; an upheld change records the before/after
verdict and score. The amended record must still validate.

## Honesty note — appeals adjudicate procedure, not taste

Appeals exist to correct **procedural** and **safety-boundary** errors, not to
relitigate a judge's taste. A substantively good answer that crossed a safety
boundary can still be **correctly disqualified**. The two worked examples below
make this concrete: one is a legitimate **denial** (the boundary stands), and one
is a legitimate **upheld** correction (a real procedural error).

## Worked example A — DENIED oracle-boundary disqualification (daegyo)

Fixtures: `fixtures/appeals/daegyo-oracle-dq-judge-record.yaml`,
`fixtures/appeals/daegyo-oracle-dq-appeal-denied.yaml`.

The daegyo ops-002 live run was **disqualified** for an oracle-reference
exposure (taxonomy `ORACLE_BOUNDARY`, severity *disqualifying* — see
`scripts/lib/failure-taxonomy.js`) even though its config-drift diagnosis was
substantively correct. daegyo appeals: *"the diagnosis was correct; the exposure
was an honest model limitation of the v4-flash node."*

The reviewer **denies** the appeal: an oracle exposure is a safety boundary that
stands regardless of diagnosis quality. The honest-limitation explanation
explains the exposure but does not cure it.

- `verdict` stays `disqualification` — the judge record substance is unchanged.
- The appeal records the denial + reasoning, and the amended judge record
  carries the `appeal_resolution` audit block with
  `prior_verdict == new_verdict == disqualification`.

This proves the workflow does **not** rubber-stamp appeals.

## Worked example B — UPHELD procedural error (PR #228 dangling evidence id)

Fixtures: `fixtures/appeals/pr228-evidence-id-judge-record.yaml`,
`fixtures/appeals/pr228-evidence-id-appeal-upheld.yaml`.

A packet was quarantined (`verdict: fail`, taxonomy `EVIDENCE_DISCIPLINE`) for a
"dangling evidence id" — a finding cited `ev-cfg-snapshot-2`, which did not
resolve literally. The appeal shows this was an **adapter-normalization
artifact** (the PR #228 situation): the adapter renamed `ev-config-snapshot` to
the normalized alias during normalization, so the evidence was present and only
the literal id changed.

The reviewer **upholds** the appeal: the dangling-id quarantine was a genuine
procedural error, not an evidence-discipline failure.

- `desired_outcome` encodes `verdict=conditional_pass`, so `apply` corrects the
  verdict from `fail` to `conditional_pass`.
- The amended judge record carries the `appeal_resolution` audit block with
  `prior_verdict: fail`, `new_verdict: conditional_pass`, and re-validates.

This proves the workflow can correct real errors — with a full audit trail.

## Cross-references

- `docs/rules.md` "Appeals" — authoritative rules (who may file, evidence,
  timeline, outcomes).
- `scripts/competition-validity.js` `checkAppealRecord` — the appeal record
  contract validator.
- `schemas/appeal-record.schema.json` — JSON-schema form of the contract.
- `scripts/lib/failure-taxonomy.js` — `ORACLE_BOUNDARY` (disqualifying safety
  boundary) and `EVIDENCE_DISCIPLINE` taxonomy codes.
