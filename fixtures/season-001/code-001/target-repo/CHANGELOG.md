# Changelog

## v0.3.0 (2026-06-08)

- Report pipeline refactor: summarize() now aggregates in a single pass per
  node (perf); sample types tightened.

## v0.2.1 (2026-05-30)

- Render mean latency as `n/a` when a node has no measured samples.

## v0.2.0 (2026-05-24)

- Added per-node retry totals to the nightly report.

## v0.1.0 (2026-05-18)

- Initial report pipeline: parse, summarize, render.
