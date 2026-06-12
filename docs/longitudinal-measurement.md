# Longitudinal Measurement (Over-Time Drift Detection)

The charter's word is **"operating"**: the Agent Olympics measure the *operating*
agent stack. That word implies a **time axis** the repo did not previously
capture. Until now, each `(task, participant)` carried a single latest judge
record — there was no way to ask *"did this stack's performance drift between
rounds?"*

This is the platform's unique angle. With a real standing fleet, the olympics
can become **continuous QA, not a one-shot contest**, and it can measure the very
thing [`ops-002`](../tasks/season-001/ops-002-clean-reinstall-drift-v2.yaml)
diagnoses — *post-update config drift* — happening to the **fleet itself**. A
stack can drift the same way a node does.

## The snapshot model

A longitudinal record is a **sequence of immutable round snapshots**. Trend and
drift are computed *across* them. This is an **additive layer**: no existing
scored data, judge record, or scoreboard logic changes behavior. Snapshots are
**derived, append-only, and immutable**.

One snapshot
([`schemas/longitudinal-snapshot.schema.json`](../schemas/longitudinal-snapshot.schema.json))
captures a round's outcome as a compact, identity-bearing-but-publishable-blindable
record:

- `snapshot_id`, `captured_at` (ISO — the time axis), `round_id`
- `source_scoreboard_id` and `source_revision` (git HEAD) for provenance
- per `(task_id, participant_id)`: `total_score` (or `null`), `verdict`,
  `status`, the six rubric dimension scores, and any `failure_code` (from the
  [failure taxonomy](live-runner.md#failure-taxonomy)) if rejected.

Snapshots live under `results/longitudinal/` as
`snapshot-<captured_at>-<round_id>.yaml`. They are **committed** — they are the
durable record. The fixture series under `fixtures/longitudinal/` exercises the
detector and is committed regardless.

Snapshots are built from the **scoreboard**, not from raw packets. Run
`make score` first if the scoreboard is stale, then:

```sh
node scripts/longitudinal.js snapshot [--scoreboard results/scoreboard.json] [--round <id>] [--output <file>]
```

`snapshot` validates against the schema and is **append-only**: it never
overwrites an existing snapshot for the same `captured_at`.

## Drift verdicts and thresholds

The report computes a deterministic, threshold-based drift verdict per
`(task, participant)` between consecutive snapshots:

```sh
node scripts/longitudinal.js report [--dir results/longitudinal] [--task <id>] [--participant <id>] [--blind] [--threshold <n>]
```

| Verdict        | Trigger                                                                                         | ops-002 drift class (conceptual)                |
| -------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `REGRESSION`   | `total_score` drops by **more than the threshold** (default **5**) between consecutive snapshots | *Performance regression after a routine update* |
| `STATUS_DRIFT` | A previously-**clean** `(task, participant)` becomes **quarantined / disqualified** (carries the `failure_code`) | *The stack broke after the update*              |
| `RECOVERY`     | `total_score` climbs back by **≥ threshold**, or status returns from rejected to clean           | *The targeted fix worked*                       |
| `STABLE`       | Within threshold, still clean                                                                    | *No mutation needed*                            |
| `NEW`          | First appearance of the series (no prior point to compare)                                       | —                                               |

Precedence: a status drift **into** rejection is the strongest signal and wins
over a numeric delta; a return **from** rejection to clean is `RECOVERY`. The
threshold is configurable with `--threshold`.

These verdicts map **conceptually** to ops-002's drift classes — that linkage is
printed in the report header and surfaced in the Makefile target comment. The
point is not that the detector *runs* ops-002; it is that the same kind of
post-update drift ops-002 watches for on a node is exactly what these snapshots
watch for on the fleet.

## Honest note: signal, not proof of causation

Drift detection is **threshold-based signal, not proof of causation.** A score
drop can be:

- **task variance** (a noisier task, a different fixture seed),
- **model-backend flakiness** (a slow or degraded inference backend that round),
- or a **genuine stack regression** (the thing we actually care about).

The report **flags** a drift for investigation; it does **not diagnose the
cause**. This mirrors the honesty posture of the rest of the repo: the safety
trial detects *honest* bait-taking, the failure taxonomy notes task drift is only
*surfaced* (not directly detected), and appeals adjudicate *procedure* not taste.
A `REGRESSION` is a prompt to look, not a verdict on the stack.

## Blind / public story

`report --blind` applies the **same anonymization rules as the public
leaderboard** ([public-leaderboard.md](public-leaderboard.md)): participant ids
become `Participant A`, `Participant B`, … (stable per run, first-appearance
order), and no model/node/config/hardware identity is shown. The blind path in
`scripts/longitudinal.js` **reuses** `anonymizeScoreboard` from
`scripts/web-result-consumer.js` rather than duplicating the rules, and drops
`source_revision` / `source_scoreboard_id` so provenance cannot re-link a
participant.

What remains visible is the competition signal that carries no identity: task id,
the score trend, the deltas, the drift verdict, and the failure-taxonomy code of
any rejection. A reader can see *how a stack drifted over time* without learning
*who* it is. The fixture suite asserts that no real participant id survives blind
mode and that drift verdicts are unchanged by anonymization (same gate spirit as
the public leaderboard's leak gate).

## Fixtures

`node scripts/longitudinal.js fixtures` (a.k.a. `make longitudinal-fixtures`,
`npm run test:longitudinal_fixtures`) runs a 3-snapshot series under
`fixtures/longitudinal/` and asserts:

- `ops-002 / fleet-alpha`: `NEW → REGRESSION → RECOVERY` (88 → 70 → 89);
- `ops-002 / fleet-stable`: stays `STABLE` within threshold (80 → 82 → 81);
- `tool-001 / fleet-beta`: `clean → STATUS_DRIFT`, quarantined carrying
  `EVIDENCE_DISCIPLINE`;
- a **malformed snapshot fails schema validation**;
- `--blind` leaks no real participant id, all ids become `Participant X`, and
  drift verdicts survive anonymization;
- `buildSnapshot` derives a `failure_code` via the **shared** failure taxonomy.

The suite exits non-zero only on its own assertion failure or a schema-invalid
snapshot; `snapshot` and `report` are otherwise informational (exit 0).

## Future work

A compact trend column (delta vs the previous snapshot) could surface on the web
leaderboard. It is left as future work to keep this change low-risk and purely
additive — the report is the surface today.

## Related

- [Public leaderboard](public-leaderboard.md) — the blind publication rules reused here
- [Failure taxonomy](live-runner.md#failure-taxonomy) — the `failure_code`s carried on STATUS_DRIFT
- [Scoring headroom plan](scoring-headroom-plan.md) — dimension view + ceiling
- [`ops-002`](../tasks/season-001/ops-002-clean-reinstall-drift-v2.yaml) — the node-drift scenario the fleet is watched for
