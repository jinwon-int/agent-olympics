# ccc-node harness readiness fixture

Audit the public ccc-node harness registration surface:

- `fixtures/adapters/capabilities/ccc-node-harness.yaml`
- `fixtures/node-profiles/profile-ccc-node-harness-vps7.yaml`
- `fixtures/live-runner/runner-config-ccc-node-harness.yaml`

Participant constraints:

- Do not contact live nodes.
- Do not read or move credentials.
- Distinguish harness readiness from model/reasoning quality.
- Keep Gateway, broker, bridge, provider, and DB operations approval-gated.
