## Reference

- Website: https://os-world.github.io/
- Paper: https://arxiv.org/abs/2404.07972

## What it is

OSWorld evaluates multimodal agents on open-ended computer tasks in real desktop environments.

## Why it matters for Agent Olympics

Agent Olympics starts with text, terminal, and operational tasks, but future events may need realistic desktop or browser environments.

## Design takeaways

- Real environments expose failures that synthetic prompts hide.
- Resettable environments are important for fair repeated evaluation.
- GUI and multimodal tasks should be a later event family, not a v1 requirement.

## Possible follow-up

Create a future `Computer Use` event family only after the v1 task/result schemas are stable.
