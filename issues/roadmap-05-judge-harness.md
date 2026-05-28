## Purpose

Create the first judge harness for Agent Olympics.

## Proposed layers

1. Schema validation.
2. Required output validation.
3. Forbidden content and secret-pattern scan.
4. Timing and status checks.
5. Evidence-reference completeness checks.
6. Human or LLM-assisted subjective scoring.

## Acceptance criteria

- A Result Packet can be scored into the six positive rubric categories.
- Penalties can be recorded separately.
- Judge output includes short reasons for each dimension.
- The harness supports blind judging by hiding runtime, model, node, and agent id.
