# A2A Effectiveness Benchmark

> Related issue: [#205](https://github.com/jinwon-int/agent-olympics/issues/205)

Agent Olympics can host a standing, source-only benchmark for the question:
when is A2A better than solo execution?

This benchmark does not treat A2A as a speed leaderboard. It records whether
delegation produced quality-adjusted closeout value: independent findings,
boundary review, avoided follow-up, lower finalizer uncertainty, or better
evidence than a comparable solo path.

## Modes

Records distinguish four treatments:

| Mode | Meaning |
|---|---|
| `solo` | One finalizer performs analysis, change, validation, and closeout. |
| `a2a_crosscheck` | One finalizer performs the work; one or more workers audit the evidence or output before closure. |
| `team1` | Workers independently produce evidence or candidate outputs; one finalizer selects and closes. |
| `hybrid` | The finalizer owns the implementation path while bounded workers inspect specific risks or alternatives. |

## Record Ownership

Agent Olympics records benchmark truth: task family, frozen source snapshot,
mode, participants, metrics, judge/outcome, follow-up state, and caveats.

`a2a-broker` records operational provenance: pre-dispatch decision packets,
worker readiness, queue/start/done timestamps, task ids, status transitions,
raw evidence pointers, and finalizer identity.

## Required Fields

Each record is one JSON object in a JSONL file under
`fixtures/a2a-effectiveness/records/`.

Records must include:

- `sampleId`, `benchmarkVersion`, `repo`, `taskType`, `mode`, and `validity`.
- participant attribution: `finalizer`, optional `soloAgent`, and worker ids.
- source/follow-up/repair links when applicable.
- milestones using ISO 8601 timestamps or `null` when unknown.
- metrics for time, workers, findings, false Done/Block, finalizer effort,
  follow-up/reopen, and boundary findings.
- confirmed defects and boundary findings with repair/outcome links.
- an outcome decision and benchmark-validity caveats.

The schema is
`fixtures/a2a-effectiveness/a2a-effectiveness-record.schema.json`.

## Core Metrics

| Metric | Meaning |
|---|---|
| `timeToEvidenceSeconds` | First useful worker/solo evidence minus work start. |
| `timeToDecisionSeconds` | Work start to finalizer decision. |
| `timeToCloseoutSeconds` | Work start to issue/PR closeout. |
| `activeFinalizerSeconds` | Active finalizer effort reconciling evidence, PRs, CI, comments, and closeout. |
| `totalAgentSeconds` | Sum of finalizer and worker execution time when known. |
| `workerCount` | Distinct A2A workers/subagents contributing evidence. |
| `foundDefectsCount` | Candidate defects reported by solo or workers. |
| `confirmedDefectsCount` | Defects accepted by the finalizer or repaired by issue/PR. |
| `falseDoneCount` | Done reports that missed required evidence or produced no valid change. |
| `falseBlockCount` | Block/failed states where useful evidence was actually present. |
| `followupIssueCount` | Follow-up issues opened because of the sample. |
| `reopenCount7d` | Reopen/follow-up count after seven days; use `null` until the window is complete. |
| `boundaryFindingCount` | Approval, live-dispatch, credential, visibility, deploy/restart, Terminal ACK, or source-only boundary findings. |

## Value Rule

The benchmark favors quality-adjusted utility:

```text
A2A value = confirmed unique findings + boundary findings + avoided reopens
            - false positives - rework penalty - boundary violations
```

Wall time, active finalizer time, and total agent time stay separate. A2A can
be useful while slower if it catches a material issue or reduces finalizer risk.

## Seed Record

The first record is `agent-olympics-47-a2a-crosscheck-001`.

In that sample, solo closeout for
[`#47`](https://github.com/jinwon-int/agent-olympics/issues/47) was
substantively correct, but a later A2A cross-check found that the close comment
over-cited `docs/references.md` as already containing an MLPerf/MLCommons
summary. Follow-up
[`#203`](https://github.com/jinwon-int/agent-olympics/issues/203) and repair PR
[`#204`](https://github.com/jinwon-int/agent-olympics/pull/204) added the
missing reference entry and parity mirror.

This seed is a historical replay, not a matched live trial. It proves one
useful A2A-only defect catch, but it does not by itself prove broad A2A
efficiency.

## Validation

Run:

```bash
npm run validate:a2a_effectiveness
```

The validator parses each JSONL row, validates it against the schema, checks
sample id uniqueness, and reports a summary.

## Boundary

This benchmark is source-only. Records may cite GitHub issues, PRs, logs, and
redacted worker evidence. They must not trigger live A2A dispatch, provider
send, deploy/restart, DB mutation, credential movement, Terminal ACK/replay,
release publication, repo visibility changes, or worker-owned GitHub mutation.
