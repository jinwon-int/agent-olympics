# Coordination Events (Two-Stage A2A)

A coordination event is a multi-node A2A round where worker nodes independently
produce evidence and a finalizer node merges them into a single result, scored
against a solo baseline. It is implemented as a **thin orchestration layer over
the single-participant live runner** (`scripts/live-runner.js`) — it does not
fork or re-implement dispatch, artifact capture, fan-in, redaction, or identity
logic. The orchestrator is `scripts/coordination-round.js`.

This closes the gap between the charter's promise of coordination events where
multiple agents actually collaborate and the previous state, where coord-001
was scored as a single finalizer merging a fixture of pre-written contradictory
reports.

## The two-stage model

```
                 ┌─────────────────────────────────────────────┐
  worker stage   │  worker[0] ─┐                                │
  (probe         │  worker[1] ─┤  each runs the PROBE envelope   │
   envelope)     │  worker[N] ─┘  via the live runner (1 packet) │
                 └───────────────┬─────────────────────────────┘
                                 │  collect participant-facing findings
                                 │  (oracle-scanned before injection)
                                 ▼
                 ┌─────────────────────────────────────────────┐
  finalizer      │  finalizer runs the MERGE envelope via the   │
  stage          │  live runner. Worker findings are injected   │
  (merge         │  as a PUBLIC `worker_reports` envelope field.│
   envelope)     └───────────────┬─────────────────────────────┘
                                 │
  solo baseline  ┌───────────────▼─────────────────────────────┐
                 │  soloAgent runs the MERGE envelope ALONE     │
                 │  (no injected worker findings)               │
                 └─────────────────────────────────────────────┘
                                 │
                                 ▼
            A2A-effectiveness record (validated against the
            standing benchmark schema) + judge handoff for the
            finalizer's commander-report packet.
```

1. **Worker stage** — Each of `N` worker participants runs a *probe* task
   envelope (independent investigation of the same question) through the live
   runner, producing one result packet per worker. There is no shared
   scratchpad; workers investigate independently.

2. **Finalizer stage** — One finalizer participant runs a *merge* task envelope
   whose participant-facing input includes the workers' findings. The
   finalizer produces a single commander-report packet.

3. **Solo baseline** — One participant runs the whole task (the merge envelope,
   with no injected worker findings) alone. This is the comparison point for
   the *was-delegation-worth-it* signal.

## Manifest format

A coordination round is declared by a sibling schema,
`schemas/coordination-round.schema.json` (`config_kind:
agent-olympics.coordination-round`), **not** the round-manifest schema. It is
intentionally not a round manifest — the orchestrator synthesizes a per-stage
round manifest + runner config from it and hands each pair to the live runner.
Keeping it separate avoids the round-manifest auto-detector
(`round_id + season + lifecycle + tasks + participants`) and its strict
`additionalProperties: false` schema.

The fixture is
`fixtures/coordination/coordination-round-coord-001.yaml`. Key fields:

| Field | Meaning |
|---|---|
| `coordination.mode` | `team1` (workers produce evidence, finalizer selects/closes) or `a2a_crosscheck` (finalizer works, workers audit). Maps to the A2A-effectiveness taxonomy. |
| `coordination.worker_probe` | The probe task envelope each worker runs. |
| `coordination.merge` | The merge task envelope the finalizer (and solo baseline) runs. |
| `coordination.workers[]` | Worker participants (agent_id, runtime, adapter, local_exec `command`). |
| `coordination.finalizer` | The finalizer participant. |
| `coordination.solo_baseline` | The solo-baseline participant. |
| `round_id` | Base round id used for the synthesized per-stage round manifests (so judge-handoff round attribution is stable). |
| `scoring_rubric` | Rubric the finalizer packet is scored against by the judge harness. |
| `task_type` | `taskType` for the emitted A2A-effectiveness record. |

Each participant's `command` is a `local_exec` argv template using the same
placeholder set the live runner allows (`{envelope}`, `{run_dir}`,
`{agent_id}`, `{run_id}`, `{task_id}`, `{round_id}`,
`{time_limit_minutes}`, `{seed}`). No shell strings.

The fixture uses the existing coord-001 v2 envelope for both stages: workers run
it under the Hermes `general` event family (independent investigation), and the
finalizer/solo run it under the Hermes `coord` event family (commander report).

## How worker findings are injected without leaking oracle

The whole point of the injection path is that it carries **only participant-facing
worker findings** — never oracle answer keys or hidden judge notes.

1. Worker findings are read from each clean worker run's **judge-handoff result
   packet** (`summary` + `findings[].claim/confidence`). The judge handoff is
   already the public, sanitized, fan-in-cleared view — it never contains the
   oracle (`oracle/season-001/coord-001-commander-report.yaml`) or judge notes
   (`docs/judge-notes-season-001.md`), which live only in the season round
   manifest for the judge tooling.

2. The assembled `worker_reports` object is scanned with the **same**
   oracle-reference scan (`scanTextForOracleReferences`) and secret-field scan
   (`scanObjectForSecretFields`) the live runner exports and applies to
   participant-facing artifacts. Any `oracle/`, `oracle_ref`,
   `hidden_judge_notes`, or credential-looking value blocks the injection.

3. The findings ride into the finalizer as a **public `worker_reports` field**
   on a synthesized merge-envelope copy. The live runner then re-sanitizes that
   envelope (stripping `oracle_ref`, `judge_notes_ref`, `hidden_judge_notes`,
   `v1_compat`) and, at fan-in, re-scans the participant-facing envelope copy
   for oracle references. The orchestrator additionally asserts the finalizer's
   `envelope.yaml` copy is oracle-clean.

This is defense-in-depth: the source of the findings is already public, and the
injection is scanned before and after it lands in the finalizer's run.

## Scoring linkage

No new scoring rubric is invented. Scoring reuses the existing harness:

- The finalizer's commander-report packet is a **normal result packet**
  assembled into a judge handoff (`finalizer/.../judge-handoff/`) by the live
  runner's fan-in. It is scored by `scripts/judge.js` against the merge
  envelope's `scoring_rubric` and the coord-001 oracle — exactly as any
  single-participant coord-001 submission would be.
- The **A2A-effectiveness record** adds the orthogonal *was-delegation-worth-it*
  signal: independent findings surfaced by workers that the solo path missed,
  boundary findings, and avoided follow-up. It is validated against
  `fixtures/a2a-effectiveness/a2a-effectiveness-record.schema.json` (the same
  schema `scripts/validate-a2a-effectiveness.js` uses) and follows the modes
  and metrics in `docs/a2a-effectiveness-benchmark.md`.

## Simulated-vs-live honesty boundary

The fixture run is a **simulated/dry-run coordination**: all three stages run
through the live runner's `local_exec` simulation transport (the Hermes
simulation adapter). There is **no network, no live A2A dispatch, no credential
movement, and no production mutation**. Accordingly the emitted A2A record uses
`validity: diagnostic` and its caveats state that this is not a matched
solo-vs-A2A live trial.

Real multi-node live execution is an **operator extension** that reuses the live
runner's remote transport and its live-profile gates (operator approval +
`live-runner-readiness.js`). The coordination orchestrator does not add any
network code; promoting a coordination round to live would swap the simulation
`command` argv for the operator's live transport and would upgrade the record's
validity beyond `diagnostic`.

## Running it

```bash
# Offline fixture suite (2 workers + 1 finalizer + 1 solo baseline on coord-001)
make coordination-fixtures
# or
npm run test:coordination_fixtures

# Run an arbitrary coordination manifest (output under runs/coordination/<id>/)
node scripts/coordination-round.js run \
  fixtures/coordination/coordination-round-coord-001.yaml --verbose
```

Fixture output is written to the gitignored `runs/` tree and cleaned up after
the suite.
