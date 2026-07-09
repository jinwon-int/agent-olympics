'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveTokens, buildRegex, STATIC_PATTERNS } = require('../scripts/identity-blocklist.js');

test('deriveTokens is non-empty (guards against a silent no-op gate)', () => {
  const tokens = deriveTokens();
  assert.ok(tokens.length > 0, 'expected a non-empty derived blocklist');
});

test('deriveTokens includes known participant codenames', () => {
  const tokens = deriveTokens();
  for (const name of ['sogyo', 'seoseo', 'gwakga']) {
    assert.ok(tokens.includes(name), `expected blocklist to include participant "${name}"`);
  }
});

test('deriveTokens excludes generic/non-identifying values', () => {
  const tokens = deriveTokens().map((t) => t.toLowerCase());
  for (const generic of ['none', 'unknown', 'fixture', 'default']) {
    assert.ok(!tokens.includes(generic), `blocklist must not include generic value "${generic}"`);
  }
});

test('the derived regex flags a leaked participant identity (self-test)', () => {
  const re = new RegExp(buildRegex(deriveTokens()), 'i');
  assert.match('Competitor row: agent sogyo scored 87', re);
});

test('the static tail flags a leaked node slug', () => {
  const re = new RegExp(buildRegex(deriveTokens()), 'i');
  assert.match('ran on vps5', re);
  assert.ok(STATIC_PATTERNS.some((p) => /vps/.test(p)));
});

test('the derived regex does not flag a benign anonymized leaderboard row', () => {
  const re = new RegExp(buildRegex(deriveTokens()), 'i');
  assert.doesNotMatch('Competitor A — 87 points — open stack division', re);
});
