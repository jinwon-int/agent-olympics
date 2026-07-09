#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_FIXTURE_DIR = path.join(ROOT, 'fixtures', 'declaration-cross-check');
const NO_DELEGATION_VALUES = new Set([
  '',
  'none',
  'no',
  'false',
  'no_subagents_used',
  'no delegated workers for this packet',
]);

function usage() {
  console.log(`Usage:
  node scripts/declaration-cross-check.js [fixture.yaml ...]

If no fixture paths are provided, all fixtures/declaration-cross-check/*.yaml
files are checked. Fixtures may declare expect: pass|fail.`);
}

function loadYaml(filePath) {
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
}

function fixturePaths(args) {
  if (args.length > 0) {
    return args.map((arg) => path.resolve(ROOT, arg));
  }
  if (!fs.existsSync(DEFAULT_FIXTURE_DIR)) {
    return [];
  }
  return fs
    .readdirSync(DEFAULT_FIXTURE_DIR)
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .sort()
    .map((name) => path.join(DEFAULT_FIXTURE_DIR, name));
}

function readDocument(fixture, fixtureFile, key) {
  const docs = fixture.documents || {};
  if (docs[key]) {
    return docs[key];
  }
  const ref = docs[`${key}_ref`] || fixture[`${key}_ref`];
  if (!ref) {
    return null;
  }
  const refPath = path.resolve(path.dirname(fixtureFile), ref);
  const rootRefPath = path.resolve(ROOT, ref);
  const resolved = fs.existsSync(refPath) ? refPath : rootRefPath;
  if (!fs.existsSync(resolved)) {
    return { __missing_ref: ref };
  }
  return loadYaml(resolved);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function listFromProfile(profile, primary, fallback) {
  if (!profile) {
    return [];
  }
  if (Array.isArray(profile[primary])) {
    return profile[primary];
  }
  if (Array.isArray(profile[fallback])) {
    return profile[fallback];
  }
  return [];
}

function normalizedList(values) {
  return (values || [])
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value));
}

function toolName(value) {
  return String(value || '').trim();
}

function actionType(action) {
  return toolName(action.type || action.action);
}

function actionLooksDelegated(action) {
  const haystack = [
    action.type,
    action.action,
    action.target,
    action.command_summary,
    action.summary,
    action.result_summary,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /\b(delegat\w*|subagent|worker_pool|worker dispatch|a2a worker|sessions_spawn)\b/.test(
    haystack
  );
}

function delegationPolicyDeclaresDelegation(policy) {
  const value = String((policy && policy.delegation_policy) || '')
    .trim()
    .toLowerCase();
  return !NO_DELEGATION_VALUES.has(value);
}

function delegationProfileDeclaresDelegation(profile) {
  if (!profile) {
    return false;
  }
  return (
    profile.subagents_used === true ||
    profile.background_jobs_used === true ||
    profile.human_assistance === true ||
    normalizedList(profile.a2a_workers).length > 0 ||
    normalizedList(profile.supported_by).length > 0
  );
}

function collectActions(resultPacket, traceRecord) {
  const resultActions = Array.isArray(resultPacket && resultPacket.actions)
    ? resultPacket.actions.map((action) => ({ ...action, source: 'result_packet.actions' }))
    : [];
  const traceActions = Array.isArray(traceRecord && traceRecord.entries)
    ? traceRecord.entries.map((entry) => ({ ...entry, source: 'trace_record.entries' }))
    : [];
  return [...resultActions, ...traceActions];
}

function comparableValue(resultPacket, pathParts) {
  let current = resultPacket && resultPacket.comparable_metadata;
  for (const part of pathParts) {
    if (!current || current[part] === undefined) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function compareField(errors, warnings, label, left, right, leftName, rightName, required = false) {
  if (
    left === undefined ||
    left === null ||
    left === '' ||
    right === undefined ||
    right === null ||
    right === ''
  ) {
    if (required) {
      warnings.push(
        `${label} is not fully cross-checkable: ${leftName}=${left || '(missing)'}, ${rightName}=${right || '(missing)'}`
      );
    }
    return;
  }
  if (String(left) !== String(right)) {
    errors.push(`${label} mismatch: ${leftName}="${left}" but ${rightName}="${right}"`);
  }
}

function checkCase(fixture, fixtureFile) {
  const errors = [];
  const warnings = [];
  const docs = {
    adapterCapability: readDocument(fixture, fixtureFile, 'adapter_capability'),
    runManifest: readDocument(fixture, fixtureFile, 'run_manifest'),
    resultPacket: readDocument(fixture, fixtureFile, 'result_packet'),
    traceRecord: readDocument(fixture, fixtureFile, 'trace_record'),
    evidenceBundle: readDocument(fixture, fixtureFile, 'evidence_bundle'),
  };

  for (const [name, doc] of Object.entries(docs)) {
    if (doc && doc.__missing_ref) {
      errors.push(`${name} reference does not exist: ${doc.__missing_ref}`);
    }
  }

  const result = docs.resultPacket || {};
  const manifest = docs.runManifest || {};
  const capability = docs.adapterCapability || {};
  const trace = docs.traceRecord || {};

  if (!docs.resultPacket) {
    errors.push('result_packet document is required');
  }

  compareField(
    errors,
    warnings,
    'run_id',
    manifest.run_id,
    result.run_id,
    'run_manifest.run_id',
    'result_packet.run_id'
  );
  compareField(
    errors,
    warnings,
    'task_id',
    manifest.task_id,
    result.task_id,
    'run_manifest.task_id',
    'result_packet.task_id',
    true
  );
  compareField(
    errors,
    warnings,
    'agent_id',
    manifest.agent_id,
    result.agent_id,
    'run_manifest.agent_id',
    'result_packet.agent_id',
    true
  );
  compareField(
    errors,
    warnings,
    'runtime',
    manifest.runtime,
    result.runtime,
    'run_manifest.runtime',
    'result_packet.runtime'
  );
  compareField(
    errors,
    warnings,
    'adapter',
    manifest.adapter,
    result.adapter,
    'run_manifest.adapter',
    'result_packet.adapter'
  );
  compareField(
    errors,
    warnings,
    'model',
    manifest.model,
    result.model,
    'run_manifest.model',
    'result_packet.model'
  );
  compareField(
    errors,
    warnings,
    'model_provider',
    manifest.model_provider,
    result.model_provider,
    'run_manifest.model_provider',
    'result_packet.model_provider'
  );
  compareField(
    errors,
    warnings,
    'node',
    manifest.node,
    result.node,
    'run_manifest.node',
    'result_packet.node'
  );

  compareField(
    errors,
    warnings,
    'participant agent_id',
    result.agent_id,
    comparableValue(result, ['participant', 'agent_id']),
    'result_packet.agent_id',
    'comparable_metadata.participant.agent_id'
  );
  compareField(
    errors,
    warnings,
    'participant adapter',
    firstDefined(result.adapter, result.runtime),
    comparableValue(result, ['participant', 'adapter']),
    'result_packet adapter/runtime',
    'comparable_metadata.participant.adapter'
  );
  compareField(
    errors,
    warnings,
    'runtime name',
    result.runtime,
    comparableValue(result, ['runtime', 'name']),
    'result_packet.runtime',
    'comparable_metadata.runtime.name'
  );
  compareField(
    errors,
    warnings,
    'runtime version',
    result.runtime_version,
    comparableValue(result, ['runtime', 'version']),
    'result_packet.runtime_version',
    'comparable_metadata.runtime.version'
  );
  compareField(
    errors,
    warnings,
    'model name',
    result.model,
    comparableValue(result, ['model', 'name']),
    'result_packet.model',
    'comparable_metadata.model.name'
  );
  compareField(
    errors,
    warnings,
    'model provider',
    result.model_provider,
    comparableValue(result, ['model', 'provider']),
    'result_packet.model_provider',
    'comparable_metadata.model.provider'
  );
  compareField(
    errors,
    warnings,
    'task metadata',
    result.task_id,
    comparableValue(result, ['task', 'task_id']),
    'result_packet.task_id',
    'comparable_metadata.task.task_id'
  );

  if (capability.adapter_id) {
    const declaredAdapter = firstDefined(
      result.adapter,
      result.runtime,
      manifest.adapter,
      manifest.runtime
    );
    compareField(
      errors,
      warnings,
      'adapter capability',
      capability.adapter_id,
      declaredAdapter,
      'adapter_capability.adapter_id',
      'result/manifest adapter'
    );
  }

  const allowedTools = listFromProfile(result.tool_use_profile, 'classes_allowed', 'allowed').map(
    toolName
  );
  const usedTools = listFromProfile(result.tool_use_profile, 'classes_used', 'used').map(toolName);
  const allowedSet = new Set(allowedTools);
  const usedSet = new Set(usedTools);
  for (const used of usedTools) {
    if (!allowedSet.has(used)) {
      errors.push(`tool_use_profile declares used tool "${used}" that is not allowed`);
    }
  }

  const actions = collectActions(result, trace);
  const undeclaredActions = actions
    .map((action) => ({ action, type: actionType(action) }))
    .filter(({ type }) => type && !usedSet.has(type));
  for (const { action, type } of undeclaredActions) {
    warnings.push(
      `${action.source || 'action'} "${action.id || action.seq || '(unnamed)'}" uses "${type}" not listed in tool_use_profile used tools`
    );
  }

  const delegationActions = actions.filter(actionLooksDelegated);
  const profileDeclaresDelegation = delegationProfileDeclaresDelegation(result.delegation_profile);
  const policyDeclaresDelegation = delegationPolicyDeclaresDelegation(result.operating_policy);
  const toolDeclaresDelegation =
    usedSet.has('delegate') ||
    usedSet.has('subagent') ||
    usedSet.has('sessions_spawn') ||
    usedSet.has('a2a_worker');
  const supportAgents = [
    ...normalizedList(result.delegation_profile && result.delegation_profile.a2a_workers),
    ...normalizedList(result.delegation_profile && result.delegation_profile.supported_by),
  ];

  if (delegationActions.length > 0 && !profileDeclaresDelegation) {
    errors.push(
      'delegation appears in actions/trace but delegation_profile does not disclose support'
    );
  }
  if (delegationActions.length > 0 && !policyDeclaresDelegation) {
    errors.push(
      'delegation appears in actions/trace but operating_policy.delegation_policy does not allow/disclose it'
    );
  }
  if (delegationActions.length > 0 && !toolDeclaresDelegation) {
    errors.push(
      'delegation appears in actions/trace but tool_use_profile used tools do not include a delegation tool class'
    );
  }
  if (profileDeclaresDelegation && supportAgents.length === 0) {
    errors.push(
      'delegation_profile discloses support but does not attribute supporting agents/workers'
    );
  }
  if (profileDeclaresDelegation && delegationActions.length === 0) {
    warnings.push('delegation_profile discloses support but no delegation action/trace was found');
  }

  const attribution = fixture.attribution || {};
  if (attribution.owner_agent_id) {
    compareField(
      errors,
      warnings,
      'delegation owner attribution',
      attribution.owner_agent_id,
      result.agent_id,
      'attribution.owner_agent_id',
      'result_packet.agent_id'
    );
  }
  for (const supporter of normalizedList(attribution.support_agents)) {
    if (!supportAgents.includes(supporter)) {
      errors.push(
        `attribution.support_agents includes "${supporter}" but delegation_profile does not list it`
      );
    }
  }

  return { errors, warnings };
}

function run() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }

  const files = fixturePaths(args);
  if (files.length === 0) {
    console.error('No declaration cross-check fixtures found.');
    process.exit(1);
  }

  let failed = 0;
  for (const file of files) {
    const fixture = loadYaml(file);
    const expect = fixture.expect || 'pass';
    const { errors, warnings } = checkCase(fixture, file);
    const passed = errors.length === 0;
    const expectedFailure = expect === 'fail';
    const rel = path.relative(ROOT, file);

    if (passed && expectedFailure) {
      console.error(`FAIL  ${rel}  - expected failure but passed`);
      failed += 1;
      continue;
    }
    if (!passed && !expectedFailure) {
      console.error(`FAIL  ${rel}`);
      for (const error of errors) {
        console.error(`  error: ${error}`);
      }
      for (const warning of warnings) {
        console.error(`  warn: ${warning}`);
      }
      failed += 1;
      continue;
    }

    const label = expectedFailure ? `expected failure - ${errors.length} error(s)` : 'pass';
    console.log(
      `OK    ${rel}  (${label}${warnings.length ? `, ${warnings.length} warning(s)` : ''})`
    );
  }

  if (failed > 0) {
    console.error(
      `\nDeclaration cross-check failed: ${failed} fixture(s) did not match expectation.`
    );
    process.exit(1);
  }
  console.log('\nDeclaration cross-check fixtures passed.');
}

run();
