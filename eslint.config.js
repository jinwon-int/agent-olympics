'use strict';

const js = require('@eslint/js');
const globals = require('globals');

/**
 * ESLint flat config (#263). Covers the JavaScript tooling under scripts/,
 * adapters/, and test/. eslint:recommended plus a small strictness layer that
 * catches the exact bug classes found in the tooling (shadowing, unused vars,
 * loose equality, reassignable consts).
 */
module.exports = [
  {
    ignores: [
      'node_modules/**',
      'fixtures/**',
      'results/**',
      'runs/**',
      'evidence/**',
      'archive/**',
      '.tmp/**',
      'public-site/**',
      '.agent-olympics-remote-runs/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['scripts/**/*.js', 'adapters/**/*.js', 'test/**/*.js', '*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-shadow': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // 'smart' permits the idiomatic `x == null` (null-or-undefined) check while
      // still flagging every other loose comparison.
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      // Enabled by eslint:recommended as of @eslint/js 10. The tooling
      // deliberately seeds `let ok = false` / `let detail = ''` before a switch
      // or try/catch so a branch that forgets to assign yields a safe default
      // instead of `undefined`. Dropping those initializers to satisfy the rule
      // buys no behaviour change and removes that guard, so keep it off.
      'no-useless-assignment': 'off',
    },
  },
];
