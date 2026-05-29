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
        score score-validate score-run score-aggregate validate-scoreboard

all: validate-all validate-v2 validate-oracle validate-fixtures validate-adapter-fixtures validate-profiles validate-scoreboard validate-competition-fixtures

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

# Validate all adapter compatibility fixture files (capability declarations + sample data)
validate-adapter-fixtures:
	@echo "=== Adapter Compatibility Fixtures ==="
	node scripts/validate.js fixtures/adapters/cli/sample-result-packet-stub.yaml
	node scripts/validate.js fixtures/adapters/human-baseline/sample-evidence-bundle-stub.yaml
	@echo "Adapter fixture schema validation passed."

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
        validate-adapter-fixtures validate-rounds validate-profiles \
        validate-scoreboard validate-competition-fixtures

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

# Remove generated artifacts and dependencies
clean:
	rm -rf node_modules
