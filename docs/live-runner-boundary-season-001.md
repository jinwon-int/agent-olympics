# Season 001 Live Runner and A2A Boundary

> Status: Season 001 boundary decision for #191.
> Scope: source documentation only. This document does not authorize live dispatch, credential movement, provider sends, release, or public visibility changes.

## Decision

Season 001 remains **manual/source-only plus stub/dry-run executable** until a separate live runner contract is implemented and approved.

Agent Olympics owns the platform-neutral competition surface:

- task envelopes
- result packets
- judge records
- rubrics
- adapter execution contract
- run directory and artifact shape
- validation and competition-validity checks
- source-only reference adapters and stub execution tools

The live runner is a separate execution boundary. It may live in this repository later, in a companion runner package, or in an external A2A broker/runner integration, but it must not be hidden inside an adapter-specific document or treated as already present.

OpenClaw/A2A is one possible adapter and transport path, not the competition's privileged execution model. The same runner boundary must be able to represent OpenClaw, Hermes, CLI agents, scripted baselines, and human baselines through the same task/result/judge surface.

## Current Mode

| Capability | Season 001 status | Notes |
|---|---|---|
| Task and result schemas | Ready for source validation | v1/v2 schemas exist and are validated by `scripts/validate.js`. |
| Adapter contract | Ready as source contract | The contract defines participant input/output behavior, not a complete live runner. |
| Stub execution | Ready for dry-run checks | `scripts/stub-adapter.js` exercises result/trace/evidence generation without live credentials. |
| Source-only CI round gate | Ready for stub lifecycle checks | `make ci-round` proves validate, init, stub execution, scoring, and competition-validity without live credentials. |
| Live runner readiness gate | Source-defined | `scripts/live-runner-readiness.js` blocks credential-bearing live dispatch unless approval, reference-only credentials, transport, timeout/cancel, fan-in, redaction, and judge handoff are ready. |
| OpenClaw/Hermes adapters | Reference/source implementations | They describe and simulate runtime-specific evidence, but are not an approved live connector boundary by themselves. |
| Dry-run dispatch / fan-in / judge handoff | Implemented via local_exec transport | `scripts/live-runner.js` implements the contract below for argv-spawned local commands: dispatch records, credential-by-reference records, timeout/cancel/status mapping, artifact capture, fan-in with quarantine, log redaction, and judge handoff packages. See `docs/live-runner.md` and `make live-runner-fixtures`. |
| Live A2A network dispatch | Not implemented here | No network code, transport discovery, or credential handoff exists in this repo. Real nodes are reachable only as operator-configured local_exec connectors (e.g. an ssh wrapper), and credential-bearing runs stay gate-blocked without operator approval plus a `ready` readiness declaration. |
| Automated blind judging | Partially source-defined | Judge records and oracle separation exist; the live runner now produces a judge handoff package per clean run, but judging itself remains the judge harness's manual/hybrid flow. |

## Minimum Live Runner Contract

A future live runner must define these behaviors before Season 001 can be called live-runner automated.

> Status note: `scripts/live-runner.js` implements sections 1–8 for the
> **local_exec** transport (dry-run/source-only dispatch of argv commands).
> Live A2A/network transport and credential-bearing dispatch remain
> unimplemented/gate-blocked — Season 001 is still not "live-runner
> automated". See `docs/live-runner.md` for the implementation mapping.

### 1. Dispatch

The runner must select participants from a round manifest, provide the task envelope, create an isolated workspace, and start the participant through its adapter.

The dispatch record must include:

- `round_id`
- `run_id`
- `task_id`
- `participant_id`
- adapter/runtime label
- source revision or fixture bundle reference
- start timestamp
- time limit
- allowed and forbidden action boundary

### 2. Credential Injection

Credentials may be passed only by reference, path, or approved secret provider handle. Credential values must not be committed, logged, printed in PRs, embedded in fixtures, or copied into result artifacts.

The runner must record:

- which credential class was made available
- who approved the run
- whether the participant was allowed to read the credential
- value-free redaction rules used for captured logs

### 3. Timeout, Cancel, and Status Mapping

The runner must enforce the envelope time limit, support cancellation, and map live execution outcomes to standard packet statuses:

| Runner outcome | Result packet status |
|---|---|
| Completed with required outputs | `completed` |
| Timed out with usable partial output | `partial` |
| Timed out without usable output | `failed` |
| Missing credentials or unreachable runtime | `blocked` |
| Forbidden action, oracle leak, or secret exposure | `disqualified` |

### 4. Artifact Capture

Every live run must produce or explain the absence of:

- result packet
- trace record
- evidence bundle
- artifact manifest
- input envelope copy
- run manifest or run metadata
- adapter stdout/stderr summary
- safe logs or transcript excerpts
- file diffs or command summaries when relevant

Artifacts must be stored under the run directory contract and validated before judging.

### 5. Result Fan-in

The runner must collect participant outputs, validate schemas, run competition-validity checks, and hand only safe participant-facing material to scoring.

Fan-in must reject or quarantine:

- missing result packets
- mismatched `run_id`, `task_id`, or `agent_id`
- participant-facing oracle references
- secret-bearing fields or values
- evidence references that do not resolve

### 6. Safety Redaction

The runner must redact logs before preservation. Redaction metadata must describe the rule and reason without recording the original value.

Forbidden content includes:

- tokens, keys, passwords, private keys, session cookies
- private endpoint values not approved for publication
- raw secret-provider output
- oracle or hidden judge material in participant-facing artifacts

### 7. Judge Handoff

The runner must separate participant material from judge-only material. Oracle files, hidden judge notes, and answer keys may be used by scoring or judge tooling, but they must never be available to participant adapters during execution.

The judge handoff package should include:

- validated result packet
- validated trace and evidence bundle
- rubric reference
- task envelope public fields
- run metadata
- redaction report

### 8. Lifecycle and Approval Gates

Live automation requires explicit gates:

| Gate | Required before |
|---|---|
| Source/schema validation | Any dry-run or live run |
| Stub smoke success | New adapter or task fixture promotion |
| Operator approval | Credential-bearing live run |
| Runner readiness check | Dispatch to live participants |
| Artifact validation | Judge handoff |
| Redaction check | Publication or PR attachment |

The source-only readiness gate can be run with:

```bash
npm run live-runner:readiness -- fixtures/live-runner-readiness/blocked-missing-approval.yaml --expect blocked
npm run live-runner:readiness -- fixtures/live-runner-readiness/dry-run-ready.yaml --expect ready
```

The blocked fixture proves that a credential-bearing live run stops before
dispatch when approval or transport readiness is missing. The dry-run fixture
proves that stub/source-only execution can be marked ready without credential
access.

## Related Trackers

| Issue | Role after this boundary decision |
|---|---|
| #180 | First verified baseline. It can proceed as manual/source-only or trusted CLI/stub baseline evidence, but it should not be treated as proof that a live automated runner exists. |
| #182 | Universal participant adapter eligibility. It should define participant readiness and adapter smoke criteria against the neutral contract. |
| #191 | This boundary decision: what Agent Olympics owns, what a live runner must own, and what remains source-only. |
| #192 | Source-only implementation tracker for live runner boundary components. The first slice is `scripts/live-runner-readiness.js`; full live dispatch remains unapproved until a separate transport runner is implemented and approved. |

Issue #192 should split into implementation sub-issues when work starts for:

- live runner package or service ownership
- A2A transport/discovery integration
- credential injection and approval handling
- timeout/cancel/status control
- artifact fan-in and validation
- judge orchestration and oracle isolation

## Non-goals

This document does not:

- dispatch a live participant
- move or read credential values
- choose a production A2A endpoint
- implement transport discovery
- publish a leaderboard
- declare stub results as live results
- make OpenClaw/A2A mandatory for all competitors

## Acceptance Mapping for #191

| Acceptance sketch | Resolution |
|---|---|
| A finalizer can tell whether Season 001 is manual/source-only, semi-automated, or live-runner automated. | Season 001 is manual/source-only plus stub/dry-run executable until the live runner contract is implemented and approved. |
| Required live-runner components are tracked with owners/issues. | Required components are listed above; implementation should be split into follow-up issues before live automation is claimed. |
| No credentials or live endpoints are embedded in repo docs or fixtures. | This document records only value-free credential handling rules and no endpoint values. |
