'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_RUN_ID_TEMPLATE,
  SUPPORTED_RUN_ID_TEMPLATE_VARIABLES,
  runIdTemplateVariables,
  renderRunIdTemplateValues,
} = require('../scripts/lib/run-id-template');

test('DEFAULT_RUN_ID_TEMPLATE has the canonical shape', () => {
  assert.equal(DEFAULT_RUN_ID_TEMPLATE, 'run-{task_id}-{agent_id}-{timestamp}');
});

test('SUPPORTED_RUN_ID_TEMPLATE_VARIABLES covers the documented variables', () => {
  for (const v of ['task_id', 'agent_id', 'timestamp', 'round_id', 'season']) {
    assert.ok(SUPPORTED_RUN_ID_TEMPLATE_VARIABLES.has(v), `missing ${v}`);
  }
});

test('runIdTemplateVariables extracts tokens in order', () => {
  assert.deepEqual(
    runIdTemplateVariables('run-{task_id}-{agent_id}-{timestamp}'),
    ['task_id', 'agent_id', 'timestamp'],
  );
});

test('runIdTemplateVariables tolerates empty/undefined input', () => {
  assert.deepEqual(runIdTemplateVariables(''), []);
  assert.deepEqual(runIdTemplateVariables(undefined), []);
  assert.deepEqual(runIdTemplateVariables(null), []);
});

test('renderRunIdTemplateValues substitutes known tokens', () => {
  assert.equal(
    renderRunIdTemplateValues('run-{task_id}-{agent_id}', { task_id: 'ops-001', agent_id: 'sogyo' }),
    'run-ops-001-sogyo',
  );
});

test('renderRunIdTemplateValues leaves unknown tokens untouched', () => {
  assert.equal(
    renderRunIdTemplateValues('run-{task_id}-{unknown}', { task_id: 'x' }),
    'run-x-{unknown}',
  );
});
