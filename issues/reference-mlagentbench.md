## Reference

- Paper: https://arxiv.org/abs/2310.03302
- GitHub: https://github.com/snap-stanford/MLAgentBench

## What it is

MLAgentBench evaluates language agents on ML experimentation workflows.

## Why it matters for Agent Olympics

It is a useful reference for measuring iterative experimentation, planning, execution, and result interpretation.

## Design takeaways

- Advanced events can test experiment loops, not only one-shot answers.
- Result Packets should distinguish actions, evidence, findings, and final recommendations.
- Judges should inspect whether the participant learned from failed attempts.

## Possible follow-up

Add an advanced `Experiment Drill` event family after v1.
