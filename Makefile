# Agent Olympics — Validation and development targets
#
# Requires: Node.js >= 18, npm

.PHONY: all validate validate-envelopes validate-packets validate-all validate-smoke \
        smoke-check smoke setup clean

all: validate-all

# Install dependencies
setup:
	npm install

# Validate all task envelope YAML files
validate-envelopes:
	node scripts/validate.js envelopes

# Validate all result packet YAML files
validate-packets:
	node scripts/validate.js packets

# Validate all known YAML files (envelopes, packets, judge records)
validate-all:
	node scripts/validate.js all

# Validate all smoke task envelopes
validate-smoke:
	node scripts/validate.js smoke

# Validate all smoke task envelopes
smoke-check: validate-smoke

# Default validation target
validate: validate-all

# Quick-run: validate smoke tasks
smoke: validate-smoke

# Remove generated artifacts and dependencies
clean:
	rm -rf node_modules
