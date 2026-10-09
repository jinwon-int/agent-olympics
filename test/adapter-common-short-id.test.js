'use strict';

// agent-olympics#314: shortId() keeps its contract after the unseeded branch
// moved from Math.random() to crypto.randomBytes().

const test = require('node:test');
const assert = require('node:assert/strict');
const { shortId } = require('../adapters/lib/adapter-common');

test('seeded shortId stays deterministic and 6 hex chars', () => {
  const a = shortId('run-123-dp');
  assert.equal(a, shortId('run-123-dp'));
  assert.match(a, /^[0-9a-f]{6}$/);
  assert.notEqual(a, shortId('run-123-msg'));
});

test('seeded shortId value is unchanged by the fix (pinned)', () => {
  // Values captured from the pre-#314 implementation: the seeded hash path must
  // not move, or existing evidence ids would stop matching re-generated ones.
  assert.equal(shortId('abc'), '017862');
  assert.equal(shortId('run-123-dp'), '5540a5');
});

test('unseeded shortId is 6 hex chars from the CSPRNG, not Math.random', () => {
  const original = Math.random;
  Math.random = () => {
    throw new Error('Math.random must not be used');
  };
  try {
    const ids = new Set();
    for (let i = 0; i < 50; i++) {
      const id = shortId();
      assert.match(id, /^[0-9a-f]{6}$/);
      ids.add(id);
    }
    assert.ok(ids.size > 40, `expected mostly distinct ids, got ${ids.size}/50`);
  } finally {
    Math.random = original;
  }
});
