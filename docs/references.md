# References

This page tracks related benchmarks and design influences. Each item should also have a GitHub issue if it may affect Agent Olympics design.

## SWE-bench

- URL: https://www.swebench.com/
- GitHub: https://github.com/swe-bench/SWE-bench
- Relevance: real GitHub issue resolution, patch evaluation, software-engineering tasks.
- Agent Olympics takeaway: Code Sprint should use real repository issues where possible and verify with tests, not judge by prose.

## Terminal-Bench

- URL: https://www.tbench.ai/
- GitHub: https://github.com/laude-institute/terminal-bench
- Relevance: terminal-based task execution in sandboxed environments.
- Agent Olympics takeaway: CLI and ops tasks should capture file system changes, command outcomes, and terminal traces.

## AgentBench

- Paper: https://arxiv.org/abs/2308.03688
- GitHub: https://github.com/THUDM/AgentBench
- Relevance: multi-environment LLM-as-agent evaluation.
- Agent Olympics takeaway: use multiple event families rather than one narrow task type.

## OSWorld

- URL: https://os-world.github.io/
- Paper: https://arxiv.org/abs/2404.07972
- Relevance: open-ended computer tasks in real desktop environments.
- Agent Olympics takeaway: realistic environments matter, but the first version can stay text/terminal focused.

## WebArena

- URL: https://webarena.dev/
- Paper: https://arxiv.org/abs/2307.13854
- GitHub: https://github.com/web-arena-x/webarena
- Relevance: autonomous web tasks in self-hosted realistic websites.
- Agent Olympics takeaway: future web events should be self-hostable and resettable.

## Tau-bench

- URL: https://sierra.ai/resources/research/tau-bench
- GitHub: https://github.com/sierra-research/tau-bench
- Relevance: tool-agent-user interaction with consistency and reliability measurement.
- Agent Olympics takeaway: repeat selected tasks multiple times to measure reliability, not only one-off success.

## GAIA

- Paper: https://arxiv.org/abs/2311.12983
- Hub: https://huggingface.co/gaia-benchmark
- Relevance: general assistant tasks requiring tools and real-world reasoning.
- Agent Olympics takeaway: include knowledge and research tasks, but keep evidence and source attribution strict.

## MLE-bench

- Paper: https://arxiv.org/abs/2410.07095
- GitHub: https://github.com/openai/mle-bench
- Relevance: machine-learning engineering benchmark with local grading and artifacts.
- Agent Olympics takeaway: later ML engineering events can follow this style with local evaluation scripts.

## MLAgentBench

- Paper: https://arxiv.org/abs/2310.03302
- GitHub: https://github.com/snap-stanford/MLAgentBench
- Relevance: language agents performing ML experimentation.
- Agent Olympics takeaway: experiment planning and iterative improvement can become an advanced event family.

## AIcrowd MineRL and Procgen

- MineRL: https://www.aicrowd.com/challenges/neurips-2019-minerl-competition
- Procgen: https://www.aicrowd.com/challenges/neurips-2020-procgen-competition
- Relevance: reproducible submissions, constrained compute/sample budgets, starter kits, and held-out or procedurally generated evaluation environments.
- Agent Olympics takeaway: adapters need a clean-environment test entrypoint, declared resource limits, and generated or held-out fixture variants so agents cannot overfit one public fixture. See [Reproducible Submission Contract](reproducible-submission-contract.md).

## Cyber Games and cybersecurity olympiads

- CyberPatriot: https://www.uscyberpatriot.org/competition/Competition-Overview/competition-overview
- US Cyber Games FAQ: https://www.uscybergames.com/faq
- International Cybersecurity Challenge: https://icc.ecsc.eu/about
- USA Cybersecurity Olympiad contest rules: https://www.usacyo.org/contest-rules
- Relevance: virtual-system hardening, open qualifier pipelines, combine/training selection, allowed/prohibited tool rules, proctoring evidence, and dynamic scoring.
- Agent Olympics takeaway: Season qualification records should carry explicit tool rules, proctoring evidence, and scoring-mode metadata so round manifests and judges can audit eligibility and scoring assumptions. Node Readiness can also use image-style hardening fixtures with scored checks, distractors, official-practice material, and held-out scoring variants. See [CyberPatriot-Style Image Hardening Fixtures](cyberpatriot-image-hardening-fixtures.md).

## Global CyberLympics

- URL: https://cyberlympics.org/
- Relevance: online elimination rounds, proof-style challenge evidence, solution verification, score timing, and tie-break pressure.
- Agent Olympics takeaway: Result Packet v2 supports optional challenge-scoped `proof_tokens`; judges should verify the submitted proof plus solution artifact before awarding points, then apply score-time/resource/penalty tie-breakers. See [Proof Token Verification](proof-token-verification.md).
