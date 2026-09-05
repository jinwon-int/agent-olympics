'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');

// Check the URI resolver actually installed for the schema validator.
const ajvRequire = createRequire(require.resolve('ajv/package.json'));
const uri = ajvRequire('fast-uri');

for (const host of ['::not-valid', 'fc00::not-hex', 'fe80::not-hex']) {
  test(`URI resolver rejects malformed IPv6 host ${host}`, () => {
    const parsed = uri.parse(`http://[${host}]/schema`);
    assert.ok(parsed.error, 'invalid IPv6 must not silently become a valid address');
  });
}

test('URI resolver preserves valid schema IDs and relative references', () => {
  assert.equal(
    uri.normalize('https://example.test/schemas/../result.json'),
    'https://example.test/result.json'
  );
  assert.equal(
    uri.resolve('https://example.test/schemas/root.json', 'parts/item.json'),
    'https://example.test/schemas/parts/item.json'
  );
  assert.equal(uri.parse('http://[::1]/schema').error, undefined);
});
