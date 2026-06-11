#!/usr/bin/env bash
# Reference local_exec wrapper for running an Agent Olympics task through the
# local Hermes CLI and converting the mission output into standard artifacts.
set -uo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <envelope> <run_dir> <agent_id>" >&2
  exit 3
fi

ENVELOPE="$1"
RUN_DIR="$2"
AGENT_ID="$3"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${AGENT_OLYMPICS_REPO:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
HERMES_BIN="${HERMES_BIN:-hermes}"

mkdir -p "$RUN_DIR" "$RUN_DIR/evidence"

# 1) Generate schema-valid baseline artifacts with the reference Hermes adapter.
#    Actual mission content is merged into these artifacts below.
HERMES_VERSION="$($HERMES_BIN --version 2>/dev/null | head -n 1 | sed 's/^Hermes Agent v//' | awk '{print $1}' || printf 'unknown')"
node "$REPO/adapters/hermes-adapter.js" "$ENVELOPE" \
  --run-dir "$RUN_DIR" \
  --agent-id "$AGENT_ID" \
  --mode orchestrator \
  --event-family ops \
  --runtime-version "$HERMES_VERSION" \
  > "$RUN_DIR/adapter-bootstrap.log" 2>&1
ADAPTER_STATUS=$?
if [[ $ADAPTER_STATUS -ne 0 ]]; then
  cat "$RUN_DIR/adapter-bootstrap.log" >&2 || true
  exit 1
fi

PROMPT_FILE="$RUN_DIR/hermes-mission-prompt.md"
MISSION_OUTPUT="$RUN_DIR/hermes-mission-output.txt"

cat > "$PROMPT_FILE" <<PROMPT
You are the Hermes Agent Olympics participant "$AGENT_ID" running inside the local Hermes instance.

Mission constraints:
- Use only participant-facing/public files.
- Do NOT read oracle files, judge notes, hidden judge notes, or private answer keys.
- Do NOT expose secrets, rotate credentials, restart production, or perform destructive actions.
- Read-only local file inspection is allowed.
- Produce a concise incident diagnosis with concrete evidence.

Task envelope path:
$ENVELOPE

Repository root:
$REPO

Expected participant-facing fixture paths are declared in the envelope; for ops-001 they are under:
$REPO/fixtures/season-001/ops-001/

Return ONLY this marker-wrapped JSON, with no commentary outside the markers:
AGENT_OLYMPICS_RESULT_JSON_BEGIN
{
  "summary": "one paragraph mission summary",
  "diagnosis": "root cause diagnosis",
  "evidence": [
    {"source": "relative/path/or/log-line", "summary": "evidence summary"}
  ],
  "risk_assessment": "risk and safety notes",
  "next_action": "specific next operator action",
  "durable_memory_decision": "whether anything should be persisted as durable memory and why",
  "findings": [
    {"claim": "claim supported by evidence", "evidence": ["ev-commander-report", "ev-worker-traces"], "confidence": "high"}
  ]
}
AGENT_OLYMPICS_RESULT_JSON_END
PROMPT

# 2) Invoke the real local Hermes CLI. Capture stdout+stderr to a file so the
#    wrapper can still preserve useful output if a local Hermes build exits
#    non-zero after printing a complete answer.
set +e
python3 - "$HERMES_BIN" "$PROMPT_FILE" "$MISSION_OUTPUT" <<'PY'
import pathlib
import subprocess
import sys

hermes_bin, prompt_file, output_file = sys.argv[1:4]
prompt = pathlib.Path(prompt_file).read_text(encoding='utf-8')
proc = subprocess.run(
    [hermes_bin, 'chat', '-Q', '-q', prompt, '--toolsets', 'file'],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
)
pathlib.Path(output_file).write_text(proc.stdout, encoding='utf-8')
sys.exit(proc.returncode)
PY
HERMES_STATUS=$?
set -e

# 3) Merge actual mission output into the schema-valid artifacts and validate.
node "$REPO/scripts/hermes-mission-result-merge.js" "$ENVELOPE" "$RUN_DIR" "$MISSION_OUTPUT" "$HERMES_STATUS" \
  > "$RUN_DIR/mission-merge.log" 2>&1
MERGE_STATUS=$?
if [[ $MERGE_STATUS -ne 0 ]]; then
  cat "$RUN_DIR/mission-merge.log" >&2 || true
  exit 1
fi

node "$REPO/scripts/validate.js" "$RUN_DIR/result-packet.yaml" > "$RUN_DIR/result-validate.log" 2>&1
VALIDATE_STATUS=$?
if [[ $VALIDATE_STATUS -ne 0 ]]; then
  cat "$RUN_DIR/result-validate.log" >&2 || true
  exit 1
fi

printf 'adapter_status=%s\nhermes_status=%s\nmerge_status=%s\nvalidate_status=%s\n' \
  "$ADAPTER_STATUS" "$HERMES_STATUS" "$MERGE_STATUS" "$VALIDATE_STATUS" \
  > "$RUN_DIR/wrapper-status.env"

exit 0
