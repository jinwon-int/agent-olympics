# Agent Olympics — Validation and development targets
#
# Requires: Node.js >= 18, npm

.PHONY: all validate validate-envelopes validate-packets validate-all \
        validate-v2 validate-envelopes-v2 validate-packets-v2 validate-judges \
        validate-judges-v2 validate-fixtures validate-adapter-fixtures \
        validate-oracle validate-smoke \
        oracle smoke-check smoke fixtures-check setup clean \
        validate-rounds rounds-check round \
        validate-profiles profiles-check \
        stub-adapter stub-adapter-fail test-stub \
        openclaw-adapter openclaw-adapter-code openclaw-adapter-fail validate-openclaw test-openclaw \
        score score-validate score-run score-aggregate validate-scoreboard validate-competition-fixtures \
        score-blind score-blind-score score-blind-aggregate score-all \
        validate-web-fields validate-web-bridge

all: validate-all validate-v2 validate-oracle validate-fixtures validate-adapter-capabilities validate-adapter-fixtures validate-hermes-fixtures validate-profiles validate-scoreboard validate-competition-fixtures validate-openclaw test-openclaw

# Install dependencies
setup:
	npm install

# Validate all task envelope YAML files (v1)
validate-envelopes:
	node scripts/validate.js envelopes

# Validate all result packet YAML files (v1)
validate-packets:
	node scripts/validate.js packets

# Validate all known YAML files (v1 envelopes, packets, judge records)
validate-all:
	node scripts/validate.js all

# Validate all judge records (v1)
validate-judges:
	node scripts/validate.js judges

# --- v2 targets ---

# Validate all v2 task envelopes
validate-envelopes-v2:
	node scripts/validate.js envelopes-v2

# Validate all v2 result packets
validate-packets-v2:
	node scripts/validate.js packets-v2

# Validate all v2 judge records
validate-judges-v2:
	node scripts/validate.js judges-v2

# Validate all v2 documents (envelopes + packets + judges)
validate-v2:
	node scripts/validate.js all-v2

# --- Oracle targets ---

# Validate all oracle answer key files
validate-oracle:
	node scripts/validate.js oracle

oracle: validate-oracle

# Validate all adapter capability declaration files (fixtures/adapters/capabilities/*.yaml)
# against the adapter-capability-declaration.schema.json
validate-adapter-capabilities:
	@echo "=== Adapter Capability Declarations ==="
	node scripts/validate.js adapter-capabilities
	@echo "Adapter capability declaration validation passed."

# Validate all adapter fixture sample data files (Hermes, CLI, human-baseline)
# Checks standard-schema files (result packets, evidence bundles) and
# adapter-specific format files (commands, timestamp logs, actions, etc.)
validate-adapter-fixtures:
	@echo "=== Adapter Compatibility Fixtures ==="
	node scripts/validate.js adapter-fixtures
	@echo ""
	@echo "Adapter fixture validation passed."

# Validate all Hermes-specific fixture files (workflow plan, worker trace,
# memory summary) with both schema and structural checks
validate-hermes-fixtures:
	@echo "=== Hermes Adapter Fixtures ==="
	node scripts/validate.js fixtures/adapters/hermes/sample-workflow-plan.yaml
	node scripts/validate.js fixtures/adapters/hermes/sample-worker-trace.yaml
	node scripts/validate.js fixtures/adapters/hermes/sample-memory-summary.yaml
	@echo "Hermes adapter fixture validation passed."

# Validate all smoke task envelopes
validate-smoke:
	node scripts/validate.js smoke

# Validate all smoke task envelopes
smoke-check: validate-smoke

# Validate all fixture bundle manifests
validate-fixtures:
	node scripts/validate.js fixtures

# Validate all fixture bundle manifests
fixtures-check: validate-fixtures

# Validate all round manifests
validate-rounds:
	node scripts/validate.js rounds

# Quick-run: validate rounds
rounds-check: validate-rounds

# Validate all node profile inventory files
validate-profiles:
	node scripts/validate.js profiles

# Quick-run: validate profiles
profiles-check: validate-profiles

# Round engine CLI (alias for convenience)
round:
	node scripts/round.js

# Default validation target
validate: validate-all validate-v2 validate-oracle validate-smoke validate-fixtures \
        validate-adapter-capabilities validate-adapter-fixtures validate-hermes-fixtures \
        validate-rounds validate-profiles \
        validate-scoreboard validate-competition-fixtures validate-openclaw test-openclaw

# --- Competition-Validity targets ---

# Run competition-validity checks (scans repo-wide if no run dir)
validate-competition:
	node scripts/competition-validity.js all

# Validate competition-validity fixtures (positive + negative examples)
validate-competition-fixtures:
	node scripts/competition-validity.js fixtures fixtures/competition-validity

# Validate run manifest integrity only
validate-run-manifests:
	node scripts/competition-validity.js run-manifests runs/season-001/round-001

# Validate engine output presence
validate-engine-outputs:
	node scripts/competition-validity.js engine-outputs runs/season-001/round-001

# Validate cross-document consistency
validate-consistency:
	node scripts/competition-validity.js consistency runs/season-001/round-001

# Validate all competition-validity checks (via validate.js wrapper)
validate-cv:
	node scripts/validate.js competition-validity

# Quick-run: validate smoke tasks
smoke: validate-smoke

# --- OpenClaw adapter targets ---

# Run OpenClaw adapter against the stub test envelope (success mode, ops)
openclaw-adapter:
	node adapters/openclaw-adapter.js tasks/stub-test/stub-hello-envelope.yaml \
		--agent-id sogyo --runtime openclaw --runtime-version 2.14.0 \
		--mode openstack --event-family ops --seed make-openclaw

# Run OpenClaw adapter in closed stack code mode
openclaw-adapter-code:
	node adapters/openclaw-adapter.js tasks/stub-test/stub-hello-envelope.yaml \
		--agent-id sogyo --runtime openclaw --runtime-version 2.14.0 \
		--mode closedstack --event-family code --seed make-openclaw-code

# Run OpenClaw adapter in failure mode
openclaw-adapter-fail:
	node adapters/openclaw-adapter.js tasks/stub-test/stub-hello-envelope.yaml \
		--agent-id sogyo --runtime openclaw --runtime-version 2.14.0 \
		--mode openstack --event-family ops --seed make-openclaw-fail --exit 1

# Validate all OpenClaw adapter output fixtures
validate-openclaw:
	@echo "=== Validating OpenClaw adapter positive fixtures ==="
	@for f in fixtures/openclaw-validity/positive/*.yaml; do \
		echo "--- $$(basename $$f) ---"; \
		node scripts/validate.js "$$f" || exit 1; \
	done
	@echo ""
	@echo "=== Validating OpenClaw adapter negative fixtures ==="
	@for f in fixtures/openclaw-validity/negative/*.yaml; do \
		echo "--- $$(basename $$f) ---"; \
		node scripts/validate.js "$$f"; \
		echo "(expected to produce errors for negative fixtures)"; \
	done
	@echo ""
	@echo "OpenClaw adapter fixture validation complete."

# Run OpenClaw adapter smoke checks without writing generated artifacts to the repo.
test-openclaw:
	@set -eu; \
	tmp="$$(mktemp -d)"; \
	trap 'rm -rf "$$tmp"' EXIT; \
	node adapters/openclaw-adapter.js tasks/stub-test/stub-hello-envelope.yaml \
		--agent-id sogyo --runtime openclaw --runtime-version 2.14.0 \
		--mode openstack --event-family ops --seed make-openclaw --run-dir "$$tmp/ops"; \
	node adapters/openclaw-adapter.js tasks/stub-test/stub-hello-envelope.yaml \
		--agent-id sogyo --runtime openclaw --runtime-version 2.14.0 \
		--mode closedstack --event-family code --seed make-openclaw-code --run-dir "$$tmp/code"; \
	if node adapters/openclaw-adapter.js tasks/stub-test/stub-hello-envelope.yaml \
		--agent-id sogyo --runtime openclaw --runtime-version 2.14.0 \
		--mode openstack --event-family ops --seed make-openclaw-fail --exit 1 --run-dir "$$tmp/fail"; then \
		echo "Expected OpenClaw failure-mode run to exit non-zero"; \
		exit 1; \
	fi; \
	echo "OpenClaw adapter smoke tests passed."

# --- Stub adapter targets ---

# Run stub adapter against the stub test envelope (success mode)
stub-adapter:
	node scripts/stub-adapter.js tasks/stub-test/stub-hello-envelope.yaml \
		--seed make-stub --agent-id make-adapter --runtime cli

# Run stub adapter in failure mode
stub-adapter-fail:
	node scripts/stub-adapter.js tasks/stub-test/stub-hello-envelope.yaml \
		--seed make-stub-fail --agent-id make-adapter --runtime cli --exit 1

# Run the full stub adapter test suite
test-stub:
	bash scripts/test-stub-adapter.sh

# --- Scoring / Judge targets ---

# Run score.js full pipeline: validate + auto-judge + scoreboard
score:
	node scripts/score.js run

# Validate result packets through the scoring engine
score-validate:
	node scripts/score.js validate

# Validate + auto-judge result packets
score-run:
	node scripts/score.js run

# Aggregate scoreboard (validate + score + scoreboard JSON)
score-aggregate:
	node scripts/score.js aggregate

# Validate the scoreboard schema
validate-scoreboard:
	node -e 'const fs = require("fs"); const Ajv = require("ajv/dist/2020"); const addFormats = require("ajv-formats"); const ajv = new Ajv({ allErrors: true, verbose: true }); addFormats(ajv); const schema = JSON.parse(fs.readFileSync("schemas/scoreboard.schema.json", "utf8")); ajv.addSchema(schema, schema.$$id); console.log("Scoreboard schema loaded and compiled.");'

# --- Blind scoring targets ---

# Run full pipeline in blind mode (anonymize before scoring)
score-blind:
	node scripts/score.js run --blind

# Score only in blind mode
score-blind-score:
	node scripts/score.js score --blind

# Aggregate only in blind mode
score-blind-aggregate:
	node scripts/score.js aggregate --blind

# Run both blind and non-blind, validate both outputs
score-all:
	node scripts/score.js run
	node scripts/score.js run --blind

# --- Web data bridge targets ---

# Validate scoreboard has all required web-display fields
validate-web-fields:
	node -e '\
	const sb = JSON.parse(require("fs").readFileSync("results/scoreboard.json", "utf8"));\
	let missing = 0;\
	for (const e of sb.entries) {\
	  if (!e.agent_id) { missing++; console.log("MISSING agent_id in " + e.entry_id); }\
	  if (!e.score && e.judge_type !== "pending") { missing++; console.log("MISSING score in " + e.entry_id); }\
	  if (!e.packet_ref) { missing++; console.log("MISSING packet_ref in " + e.entry_id); }\
	  if (!e.task_id) { missing++; console.log("MISSING task_id in " + e.entry_id); }\
	}\
	console.log(missing === 0 ? "All web-display fields present" : missing + " entries missing fields");\
	process.exit(missing > 0 ? 1 : 0);\
'

# Full web data bridge validation: scoreboard + blind + field check
validate-web-bridge: score score-blind validate-web-fields
	@echo "Web data bridge validation complete."

# Remove generated artifacts and dependencies
clean:
	rm -rf node_modules
