# Agent Olympics — Validation and development targets
#
# Requires: Node.js >= 18, npm

.PHONY: all validate validate-envelopes validate-packets validate-all \
        validate-v2 validate-envelopes-v2 validate-packets-v2 validate-judges \
        validate-judges-v2 validate-fixtures validate-oracle validate-smoke \
        oracle smoke-check smoke fixtures-check setup clean \
        stub-adapter stub-adapter-fail test-stub

all: validate-all validate-v2 validate-oracle validate-fixtures

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

# Default validation target
validate: validate-all validate-v2 validate-oracle validate-smoke validate-fixtures

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

# Remove generated artifacts and dependencies
clean:
	rm -rf node_modules
