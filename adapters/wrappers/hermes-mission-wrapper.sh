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
# Adapter bootstrap knobs (env overrides; defaults match the original wrapper).
HERMES_EVENT_FAMILY="${HERMES_EVENT_FAMILY:-ops}"
HERMES_MODE="${HERMES_MODE:-orchestrator}"

mkdir -p "$RUN_DIR" "$RUN_DIR/evidence"

# 1) Generate schema-valid baseline artifacts with the reference Hermes adapter.
#    Actual mission content is merged into these artifacts below.
HERMES_VERSION="$($HERMES_BIN --version 2>/dev/null | head -n 1 | sed 's/^Hermes Agent v//' | awk '{print $1}' || printf 'unknown')"
node "$REPO/adapters/hermes-adapter.js" "$ENVELOPE" \
  --run-dir "$RUN_DIR" \
  --agent-id "$AGENT_ID" \
  --mode "$HERMES_MODE" \
  --event-family "$HERMES_EVENT_FAMILY" \
  --runtime-version "$HERMES_VERSION" \
  > "$RUN_DIR/adapter-bootstrap.log" 2>&1
ADAPTER_STATUS=$?
if [[ $ADAPTER_STATUS -ne 0 ]]; then
  cat "$RUN_DIR/adapter-bootstrap.log" >&2 || true
  exit 1
fi

PROMPT_FILE="$RUN_DIR/hermes-mission-prompt.md"
MISSION_OUTPUT="$RUN_DIR/hermes-mission-output.txt"

# Toolset derivation (judge-notes §3.5 fleet fan-in follow-up): the nested
# session was previously hardcoded to `--toolsets file`, which contradicted
# the prompt's "run the tests" instruction on bench tasks — capping honest
# evidence and incentivizing fabricated execution claims. Precedence:
# HERMES_TOOLSETS operator override > envelope repo_path bench with the exec
# toolset (default "shell", HERMES_EXEC_TOOLSET overrides the name) when the
# local `hermes chat --help` advertises it > `file` fallback. The derived
# list and its source are attested into the result packet by the merge step.
HERMES_CHAT_HELP="$($HERMES_BIN chat --help 2>&1 || true)"
TOOLSETS_JSON="$(printf '%s' "$HERMES_CHAT_HELP" | node "$REPO/scripts/lib/mission-toolsets.js" "$ENVELOPE" \
  --override "${HERMES_TOOLSETS:-}" \
  --exec-toolset "${HERMES_EXEC_TOOLSET:-shell}" \
  --help-text-file -)" || TOOLSETS_JSON=""
IFS=$'\t' read -r HERMES_TOOLSETS_USED HERMES_TOOLSETS_SOURCE <<< "$(printf '%s' "$TOOLSETS_JSON" | python3 -c '
import json, sys
try:
    j = json.load(sys.stdin)
    print((j.get("toolsets") or "file") + "\t" + (j.get("source") or "unknown"))
except Exception:
    print("file\tderivation_error_file")
')"
if [[ "$HERMES_TOOLSETS_SOURCE" == probe_* || "$HERMES_TOOLSETS_SOURCE" == derivation_error_file ]]; then
  echo "WARNING: bench task fell back to file-only toolsets (source=$HERMES_TOOLSETS_SOURCE) — the §3.5 evidence ceiling applies to this run." >&2
fi

# The mission prompt is derived from the task envelope (objective, writable
# workspace via environment.repo_path, forbidden actions, required outputs)
# and the attested toolsets — see scripts/lib/mission-prompt.js for the rules.
node "$REPO/scripts/lib/mission-prompt.js" "$ENVELOPE" \
  --agent-id "$AGENT_ID" --repo "$REPO" --profile hermes \
  --toolsets "$HERMES_TOOLSETS_USED" \
  > "$PROMPT_FILE"
if [[ $? -ne 0 ]]; then
  echo "ERROR: mission prompt generation failed." >&2
  exit 1
fi

# 2) Invoke the real local Hermes CLI. Capture stdout+stderr to a file so the
#    wrapper can still preserve useful output if a local Hermes build exits
#    non-zero after printing a complete answer. Wall time is measured so the
#    merge script records the real duration instead of a skeleton default.
HERMES_T0=$(date +%s)
set +e
python3 - "$HERMES_BIN" "$PROMPT_FILE" "$MISSION_OUTPUT" "$HERMES_TOOLSETS_USED" <<'PY'
import pathlib
import subprocess
import sys

hermes_bin, prompt_file, output_file, toolsets = sys.argv[1:5]
prompt = pathlib.Path(prompt_file).read_text(encoding='utf-8')
proc = subprocess.run(
    [hermes_bin, 'chat', '-Q', '-q', prompt, '--toolsets', toolsets],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
)
pathlib.Path(output_file).write_text(proc.stdout, encoding='utf-8')
sys.exit(proc.returncode)
PY
HERMES_STATUS=$?
set -e
HERMES_WALL_SECONDS=$(( $(date +%s) - HERMES_T0 ))

# 3a) Model attestation: detect the routed model from the local Hermes config
#     instead of trusting the operator env (a real fleet run shipped a wrong
#     env label). Precedence: detected > operator env fallback > unknown.
#     HERMES_INFO_ARGS overrides the candidate info invocations when the
#     local Hermes prints its Model line under a different subcommand.
DETECT_OUT="$(node "$REPO/scripts/hermes-model-detect.js" --bin "$HERMES_BIN" ${HERMES_INFO_ARGS:+--args "$HERMES_INFO_ARGS"} 2>/dev/null)" || DETECT_OUT=""
IFS=$'\t' read -r DETECTED_MODEL DETECTED_PROVIDER <<< "$(printf '%s' "$DETECT_OUT" | python3 -c '
import json, sys
try:
    j = json.load(sys.stdin)
    print((j.get("model") or "") + "\t" + (j.get("provider") or "") if j.get("detected") else "\t")
except Exception:
    print("\t")
')"
HERMES_MODEL_SOURCE="unknown"
if [[ -n "$DETECTED_MODEL" ]]; then
  if [[ -n "${HERMES_MODEL:-}" && "$HERMES_MODEL" != "$DETECTED_MODEL" ]]; then
    echo "WARNING: HERMES_MODEL env (\"$HERMES_MODEL\") differs from the model detected in the Hermes config (\"$DETECTED_MODEL\") — using the detected value." >&2
  fi
  HERMES_MODEL="$DETECTED_MODEL"
  HERMES_MODEL_PROVIDER="${DETECTED_PROVIDER:-unknown}"
  HERMES_MODEL_SOURCE="hermes_config"
elif [[ -n "${HERMES_MODEL:-}" ]]; then
  HERMES_MODEL_SOURCE="operator_env"
fi

# 3b) Merge actual mission output into the schema-valid artifacts and
#     validate. Real comparable metadata is passed through env; HERMES_NODE
#     is operator-supplied; model identity comes from the attestation above.
#     Unset values are recorded as "unknown" — never a fabricated default.
HERMES_WALL_SECONDS="$HERMES_WALL_SECONDS" \
HERMES_MODEL="${HERMES_MODEL:-}" \
HERMES_MODEL_PROVIDER="${HERMES_MODEL_PROVIDER:-}" \
HERMES_MODEL_SOURCE="$HERMES_MODEL_SOURCE" \
HERMES_NODE="${HERMES_NODE:-}" \
HERMES_TOOLSETS_USED="$HERMES_TOOLSETS_USED" \
HERMES_TOOLSETS_SOURCE="$HERMES_TOOLSETS_SOURCE" \
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

# A parse-fallback packet is a partial result, not a completed mission:
# exit 2 so the live runner maps the run to "partial" (matching the packet
# status the merge script downgraded) instead of a clean completed run.
PARSE_FALLBACK=0
if grep -q 'parsed_json=false' "$RUN_DIR/mission-merge.log" 2>/dev/null; then
  PARSE_FALLBACK=1
fi

printf 'adapter_status=%s\nhermes_status=%s\nmerge_status=%s\nvalidate_status=%s\nparse_fallback=%s\ntoolsets=%s\ntoolsets_source=%s\n' \
  "$ADAPTER_STATUS" "$HERMES_STATUS" "$MERGE_STATUS" "$VALIDATE_STATUS" "$PARSE_FALLBACK" \
  "$HERMES_TOOLSETS_USED" "$HERMES_TOOLSETS_SOURCE" \
  > "$RUN_DIR/wrapper-status.env"

if [[ "$PARSE_FALLBACK" -eq 1 ]]; then
  echo "WARNING: mission output was not parseable JSON — packet downgraded to partial (exit 2)." >&2
  exit 2
fi

exit 0
