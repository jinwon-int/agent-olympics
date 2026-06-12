# code-001 target repository fixture

`target-repo/` is the TypeScript codebase the `code-001` task envelope points
at via `environment.repo_path: /work/agent-codebench`. The 2026-06-12 stage-2
live trials were voided because this path was never provisioned on the live
nodes (see judge notes §3.5); this fixture closes that gap.

## What it is

A small gateway delivery-report pipeline with a **planted regression** matching
one of the oracle's expected answer categories. The broken state is the
shipped state:

- `npm test` (build + unit tests) is **green** — the suite does not cover the
  regression yet;
- `npm run typecheck` is **clean** — the bug type-checks;
- `npm run report` **crashes** with the incident error described in the
  bench's own `README.md` (the participant's starting symptom).

The participant must identify the regression through inspection, reproduce it
with a failing test, fix it minimally, and show the suite passing — exactly
the envelope's required outputs (`changed_files`, `test_results`, `bug_cause`,
`fix_summary`, `residual_risk`).

Solvability is certified: the minimal correct fix makes the suite (plus a new
regression test) pass and the report render cleanly. Do **not** document the
fix anywhere participant-visible — the oracle holds the answer categories.

## Provisioning a live node (operator)

```sh
# from the node's sparse repo checkout
rm -rf /work/agent-codebench
cp -r fixtures/season-001/code-001/target-repo /work/agent-codebench
cd /work/agent-codebench && npm install --no-audit --no-fund

# verify the bench is in its intended broken state:
npm test                  # must be GREEN (4 tests)
npm run report; echo $?   # must CRASH (TypeError, exit 1)
```

If `npm test` fails or `npm run report` succeeds, the bench is in the wrong
state — stop and report instead of running the task.

Re-provision (same three commands) before every fresh attempt so earlier
participants' edits cannot leak into the next run.
