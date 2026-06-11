/**
 * Agent Olympics — Shared secret-detection patterns (CJS module)
 *
 * Canonical superset of the secret key-name and secret value regexes that
 * previously lived as near-identical (and drifted) local copies inside
 * validate.js, competition-validity.js, dry-run-gates.js, score.js,
 * round.js, and live-runner-readiness.js.
 *
 * - SECRET_KEY_PATTERNS:   field names that suggest a value carries
 *   credentials (api_key, token, password, ...).
 * - SECRET_VALUE_PATTERNS: actual credential material (provider key
 *   prefixes, PEM private key headers, JWTs, ...). All patterns are
 *   UNANCHORED so secrets embedded anywhere in a string are caught.
 * - looksLikeSecretValue:  heuristic used to decide whether a string value
 *   under a secret-named key is an actual credential, as opposed to a
 *   value-free policy descriptor such as
 *   `credential_location_policy: record_locations_only_never_values`.
 */

// Secret-bearing field name patterns that should NOT appear in
// participant-facing artifacts.
const SECRET_KEY_PATTERNS = [
  /^api[_-]?key$/i,
  /^api[_-]?secret$/i,
  /^token$/i,
  /^password$/i,
  /^secret$/i,
  /^credential/i,
  /^auth[_-]?token/i,
  /^private[_-]?key/i,
  /^access[_-]?key/i,
  /^session[_-]?cookie/i,
];

// Secret value patterns — actual credential leaks (unanchored).
const SECRET_VALUE_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,                                  // OpenAI-style keys
  /ghp_[a-zA-Z0-9]{36}/,                                  // GitHub PAT (legacy)
  /gho_[a-zA-Z0-9]{36}/,                                  // GitHub PAT (org)
  /github_pat_[a-zA-Z0-9_]{4,}/,                          // GitHub fine-grained PAT
  /xox[baprs]-/,                                          // Slack tokens
  /-----BEGIN (?:RSA |EC |OPENSSH |ED25519 )?PRIVATE KEY-----/i, // PEM private keys
  /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+/,                 // JWT tokens
];

/**
 * Heuristic: does this string value look like an actual credential?
 *
 * True when the value matches a known secret value pattern, or when it is a
 * token-like string (no whitespace, mixed letters and digits). Lowercase
 * word sequences joined by `_`, `-`, or `.` (policy/enum descriptors like
 * "record_locations_only_never_values" or "reference_only") are NOT treated
 * as credentials even though they may sit under a credential-named key.
 */
function looksLikeSecretValue(value) {
  if (typeof value !== 'string') return false;
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) return true;
  const v = value.trim();
  if (v.length < 6 || /\s/.test(v)) return false;
  // Lowercase word sequences (snake/kebab/dotted case) are policy
  // descriptors, not secrets.
  if (/^[a-z]+(?:[._-][a-z]+)*$/.test(v)) return false;
  // Token-like: mixed letters and digits with no whitespace.
  return /[0-9]/.test(v) && /[a-zA-Z]/.test(v);
}

module.exports = {
  SECRET_KEY_PATTERNS,
  SECRET_VALUE_PATTERNS,
  looksLikeSecretValue,
};
