# Scoring Headroom Plan — Ceiling Observation and Season 002 Measures

> Status: design decision record, agreed 2026-06-12.
> Scope: documentation only. Season 001 scoring (rubric weights, oracle
> guidance, judge records) is FROZEN — nothing in this document changes how
> Season 001 entries are scored.

## Observation: score ceiling in the Season 001 live ops rounds

The first remote-execution-verified fleet rounds (ops-001/ops-002 across 11
registered participants, 18 hybrid judge records) produced totals clustered
in **84–91 / 100**:

| Component | Behaviour | Why |
|---|---|---|
| safety (15) | Saturated at 15/15 for every clean entry | Hygiene gate by design: differentiates only through violations (e.g. the daegyo ops-002 oracle-reference disqualification), not gradations. Saturation here is desirable. |
| evidence_quality (20), execution (15) | Converged near 18 / 11 | Compliance-floor heuristics; any disciplined adapter clears them. |
| correctness (30) | Compressed to 27–29 | The ops tasks sit below every competing model's capability ceiling, so variance ≈ 0 and the dimension cannot differentiate. |
| communication (10), durability (10) | 9 / 7–9 | Same compression. |

Effective differentiation range: ~7 points. A genuinely excellent stack can
plausibly reach 100, and **multiple stacks tying at or near 100 would leave
the leaderboard unable to rank the top** — the real form of the ceiling
problem.

## Principle

A maximum score is not the problem; the problem is a maximum that sits below
the frontier. The remedy is not to suppress high scores but to **keep space
above them** — the gymnastics lesson (the post-2006 move away from the
"perfect 10") applied to agent stacks. Dimensions split into two kinds:

- **Gates** (safety, and largely evidence/execution): saturation is correct;
  differentiation happens through violations and disqualification.
- **Ladders** (correctness, and partially communication/durability):
  differentiation must come from task difficulty, not from reweighting.

Influence = weight × variance. Raising a weight on a zero-variance dimension
amplifies noise, not signal. Mid-season reweighting also breaks comparability
with the existing judge records and is ruled out on fairness grounds.

## Decision gate: stage-2 data first

Stage 2 of the live rounds (node-001, code-001, knowledge-001, coord-001 —
the harder families, especially the code regression and the contradictory
report merge) is the controlled experiment for whether correctness variance
reopens at higher task difficulty.

After stage-2 scoring, evaluate:

1. Did the correctness spread widen (e.g. range ≥ 6 points across clean
   entries on code-001/coord-001)?
2. Did the model-class ordering change on the harder families?

- If variance reopens → the difficulty ladder alone is the answer; ship the
  Season 002 measures below as planned, no further intervention.
- If correctness still compresses → additionally prioritise harder task
  tiers in Season 002 task curation.

## Season 002 measures (agreed, to be implemented at the season boundary)

1. **Oracle full-marks redefinition.** Season 002 oracle scoring guidance
   reserves the top of the correctness band for performance that *exceeds*
   the model answer (e.g. diagnosis + fix + regression test + monitoring),
   with model-answer parity scoring slightly below the maximum. Keeps space
   above every known-good answer.
2. **Efficiency tie-breaker (display/ranking layer).** Total-score ties
   resolve by recorded-but-unscored efficiency measurements
   (`raw_measurements.wall_time_seconds`, token cost when available),
   compared **only within the same hardware class**
   (`comparable_metadata.node.hardware_profile` infrastructure already
   exists). No new measurement, no rubric change.
3. **Repeat runs for top-tier resolution.** Tasks used for top-of-board
   differentiation run 3× (varying seeds) and score on the mean or best,
   collapsing single-run noise that makes 100-vs-98 meaningless at n=1.
4. **Difficulty tiers.** Each family carries at least one task at or above
   the current frontier ceiling (held-out variants of existing scenarios
   qualify, e.g. the ops-001 stale-thread-context variant).

## Fairness invariants

- No retroactive rescoring of any season's records.
- Rubric and oracle guidance change only at season boundaries.
- Presentation-layer additions (dimension views, tie-breaker displays) are
  allowed mid-season because they alter no recorded score — precedent: the
  correctness-ranked dimension view added to the web leaderboard during
  Season 001.

## Related

- [Rubric v1](../rubrics/agent-olympics-v1.yaml)
- [Performance scoring](performance-scoring.md) — raw vs scored separation
  that the efficiency tie-breaker builds on
- [Judge harness](judge-harness.md)
- [Live runner](live-runner.md)
