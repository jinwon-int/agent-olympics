## Reference

- MLPerf Inference v4.1 results: https://mlcommons.org/2024/08/mlperf-inference-v4-1-results/
- MLPerf Inference docs: https://docs.mlcommons.org/inference/

## What it is

MLPerf, maintained by MLCommons, provides architecture-neutral and reproducible AI system performance benchmarks. MLPerf Inference measures how quickly hardware and software systems run AI and ML models across deployment scenarios, while its documentation records task, model, dataset, accuracy, and latency constraints for valid submissions.

## Why it matters for Agent Olympics

Agent Olympics should measure the whole agent stack rather than only the model. Performance Trial reports need to account for runtime, adapter, tools, hardware, latency, resource use, and reproducibility metadata.

## Design takeaways

- Treat each submission as a system-under-test record.
- Preserve closed/open division framing for fixed-budget and innovation-open runs.
- Report raw measurements together with normalized and resource-adjusted scores.
- Keep hardware, runtime, adapter, tool, network-mode, and fixture-hash metadata with the result.

## Existing Agent Olympics surface

- `docs/performance-scoring.md`
- `schemas/result-packet-v2.schema.json`
- `schemas/scoreboard.schema.json`
- `scripts/score.js`
- `scripts/harness-to-packet.js`

## Possible follow-up

Add energy or power proxy fields only after the runner can collect them consistently without exposing host-sensitive data.
