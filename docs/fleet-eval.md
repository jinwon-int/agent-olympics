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
| 1 | Item and run record schemas, validator, this design, one seed item per family | this PR |
| 2 | 30–50 active items (8–12 per family), `scripts/fleet-eval.js` runner with the rule judge, first recorded run | next |
| 3 | llm judge pilot on one family (target lane ≠ judge lane), results recorded | next |
| 4 | Gate wiring PRs in fleet-skills `validate.yml` and ccc-node (observe with `continue-on-error`, then enforce) | next |

## Layout

```
fixtures/fleet-eval/
  qset-record.schema.json      # one Q-set item
  run-record.schema.json       # one judged attempt
  qset/<family>/*.jsonl        # the Q-set (one item per line)
  runs/<YYYY-MM-DD>-<sha>.jsonl  # recorded runs (body-free)
  examples/*.jsonl             # format examples, validated like runs
scripts/validate-fleet-eval.js # schema + cross-field validation (npm test, make validate)
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
attempt is `fail` with `error.type = unparseable_output`.

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

## Runner contract (slice 2)

`scripts/fleet-eval.js` (CommonJS like the rest of `scripts/`, so lint and
Prettier already cover it; the issue's `tools/fleet_eval/run.mjs` path was
changed for that reason).

```
node scripts/fleet-eval.js run \
  --target-lane <lane> --target-model <model> --adapter <adapter> \
  [--family <f>]... [--attempts 3] [--timeout-ms 120000] [--out fixtures/fleet-eval/runs/]
node scripts/fleet-eval.js gate --baseline <run.jsonl> --candidate <run.jsonl>
```

- Loads active items, calls the target through an adapter that follows
  [adapter-execution-contract.md](adapter-execution-contract.md) (the item's
  `input` is sent as the prompt; the adapter returns the final output text),
  judges each attempt, appends run records and prints a family summary.
- A `stub` adapter returning fixed outputs ships with the runner so CI can test
  the runner without any model call.
- Model calls only happen when an operator or a caller workflow runs `run`
  explicitly. This repository's own CI validates fixtures and runner tests only.

## Gate rule

1. Each active item is attempted **3 times**; the item **passes when at least 2
   of 3 attempts pass**. (With 8–12 items per family, confidence intervals are
   too wide to be useful; repeated attempts absorb sampling noise instead.)
   `error` attempts count as failures but are reported separately so an outage
   is not mistaken for a regression.
2. Family pass rate = passing items / active items in that family.
3. **Baseline** = the most recent run recorded from `main` for the same target
   lane. Items whose `version` differs between baseline and candidate, or that
   are new, are excluded from the comparison and listed.
4. The gate **fails** when any gated family's pass rate is lower than the
   baseline, or the overall pass rate is lower than the baseline (tolerance 0).
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
node --test test/fleet-eval.test.js
```
