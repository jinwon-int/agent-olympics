## Reference

- Website: https://sierra.ai/resources/research/tau-bench
- GitHub: https://github.com/sierra-research/tau-bench
- Paper: https://arxiv.org/abs/2406.12045

## What it is

Tau-bench measures tool-agent-user interaction in realistic domains and emphasizes reliability over repeated trials.

## Why it matters for Agent Olympics

One successful run is not enough for operational trust. Some Agent Olympics tasks should be repeated to measure consistency, especially liveness, safety, and tool-use tasks.

## Design takeaways

- Add repeated-run scoring for selected events.
- Measure consistency, not only best-case success.
- Simulated users and policies can test whether agents follow constraints.

## Possible follow-up

Add `repeat_count` and `reliability_score` fields to a later schema version or judge record.
