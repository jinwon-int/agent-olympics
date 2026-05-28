## Reference

- Paper: https://arxiv.org/abs/2308.03688
- GitHub: https://github.com/THUDM/AgentBench

## What it is

AgentBench evaluates LLM-as-agent behavior across multiple environments rather than a single narrow task type.

## Why it matters for Agent Olympics

Agent Olympics should avoid becoming only a coding benchmark or only an ops benchmark. The event-family structure should intentionally test several types of autonomous work.

## Design takeaways

- Maintain multiple event families.
- Normalize outputs across heterogeneous tasks.
- Score by capability dimension, not only by final pass/fail.
- Keep environment-specific adapters thin.

## Possible follow-up

Map each Agent Olympics event family to the score dimensions it is expected to stress.
