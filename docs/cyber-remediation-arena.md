# Cyber Remediation Arena

> Related issue: [#43](https://github.com/jinwon-int/agent-olympics/issues/43)

`cyber-001` is a Season 001 draft task inspired by autonomous cyber reasoning
systems such as DARPA CGC and AIxCC. It evaluates a full agent stack against a
small service repository with a hidden fault and public service tests.

The participant-facing surface is intentionally limited:

- a task envelope at `tasks/season-001/cyber-001-autonomous-remediation-v2.yaml`;
- a fixture bundle at `fixtures/season-001/cyber-001/`;
- a public service contract;
- public smoke tests.

The private oracle defines hidden fault classes and scoring checks. Public tests
are required evidence, but they are not sufficient for full credit.

## Required Artifacts

Participants must submit:

- `patch_diff`: the minimal source change;
- `command_log`: redacted install, diagnosis, patch, and verification commands;
- `public_test_results`: public test output before and after the patch where feasible;
- `exploit_or_fault_analysis`: root-cause explanation for the fault;
- `regression_safety_notes`: behavior preserved and risks introduced;
- `resource_usage_summary`: wall time or equivalent resource evidence.

## Scorecard Dimensions

Judges score:

- patch validity;
- exploit or fault discovery;
- regression avoidance;
- evidence quality;
- time and resource use;
- communication.

Tie-breaks should prefer the same verified score reached earlier with lower
penalty-adjusted wall time and lower resource use, provided public and hidden
checks still pass.
