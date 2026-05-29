# OpenClaw adapter validation fixtures
#
# These fixtures validate OpenClaw adapter output against Agent Olympics
# schemas and competition-validity checks.
#
## Positive fixtures
#   Schema-valid AND competition-valid OpenClaw result examples.
#   Each tests a specific event-family / status combination.
#
## Negative fixtures
#   Schema-valid but competition-invalid OpenClaw result examples.
#   Each tests a specific failure mode.
#
## Running
#   node scripts/validate.js fixtures/openclaw-validity/positive/ops-completed-result-packet.yaml
#   node scripts/validate.js fixtures/openclaw-validity/negative/missing-evidence-result-packet.yaml
