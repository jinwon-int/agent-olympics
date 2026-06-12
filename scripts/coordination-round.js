#!/usr/bin/env node
/**
 * Agent Olympics Coordination Round Orchestrator
 *
 * A thin two-stage orchestration layer OVER the single-participant live runner
 * (scripts/live-runner.js). It does NOT re-implement dispatch, artifact
 * capture, fan-in, redaction, or identity logic — it requires those functions
 * from the live runner and drives them once per stage.
 *
 * Stages:
 *   1. Worker stage   — N worker participants each run the *probe* envelope
 *                       (independent investigation of the same question) via
 *                       the live runner → N result packets.
 *   2. Finalizer stage— one finalizer participant runs the *merge* envelope.
 *                       The workers' PARTICIPANT-FACING findings are injected
 *                       into the finalizer's envelope as a public `worker_reports`
 *                       field (a worker-reports evidence file the finalizer
 *                       reads). The injection path is scanned with the SAME
 *                       oracle-reference and secret scans the live runner uses,
 *                       so oracle/judge material can never leak through it.
 *   3. Solo baseline  — one participant runs the *merge* envelope ALONE (no
 *                       injected worker findings) for the was-delegation-worth-it
 *                       comparison.
 *
 * The finalizer's commander-report packet is a normal result packet scored by
 * the existing judge harness against the merge envelope's rubric/oracle. This
 * orchestrator adds the A2A-effectiveness signal: an a2a-effectiveness record
 * (validated against fixtures/a2a-effectiveness/a2a-effectiveness-record.schema.json)
 * capturing mode, participants, metrics, and benchmark-validity caveats.
 *
 * Boundaries (honest):
 *   - No network. Workers run via the SAME local_exec transport the live runner
 *     uses. Real multi-node live execution is an operator extension that reuses
 *     the live runner's remote transport — out of scope here.
 *   - Oracle files and hidden judge notes never enter any participant-facing
 *     artifact, including the worker-reports injection.
 *   - Fixture output goes to a gitignored runs/ path and is cleaned up.
 *
 * Usage:
 *   node scripts/coordination-round.js run <coordination-manifest> [--run-directory <dir>] [--verbose]
 *   node scripts/coordination-round.js fixtures
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const {
  dispatchRound,
  faninRound,
  scanTextForOracleReferences,
  scanObjectForSecretFields,
} = require('./live-runner');

const ROOT = path.resolve(__dirname, '..');
const RUNNER_CONFIG_KIND = 'agent-olympics.live-runner.config';
const COORD_CONFIG_KIND = 'agent-olympics.coordination-round';
const A2A_BENCHMARK_VERSION = 'agent-olympics-a2a-effectiveness-v1';

const EXIT_OK = 0;
const EXIT_ERROR = 1;

class CoordinationError extends Error {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function repoPath(rel) {
  return path.isAbsolute(rel) ? rel : path.resolve(ROOT, rel);
}

function loadYaml(filePath) {
  const abs = repoPath(filePath);
  if (!fs.existsSync(abs)) throw new CoordinationError(`File not found: ${filePath}`);
  return yaml.load(fs.readFileSync(abs, 'utf8'));
}

function writeYaml(filePath, doc) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, yaml.dump(doc, { indent: 2, lineWidth: 120, noRefs: true }), 'utf8');
}

function isoNow() {
  return new Date().toISOString();
}

function ajvValidator(schemaRelPath) {
  const Ajv = require('ajv/dist/2020');
  const addFormats = require('ajv-formats');
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, schemaRelPath), 'utf8'));
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

function validateCoordinationManifest(manifest, manifestPath) {
  const validate = ajvValidator('schemas/coordination-round.schema.json');
  if (!validate(manifest)) {
    const errs = (validate.errors || []).map((e) => `${e.instancePath || '(root)'} ${e.message}`);
    throw new CoordinationError(`Coordination manifest invalid (${manifestPath}):\n  - ${errs.join('\n  - ')}`);
  }
  return manifest;
}

// ---------------------------------------------------------------------------
// Per-stage round manifest + runner config synthesis
// ---------------------------------------------------------------------------
// The live runner consumes a (round manifest, runner config) pair. The
// coordination manifest is NOT a round manifest, so for each stage we
// synthesize a minimal, schema-valid round manifest + runner config into the
// temp run base and hand them to dispatchRound(). This is the reuse seam: all
// dispatch/capture/fan-in/redaction/identity logic stays in the live runner.

function synthRoundManifest(coord, stage, participants, task, runDir) {
  return {
    schema_version: 1,
    round_id: coord.round_id,
    season: coord.season,
    title: `${coord.title} — ${stage} stage`,
    lifecycle: {
      status: 'running',
      status_history: [{ status: 'running', timestamp: isoNow(), note: `coordination-round ${stage} stage` }],
    },
    tasks: [{
      task_id: task.task_id,
      title: task.title || task.task_id,
      envelope_path: task.envelope_path,
      time_limit_minutes: task.time_limit_minutes,
      fixture_bundle_ref: task.fixture_bundle_ref,
      scoring_rubric: task.scoring_rubric || coord.scoring_rubric,
    }],
    participants: participants.map((p) => ({
      agent_id: p.agent_id,
      adapter: p.adapter,
      runtime: p.runtime,
      label: p.label || p.agent_id,
      model: p.model,
      model_provider: p.model_provider,
      node: p.node,
      enabled: true,
    })).map((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined))),
    run_directory: path.relative(ROOT, runDir),
    run_id_template: 'run-{task_id}-{agent_id}-{timestamp}',
  };
}

function synthRunnerConfig(coord, stage, participants) {
  return {
    schema_version: 1,
    config_kind: RUNNER_CONFIG_KIND,
    runner_id: `coordination-${coord.coordination_id}-${stage}`,
    description: `Synthesized by coordination-round.js for the ${stage} stage of ${coord.coordination_id}.`,
    participants: participants.map((p) => ({
      participant_id: p.agent_id,
      adapter: p.adapter,
      transport: 'local_exec',
      execution_profile: 'dry_run',
      command: p.command,
    })),
  };
}

/**
 * Run one stage through the live runner: synthesize manifest+config, dispatch,
 * fan in. Returns { dispatch, fanin, manifestPath } with clean runs ready for
 * judge handoff. Throws if the stage produced no clean runs.
 */
async function runStage(coord, stageName, participants, task, runBase, options) {
  const stageDir = path.join(runBase, stageName);
  fs.mkdirSync(stageDir, { recursive: true });
  const manifest = synthRoundManifest(coord, stageName, participants, task, stageDir);
  const config = synthRunnerConfig(coord, stageName, participants);
  const manifestPath = path.join(stageDir, 'round-manifest.yaml');
  writeYaml(manifestPath, manifest);
  writeYaml(path.join(stageDir, 'runner-config.yaml'), config);

  if (options.verbose) console.log(`\n=== Stage: ${stageName} (${participants.length} participant(s)) ===`);
  const dispatch = await dispatchRound(manifestPath, config, {
    runDirectory: stageDir, dryRunOnly: false, verbose: options.verbose,
  });
  const fanin = faninRound(dispatch.runDirBaseAbs);
  return { dispatch, fanin, stageDir, runDirBaseAbs: dispatch.runDirBaseAbs };
}

// ---------------------------------------------------------------------------
// Worker findings collection + injection (participant-facing ONLY)
// ---------------------------------------------------------------------------

/**
 * Collect each clean worker run's participant-facing findings from its judge
 * handoff result packet (NOT the oracle, NOT judge notes). Returns an array of
 * { worker, status, summary, findings: [{claim, confidence}] }.
 */
function collectWorkerFindings(stage) {
  const handoffRoot = stage.runDirBaseAbs;
  const reports = [];
  for (const run of stage.fanin.runs) {
    if (run.decision !== 'clean' || !run.handoff) continue;
    const packetPath = path.join(ROOT, run.handoff, 'result-packet.yaml');
    if (!fs.existsSync(packetPath)) continue;
    const packet = yaml.load(fs.readFileSync(packetPath, 'utf8'));
    reports.push({
      worker: run.participant_id,
      status: packet.status,
      summary: String(packet.summary || '').trim(),
      findings: (packet.findings || []).map((f) => ({
        claim: String(f.claim || '').trim(),
        confidence: f.confidence || 'unspecified',
      })),
    });
  }
  return reports;
}

/**
 * Build the worker-reports evidence object that is injected into the
 * finalizer's envelope as a PUBLIC field. Scans the assembled object with the
 * same oracle-reference and secret scans the live runner applies to
 * participant-facing artifacts. Throws on any oracle/judge/secret leak — this
 * is the guarantee that only worker participant-facing findings flow through.
 */
function buildWorkerReportsEvidence(coordinationId, reports) {
  const evidence = {
    evidence_kind: 'a2a_worker_reports',
    note: 'Participant-facing findings produced independently by worker nodes in the worker stage. Injected as evidence for the finalizer merge. Contains NO oracle, judge-notes, or credential material.',
    coordination_id: coordinationId,
    worker_count: reports.length,
    reports,
  };

  const serialized = yaml.dump(evidence, { noRefs: true });
  const oracleHits = scanTextForOracleReferences(serialized);
  if (oracleHits.length > 0) {
    throw new CoordinationError(
      `Worker-reports injection blocked: oracle/judge reference detected (${oracleHits.join(', ')}). `
      + 'Only participant-facing worker findings may flow to the finalizer.'
    );
  }
  const secretFields = scanObjectForSecretFields(evidence);
  if (secretFields.length > 0) {
    throw new CoordinationError(
      `Worker-reports injection blocked: secret-bearing field(s) at ${secretFields.join(', ')}.`
    );
  }
  return evidence;
}

/**
 * Synthesize the finalizer's merge envelope copy with the worker reports
 * embedded as a PUBLIC field. The live runner re-sanitizes this envelope
 * (stripping any private fields) and scans the participant-facing copy for
 * oracle references at fan-in, so the injection is defense-in-depth checked.
 */
function writeFinalizerEnvelope(mergeTask, workerEvidence, stageDir) {
  const baseEnvelope = loadYaml(mergeTask.envelope_path);
  const merged = JSON.parse(JSON.stringify(baseEnvelope));
  merged.worker_reports = workerEvidence; // participant-facing public field
  const envPath = path.join(stageDir, 'merge-envelope-with-worker-reports.yaml');
  writeYaml(envPath, merged);
  return envPath;
}

// ---------------------------------------------------------------------------
// A2A-effectiveness record
// ---------------------------------------------------------------------------

function countFinalizerFindings(stage) {
  const run = stage.fanin.runs.find((r) => r.decision === 'clean' && r.handoff);
  if (!run) return { findings: 0, status: null };
  const packetPath = path.join(ROOT, run.handoff, 'result-packet.yaml');
  if (!fs.existsSync(packetPath)) return { findings: 0, status: null };
  const packet = yaml.load(fs.readFileSync(packetPath, 'utf8'));
  return { findings: (packet.findings || []).length, status: packet.status };
}

/**
 * Build the A2A-effectiveness record from the three stages' outcomes. The
 * record is intentionally conservative: this is a simulated/dry-run
 * coordination (local_exec simulation transports), so validity is
 * "diagnostic" and the caveats spell that out.
 */
function buildA2aRecord(coord, workerStage, finalizerStage, soloStage, workerReports) {
  const workers = coord.coordination.workers.map((w) => w.agent_id);
  const finalizer = coord.coordination.finalizer.agent_id;
  const solo = coord.coordination.solo_baseline.agent_id;

  const cleanWorkers = workerStage.fanin.runs.filter((r) => r.decision === 'clean').length;
  const finFindings = countFinalizerFindings(finalizerStage);
  const soloFindings = countFinalizerFindings(soloStage);

  // Independent findings surfaced by workers (proxy: distinct worker claims).
  const workerClaimCount = workerReports.reduce((s, r) => s + r.findings.length, 0);
  // "Unique" findings the solo path plausibly missed: workers collectively
  // surfaced more candidate claims than the solo baseline reported.
  const uniqueWorkerFindings = Math.max(0, workerClaimCount - soloFindings.findings);

  return {
    benchmarkVersion: A2A_BENCHMARK_VERSION,
    sampleId: `coord-sim-${coord.coordination_id}-${Date.now().toString(36)}`,
    standingBenchmark: 'agent-olympics',
    repo: 'jinwon-int/agent-olympics',
    taskType: coord.task_type || 'read_only_no_change_audit',
    mode: coord.coordination.mode,
    validity: 'diagnostic',
    participants: {
      finalizer,
      soloAgent: solo,
      workers,
    },
    milestones: {
      workStartedAt: isoNow(),
      soloCloseoutAt: isoNow(),
      firstCrosscheckEvidenceAt: workerReports.length > 0 ? isoNow() : null,
      followupOpenedAt: null,
      repairPrOpenedAt: null,
      repairMergedAt: null,
      closeoutAt: isoNow(),
    },
    metrics: {
      timeToEvidenceSeconds: null,
      timeToDecisionSeconds: null,
      timeToCloseoutSeconds: null,
      activeFinalizerSeconds: null,
      totalAgentSeconds: null,
      workerCount: workers.length,
      foundDefectsCount: workerClaimCount,
      confirmedDefectsCount: uniqueWorkerFindings,
      falseDoneCount: 0,
      falseBlockCount: 0,
      followupIssueCount: 0,
      reopenCount7d: null,
      boundaryFindingCount: 1,
    },
    defects: workerReports.length > 0 ? [{
      id: `finding-worker-independent-${coord.coordination_id}`,
      kind: uniqueWorkerFindings > 0 ? 'missing_evidence' : 'duplicate_or_low_value',
      foundBy: workers[0],
      confirmed: uniqueWorkerFindings > 0,
    }] : [],
    boundaryFindings: [{
      boundary: 'simulated-coordination-no-live-dispatch',
      observed: 'Worker and finalizer stages ran via the live runner local_exec simulation transport. No network, no live A2A dispatch, no credential movement. Worker findings were injected as a participant-facing envelope field, oracle-scanned before injection.',
    }],
    outcome: {
      decision: 'no_repair_needed',
      followupWindowComplete: false,
    },
    caveats: [
      'Simulated/dry-run coordination: stages ran through the live runner local_exec simulation transport, not a live multi-node A2A trial.',
      'Not a matched solo-vs-A2A pair under identical seeds; uniqueWorkerFindings is a claim-count proxy, not a judged defect delta.',
      `Clean worker runs: ${cleanWorkers}/${workers.length}. Finalizer findings: ${finFindings.findings}. Solo-baseline findings: ${soloFindings.findings}.`,
      'Real multi-node live execution reuses the live runner remote transport (operator extension) and would upgrade validity beyond diagnostic.',
    ],
  };
}

function validateA2aRecord(record) {
  const validate = ajvValidator('fixtures/a2a-effectiveness/a2a-effectiveness-record.schema.json');
  if (!validate(record)) {
    const errs = (validate.errors || []).map((e) => `${e.instancePath || '(root)'} ${e.message}`);
    throw new CoordinationError(`A2A-effectiveness record invalid:\n  - ${errs.join('\n  - ')}`);
  }
  // Mirror validate-a2a-effectiveness.js cross-check.
  if (record.metrics.workerCount !== record.participants.workers.length) {
    throw new CoordinationError('workerCount does not match participants.workers length');
  }
  return record;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function runCoordinationRound(manifestPath, options) {
  const coord = validateCoordinationManifest(loadYaml(manifestPath), manifestPath);
  if (coord.config_kind !== COORD_CONFIG_KIND) {
    throw new CoordinationError(`config_kind must be ${COORD_CONFIG_KIND}`);
  }

  const runBase = options.runDirectory
    ? repoPath(options.runDirectory)
    : path.join(ROOT, 'runs', 'coordination', coord.coordination_id);
  fs.mkdirSync(runBase, { recursive: true });

  console.log(`\n### Coordination round: ${coord.coordination_id} (mode=${coord.coordination.mode}) ###`);

  // --- Stage 1: workers run the probe envelope independently. ---
  const workerStage = await runStage(
    coord, 'worker', coord.coordination.workers, coord.coordination.worker_probe, runBase, options
  );
  if (workerStage.fanin.clean === 0) {
    throw new CoordinationError('Worker stage produced no clean runs — cannot proceed to finalizer.');
  }

  // --- Collect worker findings (participant-facing) and build injection. ---
  const workerReports = collectWorkerFindings(workerStage);
  const workerEvidence = buildWorkerReportsEvidence(coord.coordination_id, workerReports);

  // --- Stage 2: finalizer runs the merge envelope WITH worker findings. ---
  const finalizerStageDir = path.join(runBase, 'finalizer');
  fs.mkdirSync(finalizerStageDir, { recursive: true });
  const finalizerEnvPath = writeFinalizerEnvelope(
    coord.coordination.merge, workerEvidence, finalizerStageDir
  );
  const mergeTaskWithInjection = {
    ...coord.coordination.merge,
    envelope_path: path.relative(ROOT, finalizerEnvPath),
  };
  const finalizerStage = await runStage(
    coord, 'finalizer', [coord.coordination.finalizer], mergeTaskWithInjection, runBase, options
  );

  // Oracle-isolation assertion: scan the participant-facing finalizer envelope
  // copy (what the finalizer actually saw) with the runner's oracle scan.
  const finalizerEnvCopies = [];
  for (const run of finalizerStage.dispatch.report.runs) {
    const copy = path.join(ROOT, run.run_dir, 'envelope.yaml');
    if (fs.existsSync(copy)) finalizerEnvCopies.push(copy);
  }
  for (const copy of finalizerEnvCopies) {
    const hits = scanTextForOracleReferences(fs.readFileSync(copy, 'utf8'));
    if (hits.length > 0) {
      throw new CoordinationError(`Oracle reference leaked into finalizer envelope copy ${copy}: ${hits.join(', ')}`);
    }
  }

  // --- Stage 3: solo baseline runs the merge envelope ALONE (no injection). ---
  const soloStage = await runStage(
    coord, 'solo', [coord.coordination.solo_baseline], coord.coordination.merge, runBase, options
  );

  // --- Emit + validate the A2A-effectiveness record. ---
  const record = buildA2aRecord(coord, workerStage, finalizerStage, soloStage, workerReports);
  validateA2aRecord(record);
  const recordPath = path.join(runBase, 'a2a-effectiveness-record.jsonl');
  fs.writeFileSync(recordPath, `${JSON.stringify(record)}\n`, 'utf8');

  // --- Coordination report. ---
  const report = {
    schema_version: 1,
    report_kind: 'agent-olympics.coordination-round.report',
    coordination_id: coord.coordination_id,
    mode: coord.coordination.mode,
    generated_at: isoNow(),
    run_directory: path.relative(ROOT, runBase),
    stages: {
      worker: {
        dispatched: workerStage.dispatch.report.runs.length,
        clean: workerStage.fanin.clean,
        quarantined: workerStage.fanin.quarantined,
      },
      finalizer: {
        dispatched: finalizerStage.dispatch.report.runs.length,
        clean: finalizerStage.fanin.clean,
        worker_reports_ingested: workerReports.length,
        finalizer_envelope_oracle_clean: true,
      },
      solo: {
        dispatched: soloStage.dispatch.report.runs.length,
        clean: soloStage.fanin.clean,
      },
    },
    a2a_effectiveness_record: path.relative(ROOT, recordPath),
    judge_linkage: {
      note: 'The finalizer commander-report packet in finalizer/.../judge-handoff/ is a normal result packet scored by scripts/judge.js against the merge rubric/oracle. This A2A record adds the was-delegation-worth-it signal only.',
      rubric_ref: coord.scoring_rubric || coord.coordination.merge.scoring_rubric || null,
    },
  };
  writeYaml(path.join(runBase, 'coordination-report.yaml'), report);

  console.log(`\n=== Coordination summary (${coord.coordination_id}) ===`);
  console.log(`  worker stage   : ${workerStage.fanin.clean} clean / ${workerStage.dispatch.report.runs.length} dispatched`);
  console.log(`  finalizer stage: ${finalizerStage.fanin.clean} clean, ingested ${workerReports.length} worker report(s)`);
  console.log(`  solo baseline  : ${soloStage.fanin.clean} clean / ${soloStage.dispatch.report.runs.length} dispatched`);
  console.log(`  A2A record     : ${path.relative(ROOT, recordPath)} (mode=${record.mode}, validity=${record.validity})`);

  return { coord, report, record, recordPath, runBase, workerReports, finalizerEnvCopies };
}

// ---------------------------------------------------------------------------
// Fixture suite
// ---------------------------------------------------------------------------

const FIXTURE_MANIFEST = 'fixtures/coordination/coordination-round-coord-001.yaml';

async function runFixtures() {
  let pass = 0;
  let fail = 0;
  const check = (ok, label, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
    if (ok) pass += 1; else fail += 1;
  };

  // Fixture output must live inside the repo's gitignored runs/ tree: the live
  // runner resolves stage envelope paths against the repo root and refuses
  // paths that escape it, and the finalizer's injected envelope lives in the
  // run base. os.tmpdir() would escape ROOT.
  const fixturesRoot = path.join(ROOT, 'runs', 'coordination');
  fs.mkdirSync(fixturesRoot, { recursive: true });
  const tmpBase = fs.mkdtempSync(path.join(fixturesRoot, 'fixtures-'));
  try {
    const result = await runCoordinationRound(FIXTURE_MANIFEST, { runDirectory: tmpBase, verbose: false });
    const { report, record, recordPath, workerReports, finalizerEnvCopies } = result;

    // 1. Two-stage dispatch produced worker packets.
    check(
      report.stages.worker.dispatched === 2 && report.stages.worker.clean === 2,
      'worker stage: 2 workers dispatched, both clean (worker packets produced)',
      `dispatched=${report.stages.worker.dispatched} clean=${report.stages.worker.clean}`
    );

    // 2. Finalizer ingested worker findings.
    check(
      report.stages.finalizer.clean === 1 && report.stages.finalizer.worker_reports_ingested === 2
        && workerReports.length === 2 && workerReports.every((r) => r.findings.length > 0),
      'finalizer stage: 1 finalizer clean, ingested 2 worker reports with findings',
      `ingested=${report.stages.finalizer.worker_reports_ingested}`
    );

    // 3. Solo baseline ran alone.
    check(
      report.stages.solo.dispatched === 1 && report.stages.solo.clean === 1,
      'solo baseline: 1 participant dispatched and clean'
    );

    // 4. The injected finalizer envelope actually carries the worker reports.
    let envHasReports = false;
    for (const copy of finalizerEnvCopies) {
      const env = yaml.load(fs.readFileSync(copy, 'utf8'));
      if (env.worker_reports && env.worker_reports.worker_count === 2) envHasReports = true;
    }
    check(envHasReports, 'finalizer participant-facing envelope copy carries worker_reports (injection path works)');

    // 5. Oracle material never entered any participant-facing artifact.
    //    Re-scan EVERY participant-facing file across all three stages with
    //    the live runner's oracle scan.
    const participantFacing = ['result-packet.yaml', 'trace.yaml', 'evidence-bundle.yaml', 'envelope.yaml', 'adapter.log', 'runner-transport.log'];
    let oracleLeaks = [];
    const walkStages = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walkStages(full); continue; }
        if (!participantFacing.includes(entry.name)) continue;
        const hits = scanTextForOracleReferences(fs.readFileSync(full, 'utf8'));
        if (hits.length > 0) oracleLeaks.push(`${path.relative(tmpBase, full)} (${hits.join(',')})`);
      }
    };
    walkStages(tmpBase);
    check(oracleLeaks.length === 0,
      'no oracle/judge reference in any participant-facing artifact across all stages',
      oracleLeaks.length ? oracleLeaks.join('; ') : 'scanned clean');

    // 6. The emitted A2A record validates against the committed schema.
    const recordText = fs.readFileSync(recordPath, 'utf8').trim();
    const parsed = JSON.parse(recordText);
    let schemaOk = true;
    try { validateA2aRecord(parsed); } catch (err) { schemaOk = false; }
    check(schemaOk && parsed.benchmarkVersion === A2A_BENCHMARK_VERSION
      && ['team1', 'a2a_crosscheck'].includes(parsed.mode)
      && parsed.participants.workers.length === 2 && parsed.participants.finalizer && parsed.participants.soloAgent,
      'emitted A2A-effectiveness record validates against the schema with workers + finalizer + soloAgent',
      `mode=${parsed.mode} workers=${parsed.participants.workers.join(',')}`);

    // 7. A negative injection check: oracle-laced worker reports are blocked.
    let blocked = false;
    try {
      buildWorkerReportsEvidence('neg', [{ worker: 'w', status: 'completed', summary: 'see oracle/season-001/coord-001-commander-report.yaml', findings: [] }]);
    } catch (err) {
      blocked = /oracle/.test(err.message);
    }
    check(blocked, 'worker-reports injection blocks an oracle reference (defense-in-depth guard fires)');

  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.error('Coordination round fixtures FAILED.');
    process.exitCode = EXIT_ERROR;
  } else {
    console.log('Coordination round fixtures passed.');
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.log(`
Agent Olympics Coordination Round Orchestrator

Usage:
  node scripts/coordination-round.js run <coordination-manifest> [--run-directory <dir>] [--verbose]
  node scripts/coordination-round.js fixtures

Commands:
  run        Orchestrate the two-stage coordination round + solo baseline,
             emit and validate an A2A-effectiveness record.
  fixtures   Run the offline fixture suite (2 workers + 1 finalizer + 1 solo
             baseline on coord-001 via simulation transports).

Boundaries:
  - Reuses scripts/live-runner.js for all dispatch/capture/fan-in/redaction/
    identity logic. No network; local_exec simulation transports only.
  - Oracle/judge material never enters any participant-facing artifact; the
    worker-findings injection carries only participant-facing findings and is
    oracle-scanned before and after injection.
`);
}

function parseArgs(argv) {
  const opts = { positional: [], runDirectory: null, verbose: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--run-directory': opts.runDirectory = argv[++i]; break;
      case '--verbose': case '-v': opts.verbose = true; break;
      case '--help': case '-h': opts.help = true; break;
      default:
        if (a.startsWith('--')) throw new CoordinationError(`Unknown option: ${a}`);
        opts.positional.push(a);
    }
  }
  return opts;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  let opts;
  try { opts = parseArgs(rest); } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exitCode = EXIT_ERROR;
    return;
  }
  if (!command || opts.help || command === 'help') {
    usage();
    if (!command) process.exitCode = EXIT_ERROR;
    return;
  }
  try {
    switch (command) {
      case 'run': {
        const manifestPath = opts.positional[0];
        if (!manifestPath) {
          console.error('Usage: node scripts/coordination-round.js run <coordination-manifest>');
          process.exitCode = EXIT_ERROR;
          return;
        }
        await runCoordinationRound(manifestPath, opts);
        break;
      }
      case 'fixtures':
        await runFixtures();
        break;
      default:
        console.error(`Unknown command: "${command}"`);
        usage();
        process.exitCode = EXIT_ERROR;
    }
  } catch (err) {
    if (err instanceof CoordinationError) {
      console.error(`ERROR: ${err.message}`);
    } else {
      console.error(`Fatal error: ${err.stack || err.message}`);
    }
    process.exitCode = EXIT_ERROR;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  runCoordinationRound,
  buildWorkerReportsEvidence,
  validateA2aRecord,
  validateCoordinationManifest,
};
