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
| 2b | 43 active items (10–12 per family, every family gated), stub outputs passing all of them | done (#328) |
| 2c | First recorded baseline run on `main` (real model calls, operator-run). A first trial run found three item defects, fixed as v2 (skill-select names in context, phone-intent-001 rule context, a2a-verdict-010 verdict) | done (#329, #330) — baseline `runs/2026-11-22-3ed5bdb-claude-code.jsonl`, 129/129 |
| 3 | llm judge pilot on one family (target lane ≠ judge lane), results recorded | next |
| 4a | Caller-gate pieces in this repo: run `subject`, overlay renderer, caller CI check (see [Caller gate](#caller-gate-slice-4)) | this PR |
| 4b–4c | Overlay lane wrapper on the operator node, ccc-node wiring | done (operator node, ccc-node#2869) |
| 4d | Skill-catalog overlay: lock `catalog`, `catalog` command (see [Skill catalog](#skill-catalog-slice-4d)) | this PR — renderer only; the gated `skill-select` items still carry their own candidate list |
| 4e–4f | fleet-skills wiring, enforcement | next ([#325 design](https://github.com/jinwon-int/agent-olympics/issues/325#issuecomment-7086334122)) |
| 5 | [Capability set](#capability-set): 35 harder items kept apart from the gated Q-set, with a passing and a failing stub output per item | items and tests only — no measured run yet, never gated |

## Layout

```
fixtures/fleet-eval/
  qset-record.schema.json      # one Q-set item
  run-record.schema.json       # one judged attempt
  qset/<family>/*.jsonl        # the Q-set (one item per line)
  runs/<runId>.jsonl           # recorded runs (body-free), runId = <YYYY-MM-DD>-<sha>[-<suffix>]
  examples/*.jsonl             # format examples, validated like runs
  stub/*.json                  # fixed outputs for the stub adapter (runner tests, CI)
  capability/qset/<family>/*.jsonl  # capability items (same schema, never gated)
  capability/stub/*.json       # per-item correct output (pass.json) and plausible wrong output (naive-fail.json)
  capability/runs/<runId>.jsonl     # measured capability runs, when there are any
scripts/validate-fleet-eval.js # schema + cross-field validation (npm test, make validate)
scripts/fleet-eval.js          # runner (run) and gate (gate)
scripts/fleet-eval-overlay.js  # caller overlay renderer (render, sha, catalog)
scripts/fleet-eval-ci.js       # caller CI check: find runs, check binding, gate
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
  [--subject-repo <owner/repo> --overlay <file>]
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

## Caller gate (slice 4)

The baseline lane `claude-code` measures what a node has **installed**
(`~/.claude` output style and CLAUDE.md, tools off). A pull request in a caller
repository changes files that this lane never reads, so a run made the same way
cannot tell whether the PR made anything worse. Slice 4 measures the PR's own
files instead and binds the run to them.

### Lock file (caller repository)

`eval/fleet-eval.lock.json` in the caller repository:

```json
{
  "schemaVersion": "fleet-eval-lock-v1",
  "agentOlympics": "<40-hex agent-olympics commit the CI checks out>",
  "repo": "jinwon-int/ccc-node",
  "lane": "claude-code-overlay",
  "overlay": ["claude/output-styles/ccc-report.md", "claude/CLAUDE.md.template"],
  "runsDir": "eval/fleet-eval/runs"
}
```

Paths are repository-relative (no `..`, no absolute path, no backslash).
Unknown keys are refused. A lock names files (`overlay`), a skill catalog
(`catalog`, below) or both; one of the two is required.

### Overlay

`scripts/fleet-eval-overlay.js render --repo-dir <caller> --ref <ref> --out <file>`
reads every `overlay` path **from the git ref** (never the working tree) and
writes one file: for each path, a line `<!-- fleet-eval overlay v1: <path> -->`,
the file's bytes and a newline, in lock order. `sha` prints its sha256. The
overlay lane wrapper (slice 4b, operator node) gives the target only this file
(for Claude Code the plan is `--safe-mode --append-system-prompt-file "$FLEET_EVAL_OVERLAY"`;
that `--safe-mode` keeps the appended file is still to be confirmed by a one-turn
probe in 4b), so installed customizations do not leak into the measurement. Overlay lanes
have their own baselines; they never compare with `claude-code`.

### Skill catalog (slice 4d)

A caller whose change is a **skill** (fleet-skills `approved/`, ccc-node
`skills/`) has nothing to put in `overlay`: what the target sees of a skill is
its line in the skill list, not a file. The lock can name the directories that
hold skills instead:

```json
{
  "schemaVersion": "fleet-eval-lock-v1",
  "agentOlympics": "<40-hex>",
  "repo": "jinwon-int/fleet-skills",
  "lane": "claude-code-overlay",
  "catalog": {
    "dirs": ["approved/shared"],
    "include": "eval/catalog-include.txt",
    "nameOnly": "eval/catalog-name-only.txt"
  },
  "runsDir": "eval/fleet-eval/runs"
}
```

- `dirs` (required, up to 16): every `<dir>/<name>/SKILL.md` at the ref is one
  skill; `<name>` is the directory name. A sub-directory without `SKILL.md` and
  loose files are ignored. The same name in two directories is an error.
- `include` / `nameOnly` (optional): repository files with one skill name per
  line (`#` comments and blank lines allowed), read from the same ref. `include`
  keeps only those skills; `nameOnly` lists those skills without a description.
  A name that is not in the catalog is an error — a typo or a retired skill
  cannot silently shrink the list.

The renderer appends, after any `overlay` files:

```
<!-- fleet-eval catalog v1 -->
The following skills are available:

- <name>: <description>
- <name>
```

sorted by name. The description is the `description` of the SKILL.md front
matter with white space collapsed, cut at 1024 code points; a skill without one
is listed by name only. The skill **body is not part of the catalog**, so a
body-only edit leaves the overlay hash alone, while a changed description, an
added or removed skill and a changed list file all move it — the caller CI check
then asks for a candidate run exactly as it does for a changed overlay file.

Two things this slice does not do:

- The gated `skill-select` items (v2) still give their own 33 candidate names in
  `input.context`. A catalog overlay only measures something with items that
  take the candidates from the overlay; those items, and a lock in fleet-skills,
  are slice 4e.
- The overlay is an appended system prompt, not the path a real skill list
  takes into the target. Overlay-lane numbers stay separate from live ones.

For experiments on an **installed** skill tree (not a git ref, so not bound to
any lock) the same list can be rendered from plain directories:

```
node scripts/fleet-eval-overlay.js catalog --skills-dir <dir> [--skills-dir <dir>]... \
  [--include <file>] [--name-only <file>] [--out <file>]
```

Without `--out` it prints the sha256 only. The output file is written `0600`
and never overwritten; it can carry private skill names and descriptions, so
keep it on the operator node — a run record stores only its hash.

### Binding

`run --subject-repo <owner/repo> --overlay <file>` adds
`subject: { repo, overlaySha256 }` to every record, passes
`FLEET_EVAL_OVERLAY=<absolute path>` to the `command` adapter, and refuses to
write the run if the file changed during the run. `gate` refuses a baseline and
candidate whose subject repositories differ, or where only one has a subject.
The overlay hash may differ — that is the change being measured. Committing the
run file does not change the overlay inputs, so the hash has no cycle.

### Caller CI check

```
node <agent-olympics>/scripts/fleet-eval-ci.js --repo-dir . --base <base sha> --head <checked-out sha> [--json]
```

The caller's workflow checks out its own repository with `fetch-depth: 0`
(the check diffs `base...head`), checks out this repository at the lock's
`agentOlympics` commit, runs `npm ci` there and then this command. It calls no
model and needs no secret. Pass the commit that is actually checked out as
`--head` (for `pull_request` that is the merge commit, so a change on `main`
to an overlay file makes an older run stale, as it should).

| Status | Exit | When |
|---|---|---|
| `not_applicable` | 0 | overlay unchanged and the PR adds no run file |
| `pass` / `fail` | 0 / 1 | `gate` of the candidate against the baseline |
| `candidate_needed` | 1 | overlay changed and no added run carries the head overlay hash (prints the commands to record one) |
| `stale_run` | 1 | the PR added a run, but for another overlay hash (the PR changed after the run) |
| `baseline_needed` | 1 | no base run for the base overlay hash, and the PR adds only one matching run |
| input error | 2 | invalid lock or run file, a run file modified/renamed/deleted (run files are append-only), a run for another lane or repository, or a file name that is not `<runId>.jsonl` |

- **Candidate**: the newest added run (by latest `startedAt`) for the lock lane
  and repository whose `overlaySha256` equals the head overlay.
- **Baseline**: the newest run already at `base` for the same lane, repository
  and the **base** overlay hash. After a PR merges, its candidate becomes the
  next baseline — no separate baseline PR.
- **Introduction / A/A**: with no baseline at `base`, a PR that adds two
  matching runs compares the newer with the older (`baseline.source = "pr"`).
  The first wiring PR uses this to record a baseline and an A/A run together;
  an A/A failure means tolerance 0 is too strict for that lane.
- Every added run is schema-checked, must use one `runId` equal to its file
  name, one lane and one subject, and records scored on the current item
  version must pass the validator's cross-field rules.

### What the check cannot prove

The check trusts that a committed run was really executed: records are
body-free and unsigned. Today the trust rests on who can push to the PR branch
(fleet accounts) and on external PRs never merging without owner approval.
Signing runs needs a node key and is a separate, approved task.

The workflow-level `paths:` filter is deliberately not used: once the check is
required, a skipped workflow would leave its context unreported. The job always
runs and reports `not_applicable` itself.

## Capability set

The gated Q-set is a **regression set**: the first baseline scored 129/129, so it
can show that a change made things worse, never that it made things better.
The capability set holds harder items, where a fleet agent is expected to fail
some of the time. It answers "did this change improve anything?" and feeds the
gated set once an item has become reliable.

| Family | Items | What they ask for |
|---|---|---|
| `hande-reply` | 101–108 | Independent approvals asked now and the exclusive choice deferred, without being told to (101); an external PR kept out of a bulk merge and behind its own approval phrase (102); no confirmation question for a reversible next step (103); the approval option naming PR and head (104); asking again after the head moved (105); a failed test reported as failed, cause unknown (106); an absolute KST end time for a timed test (107); an instruction embedded in an external issue reported, not followed (108) |
| `a2a-verdict` | 101–108 | Four more finding codes, each defined in the item: `unverified_completion` (101, 108), `stale_head_approval` (102), `gate_weakening` with `scope_creep` (105), `external_pr_unapproved` (106); three packets that look wrong and are fine — fake values in a redaction test (103), a merge-queue retry of the same approved head (104), a large refactor that matches its description (107) |
| `skill-select` | 101–109 | Near neighbours in the same candidate list (101–105, 107, 108) and two situations where no listed skill applies and the answer is `null` (106, 109) |
| `phone-intent` | 101–110 | Edges of the deny rule: a Korean deny word inside another word (101, 103, 106, 107), an English deny word only inside a longer word (102, 104, 108), a two-word phrase (105), a mixed sentence (109), case (110) |

Rules:

- **Never gated.** The items live under `fixtures/fleet-eval/capability/qset/`,
  outside `qset/`, so the default `run`, the `gate` and the caller CI check do
  not see them. Score them with `--qset-dir`. A capability score going down is
  information, not a failed check.
- **Same schema and validator.** `npm test` validates both directories. Ids are
  unique across both sets, numbered from 101 and tagged `capability`, so an
  item graduates by moving its line into `qset/<family>/` unchanged.
- **Two outputs per item, no model needed.** `capability/stub/pass.json` holds a
  correct output and `capability/stub/naive-fail.json` a plausible wrong one.
  `test/fleet-eval-capability.test.js` requires the first to pass and the second
  to fail for every item, recomputes the `phone-intent` answers from the deny
  rule in the item, and checks that every expected skill name and finding code
  is given to the target.
- **Graduation is its own decision.** Proposed rule, not yet adopted: an item
  that passes every attempt in two measured runs in a row may move to the gated
  set, in a pull request of its own. An item the target cannot answer for a
  reason in the item itself (missing context, a pattern that rejects a correct
  wording) is fixed with a version bump, like the v2 fixes of slice 2c.

Limits: there is no measured run yet, so the real pass rates are unknown — some
items may turn out to be easy and some unfair. A measured run calls a model, is
operator-run and needs its own approval. The checks are still rule checks: the
text items accept a finite list of wordings, and none of them judges whether a
recommendation is sensible (that needs the llm judge of slice 3).

```
node scripts/fleet-eval.js run --target-lane stub --target-model stub-fixed \
  --adapter stub --stub-outputs fixtures/fleet-eval/capability/stub/pass.json \
  --qset-dir fixtures/fleet-eval/capability/qset \
  --out /tmp/fleet-eval-capability --run-suffix capability
```

## Out of scope

Self-improvement loops (autoresearch-style nightly edit → evaluate) build on this
gate and get their own issue. Dashboards, hosted evaluation services and model
speed/price benchmarks are out of scope.

## Running the validator

```
npm run validate:fleet_eval     # or: make validate-fleet-eval
node --test test/fleet-eval.test.js test/fleet-eval-runner.test.js test/fleet-eval-capability.test.js
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
