# Test Event Venue Readiness

> Related issue: [#39](https://github.com/jinwon-int/agent-olympics/issues/39)

Season 001 treats each event family as a venue. A venue is not a physical place;
it is the field of play the agent uses for that event: a repo fixture, node
sandbox, web surface, wiki worktree, ops evidence pack, adapter, or judge
harness.

Test events are diagnostic. They do not award medals, seed rankings, or final
scores. Their purpose is to prove the venue can be reset, executed, judged,
captured, and amended before score-bearing rounds.

## Venue Map

| Venue | Field of Play | Primary Gates |
|---|---|---|
| Ops Relay | log/config fixture plus result packet | fixture reset, secret scan, evidence capture |
| Node Readiness | node profile or sandbox snapshot | adapter health, capability matrix, redaction |
| Performance Trial | controlled workload and scoreboard path | timer capture, resource metadata, publication gates |
| Code Sprint | repo fixture and test runner | clean checkout, patch diff, targeted tests |
| Wiki Marathon | wiki worktree and transcript pack | source refs, PR path, no direct production edits |
| Safety Trial | approval/refusal scenario pack | forbidden-action gates, redaction, policy trace |
| Coordination Drill | multi-report evidence pack | attribution, contradiction handling, final owner record |
| Tool Decathlon | bounded tool budget scenario | budget capture, trace completeness, result packet fields |
| Harness Reliability | interrupted/stale run fixture | recovery path, visible final delivery, durable evidence |

The [A2A effectiveness benchmark](a2a-effectiveness-benchmark.md) is a
diagnostic, non-scoring Coordination Drill venue. Its JSONL records capture
solo-vs-A2A samples, finalizer/worker attribution, quality findings, false
Done/Block counts, follow-up state, and no-live boundary findings before any
score-bearing A2A claims are made.

## Go/No-Go Gates

Before a test event may begin:

1. Fixture reset: `node scripts/validate.js fixtures` passes and every selected
   fixture has a documented reset or generation path.
2. Adapter health: the selected adapter has a capability declaration or sample
   fixture, and any live-runner path is blocked unless approval/transport gates
   pass.
3. Judge harness: `node scripts/validate.js oracle`, relevant verifier scripts,
   and scoring paths pass locally.
4. Result capture: the runner can emit a result packet, trace, evidence bundle,
   and run manifest into the configured output directory.
5. Secret boundary: participant-facing artifacts contain no oracle material,
   credential values, or raw host-specific metadata.
6. Failure mode: the operator has a stop/retry/retire decision path for failed
   setup, adapter timeout, hidden-material leak, invalid packet, or judge
   disagreement.
7. A2A effectiveness records: if the venue is an A2A benchmark replay or
   comparison, `npm run validate:a2a_effectiveness` passes and the record
   states whether it is historical replay, matched group, prospective, or
   diagnostic evidence.

The source command layer is:

```bash
make dry-run-readiness
make dry-run-execute-validate
make dry-run-publication
```

## Failed Test Events

A failed test event changes the official season pack before score-bearing runs:

- Fixture reset failure: update the fixture bundle manifest or generation
  instructions, then rerun the same test event.
- Hidden-material leak: retire the affected fixture version, rotate the hidden
  variant, and record the leak as a mismatch issue.
- Adapter health failure: keep the event diagnostic-only until the adapter
  fixture or capability declaration passes.
- Judge harness failure: update the oracle, verifier, or scorecard before any
  official run uses that task.
- Result capture failure: block publication and update the run/result schema or
  runner path before finalization.

No task may move from `draft` to `smoke` or `verified` solely because source
files exist. Promotion requires a completed test event or trusted baseline run
with captured evidence and resolved mismatches.
