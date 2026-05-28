## Reference

- Paper: https://arxiv.org/abs/2311.12983
- Hugging Face: https://huggingface.co/gaia-benchmark

## What it is

GAIA evaluates general AI assistants on real-world questions requiring reasoning, tool use, and sometimes web browsing.

## Why it matters for Agent Olympics

Agent Olympics should include knowledge and research tasks, but they must be evidence-backed and source-attributed.

## Design takeaways

- Require citations or evidence links for research claims.
- Separate final answer quality from tool-use trace quality.
- Avoid over-reliance on LLM judge impressions for factual tasks.

## Possible follow-up

Create a `Knowledge Research` event variant with mandatory source list, quote limits, and confidence ratings.
