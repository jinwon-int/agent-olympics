# Fleet Evaluation Gate (Q-set)

> Related issue: [#325](https://github.com/jinwon-int/agent-olympics/issues/325) ·
> Wiki roadmap TM-2370 P1 / TM-4444 ① · ccc-node#2462 G1

The fleet changes skills, hooks, prompts and A2A verdict rules often, but has no
gate that answers "did this change make things better or worse?" with a number.
This document defines the **held-out evaluation set (Q-set)**, the **run record**,
the **judges**, the **runner contract** and the **gate rule**. This repository owns
the Q-set and the runner; the gate itself runs in the caller's CI (fleet-skills,
ccc-node).

External evaluation products (promptfoo, Braintrust, LangSmith, …) are not
installed — only their ideas are borrowed (owner decision 2026-11-06, external
dependency principle). The validator and runner use the dependencies this
repository already has (`ajv`, `ajv-formats`).

## Status

| Slice | Content | State |
|---|---|---|
| 1 | Item and run record schemas, validator, this design, one seed item per family | done (#326) |
| 2a | `scripts/fleet-eval.js` runner (`run`, `gate`) with the rule judge, `stub` and `command` adapters, tests | done (#327) |
| 2b | 43 active items (10–12 per family, every family gated), stub outputs passing all of them | this PR |
| 2c | First recorded baseline run on `main` (real model calls, operator-run) | next |
| 3 | llm judge pilot on one family (target lane ≠ judge lane), results recorded | next |
| 4 | Gate wiring PRs in fleet-skills `validate.yml` and ccc-node (observe with `continue-on-error`, then enforce) | next |

## Layout

```
fixtures/fleet-eval/
  qset-record.schema.json      # one Q-set item
  run-record.schema.json       # one judged attempt
  qset/<family>/*.jsonl        # the Q-set (one item per line)
  runs/<runId>.jsonl           # recorded runs (body-free), runId = <YYYY-MM-DD>-<sha>[-<suffix>]
  examples/*.jsonl             # format examples, validated like runs
  stub/*.json                  # fixed outputs for the stub adapter (runner tests, CI)
scripts/validate-fleet-eval.js # schema + cross-field validation (npm test, make validate)
scripts/fleet-eval.js          # runner (run) and gate (gate)
```

## Q-set item

One JSON object per line, schema `fleet-eval-qset-v1`.

| Field | Meaning |
|---|---|
| `id` | `<family>-NNN`; never reused after an item is retired |
| `family` | must equal the directory name and the id prefix |
| `version` | bump on any change to `input` or `expected`; runs record the version they scored |
| `status` | `active` counts toward the gate; `draft` and `retired` do not |
| `input.prompt` / `input.context` | the situation given to the target. **No credential material and no personal contact data** — the validator refuses both |
| `input.outputFormat` | `text` or `json`; `outputHint` states the json shape asked for |
| `judge` | `rule` (deterministic) or `llm` (rubric, other lane) |
| `expected.checks` | required for `rule` items |
| `expected.rubric` | required for `llm` items: `id`, `criteria[]`, `passScore` |
| `source` | at least one Wiki ID, issue, PR, file or session the item came from |
| `added_at`, `caveats`, `tags` | bookkeeping |

### Families

| Family | Asks the target to … | Typical checks |
|---|---|---|
| `hande-reply` | write a 한데 reply that needs an owner decision | answer-block header, numbered options, a `(권장)` mark, no credential material (ccc-node#2665) |
| `skill-select` | name the one skill a situation calls for | `json_equals skill` against the ccc-node / fleet-skills catalog at a cited commit |
| `a2a-verdict` | judge a review packet | `json_equals verdict`, `json_includes_all findings`, `json_excludes_all` for invented findings |
| `phone-intent` | allow or deny a phone-agent sentence | `json_equals decision`, risky words per iphone-agent-cast `SIRI_RISKY` (#160) |

A family is **gated only when it has at least 8 active items**. Smaller families
are run and reported but cannot fail the gate — with fewer items one flaky item
moves the pass rate by more than 12 points.

### Rule checks

Checks are evaluated in order against the target output. For `text` items the
output string is used as-is. For `json` items the output must parse as a JSON
object (after stripping one surrounding Markdown code fence); otherwise the
attempt is `fail` with `error.type = unparseable_output`, **every** check is
recorded as not ok and `score` is 0.

| `op` | Passes when |
|---|---|
| `regex` | `new RegExp(pattern, flags)` matches the output text (raw string, also for json items) |
| `not_regex` | it does not match |
| `json_equals` | the value at `path` is strictly equal to `value` |
| `json_in` | the value at `path` is one of `values` |
| `json_includes_all` | the value at `path` is an array containing every entry of `values` |
| `json_excludes_all` | the value at `path` is an array containing none of `values` (a missing path counts as an empty array) |

`path` is a dotted key path (`review.verdict`); array indexing is not supported
on purpose — items that need it should ask for a flatter output shape.
A `rule` attempt passes only if **every** check passes; `score` is the fraction of
checks that passed.

## Judges

- **rule** is the default. It is deterministic, cheap and cannot be argued with.
- **llm** scores `expected.rubric.criteria` (each met / not met); `score` is the
  fraction met and the attempt passes when `score ≥ passScore`. The judge **must
  run on a different model lane than the target** (for example target
  `claude-code`, judge `codex`). LLM self-evaluation was measured at 46.4 %
  accuracy in ccc-node#2462, so same-lane judging is refused by the validator.
  The judge sees the item and the output, never the target's reasoning.

## Run record

One JSON object per judged attempt, schema `fleet-eval-run-v1`, appended to
`fixtures/fleet-eval/runs/<YYYY-MM-DD>-<short sha>.jsonl`. Records are
**body-free**: the target output is never stored, only `outputSha256` and
`outputChars`, plus per-check `ok` flags. The validator cross-checks every
record against the Q-set:

- `itemId`, `family`, `itemVersion` and `judge.kind` match the item;
- a rule record lists one outcome per item check, in order, and `verdict = pass`
  exactly when every outcome is `ok`;
- an `llm` record names `judge.lane` and `judge.model`, and the lane differs
  from `target.lane`;
- `verdict = error` carries `error.type` (`timeout`, `adapter_error`,
  `unparseable_output`, `judge_error`).

## Runner contract (slice 2a)

`scripts/fleet-eval.js` (CommonJS like the rest of `scripts/`, so lint and
Prettier already cover it; the issue's `tools/fleet_eval/run.mjs` path was
changed for that reason). No new dependencies.

```
node scripts/fleet-eval.js run \
  --target-lane <lane> --target-model <model> \
  --adapter stub --stub-outputs <file.json>
  | --adapter command --command <bin> [--command-arg <arg>]...
  [--family <f>]... [--attempts 3] [--timeout-ms 120000]
  [--out fixtures/fleet-eval/runs] [--qset-commit <sha>] [--run-suffix <s>] [--qset-dir <dir>]
node scripts/fleet-eval.js gate --baseline <run.jsonl> --candidate <run.jsonl> [--json] [--qset-dir <dir>]
```

Exit codes: `0` run written / gate passed, `1` gate failed, `2` usage or input
error (nothing is written and no adapter is called).

- `run` loads and validates the Q-set, selects active `rule` items (optionally
  by `--family`), sends each item's prompt to the target `--attempts` times,
  judges every attempt and writes the records to `<out>/<runId>.jsonl`.
  `runId` is `<UTC date>-<qsetCommit>[-<run-suffix>]`; `qsetCommit` defaults to
  `git rev-parse --short=7 HEAD`. An existing run file is never overwritten —
  record another run with a different `--run-suffix`. Every record is checked
  against the run schema and the validator's cross-field rules before the file
  is written. `llm` items are listed as skipped until slice 3.
- **Prompt.** The target receives `input.prompt`, then `상황 자료:` +
  `input.context` when present, then for `json` items one line asking for a
  single JSON object in the `outputHint` shape (`buildPrompt`).
- **Adapters** return the final output text or an error type:
  - `stub` — fixed outputs per item id from a JSON object: a string (every
    attempt), an array (one entry per attempt, the last repeats) or
    `{ "error": "timeout" }` / `{ "error": "adapter_error" }`. An id missing
    from the file is an `adapter_error`. CI uses only this adapter
    (`fixtures/fleet-eval/stub/seed-pass.json` passes every seed item).
  - `command` — spawns `<bin> [args]` **without a shell**, writes the prompt to
    stdin and reads stdout as the output. A non-zero exit, a spawn failure or
    more than 1 MiB of output is an `adapter_error`; exceeding `--timeout-ms`
    kills the process and records `timeout`. stderr is discarded. This is the
    only path that calls a model; any credentials are the wrapped CLI's own
    concern and never pass through the runner or the run file.
  - The heavier [adapter-execution-contract.md](adapter-execution-contract.md)
    (task envelopes, result packets) is not used: a Q-set item is one prompt and
    one answer. Only its exit-code idea (success / failure / timeout) carries over.
- Model calls only happen when an operator runs `run --adapter command`
  explicitly. This repository's own CI validates fixtures and runs the runner
  tests with the stub adapter only.

## Gate rule

1. Each active item is attempted **3 times**; the item **passes when at least 2
   of 3 attempts pass**. (With 8–12 items per family, confidence intervals are
   too wide to be useful; repeated attempts absorb sampling noise instead.)
   `error` attempts count as failures but are reported separately so an outage
   is not mistaken for a regression. With a different attempt count the item
   needs `ceil(2/3 × attempts)` passes.
2. Family pass rate = passing items / comparable items in that family (see 3).
3. **Baseline** = the most recent run recorded from `main` for the same target
   lane. Items whose `version` differs between baseline and candidate, or that
   are new, are excluded from the comparison and listed. `gate` refuses a
   baseline and candidate on different target lanes, and a run file that mixes
   run ids or lanes.
4. The gate **fails** when any gated family's pass rate is lower than the
   baseline, or the overall pass rate is lower than the baseline (tolerance 0).
   "Overall" counts the comparable items of **gated** families only, so a family
   below 8 active items still cannot fail the gate. A comparable baseline item
   of a gated family that the candidate did not run also fails the gate, so a
   run cannot pass by skipping a family with `--family`.
5. Rollout: callers add the gate with `continue-on-error: true` first, record
   two weeks of results, then enforce. Gate numbers are recorded in the Wiki
   roadmap (TM-4444) when enforcement starts.

## Out of scope

Self-improvement loops (autoresearch-style nightly edit → evaluate) build on this
gate and get their own issue. Dashboards, hosted evaluation services and model
speed/price benchmarks are out of scope.

## Running the validator

```
npm run validate:fleet_eval     # or: make validate-fleet-eval
node --test test/fleet-eval.test.js test/fleet-eval-runner.test.js
```

## Running the runner without a model

```
node scripts/fleet-eval.js run --target-lane stub --target-model stub-fixed \
  --adapter stub --stub-outputs fixtures/fleet-eval/stub/seed-pass.json \
  --out /tmp/fleet-eval-runs --run-suffix smoke
node scripts/fleet-eval.js gate --baseline /tmp/fleet-eval-runs/<runId>.jsonl \
  --candidate /tmp/fleet-eval-runs/<runId>.jsonl
```

Use a scratch `--out` for trial runs; only a deliberate baseline or candidate
run belongs in `fixtures/fleet-eval/runs/`.
