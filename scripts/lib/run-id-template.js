'use strict';

/**
 * Shared run-id template constants and helpers.
 *
 * Previously duplicated verbatim in scripts/validate.js and scripts/round.js
 * (a drift risk called out in #258 / #262). Kept here as the single source of
 * truth; both consumers import from this module.
 */

const DEFAULT_RUN_ID_TEMPLATE = 'run-{task_id}-{agent_id}-{timestamp}';

const SUPPORTED_RUN_ID_TEMPLATE_VARIABLES = new Set([
  'task_id',
  'agent_id',
  'timestamp',
  'round_id',
  'season',
]);

/**
 * Extract the `{variable}` names referenced by a run-id template, in order.
 * @param {string} template
 * @returns {string[]}
 */
function runIdTemplateVariables(template) {
  return [...String(template || '').matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
}

/**
 * Render a run-id template against a map of values. Unknown `{tokens}` are left
 * untouched (same behaviour the inline copies had).
 * @param {string} template
 * @param {Record<string, string|undefined>} values
 * @returns {string}
 */
function renderRunIdTemplateValues(template, values) {
  return String(template).replace(
    /\{([^{}]+)\}/g,
    (match, key) => (values[key] !== undefined ? values[key] : match),
  );
}

module.exports = {
  DEFAULT_RUN_ID_TEMPLATE,
  SUPPORTED_RUN_ID_TEMPLATE_VARIABLES,
  runIdTemplateVariables,
  renderRunIdTemplateValues,
};
