#!/usr/bin/env node
'use strict';

/**
 * Hermes toolset derivation for the live-runner Hermes wrapper.
 *
 * Why this exists (judge-notes §3.5, stage-2 fleet fan-in): the wrapper used
 * to hardcode `--toolsets file`, while the mission prompt told code-family
 * participants to run the bench's build/test commands. That contradiction
 * (a) capped evidence_quality for honest packets (no real failing/passing
 * test output is possible without an exec tool — the 12/20 oracle hard
 * criterion), and (b) created a fabrication incentive — two participants
 * asserted test runs a file-only session cannot perform.
 *
 * Derivation precedence (first match wins):
 *
 *   1. Operator override (HERMES_TOOLSETS env, passed as --override):
 *      used verbatim — the operator asserts the node supports it.
 *   2. Envelope declares `environment.repo_path` (writable bench → the
 *      mission is expected to run commands): want `file,<exec>` where
 *      <exec> defaults to "terminal" (the fleet's Hermes builds name their
 *      command-execution toolset "terminal", attested on vps6 2026-06-12;
 *      --exec-toolset overrides for builds that name it differently). The
 *      exec toolset is only enabled when a node probe confirms it — an
 *      unknown toolset value yields a session without the exec tool (vps6:
 *      "Warning: Unknown toolsets: shell"), which silently recreates the
 *      fabrication setup this change removes. Probe order:
 *        a. `hermes tools list` output mentions the toolset on a line that
 *           is not "disabled" (authoritative; vps6 prints
 *           "terminal enabled" here), else
 *        b. `hermes chat --help` mentions it near a "toolset" line (some
 *           builds list toolset names in help; vps6 does NOT — its help
 *           says only "Comma-separated toolsets to enable").
 *      Otherwise fall back to `file` and record WHY in `source`, so the
 *      run is honestly attributable to a probe fallback instead of
 *      silently mismatching the cohort.
 *   3. No repo_path → `file` (legacy read-only/diagnosis missions).
 *
 * The returned `source` is attested into the result packet (probe evidence
 * summary) and worker trace so judges can apply or lift the §3.5 evidence
 * ceiling from the packet alone:
 *
 *   operator_env          — override used verbatim
 *   tools_list_exec       — repo_path bench, exec toolset confirmed by
 *                           `hermes tools list`
 *   help_text_exec        — repo_path bench, exec toolset confirmed by
 *                           `hermes chat --help`
 *   probe_fallback_file   — repo_path bench, probes ran but lack the toolset
 *   probe_unavailable_file— repo_path bench, no probe text available
 *   default_file          — no repo_path; file-only by design
 *
 * Usage (CLI):
 *   node scripts/lib/mission-toolsets.js <envelope> \
 *     [--override "<HERMES_TOOLSETS>"] [--exec-toolset terminal] \
 *     [--tools-list-file <path>|-] [--help-text-file <path>|-]
 *   node scripts/lib/mission-toolsets.js selftest
 *
 * Prints JSON: {"toolsets": "file,terminal", "source": "tools_list_exec"}
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DEFAULT_EXEC_TOOLSET = 'terminal';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when the help text advertises the exec toolset. To avoid false
 * positives ("shell" can appear in unrelated help, e.g. shell completion),
 * the token must appear on a line mentioning "toolset" or within the two
 * lines after it (wrapped option help).
 */
function helpTextSupportsToolset(helpText, execToolset) {
  if (!helpText || !helpText.trim()) return false;
  // Hyphen counts as part of a token: "--shell-completion" must not read as
  // the "shell" toolset.
  const token = new RegExp(`(?<![\\w-])${escapeRegExp(execToolset)}(?![\\w-])`, 'i');
  const lines = helpText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!/toolset/i.test(lines[i])) continue;
    // Window: the toolset line plus its wrapped continuation lines, stopping
    // at the next flag definition (a different option's help must not count).
    const window = [lines[i]];
    for (let j = i + 1; j < lines.length && window.length < 3; j += 1) {
      if (/^\s*-{1,2}\w/.test(lines[j])) break;
      window.push(lines[j]);
    }
    if (token.test(window.join('\n'))) return true;
  }
  return false;
}

/**
 * True when `hermes tools list` output mentions the exec toolset on a line
 * that is not marked disabled (vps6 prints e.g. "terminal enabled").
 */
function toolsListSupportsToolset(toolsListText, execToolset) {
  if (!toolsListText || !toolsListText.trim()) return false;
  const token = new RegExp(`(?<![\\w-])${escapeRegExp(execToolset)}(?![\\w-])`, 'i');
  for (const line of toolsListText.split(/\r?\n/)) {
    if (token.test(line) && !/disabled/i.test(line)) return true;
  }
  return false;
}

function deriveHermesToolsets({ envelope, override, execToolset, helpText, toolsListText }) {
  const exec = (execToolset || DEFAULT_EXEC_TOOLSET).trim();
  if (override && override.trim()) {
    return { toolsets: override.trim(), source: 'operator_env' };
  }
  const repoPath = envelope && envelope.environment && envelope.environment.repo_path;
  if (!repoPath) {
    return { toolsets: 'file', source: 'default_file' };
  }
  const tools = toolsListText === null || toolsListText === undefined ? '' : String(toolsListText);
  const help = helpText === null || helpText === undefined ? '' : String(helpText);
  if (toolsListSupportsToolset(tools, exec)) {
    return { toolsets: `file,${exec}`, source: 'tools_list_exec' };
  }
  if (helpTextSupportsToolset(help, exec)) {
    return { toolsets: `file,${exec}`, source: 'help_text_exec' };
  }
  if (!tools.trim() && !help.trim()) {
    return { toolsets: 'file', source: 'probe_unavailable_file' };
  }
  return { toolsets: 'file', source: 'probe_fallback_file' };
}

// ---------------------------------------------------------------------------
// Selftest (no fixtures needed; run via `npm run test:mission_toolsets`)
// ---------------------------------------------------------------------------

function selftest() {
  const benchEnvelope = { environment: { repo_path: '/work/agent-codebench' } };
  const opsEnvelope = { environment: {} };
  // vps6-attested shapes (2026-06-12): help does NOT list toolset names;
  // `hermes tools list` is where "terminal enabled" appears.
  const helpVps6 = [
    'Usage: hermes chat [flags]',
    '  --toolsets TOOLSETS  Comma-separated toolsets to enable',
    '  --shell-completion   Generate shell completion script',
  ].join('\n');
  const toolsListVps6 = [
    'file enabled',
    'terminal enabled',
    'code_execution enabled',
  ].join('\n');
  const helpWithTerminal = [
    'Usage: hermes chat [flags]',
    '  --toolsets strings   Toolsets to enable, comma-separated.',
    '                       Available: file, terminal, web',
    '  -q string            Prompt to send',
  ].join('\n');

  const cases = [
    {
      name: 'operator override wins verbatim',
      args: { envelope: benchEnvelope, override: 'file,exec', helpText: helpVps6, toolsListText: '' },
      want: { toolsets: 'file,exec', source: 'operator_env' },
    },
    {
      name: 'no repo_path stays file-only by design',
      args: { envelope: opsEnvelope, override: '', helpText: helpWithTerminal, toolsListText: toolsListVps6 },
      want: { toolsets: 'file', source: 'default_file' },
    },
    {
      name: 'vps6 shape: tools list confirms terminal even though help names no toolsets',
      args: { envelope: benchEnvelope, override: '', helpText: helpVps6, toolsListText: toolsListVps6 },
      want: { toolsets: 'file,terminal', source: 'tools_list_exec' },
    },
    {
      name: 'help text listing terminal works without a tools list',
      args: { envelope: benchEnvelope, override: '', helpText: helpWithTerminal, toolsListText: '' },
      want: { toolsets: 'file,terminal', source: 'help_text_exec' },
    },
    {
      name: 'disabled tools-list entry does not count',
      args: { envelope: benchEnvelope, override: '', helpText: helpVps6, toolsListText: 'file enabled\nterminal disabled' },
      want: { toolsets: 'file', source: 'probe_fallback_file' },
    },
    {
      name: 'probes present but lacking the toolset fall back (shell-completion is not a toolset)',
      args: { envelope: benchEnvelope, override: '', helpText: helpVps6, toolsListText: 'file enabled' },
      want: { toolsets: 'file', source: 'probe_fallback_file' },
    },
    {
      name: 'no probe text at all falls back honestly',
      args: { envelope: benchEnvelope, override: '', helpText: '', toolsListText: '' },
      want: { toolsets: 'file', source: 'probe_unavailable_file' },
    },
    {
      name: 'custom exec toolset name is probed instead of terminal',
      args: {
        envelope: benchEnvelope,
        override: '',
        execToolset: 'exec',
        helpText: '',
        toolsListText: 'file enabled\nexec enabled',
      },
      want: { toolsets: 'file,exec', source: 'tools_list_exec' },
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const got = deriveHermesToolsets(c.args);
    const ok = got.toolsets === c.want.toolsets && got.source === c.want.source;
    if (!ok) {
      failed += 1;
      console.error(`FAIL ${c.name}: want ${JSON.stringify(c.want)} got ${JSON.stringify(got)}`);
    } else {
      console.log(`ok   ${c.name}`);
    }
  }
  if (failed > 0) {
    console.error(`${failed}/${cases.length} mission-toolsets selftest case(s) failed`);
    process.exit(1);
  }
  console.log(`mission-toolsets selftest: ${cases.length}/${cases.length} passed`);
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'selftest') {
    selftest();
    return;
  }
  let envelopePath = null;
  let override = '';
  let execToolset = DEFAULT_EXEC_TOOLSET;
  let helpTextFile = null;
  let toolsListFile = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--override') override = args[++i] || '';
    else if (args[i] === '--exec-toolset') execToolset = args[++i] || DEFAULT_EXEC_TOOLSET;
    else if (args[i] === '--help-text-file') helpTextFile = args[++i] || null;
    else if (args[i] === '--tools-list-file') toolsListFile = args[++i] || null;
    else if (!envelopePath) envelopePath = args[i];
    else { console.error(`Unknown argument: ${args[i]}`); process.exit(2); }
  }
  if (!envelopePath) {
    console.error('Usage: mission-toolsets.js <envelope> [--override <toolsets>] [--exec-toolset <name>] [--tools-list-file <path>|-] [--help-text-file <path>|-] | selftest');
    process.exit(2);
  }
  const envelope = yaml.load(fs.readFileSync(path.resolve(envelopePath), 'utf8'));
  const readProbe = (file) => {
    if (!file) return null;
    return fs.readFileSync(file === '-' ? 0 : path.resolve(file), 'utf8');
  };
  const helpText = readProbe(helpTextFile);
  const toolsListText = readProbe(toolsListFile);
  process.stdout.write(`${JSON.stringify(deriveHermesToolsets({ envelope, override, execToolset, helpText, toolsListText }))}\n`);
}

if (require.main === module) main();

module.exports = { deriveHermesToolsets, helpTextSupportsToolset, toolsListSupportsToolset };
