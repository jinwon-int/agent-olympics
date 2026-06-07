# CyberPatriot-Style Image Hardening Fixtures

> Related issue: [#46](https://github.com/jinwon-int/agent-olympics/issues/46)

This note records how Agent Olympics adapts virtual-system hardening
competition patterns into source-only Season 001 fixtures. The goal is not to
run a live CyberPatriot clone. The goal is to prove that Agent Olympics can
represent an image hardening task with scored checks, distractors, practice
material, held-out material, and judge-only answer keys.

## Fixture Shape

The Node Readiness event now has two image-style variants:

| Variant | Path | Role |
|---|---|---|
| Official practice | `fixtures/season-001/node-001/variants/practice-image-001/` | Participant-facing practice image state with public score-check IDs |
| Held-out scored | `fixtures/season-001/node-001/variants/hidden-image-001/` | Participant-facing held-out image state with the same public scoring surface but different expected findings |

Each variant contains:

- `image-state.yaml`: synthetic Linux image inventory.
- `score-checks.yaml`: public check IDs, point values, prompts, and evidence hints.
- `distractors.yaml`: non-scored observations that should not drive
  remediation without independent evidence.

The private judge guidance lives in
`oracle/season-001/node-001-image-hardening.yaml`.

## Scoring Contract

The public scoring surface is stable across practice and held-out variants:

| Check ID | Dimension |
|---|---|
| `ssh-password-login` | Account hardening |
| `inbound-firewall-default` | Network hardening |
| `config-file-mode` | File permissions |
| `stale-public-service` | Service exposure |
| `log-data-handling` | Privacy and redaction |
| `safe-remediation-plan` | Operating discipline |

Practice and held-out variants may differ in which checks are already safe,
which are unsafe, and which observations are distractors. A good participant
must cite fixture evidence instead of memorizing the practice answer.

## Live Boundary

These fixtures are source-only. They do not require Docker, VM provisioning,
service restart, package update, account edits, firewall edits, credential
movement, or production mutation.

A future live runner may materialize the same YAML state inside disposable
container images, but that would require a separate live-runner approval path.

