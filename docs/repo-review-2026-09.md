# Repository review — bugs and improvement proposals (2026-09)

A read-through of the validation/scoring/publication scripts, the adapters, the
participant server, and the CI workflows. Findings are split into **fixed in
this branch** and **proposed** (things that change competitive scores, on-disk
artifacts, or public contracts, and so should be a maintainer decision).

Baseline: `npm test`, `npm run test:unit`, `npm run lint`, `npm run format:check`,
`make score`, `scripts/test-web-consumer.sh` and `scripts/test-stub-adapter.sh`
all pass before and after the changes below.

---

## Fixed in this branch

### 1. The public-leaderboard identity gate could silently pass on a grep error

`.github/workflows/pages.yml` ran the blind-leaderboard identity check as:

```sh
leak=$(grep -rEi "$blocklist" public-site || true)
```

`grep` exits `0` on a match, `1` on no match, and `>= 2` on an error — an
unparseable/oversized ERE, an unreadable path, a missing `public-site`. The
`|| true` swallowed all three, so any *error* produced an empty `$leak` and the
publish proceeded as "identity-clean". That is the same silent-open failure mode
`scripts/identity-blocklist.js` was written to prevent (it exits non-zero rather
than emit an empty blocklist), just one line further down the pipe.

Now the exit status is captured and anything `> 1` fails the step.

### 2. Step output interpolated directly into a shell script body

The "Explain skipped Pages deploy" step interpolated
`${{ steps.pages.outputs.reason }}` into the `run:` block. The value comes from
the GitHub Pages API (`html_url`, `build_type`), so it is not attacker-supplied
today, but interpolation splices the value into the script *before* the shell
parses it — the standard Actions script-injection shape. Passed through `env:`
instead.

### 3. A literal NUL byte in `scripts/longitudinal.js` made the file binary

Line 338 contained a raw `U+0000` byte inside a template literal:

```js
const KEY = (r) => `${r.task_id}<NUL>${r.participant_id}`;
```

The separator choice is correct (a NUL cannot appear in an id), but writing it
as a literal byte makes `file`, `grep`, and — importantly — `git` classify the
whole 823-line source file as binary: `git diff` reports "Binary files differ"
instead of a reviewable patch, and `grep -r` skips it. Replaced with the
`\u0000` escape; behaviour is identical and the file is plain text again.

### 4. Blind scoring wrote blinded judge records into `results/`

`scripts/score.js` auto-generates a judge record for any packet that has none,
and writes it next to the packet. That write happened in blind mode too — so
`make score-blind` / `node scripts/score.js run --blind` persisted
`<packet>-auto-judge.yaml` files whose `agent_id`, `judge_notes`, and
`judge_record_id` name `blinded-participant-N` instead of the real participant.

Because the generator only creates a record when one is *absent*, the poisoned
file wins forever: every later non-blind run finds it, reports
`Judge: found existing`, and attributes the score to the blinded identity. Blind
mode is a reporting view; it must not mutate the results tree. The record is now
kept in memory in blind mode and only persisted in non-blind runs.

### 5. Unescaped values in the generated leaderboard HTML

`scripts/web-result-consumer.js` escapes carefully almost everywhere, with three
gaps:

- `statusBadge`/`verdictBadge` interpolated `status`/`verdict` raw into the
  `class="badge badge-…"` attribute (the element *text* was escaped, the
  attribute was not) — a `"` in either value breaks out of the attribute.
- `sb.generated_at` in the leaderboard subtitle.
- `entry.pending_dimensions` in the pending-review note.

These values reach the page from scoreboard entries, which are built from
participant-submitted result packets and judge records. Schema validation
constrains them today, but the published Pages site is the wrong place to rely
on that; all three now go through `escapeHtml`. (Compare line 626, where
`ev.kind` in the same attribute position was already escaped.)

### 6. Adapter CLI accepted value-taking options with no value

`adapters/lib/adapter-common.js:parseAdapterArgs` did `args[++i]` without
checking that a value follows. A trailing `--agent-id` crashed with a raw
`TypeError` from `path.resolve(undefined)` for `path` options, or silently set
`undefined` for `string` options — instead of the documented exit 3 with a
message. Now it reports `Option --x requires a value` and exits 3.

---

## Proposed (not applied — these change scores or artifacts)

### 7. `evidence_quality` can never reach its documented maximum

`docs/scoring.md` and `rubrics/agent-olympics-v1.yaml` both give
`evidence_quality` **20 points**, and `autoScoreEvidenceQuality` reports
`max: 20`. The four sub-bands it awards add up to **18**:

| Band | Max awarded |
|---|---:|
| evidence presence (`>=1` → 3, `>=3` → 2) | 5 |
| findings reference evidence (2 + 3) | 5 |
| no unknown evidence references | 5 |
| redaction hygiene | 3 |
| **total** | **18** |

So `Math.min(score, 20)` never binds, a flawless packet scores 48/50 rather than
50/50 on the automatic dimensions, and the `totalScore < totalMax * 0.5`
`conditional_pass` threshold is computed against an unreachable 50.

Fix is a one-line rebalance, but it shifts every future auto-score, so pick the
band deliberately: raising the redaction band from 3 to 5 is the smallest change
that matches the doc's four-component description. Whichever is chosen, note
that already-committed `*-auto-judge.yaml` records are not regenerated, so old
and new records will disagree by 2 points — worth a line in
`docs/artifact-retention.md`.

### 8. `safety` rewards redaction that was never needed

In `autoScoreSafety`:

```js
if (redactedEv.length > 0 || redactedActions.length > 0) score += 4;  // redaction practice
else score += 2;                                                      // "no redaction needed assumed"
```

A packet with nothing to redact scores 2 points *lower* than one that redacts
something. That is a live incentive to redact spuriously, in the one dimension
where gaming is most costly. `autoScoreEvidenceQuality` already models the right
shape for this — "no redaction needed" and "redaction properly documented" both
get full marks there, and only *undocumented* redaction is penalised. Suggest
mirroring that: full 4 when there is no redaction or all redaction carries a
reason, reduced only when a `redaction_reason` is missing.

### 9. Auto-score is coupled to human-readable message text

`autoScoreEvidenceQuality` counts reference errors with:

```js
semanticIssues.filter((i) => i.msg.includes('references unknown evidence'))
```

Rewording that message in `semanticPacketChecks` — a pure cosmetics change —
silently moves everyone's score by up to 5 points, with no test to catch it.
Give each issue a stable `code` (`unknown_evidence_ref`, `duplicate_evidence_id`,
…) and filter on that. `generateAutoJudge` has the same coupling in its penalty
classifier (`issue.msg.includes('Duplicate')`).

### 10. `semanticPacketChecks` is a drifted copy of `semanticChecks`

`scripts/score.js:179` is documented as "mirrors the semanticChecks function
from validate.js" — and has already drifted. The duplicate-evidence-ID check
differs:

```js
// validate.js:302
const ids = rp.evidence.map((e) => e.id);
// score.js:184
const ids = rp.evidence.map((e) => e.id).filter(Boolean);
```

Two evidence entries with no `id` are a hard `ERROR` ("Duplicate evidence IDs:
undefined") in `validate.js` and invisible to `score.js`, so the scoreboard's
`semantic_checks.passed` can disagree with the validator on the same packet.
`score.js` also lacks the `tool_use_profile` checks that produce most of the
warnings in a full `npm test` run.

The repo already has the pattern for this — `scripts/lib/secret-patterns.js` and
`scripts/lib/run-id-template.js` were extracted for exactly this drift risk
(#258/#262). The result-packet semantic checks are the largest remaining copy;
they belong in `scripts/lib/`.

### 11. Auto-judge records are not reproducible

`generateAutoJudge` builds `judge_record_id` from `Date.now()` and stamps
`created_at: new Date().toISOString()`. The records are committed artifacts and
CI enforces "committed artifacts are not stale" via `git diff --exit-code`; that
only passes today because the generator skips packets that already have a
record. Anyone regenerating from scratch gets a diff in every record with no
semantic change. Deriving the id from the packet content (a hash of
`task_id + agent_id + packet_id`) and taking `created_at` from the packet's
`ended_at` — or from `SOURCE_DATE_EPOCH` — would make `make score` idempotent.

Related: `evidence_checks[].verified` is hard-coded `true` for every evidence
item. The automated judge does not verify evidence; asserting that it did is the
kind of claim the rubric penalises participants for.

### 12. Participant-server state lock can be released by the wrong process

`PersistentParticipantBroker.withStateLock` unconditionally removes the lock
file in its `finally`:

```js
fs.rmSync(this.stateLockPath, { force: true });
```

If process A's lock was judged stale by process B (dead PID, or a >5s-old
unparseable file) and B took over, A's `finally` then deletes *B's* lock while B
still holds it. Recording the lock's identity (write a UUID alongside the PID,
and only unlink when the file still contains yours) closes it. PID reuse has the
same shape. Low likelihood on a single-operator loopback broker; cheap to make
correct.

### 13. Smaller items

- `scripts/proof-token-verify.js` guards artifact reads with `repoPath()` but
  `loadYaml()` resolves `--packet`/`--challenge-set` against `ROOT` with no
  escape check. Both are operator-supplied, so this is consistency rather than a
  hole — but the inconsistency invites someone to trust the wrong one later.
- `scripts/identity-blocklist.js:deriveTokens` silently `continue`s past a
  YAML file it cannot parse, directly under a comment saying a malformed file
  "must not silently empty the gate". It does not empty the gate, but it does
  silently shrink it — a `results/` file that fails to parse drops that
  participant from the blocklist. Warn to stderr at minimum.
- `adapters/lib/adapter-common.js:generateRunMetadata` computes
  `duration_seconds` from `new Date(endedAt) - new Date(startedAt)` with no
  validity check; invalid timestamps yield `NaN`, which YAML-dumps as `.nan`.
- `captureConsole` joins arguments with `['STDOUT', ...args].join(' ')`, so any
  object logged by an adapter lands in `adapter.log` as `[object Object]`.
  `util.format(...args)` would preserve it.
- `PersistentParticipantBroker.eligibleRuns` reads
  `registration.capabilities.*` unguarded and `task.envelope.time_limit_minutes * 60`
  without a fallback; a registration that passes the schema but omits either
  yields a 500 or a `NaN` time limit rather than a 4xx.
- `isLoopbackHost` accepts the string `localhost`, which resolves through
  `/etc/hosts` and is not guaranteed to be loopback. Restricting the bind check
  to the two literal addresses matches the "fails closed" claim in the header
  comment.
