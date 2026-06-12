# Human Baseline (Reference Line Authoring)

The capability declaration
([`fixtures/adapters/capabilities/human-baseline.yaml`](../fixtures/adapters/capabilities/human-baseline.yaml))
has promised it from the start: a human baseline "establishes the reference
quality level for judging agent performance — if an agent significantly
outperforms or underperforms the human baseline, that is a meaningful signal."
The `human_baseline` division exists in the result-packet schema, and the
[eligibility table](participant-eligibility.md#eligible-participant-classes)
lists the human operator as a first-class participant class.

What was missing was the **path**: every other class has an adapter or wrapper
that produces its packets, but a human baseline is authored **manually** — there
is no transport to auto-execute. `scripts/human-baseline.js` closes that gap
with a **template → fill → finalize → submit** workflow instead of a transport.

## Why this matters for scoring

The [scoring headroom plan](scoring-headroom-plan.md) established that
differentiation comes from task difficulty, not rubric reweighting. The human
baseline adds the second calibration axis: an **absolute reference line**.
A leaderboard ordering says *which stack is better*; the human anchor says
*whether any of them beat a competent human*. That is the claim the charter
actually cares about, and it cannot be derived from agent-vs-agent comparison
alone.

## The workflow

### 1. `template` — generate the human-fillable form

```sh
node scripts/human-baseline.js template tasks/season-001/ops-001-gateway-incident-v2.yaml \
  --operator human-ref-001 --output /tmp/ops-001-human.yaml
```

The template is a result-packet v2 skeleton with the identity fields a human
should never have to invent already fixed (`division: human_baseline`,
`runtime`/`adapter` `human-baseline`, `model: human-operator`, a solo
`delegation_profile` with `human_assistance: true`) and a `FILL_ME` placeholder
plus inline guidance for everything the operator must author: the per-output
answers, the **timestamped action log** (`outputs.action_log` — the human
action timeline), evidence summaries, and findings that cite the seeded
`ev-human-*` evidence ids.

The template echoes only the envelope's **public** fields (objective, allowed /
forbidden actions, required outputs) as guidance. It contains **no oracle or
judge material** — the same prohibition the agent wrappers live under.

### 2. The operator fills it in by hand

The operator performs the task from the public envelope, then replaces every
`FILL_ME`. House rules, stated in the template header:

- keep the action log honest — timestamped, in order, with observed outcomes;
- never read oracle files / hidden judge notes / answer keys;
- never paste secret **values**; record locations/handles and redact first.

### 3. `finalize` — validate and emit a clean packet

```sh
node scripts/human-baseline.js finalize /tmp/ops-001-human.yaml \
  --output results/season-001/ops-001/human-ref-001/result-packet.yaml
```

`finalize` strips the authoring header and rejects the packet (exit 1, all
reasons listed) if any of the following hold:

1. any `FILL_ME` placeholder survives anywhere in the packet;
2. a required result-packet v2 field is missing;
3. `division`/`runtime`/`adapter` are not human-baseline;
4. `status`/`validity` are not legal enum values;
5. a finding cites no evidence or a non-existent evidence id (the same
   evidence-discipline rule the fan-in enforces on agents);
6. the action log is empty;
7. a raw secret value or secret-bearing field is present (shared
   [`secret-patterns`](../scripts/lib/secret-patterns.js) + the live-runner
   field scan — unanchored, same as everywhere else);
8. anything references oracle / hidden judge material (the live runner's own
   `scanTextForOracleReferences`, not a re-derivation).

On success it writes the clean packet **plus the trace and evidence-bundle
companions** (built from the action log) for fan-in parity, and reports the
[runtime fingerprint](../scripts/lib/runtime-fingerprint.js) verdict — a
finalized packet fingerprints as `human-baseline`, keeping the identity-check
layer honest for manual submissions too.

### 4. Submit like any participant

The finalized packet goes under `results/` through the normal contract
([participant-quickstart](participant-quickstart.md)): `make validate` checks
it, the [judge harness](judge-harness.md) scores it with the **same rubric**,
and on the [public leaderboard](public-leaderboard.md) it appears as just
another `Participant X`. No privileged path, no separate rubric.

## `anchor` — reading agents against the human line

```sh
node scripts/human-baseline.js anchor [--scoreboard results/scoreboard.json] \
  [--task ops-001] [--blind] [--threshold 10]
```

For each task that has a scored human-baseline entry, `anchor` prints each
agent participant's **delta** vs the human reference score and flags:

| Flag                          | Trigger                                  |
| ----------------------------- | ---------------------------------------- |
| `significantly_above_human`   | delta **> +threshold** (default **10**)  |
| `significantly_below_human`   | delta **< −threshold**                   |
| `comparable`                  | within ±threshold                        |

The default threshold of 10 points is one full grade band on the 100-point
rubric — a defensible notion of "significantly". Tasks without a human
baseline report exactly that; **no anchor is fabricated**.

`--blind` reuses the public leaderboard's anonymizer (one shared definition in
`web-result-consumer.js`, same loader the longitudinal report uses), so the
anchor view can be shown on the public surface without leaking identity — the
delta math survives anonymization unchanged.

## Fairness posture

- **Additive, presentation-layer**: no existing score, judge record, or
  scoreboard changes behavior. The anchor is a read-only view — allowed
  mid-season under the no-reweighting / no-retroactive-rescoring invariants.
- **Same contract, both directions**: the human packet is held to the agents'
  rules (evidence discipline, oracle isolation, secret redaction), and agents
  are read against the human line with a fixed, documented threshold.
- **Known limits** (from the capability declaration): human baselines are
  slower, non-deterministic, and operator-dependent. They are a *reference
  line*, not a volume participant; multiple baselines per task family is
  future work.

## Fixtures

`make human-baseline-fixtures` (`npm run test:human_baseline_fixtures`)
exercises, from committed fixtures under `fixtures/human-baseline/`:

- the worked **ops-001 filled template** finalizing into a valid
  `human_baseline` packet that **fingerprints as human-baseline**;
- three negative templates, each rejected **for the right reason**: an
  unresolved `FILL_ME`, an oracle reference, a raw secret value;
- the anchor delta math and flags on a fixture scoreboard (+15 over / −20
  under / +5 comparable, no-baseline task not fabricated), and the **blind**
  anchor leaking no real participant identity while preserving the deltas.

The suite runs inside `make validate`, so CI gates it on every PR.

## Related

- [Participant eligibility](participant-eligibility.md) — the class table
- [Capability declaration](../fixtures/adapters/capabilities/human-baseline.yaml)
- [Scoring headroom plan](scoring-headroom-plan.md) — why an absolute anchor
- [Public leaderboard](public-leaderboard.md) — blind rules the anchor reuses
- [Judge harness](judge-harness.md) — scores the human packet like any other
