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
  [--run-directory <dir>] [--run-id <substr>] [--dry-run-only]

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
    adapter: hermes                # adapter/runtime label for the dispatch record
    transport: local_exec          # the only implemented transport
    execution_profile: dry_run     # dry_run | live
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
rejected by config validation.

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
| 5. Result fan-in | Each packet/trace/bundle is validated via `scripts/validate.js`; identity must match the dispatch record (`task_id`/`agent_id`, plus trace/bundle internal `run_id` consistency); participant-facing files are scanned for oracle references (`oracle/` paths, `oracle_ref`, `hidden_judge_notes`) and secret values/fields (`scripts/lib/secret-patterns.js`); finding/trace evidence id references must resolve. Rejects are moved to `quarantine/<run-id>/` with a `quarantine-reason.yaml`; clean runs proceed to handoff. Missing `content_ref` files are recorded as warnings (same severity competition-validity.js assigns the simulation adapters). |
| 6. Safety redaction | Transport stdout/stderr is redacted with `SECRET_VALUE_PATTERNS` + secret-named `key: value` lines **before** anything is written to disk. `redaction-report.yaml` records rule id + reason + match count — never the original value. A secret in transport output also disqualifies the run (secret exposure). |
| 7. Judge handoff | `judge-handoff/` per clean run: validated result packet, trace, evidence bundle (+ `evidence/` content files), `envelope-public.yaml` (hidden_judge_notes / judge_notes_ref / oracle_ref / v1_compat stripped), run metadata, redaction report, and a handoff manifest with the rubric reference. Oracle/judge-notes paths are intentionally **not** copied into run directories; judges resolve them from the round manifest task entry. The assembled package is secret-scanned; a leak removes the package and quarantines the run. |
| 8. Lifecycle gates | Before any dispatch: round manifest schema validation (`scripts/validate.js`) and a stub smoke run per distinct task envelope. Before any `live` dispatch: operator approval present in config AND the participant's readiness declaration passes `scripts/live-runner-readiness.js` with decision `ready` — otherwise dispatch is refused before any transport is spawned (exit code 2). Artifact validation gates the judge handoff (fan-in), and the redaction check gates the handoff package. |

## Run directory layout

```
<run_directory>/
  dispatch-report.yaml          # gates + per-run dispatch outcomes
  fanin-report.yaml             # fan-in decisions per run
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
    run-.../quarantine-reason.yaml
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

The wrapper intentionally uses only participant-facing/public inputs and tells
Hermes not to read oracle files, judge notes, hidden judge notes, or private
answer keys. If Hermes returns non-JSON text, the merge script preserves the raw
output in `mission-result.raw.txt` and writes a fallback result that still
validates, but flags the parse fallback for human review.

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

`fixtures/live-runner/` contains the fixture round manifest, four runner
configs, and three tiny fixture transports. `node scripts/live-runner.js
fixtures` (Make target `live-runner-fixtures`) exercises:

- dry-run dispatch → fan-in → handoff with hermes + openclaw + stub local_exec
  transports (fixture round manifest, 6 runs) and with hermes + openclaw on
  the committed `rounds/season-001-round-001.yaml`;
- live profile without approval → gate-blocked before dispatch (CLI exit 2);
- mismatched `agent_id` packet → quarantined with a reason file;
- fake secret in transport stdout → redacted stored log + value-free redaction
  metadata + `disqualified`;
- timeout with/without usable output → `partial` / `failed`;
- unspawnable transport (ENOENT) → `blocked`.

Fixture run directories are created under a temp directory and removed.
