#!/usr/bin/env bash
# Test: Stub Adapter — Success, Failure, Timeout, and Prereq-error modes
#
# Runs the stub adapter against the minimal test envelope and verifies
# output structure, schema compliance, and exit code mapping.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENVELOPE="$REPO_DIR/tasks/stub-test/stub-hello-envelope.yaml"

PASS=0
FAIL=0
ERRORS=()

pass() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ✗ $1"; ERRORS+=("$1"); }

# ---------------------------------------------------------------------------
# 1. Success mode (exit 0 → completed)
# ---------------------------------------------------------------------------
echo ""
echo "=== Test 1: Success mode (exit 0 → completed) ==="
RUN_DIR=$(mktemp -d /tmp/stub-test-success-XXXXXX)
trap 'rm -rf "$RUN_DIR"' EXIT

node "$SCRIPT_DIR/stub-adapter.js" "$ENVELOPE" --run-dir "$RUN_DIR" --agent-id test-adapter --runtime cli-stub --exit 0 --seed test-success

if [ -f "$RUN_DIR/result-packet.yaml" ]; then
  pass "result-packet.yaml exists"
else
  fail "result-packet.yaml missing"
fi

if [ -f "$RUN_DIR/trace.yaml" ]; then
  pass "trace.yaml exists"
else
  fail "trace.yaml missing"
fi

if [ -f "$RUN_DIR/evidence-bundle.yaml" ]; then
  pass "evidence-bundle.yaml exists"
else
  fail "evidence-bundle.yaml missing"
fi

if [ -f "$RUN_DIR/run.yaml" ]; then
  pass "run.yaml exists"
else
  fail "run.yaml missing"
fi

if [ -f "$RUN_DIR/adapter.log" ]; then
  pass "adapter.log exists"
else
  fail "adapter.log missing"
fi

# Check status in result packet
STATUS=$(grep -E '^status:' "$RUN_DIR/result-packet.yaml" | awk '{print $2}')
if [ "$STATUS" = "completed" ]; then
  pass "Status is 'completed' (exit 0)"
else
  fail "Expected status 'completed', got '$STATUS'"
fi

# Check run metadata
EXIT_CODE=$(grep -E '^exit_code:' "$RUN_DIR/run.yaml" | awk '{print $2}')
if [ "$EXIT_CODE" = "0" ]; then
  pass "run.yaml exit_code is 0"
else
  fail "Expected exit_code 0, got '$EXIT_CODE'"
fi

# ---------------------------------------------------------------------------
# 2. Failure mode (exit 1 → failed)
# ---------------------------------------------------------------------------
echo ""
echo "=== Test 2: Failure mode (exit 1 → failed) ==="
RUN_DIR2=$(mktemp -d /tmp/stub-test-fail-XXXXXX)

set +e
node "$SCRIPT_DIR/stub-adapter.js" "$ENVELOPE" --run-dir "$RUN_DIR2" --agent-id test-adapter --runtime cli-stub --exit 1 --seed test-fail
EXIT_ACTUAL=$?
set -e

if [ "$EXIT_ACTUAL" = "1" ]; then
  pass "Process exited with code 1"
else
  fail "Expected exit code 1, got $EXIT_ACTUAL"
fi

STATUS2=$(grep -E '^status:' "$RUN_DIR2/result-packet.yaml" | awk '{print $2}')
if [ "$STATUS2" = "failed" ]; then
  pass "Status is 'failed' (exit 1)"
else
  fail "Expected status 'failed', got '$STATUS2'"
fi

rm -rf "$RUN_DIR2"

# ---------------------------------------------------------------------------
# 3. Partial/timeout mode (exit 2 → partial)
# ---------------------------------------------------------------------------
echo ""
echo "=== Test 3: Partial mode (exit 2 → partial) ==="
RUN_DIR3=$(mktemp -d /tmp/stub-test-partial-XXXXXX)

set +e
node "$SCRIPT_DIR/stub-adapter.js" "$ENVELOPE" --run-dir "$RUN_DIR3" --agent-id test-adapter --runtime cli-stub --exit 2 --seed test-partial
EXIT_ACTUAL=$?
set -e

if [ "$EXIT_ACTUAL" = "2" ]; then
  pass "Process exited with code 2"
else
  fail "Expected exit code 2, got $EXIT_ACTUAL"
fi

STATUS3=$(grep -E '^status:' "$RUN_DIR3/result-packet.yaml" | awk '{print $2}')
if [ "$STATUS3" = "partial" ]; then
  pass "Status is 'partial' (exit 2)"
else
  fail "Expected status 'partial', got '$STATUS3'"
fi

rm -rf "$RUN_DIR3"

# ---------------------------------------------------------------------------
# 4. Missing envelope → exit 3 (blocked)
# ---------------------------------------------------------------------------
echo ""
echo "=== Test 4: Missing envelope → blocked ==="
set +e
node "$SCRIPT_DIR/stub-adapter.js" "/nonexistent/envelope.yaml" 2>/dev/null
EXIT_ACTUAL=$?
set -e

if [ "$EXIT_ACTUAL" = "3" ]; then
  pass "Missing envelope exits with code 3 (prereq error)"
else
  fail "Expected exit code 3, got $EXIT_ACTUAL"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=== Summary ==="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
if [ ${#ERRORS[@]} -gt 0 ]; then
  echo "  Errors:"
  for e in "${ERRORS[@]}"; do echo "    - $e"; done
  exit 1
fi
echo "  All tests passed."
