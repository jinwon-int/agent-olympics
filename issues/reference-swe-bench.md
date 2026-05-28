## Reference

- Website: https://www.swebench.com/
- GitHub: https://github.com/swe-bench/SWE-bench
- Paper: https://arxiv.org/abs/2310.06770

## What it is

SWE-bench evaluates AI systems on real-world GitHub issues. The core design links issue resolution to repository patches and tests.

## Why it matters for Agent Olympics

Agent Olympics `Code Sprint` should not be judged by prose alone. It should prefer repository-grounded tasks with a patch, targeted tests, and CI-style verification.

## Design takeaways

- Use real issue-style tasks where possible.
- Require changed files and test results in the Result Packet.
- Keep an answer key or validation script separate from the participant prompt.
- Track benchmark contamination risk if public tasks are reused heavily.

## Possible follow-up

Create a `Code Sprint` fixture format that can point to a repository, base commit, failing test, expected behavior, and validation command.
