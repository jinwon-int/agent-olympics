## Reference

- Website: https://www.tbench.ai/
- GitHub: https://github.com/laude-institute/terminal-bench

## What it is

Terminal-Bench focuses on AI agents completing real work in terminal environments with observable files, commands, and outcomes.

## Why it matters for Agent Olympics

Many Agent Olympics tasks are operational or CLI-heavy. The benchmark should capture actual terminal work, not only the final narrative.

## Design takeaways

- Use sandboxed or resettable workspaces for CLI tasks.
- Capture command outcomes and file changes as evidence.
- Prefer rule-based validation where possible.
- Separate task execution from judge scoring.

## Possible follow-up

Define a CLI adapter that records command summaries, timing, file diffs, and test results into a Result Packet.
