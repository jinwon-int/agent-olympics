#!/usr/bin/env bash
#
# Test suite for scripts/web-result-consumer.js
#
# Tests:
#   1. Consumer produces valid HTML output from an existing scoreboard
#   2. Output files exist (index.html, detail/*.html, compare/*.html)
#   3. Consumer handles missing scoreboard gracefully
#   4. Consumer handles empty entries gracefully
#   5. Consumer handles blind mode
#   6. Critical HTML structure checks
#

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
SCOREBOARD="$REPO_DIR/results/scoreboard.json"
CONSUMER="$SCRIPT_DIR/web-result-consumer.js"

if [ ! -f "$SCOREBOARD" ]; then
  echo "Pre-flight: generating scoreboard..."
  (cd "$REPO_DIR" && node scripts/score.js run >/dev/null 2>&1)
fi

if [ ! -f "$SCOREBOARD" ]; then
  echo "FAIL: No scoreboard.json available. Run 'node scripts/score.js run' first."
  exit 1
fi

PASS=0
FAIL=0
TMPDIR=""
SUMMARY=""

cleanup() {
  [ -n "$TMPDIR" ] && rm -rf "$TMPDIR"
}
trap cleanup EXIT

TMPDIR="$(mktemp -d)"
echo "Test output: $TMPDIR"
echo ""

# ---------------------------------------------------------------------------
# Test 1: Normal run produces expected output files
# ---------------------------------------------------------------------------
echo "=== Test 1: Normal run ==="
if node "$CONSUMER" "$SCOREBOARD" --output-dir "$TMPDIR/out1" > /dev/null 2>&1 && [ -f "$TMPDIR/out1/index.html" ]; then
  echo "  PASS: index.html created"
  PASS=$((PASS+1))
else
  echo "  FAIL: index.html not created"
  FAIL=$((FAIL+1))
fi

if [ -d "$TMPDIR/out1/detail" ] && [ "$(ls -A "$TMPDIR/out1/detail" 2>/dev/null)" ]; then
  echo "  PASS: detail pages created"
  PASS=$((PASS+1))
else
  echo "  FAIL: no detail pages"
  FAIL=$((FAIL+1))
fi

if [ -d "$TMPDIR/out1/compare" ] && [ "$(ls -A "$TMPDIR/out1/compare" 2>/dev/null)" ]; then
  echo "  PASS: comparison views created"
  PASS=$((PASS+1))
else
  echo "  FAIL: no comparison views"
  FAIL=$((FAIL+1))
fi

# ---------------------------------------------------------------------------
# Test 2: HTML structure checks
# ---------------------------------------------------------------------------
echo ""
echo "=== Test 2: HTML structure ==="
# Check for DOCTYPE
if head -1 "$TMPDIR/out1/index.html" | grep -q '<!DOCTYPE html>'; then
  echo "  PASS: index.html has DOCTYPE"
  PASS=$((PASS+1))
else
  echo "  FAIL: index.html missing DOCTYPE"
  FAIL=$((FAIL+1))
fi

# Check for closing tags
if grep -q '</html>' "$TMPDIR/out1/index.html"; then
  echo "  PASS: index.html has closing html tag"
  PASS=$((PASS+1))
else
  echo "  FAIL: index.html missing closing html tag"
  FAIL=$((FAIL+1))
fi

# Check leaderboard table exists
if grep -q '<table>' "$TMPDIR/out1/index.html"; then
  echo "  PASS: index.html has table"
  PASS=$((PASS+1))
else
  echo "  FAIL: index.html missing table"
  FAIL=$((FAIL+1))
fi

# Check detail page has scorecard
if grep -q 'Scorecard' "$TMPDIR/out1/detail/"*.html 2>/dev/null; then
  echo "  PASS: detail pages have Scorecard section"
  PASS=$((PASS+1))
else
  echo "  FAIL: detail pages missing Scorecard"
  FAIL=$((FAIL+1))
fi

# Check detail page has navigation back to leaderboard
if grep -q 'Leaderboard' "$TMPDIR/out1/detail/"*.html 2>/dev/null; then
  echo "  PASS: detail pages have Leaderboard back-link"
  PASS=$((PASS+1))
else
  echo "  FAIL: detail pages missing back-link"
  FAIL=$((FAIL+1))
fi

# Check comparison page has table
if grep -q '<table' "$TMPDIR/out1/compare/"*.html 2>/dev/null; then
  echo "  PASS: comparison pages have tables"
  PASS=$((PASS+1))
else
  echo "  FAIL: comparison pages missing tables"
  FAIL=$((FAIL+1))
fi

# ---------------------------------------------------------------------------
# Test 3: Blind mode
# ---------------------------------------------------------------------------
echo ""
echo "=== Test 3: Blind mode ==="
if node "$CONSUMER" "$SCOREBOARD" --output-dir "$TMPDIR/out3" --blind > /dev/null 2>&1 && [ -f "$TMPDIR/out3/index.html" ]; then
  echo "  PASS: blind mode produces output"
  PASS=$((PASS+1))
else
  echo "  FAIL: blind mode failed"
  FAIL=$((FAIL+1))
fi

# Verify blind banner present
if grep -q 'Blind scoring mode' "$TMPDIR/out3/index.html"; then
  echo "  PASS: blind mode banner present"
  PASS=$((PASS+1))
else
  echo "  FAIL: blind mode banner missing"
  FAIL=$((FAIL+1))
fi

# ---------------------------------------------------------------------------
# Test 4: Missing scoreboard
# ---------------------------------------------------------------------------
echo ""
echo "=== Test 4: Missing scoreboard ==="
node "$CONSUMER" "$TMPDIR/nonexistent.json" --output-dir "$TMPDIR/out4" > /dev/null 2>&1 && {
  echo "  FAIL: consumer should exit non-zero for missing scoreboard"
  FAIL=$((FAIL+1))
} || {
  echo "  PASS: consumer exits non-zero for missing scoreboard"
  PASS=$((PASS+1))
}

# ---------------------------------------------------------------------------
# Test 5: Empty entries
# ---------------------------------------------------------------------------
echo ""
echo "=== Test 5: Empty entries ==="
echo '{"schema_version":1,"entries":[],"participants":[],"summary":{}}' > "$TMPDIR/empty.json"
if node "$CONSUMER" "$TMPDIR/empty.json" --output-dir "$TMPDIR/out5" > /dev/null 2>&1 && [ -f "$TMPDIR/out5/index.html" ]; then
  echo "  PASS: consumer handles empty scoreboard"
  PASS=$((PASS+1))
else
  echo "  FAIL: consumer fails on empty scoreboard"
  FAIL=$((FAIL+1))
fi

# ---------------------------------------------------------------------------
# Test 6: Custom title
# ---------------------------------------------------------------------------
echo ""
echo "=== Test 6: Custom title ==="
node "$CONSUMER" "$SCOREBOARD" --output-dir "$TMPDIR/out6" --title "Custom Test Title" > /dev/null 2>&1 || true
if grep -q 'Custom Test Title' "$TMPDIR/out6/index.html" 2>/dev/null; then
  echo "  PASS: custom title rendered"
  PASS=$((PASS+1))
else
  echo "  FAIL: custom title missing"
  FAIL=$((FAIL+1))
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=== Results ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo "Total:  $((PASS+FAIL))"

if [ "$FAIL" -gt 0 ]; then
  echo "FAILURE: $FAIL test(s) failed"
  exit 1
fi
echo "SUCCESS: All tests passed"
