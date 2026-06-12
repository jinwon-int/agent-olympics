#!/usr/bin/env bash
# Reference local_exec wrapper for running an Agent Olympics task through a
# generic coding-agent CLI (Claude Code, Codex, or any argv command) and
# converting the agent output into standard artifacts.
#
# This is the CLI analogue of adapters/wrappers/hermes-mission-wrapper.sh. It
# shares the live runner, the merge logic (generalized in
# scripts/lib/mission-result-merge.js, `cli` profile), the secret-patterns, and
# the attestation discipline rather than duplicating them.
#
# Honesty: this is the simulation/source-only slice. By default it points at a
# fake `claude`-like binary fixture so it runs fully offline. Pointing
# CLI_AGENT_BIN at a real Claude Code / Codex install is an operator extension
# (the wrapper does not own model endpoints or credentials).
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

# The coding-agent CLI to invoke. Default `claude`; operators set CLI_AGENT_BIN
# to codex / any argv command. CLI_AGENT_ARGS is the (space-separated) run
# subcommand/flags the agent needs (e.g. "-p" for claude print mode). The
# wrapper appends the mission prompt as the final argument.
CLI_AGENT_BIN="${CLI_AGENT_BIN:-claude}"
CLI_AGENT_ARGS="${CLI_AGENT_ARGS:-}"

mkdir -p "$RUN_DIR" "$RUN_DIR/evidence"

# 1) Generate schema-valid baseline artifacts with the CLI adapter skeleton.
#    Actual agent content is merged into these artifacts below. The skeleton's
#    runtime/adapter labels are `cli`, so the live runner treats this as a CLI
#    participant (not hermes).
CLI_VERSION="$($CLI_AGENT_BIN --version 2>/dev/null | head -n 1 | awk '{print $NF}' || printf 'unknown')"
node "$REPO/scripts/cli-adapter.js" "$ENVELOPE" \
  --run-dir "$RUN_DIR" \
  --agent-id "$AGENT_ID" \
  --runtime-version "$CLI_VERSION" \
  > "$RUN_DIR/adapter-bootstrap.log" 2>&1
ADAPTER_STATUS=$?
if [[ $ADAPTER_STATUS -ne 0 ]]; then
  cat "$RUN_DIR/adapter-bootstrap.log" >&2 || true
  exit 1
fi

PROMPT_FILE="$RUN_DIR/cli-mission-prompt.md"
MISSION_OUTPUT="$RUN_DIR/cli-mission-output.txt"

# The mission prompt is derived from the task envelope (objective, writable
# workspace via environment.repo_path, forbidden actions, required outputs)
# by the shared builder — see scripts/lib/mission-prompt.js for the rules.
node "$REPO/scripts/lib/mission-prompt.js" "$ENVELOPE" \
  --agent-id "$AGENT_ID" --repo "$REPO" --profile cli \
  > "$PROMPT_FILE"
if [[ $? -ne 0 ]]; then
  echo "ERROR: mission prompt generation failed." >&2
  exit 1
fi

# 2) Invoke the coding-agent CLI. Capture stdout+stderr to a file so the
#    wrapper preserves useful output even if the CLI exits non-zero after
#    printing a complete answer. Wall time is measured so the merge script
#    records the real duration instead of a skeleton default. The prompt is
#    passed as the final argv element (never through a shell).
CLI_T0=$(date +%s)
set +e
python3 - "$CLI_AGENT_BIN" "$CLI_AGENT_ARGS" "$PROMPT_FILE" "$MISSION_OUTPUT" <<'PY'
import pathlib
import shlex
import subprocess
import sys

cli_bin, cli_args, prompt_file, output_file = sys.argv[1:5]
prompt = pathlib.Path(prompt_file).read_text(encoding='utf-8')
argv = [cli_bin] + shlex.split(cli_args) + [prompt]
proc = subprocess.run(
    argv,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
)
pathlib.Path(output_file).write_text(proc.stdout, encoding='utf-8')
sys.exit(proc.returncode)
PY
CLI_STATUS=$?
set -e
CLI_WALL_SECONDS=$(( $(date +%s) - CLI_T0 ))

# 3a) Model attestation: detect the routed model from the CLI config/version
#     instead of trusting the operator env. Precedence: detected > operator env
#     fallback > unknown. CLI_AGENT_INFO_ARGS overrides the candidate info
#     invocations when the CLI prints its Model line under a different command.
DETECT_OUT="$(node "$REPO/scripts/cli-model-detect.js" --bin "$CLI_AGENT_BIN" ${CLI_AGENT_INFO_ARGS:+--args "$CLI_AGENT_INFO_ARGS"} 2>/dev/null)" || DETECT_OUT=""
IFS=$'\t' read -r DETECTED_MODEL DETECTED_PROVIDER <<< "$(printf '%s' "$DETECT_OUT" | python3 -c '
import json, sys
try:
    j = json.load(sys.stdin)
    print((j.get("model") or "") + "\t" + (j.get("provider") or "") if j.get("detected") else "\t")
except Exception:
    print("\t")
')"
CLI_MODEL_SOURCE="unknown"
if [[ -n "$DETECTED_MODEL" ]]; then
  if [[ -n "${CLI_AGENT_MODEL:-}" && "$CLI_AGENT_MODEL" != "$DETECTED_MODEL" ]]; then
    echo "WARNING: CLI_AGENT_MODEL env (\"$CLI_AGENT_MODEL\") differs from the model detected from the CLI (\"$DETECTED_MODEL\") — using the detected value." >&2
  fi
  CLI_MODEL="$DETECTED_MODEL"
  CLI_MODEL_PROVIDER="${DETECTED_PROVIDER:-unknown}"
  CLI_MODEL_SOURCE="cli_config"
elif [[ -n "${CLI_AGENT_MODEL:-}" ]]; then
  CLI_MODEL="$CLI_AGENT_MODEL"
  CLI_MODEL_PROVIDER="${CLI_AGENT_MODEL_PROVIDER:-unknown}"
  CLI_MODEL_SOURCE="operator_env"
fi

# 3b) Merge actual agent output into the schema-valid artifacts and validate.
#     The merge logic is shared with the Hermes wrapper (cli profile). Unset
#     values are recorded as "unknown" — never a fabricated default.
CLI_WALL_SECONDS="$CLI_WALL_SECONDS" \
CLI_MODEL="${CLI_MODEL:-}" \
CLI_MODEL_PROVIDER="${CLI_MODEL_PROVIDER:-}" \
CLI_MODEL_SOURCE="$CLI_MODEL_SOURCE" \
CLI_NODE="${CLI_NODE:-}" \
node "$REPO/scripts/cli-mission-result-merge.js" "$ENVELOPE" "$RUN_DIR" "$MISSION_OUTPUT" "$CLI_STATUS" \
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

printf 'adapter_status=%s\ncli_status=%s\nmerge_status=%s\nvalidate_status=%s\nparse_fallback=%s\n' \
  "$ADAPTER_STATUS" "$CLI_STATUS" "$MERGE_STATUS" "$VALIDATE_STATUS" "$PARSE_FALLBACK" \
  > "$RUN_DIR/wrapper-status.env"

if [[ "$PARSE_FALLBACK" -eq 1 ]]; then
  echo "WARNING: CLI agent output was not parseable JSON — packet downgraded to partial (exit 2)." >&2
  exit 2
fi

exit 0
