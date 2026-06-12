# Season 001 Live Runner (local_exec transport)

`scripts/live-runner.js` implements the Minimum Live Runner Contract defined in
[live-runner-boundary-season-001.md](live-runner-boundary-season-001.md) for
the **local_exec** transport: it dispatches a round's tasks to participants by
spawning operator-configured argv commands, enforces the timeout/cancel/status
contract, captures and redacts artifacts, fans results in with safety checks,
and produces a judge handoff package per clean run.

> Boundary honesty: this is the dry-run/source-only slice of the live runner.
> There is **no network code** in this repository. Live A2A/network transports
> remain an operator configuration/extension point, and credential-bearing
> runs are gate-blocked unless operator approval AND a passing readiness
> declaration are present.

## Usage

```bash
# Full pipeline: gates → dispatch → capture → fan-in → judge handoff
node scripts/live-runner.js run rounds/season-001-round-001.yaml \
  --config fixtures/live-runner/runner-config-season-001-dryrun.yaml

# Dispatch only (gates → dispatch → capture)
node scripts/live-runner.js dispatch <round-manifest> --config <runner-config> \
  [--run-directory <dir>] [--run-id <substr>] [--dry-run-only] \
  [--allow-runtime-mismatch]

# Fan-in + judge handoff over an existing live-runner runs directory
node scripts/live-runner.js fanin runs/live-runner/season-001-round-001/

# Fixture suite (also wired as `make live-runner-fixtures` /
# `npm run test:live_runner_fixtures`)
node scripts/live-runner.js fixtures
```

Exit codes: `0` success, `1` validation/runtime error, `2` a lifecycle or
approval gate refused dispatch, `130` cancelled by SIGINT.

## Runner config format

The runner config is an operator-supplied per-round YAML file validated
against `schemas/runner-config.schema.json` plus hand-rolled checks. Example
(`fixtures/live-runner/runner-config-dryrun.yaml`):

```yaml
schema_version: 1
config_kind: agent-olympics.live-runner.config
runner_id: season-001-live-runner-dryrun
round_manifest: fixtures/live-runner/round-live-runner-fixture.yaml
run_directory: runs/live-runner-fixtures/round-901/   # never collide with round.js dirs
tasks: [ops-001, ops-002]                              # optional task filter
participants:
  - participant_id: sogyo          # must match an agent_id in the round manifest
    adapter: hermes                # adapter label — MUST match the manifest
                                   # participant's runtime (runtime_identity gate)
    transport: local_exec          # the only implemented transport
    execution_profile: dry_run     # dry_run | live
    identify_command:              # optional runtime attestation probe (argv,
      - hermes                     # same placeholder/no-shell rules as command)
      - --version
    command:                       # argv array — spawned directly, NEVER a shell
      - node
      - adapters/hermes-adapter.js
      - '{envelope}'
      - --run-dir
      - '{run_dir}'
      - --agent-id
      - '{agent_id}'
      - --seed
      - '{seed}'
```

Command placeholders (substituted per argv element, no shell interpolation):
`{envelope}` `{run_dir}` `{agent_id}` `{run_id}` `{task_id}` `{round_id}`
`{time_limit_minutes}` `{seed}`. Shell metacharacters in command arguments are
rejected by config validation. The same rules apply to the optional
`identify_command` (runtime attestation probe, see below).

A `live` participant additionally requires (all enforced as gates):

```yaml
  - participant_id: nodeX
    adapter: openclaw
    transport: local_exec
    execution_profile: live
    readiness_declaration: fixtures/live-runner-readiness/<declaration>.yaml
    credentials:
      credential_class: gateway_session     # class only
      handling: reference_only              # the runner never reads values
      ref: secret-provider://agent-olympics/gateway-session   # handle, not a value
      participant_may_read: false
    approval:
      approver: operator-handle
      approval_ref: https://github.com/.../issues/NNN
    command: [...]
```

`time_limit_ms_override` (per participant) overrides the enforced wall-clock
limit for tests/operator drills; the dispatch record records which source the
enforced limit came from.

## Contract mapping

| Contract section | Implementation |
|---|---|
| 1. Dispatch | Participants are selected from the round manifest (config participants must exist there). Each run gets an isolated `run-{task_id}-{agent_id}-{timestamp}` directory under the configured run directory (round.js `run_id_template` conventions) with a round.js-style run lifecycle `manifest.yaml` and a `dispatch-record.yaml` carrying round/run/task/participant ids, adapter label, source revision (`git rev-parse HEAD`, falling back to the fixture bundle ref), start timestamp, time limit, and the allowed/forbidden action boundary copied from the envelope's public fields. |
| 2. Credential injection | `live` profile only, by reference. The dispatch record stores credential class, handling, the value-free reference handle, approver + approval ref, whether the participant may read the credential, and the value-free redaction rule list. `dry_run` records `credential_class: none`. The runner never resolves, reads, or stores credential values; only the reference string is exported to the child env (`AGENT_OLYMPICS_CREDENTIAL_REF`). |
| 3. Timeout/cancel/status | The envelope/task time limit (or override) is enforced with SIGTERM + SIGKILL grace. SIGINT cancels: the active child is terminated, in-flight runs are finalized, remaining runs are not dispatched. Mapping: exit 0 → `completed`; timeout/cancel with a usable packet → `partial`; timeout/cancel without → `failed`; unspawnable transport (ENOENT) or missing credentials → `blocked`; secret exposure / oracle leak / exit-0-without-packet → `disqualified`. |
| 4. Artifact capture | `capture-report.yaml` per run verifies presence or explained absence of: result packet, trace record, evidence bundle, artifact manifest, envelope copy, run manifest/metadata, adapter stdout/stderr summary (`runner-transport.log`, captured by the runner and redacted before writing), and safe logs. If an adapter emits its own artifact manifest at `manifest.yaml`, the runner's lifecycle manifest moves to `run-manifest.yaml` and the capture report notes it. |
| 5. Result fan-in | Each packet/trace/bundle is validated via `scripts/validate.js`; identity must match the dispatch record (`task_id`/`agent_id`, plus the packet's `runtime`/`adapter` labels vs the dispatched adapter, plus trace/bundle internal `run_id` consistency); participant-facing files are scanned for oracle references (`oracle/` paths, `oracle_ref`, `hidden_judge_notes`) and secret values/fields (`scripts/lib/secret-patterns.js`); finding/trace evidence id references must resolve; runtime attestation and artifact-fingerprint discrepancies are surfaced as warnings (see "Runtime identity verification"). Rejects are moved to `quarantine/<run-id>/` with a `quarantine-reason.yaml`; clean runs proceed to handoff. Missing `content_ref` files are recorded as warnings (same severity competition-validity.js assigns the simulation adapters). |
| 6. Safety redaction | Transport stdout/stderr is redacted with `SECRET_VALUE_PATTERNS` + secret-named `key: value` lines **before** anything is written to disk. `redaction-report.yaml` records rule id + reason + match count — never the original value. A secret in transport output also disqualifies the run (secret exposure). |
| 7. Judge handoff | `judge-handoff/` per clean run: validated result packet, trace, evidence bundle (+ `evidence/` content files), `envelope-public.yaml` (hidden_judge_notes / judge_notes_ref / oracle_ref / v1_compat stripped), run metadata, redaction report, and a handoff manifest with the rubric reference. Oracle/judge-notes paths are intentionally **not** copied into run directories; judges resolve them from the round manifest task entry. The assembled package is secret-scanned; a leak removes the package and quarantines the run. |
| 8. Lifecycle gates | Before any dispatch: round manifest schema validation (`scripts/validate.js`), a stub smoke run per distinct task envelope, and the per-participant `runtime_identity` gate (config `adapter` must match the manifest participant's `runtime`; `--allow-runtime-mismatch` downgrades to a recorded warning). Before any `live` dispatch: operator approval present in config AND the participant's readiness declaration passes `scripts/live-runner-readiness.js` with decision `ready` — otherwise dispatch is refused before any transport is spawned (exit code 2). Artifact validation gates the judge handoff (fan-in), and the redaction check gates the handoff package. |

## Runtime identity verification

Runtime/adapter identity used to be declaration-only ("Operator-supplied") and
was declared in three places that could silently disagree: the round manifest
`participants[].runtime`, the runner config `participants[].adapter`, and the
result packet's `runtime`/`adapter` fields. Divisions and scoreboards compare
by runtime, so a silent disagreement is a competition-integrity gap. The
runner now checks identity in three layers:

**Layer 1 — declaration consistency (deterministic).**

- Dispatch gate `runtime_identity`: for every selected participant the runner
  config `adapter` must match the round manifest participant's `runtime`
  (case-insensitive; the manifest registration is authoritative). A mismatch
  refuses dispatch for that participant (exit code 2, nothing spawned).
  `--allow-runtime-mismatch` downgrades the refusal to a recorded warning:
  the gate records status `warn`, the dispatch record's `runtime_identity`
  block notes the operator override, and fan-in surfaces it as a warning.
- Fan-in: the packet's `runtime` (and `adapter`, if present) must match the
  dispatch record's adapter label — a mismatch quarantines the run with a
  reason, the same severity as an `agent_id` mismatch.

**Layer 2 — runtime attestation probe (opt-in).**

A participant may declare `identify_command` (argv array, same placeholder
and no-shell rules as `command`). The runner runs it at dispatch, before the
main transport, with a ~10s timeout, redacts the captured stdout with the
shared secret patterns, and records in the dispatch record:

```yaml
runtime_attestation:
  command_ran: true
  exit_code: 0
  output_excerpt: Hermes Agent v0.16.0 ...   # first ~200 chars, redacted
  declared_adapter: hermes
  consistent: true
```

`consistent` is a case-insensitive substring heuristic: the probe output
should mention the declared adapter name (e.g. "Hermes Agent v0.16.0"
contains "hermes"). An inconsistent or failed probe is a **recorded
warning** in the dispatch and fan-in reports — never a refusal, because
probes can be flaky. Without `identify_command` the record is
`runtime_attestation: { command_ran: false }` and no warning is raised.

**Layer 3 — artifact fingerprinting (heuristic).**

`scripts/lib/runtime-fingerprint.js` exports
`fingerprintRuntime(packet, trace) -> { detected, confidence, signals[] }`
with `detected` in `hermes | openclaw | stub | unknown`. It looks at the
SHAPE of the artifacts, not their labels: hermes → non-empty
`delegation_profile.a2a_workers`, `workflow_plan`/`worker_trace`/
`commander_report` evidence kinds, orchestrator/coordinator mode; openclaw →
`session_id`/`gateway_*`/`tool_call_summary`/`delivery_probe` evidence
kinds, openstack/closedstack/human_baseline mode, gateway/telegram evidence
ids; stub → `ev-stub-*` evidence ids, the stub summary marker, stub
agent/runtime labels. A non-unknown verdict requires at least two distinct
signals (and strictly more than any other candidate). Fan-in runs it on
every clean-candidate run: `detected` ≠ declared adapter (and ≠ `unknown`)
produces a **WARNING** in the fan-in report — never a quarantine — and the
verdict + signals are copied into the judge handoff manifest
(`runtime_fingerprint`) so judges see the discrepancy.

> **Honesty caveat:** all three layers catch *honest misconfiguration*
> (mislabeled registrations, wrong runner-config entries, copy-pasted
> adapter blocks) — not adversarial spoofing. A malicious wrapper can fake
> the declaration, echo the right attestation string, and shape its
> artifacts to any fingerprint. Cryptographically attested runtimes
> (signed adapter builds, hardware/TEE attestation) are out of scope for
> Season 001 and listed as future work.

## Failure taxonomy

Live runs quarantine or disqualify packets for qualitatively different reasons
— a flaky backend, citation-discipline collapse under load, an oracle-boundary
violation, an identity inconsistency — but historically every rejection was an
opaque free-text string in `quarantine-reason.yaml`. To make the leaderboard a
*diagnostic* and not just a ranking (the repo's "measure the operating agent
stack, including operating principles" charter — see
[scoring-headroom-plan.md](scoring-headroom-plan.md)), each rejection is now
tagged with a standard classification code.

`scripts/lib/failure-taxonomy.js` is the single source of truth. It exports the
ordered category list, a `classifyReason(reason) -> code` mapper (robust
substring/keyword matching, `UNCLASSIFIED` fallback), and aggregation helpers.
The runner attaches codes at fan-in *without changing any quarantine decision*
— classification is purely additive metadata.

The diagnostic axis is `kind`: **whose fault was the rejection?**

| Code | Kind | Severity | Description |
|---|---|---|---|
| `BACKEND_TIMEOUT` | stack_reliability | quarantine | Transport timed out / was cancelled / never produced a result packet (stack failure, not model judgement). |
| `MISSING_ARTIFACT` | stack_reliability | quarantine | A required artifact (trace, evidence bundle) is absent even though a packet exists. |
| `EVIDENCE_DISCIPLINE` | discipline | quarantine | A finding or trace entry cites an evidence id that does not resolve. |
| `CONTENT_RESOLUTION` | discipline | quarantine | An evidence item `content_ref` is missing/unresolved or escapes the run directory. |
| `ORACLE_BOUNDARY` | safety | disqualifying | A participant-facing artifact references oracle files / hidden judge notes. |
| `SECRET_EXPOSURE` | safety | disqualifying | A secret value or secret-bearing field appeared in a participant-facing artifact or transport output. |
| `IDENTITY_MISMATCH` | integrity | quarantine | Packet/trace/bundle `agent_id`/`task_id`/`run_id`/runtime label disagrees with the dispatch record. |
| `SCHEMA_INVALID` | integrity | quarantine | An artifact failed schema validation. |
| `MALFORMED_OUTPUT` | integrity | quarantine | An artifact is not parseable YAML. |
| `UNCLASSIFIED` | integrity | quarantine | No category matched — a visible signal to extend the taxonomy. |

Warnings (which never quarantine) get a lighter classification recorded in the
fan-in entry's `warning_categories`: `RUNTIME_FINGERPRINT` (artifact-shape
fingerprint disagrees with the declared adapter) and `ATTESTATION` (attestation
probe / operator-allowed declaration mismatch).

Where the codes appear:

- **`quarantine/<run>/quarantine-reason.yaml`** — keeps the original `reasons`
  free-text array (unchanged, for humans) and adds a `categories` array of
  `{code, kind, count}` for that run.
- **`fanin-report.yaml`** — each run entry gains `categories` (and
  `warning_categories`); a round-level `failure_summary` aggregates
  `{categories: [{code, kind, count}], by_kind, total}` across all rejected
  runs. All existing fields are preserved.
- **Console** — after the fan-in summary line, a one-line breakdown:
  `Rejections by category: IDENTITY_MISMATCH×3, BACKEND_TIMEOUT×2`.
- **`failure-report` command** — the read-only diagnostic surface:

  ```bash
  node scripts/live-runner.js failure-report runs/live-runner/round-001/
  ```

  prints a per-code table (code / kind / count / which runs+participants hit
  it). It reads `fanin-report.yaml` when present, else scans
  `quarantine/*/quarantine-reason.yaml`. It is informational and **always exits
  0**.

> **Honest gap — task drift is not yet directly detected.** A model that
> diagnoses its own runtime environment instead of the assigned fixture is a
> distinct failure mode, but the runner has no positive detector for it today.
> It surfaces indirectly: the self-diagnosis cites evidence ids that do not
> resolve against the fixture, so it is currently classified as
> `EVIDENCE_DISCIPLINE`. A dedicated `TASK_DRIFT` code (and a detector) is
> future work — see [scoring-headroom-plan.md](scoring-headroom-plan.md).

## Run directory layout

```
<run_directory>/
  dispatch-report.yaml          # gates + per-run dispatch outcomes
  fanin-report.yaml             # fan-in decisions per run + failure_summary
  run-<task>-<agent>-<ts>/
    dispatch-record.yaml        # contract §1 + §2 record
    manifest.yaml               # run lifecycle manifest (round.js style) — or the
                                # adapter's artifact manifest, with the lifecycle
                                # manifest at run-manifest.yaml
    envelope.yaml               # public-fields-only envelope given to the participant
    runner-transport.log        # redacted stdout/stderr captured by the runner
    redaction-report.yaml       # value-free redaction metadata
    capture-report.yaml         # artifact presence / explained absence
    result-packet.yaml ...      # participant outputs (adapter contract)
    judge-handoff/              # assembled for clean runs at fan-in
  quarantine/
    run-.../quarantine-reason.yaml   # reasons + taxonomy categories
```

## Reference Hermes local wrapper

The repository includes a reusable reference wrapper for operators who want to
run a participant through the local Hermes CLI while still producing the normal
Agent Olympics artifact set:

- `adapters/wrappers/hermes-mission-wrapper.sh` invokes `hermes chat -Q -q`
  with the public task envelope and participant-facing fixture paths, captures
  the mission answer, and returns runner-compatible exit/status behavior.
- `scripts/hermes-mission-result-merge.js` parses the marker-wrapped mission
  JSON and merges the actual diagnosis, findings, evidence, risk assessment,
  next action, and durable-memory decision into the schema-valid artifacts that
  `adapters/hermes-adapter.js` bootstraps first.

Example dry-run config for one local Hermes participant:

```yaml
schema_version: 1
config_kind: agent-olympics.live-runner.config
runner_id: hermes-instance-001
round_manifest: rounds/season-001-round-001.yaml
run_directory: runs/live-runner/round-001/
tasks: [ops-001]
participants:
  - participant_id: sogyo
    adapter: hermes
    transport: local_exec
    execution_profile: dry_run
    command:
      - bash
      - adapters/wrappers/hermes-mission-wrapper.sh
      - '{envelope}'
      - '{run_dir}'
      - '{agent_id}'
```

Useful environment overrides for the wrapper:

- `AGENT_OLYMPICS_REPO=/path/to/agent-olympics` when invoking the wrapper from
  outside this checkout.
- `HERMES_BIN=/path/to/hermes` when the desired Hermes executable is not first
  on `PATH`.
- `HERMES_EVENT_FAMILY` / `HERMES_MODE` to override the adapter bootstrap's
  event family and mode (defaults `ops` / `orchestrator`).
- `HERMES_NODE` to record the node identity in the packet's comparable
  metadata (operator-supplied; `unknown` when unset).
- `HERMES_INFO_ARGS` to override the model-attestation probe's info
  invocation when the local Hermes prints its `Model:` line under a
  different subcommand.
- `HERMES_MODEL` / `HERMES_MODEL_PROVIDER` as a **fallback only**: the
  wrapper now detects the routed model directly from the Hermes config
  (`scripts/hermes-model-detect.js` parses the `Model:` line from candidate
  info commands). A successful detection wins over the env — a real fleet
  run shipped a wrong env label — and a mismatch between the two prints a
  warning. The packet's probe evidence records `model_source`
  (`hermes_config` / `operator_env` / `unknown`), and unresolved values are
  recorded as `unknown`, never a fabricated skeleton default.

The merge script also overwrites the skeleton's simulated workflow metadata
with the wrapper's real execution shape: a single nested Hermes CLI session
(`delegation_profile.a2a_workers: [local-hermes-cli]`, worker counts of 1) and
the measured wall-clock duration of the Hermes invocation.

The wrapper intentionally uses only participant-facing/public inputs and tells
Hermes not to read oracle files, judge notes, hidden judge notes, or private
answer keys. If Hermes returns non-JSON text, the merge script preserves the raw
output in `mission-result.raw.txt` and writes a fallback result that still
validates, but flags the parse fallback for human review.

## Reference CLI local wrapper (heterogeneous participant)

The same pattern runs a generic coding-agent CLI (Claude Code, Codex, any argv
command) as a live-runner participant, validating that the schemas/gates/scoring
are runtime-neutral rather than Hermes-specific:

- `adapters/wrappers/cli-mission-wrapper.sh` is the CLI analogue of the Hermes
  wrapper. It bootstraps a schema-valid **result-packet v2** baseline with
  `scripts/cli-adapter.js` (labelled `runtime: cli` / `adapter: cli`, solo
  `delegation_profile`, CLI-native evidence kinds), invokes the coding-agent CLI
  via env-configured argv (`CLI_AGENT_BIN`, default `claude`; `CLI_AGENT_ARGS`
  for the run subcommand) with the same marker-wrapped-JSON mission prompt
  contract, merges, validates, and applies the same parse-fallback → partial /
  exit-2 discipline, wall-time measurement, and model attestation.
- The merge logic is **shared** with the Hermes wrapper:
  `scripts/cli-mission-result-merge.js` and
  `scripts/hermes-mission-result-merge.js` are thin profile selectors over
  `scripts/lib/mission-result-merge.js`, which parameterizes the evidence-id set
  and execution shape so both wrappers reuse one implementation (redaction,
  hallucinated-evidence-id normalization, parse-fallback downgrade).
- The mission prompt is also **shared and envelope-driven**:
  `scripts/lib/mission-prompt.js` builds both wrappers' prompts from the task
  envelope — the objective is quoted, the envelope's `forbidden_actions` are
  echoed as constraints, and the JSON contract carries an `outputs` object with
  one key per envelope `required_output` (the merge copies exactly those
  declared keys into the packet, redacted). When the envelope declares
  `environment.repo_path`, that path is a **writable workspace** (file edits
  and the project's own build/test commands are allowed and expected); without
  it the legacy read-only inspection rule stands. This replaced the original
  hardcoded ops-style "read-only diagnosis" prompt, which on code-sprint tasks
  forbade the very work the task required (the voided code-001 r2 run
  diagnosed the planted bug precisely but never touched the workspace —
  a harness defect, not a stack failure). The oracle/secret/destructive-action
  prohibitions are universal and never relaxed by an envelope.
- Model attestation generalizes the Hermes probe:
  `scripts/cli-model-detect.js` (over the shared `scripts/lib/model-detect.js`)
  detects the routed model from the CLI and records `model_source`
  (`cli_config` / `operator_env` / `unknown`).

This is the **simulation / source-only slice**: the committed fixtures point the
wrapper at an offline fake `claude`-like binary
(`fixtures/live-runner/transports/fake-claude-cli.js`); real Claude Code / Codex
live runs are an operator extension. See [CLI participant](cli-participant.md)
for registration, the wrapper env vars, the model-attestation story, and the
runtime-neutrality layers.

## Transport extension point (how an operator points at a real node)

`local_exec` runs any argv command, so a real participant node is reached by
pointing the command at a connector the operator owns — for example an SSH
wrapper for a Hermes node:

```yaml
  - participant_id: hermes-node-1
    adapter: hermes
    transport: local_exec
    execution_profile: live
    readiness_declaration: fixtures/live-runner-readiness/<node-ready>.yaml
    credentials:
      credential_class: ssh_session
      handling: reference_only
      ref: ssh-config-host://hermes-node-1     # an ~/.ssh/config alias, NOT a key
      participant_may_read: false
    approval:
      approver: operator-handle
      approval_ref: <approval issue link>
    command:
      - ssh
      - hermes-node-1                          # alias resolved by the operator's ssh config
      - agent-olympics-adapter
      - --task
      - '{task_id}'
      - --run-id
      - '{run_id}'
```

Rules for any such extension:

- **Credentials by reference only.** The command and config may carry aliases,
  paths, or secret-provider handles — never key material, passwords, or
  tokens. Config validation rejects credential-looking values.
- The connector must write the adapter-contract artifacts into `{run_dir}`
  (or stream them back to it) so capture/fan-in/handoff work unchanged.
- Live profiles stay gate-blocked until operator approval and a `ready`
  readiness declaration exist. A2A/network transport discovery is not owned by
  this repository.

## Fixtures

`fixtures/live-runner/` contains the fixture round manifest, seven runner
configs (including `runner-config-cli.yaml`), and five tiny fixture transports
(including the offline `fake-claude-cli.js`). `node scripts/live-runner.js
fixtures` (Make target `live-runner-fixtures`) exercises:

- dry-run dispatch → fan-in → handoff with hermes + openclaw + stub local_exec
  transports (fixture round manifest, 6 runs) and with sogyo + seoseo + nosuk
  (all hermes) on the committed `rounds/season-001-round-001.yaml`;
- live profile without approval → gate-blocked before dispatch (CLI exit 2);
- mismatched `agent_id` packet → quarantined with a reason file;
- fake secret in transport stdout → redacted stored log + value-free redaction
  metadata + `disqualified`;
- timeout with/without usable output → `partial` / `failed`;
- unspawnable transport (ENOENT) → `blocked`;
- config adapter ≠ manifest runtime → `runtime_identity` gate-refused (exit 2),
  and dispatched-with-warning under `--allow-runtime-mismatch`;
- packet runtime label ≠ dispatched adapter → quarantined at fan-in;
- consistent and inconsistent `identify_command` attestation probes →
  recorded attestation block / recorded warning;
- declared stub but hermes-shaped artifacts → fan-in fingerprint WARNING
  plus `runtime_fingerprint` metadata in the judge handoff manifest;
- a heterogeneous CLI participant (`runtime: cli`) dispatched through
  `cli-mission-wrapper.sh` against an offline fake `claude`-like binary →
  dispatches and completes, the `runtime_identity` gate accepts `cli`, the
  merged packet's runtime/adapter is `cli` (v2, solo delegation), model
  attestation records a source, the layer-3 fingerprint detects `cli`, and the
  run fans in clean with a `cli` fingerprint in the judge handoff manifest;
- failure-taxonomy classification: the `agent_id`-mismatch case →
  `IDENTITY_MISMATCH`, the secret-echo case → `SECRET_EXPOSURE`, the
  missing-packet cases → `BACKEND_TIMEOUT`; `quarantine-reason.yaml` carries
  the matching `categories`; `fanin-report.yaml` carries a `failure_summary`;
  the `failure-report` command prints the taxonomy table (exit 0); and
  `classifyReason` is unit-checked against every observed live reason string.

Fixture run directories are created under a temp directory and removed.
