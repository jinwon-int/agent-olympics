#!/usr/bin/env node
'use strict';

/**
 * Loopback-only MOCK/DEMO of the HTTP/JSON participant protocol (#287, Slice C).
 *
 * THIS IS A MOCK / DEMO, NOT PRODUCTION INFRASTRUCTURE. It illustrates the
 * 5-step participant flow (register -> eligible-runs/claim -> submit -> status)
 * by round-tripping the sample fixtures under
 * fixtures/external-participant-http-json/ against the protocol schemas.
 *
 * Safety boundary (see docs/http-json-participant-protocol.md):
 *   - DEFAULT mode is in-process: NO socket binding, NO network, NO credentials.
 *     Every step is a plain function call over fixture data validated with ajv.
 *   - OPTIONAL --listen mode binds an EPHEMERAL port on 127.0.0.1 (loopback
 *     ONLY) using Node's built-in http module and has this same process
 *     self-request the endpoints once, then closes the server. It never binds a
 *     non-loopback address, contacts an external host, or moves secrets.
 *   - No live mutation, no provider/notification sends, no deploy/restart.
 *
 * Exit code: 0 = fully-valid demo run, non-zero = any step failed validation.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(ROOT, 'fixtures', 'external-participant-http-json');

const SCHEMAS = {
  registration: 'schemas/participant-registration.schema.json',
  run_claim: 'schemas/run-claim.schema.json',
  artifact_submission: 'schemas/artifact-submission.schema.json',
  run_status: 'schemas/run-status.schema.json',
  result_packet: 'schemas/result-packet-v2.schema.json',
};

function loadValidator(rel) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
}

function readFixture(file) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
}

/**
 * Build the set of compiled validators once. Returned as a map keyed by the
 * logical names in SCHEMAS.
 */
function buildValidators() {
  const validators = {};
  for (const [name, rel] of Object.entries(SCHEMAS)) {
    validators[name] = loadValidator(rel);
  }
  return validators;
}

/**
 * Validate `doc` against a compiled validator, throwing a descriptive error on
 * failure so callers can surface which step broke.
 */
function assertValid(validators, name, doc, label) {
  const validate = validators[name];
  const ok = validate(doc);
  if (!ok) {
    const detail = JSON.stringify(validate.errors);
    throw new Error(`${label} failed ${name} validation: ${detail}`);
  }
  return true;
}

/**
 * In-memory mock "server". Holds an idempotency map so a repeated claim with the
 * same key returns the same run_id via an `already_claimed` response, never a
 * second live run. No sockets, no persistence, no side effects.
 */
function createMockServer(validators) {
  const claimsByKey = new Map();

  return {
    register(registration) {
      assertValid(validators, 'registration', registration, 'register');
      // A mock registration is always pending_review; it grants no trusted status.
      return { status: 'pending_review', participant_id: registration.agent_id };
    },

    claim(idempotencyKey, request) {
      assertValid(validators, 'run_claim', request, 'claim_request');
      if (claimsByKey.has(idempotencyKey)) {
        const existing = claimsByKey.get(idempotencyKey);
        const already = {
          kind: 'already_claimed',
          schema_version: 1,
          run_id: existing.run_id,
          required_artifacts: existing.required_artifacts,
          forbidden_actions: existing.forbidden_actions,
        };
        assertValid(validators, 'run_claim', already, 'already_claimed');
        return already;
      }
      const response = {
        kind: 'claim_response',
        schema_version: 1,
        run_id: `run_${idempotencyKey}`,
        task_envelope_ref: 'https://example.invalid/task-envelope.json',
        required_artifacts: ['result_packet', 'trace', 'evidence_bundle'],
        forbidden_actions: ['oracle_access', 'unapproved_live_mutation', 'secret_disclosure'],
      };
      assertValid(validators, 'run_claim', response, 'claim_response');
      claimsByKey.set(idempotencyKey, response);
      return response;
    },

    submit(submission) {
      assertValid(validators, 'artifact_submission', submission, 'submit');
      // The inner result_packet must validate against the competition schema, so
      // the protocol reuses the exact artifact contract it wraps.
      assertValid(validators, 'result_packet', submission.result_packet, 'submit.result_packet');
      return { accepted: true };
    },

    status(runStatus) {
      assertValid(validators, 'run_status', runStatus, 'status');
      return runStatus;
    },
  };
}

/**
 * Drive the 5-step flow purely in-process over the sample fixtures. Returns a
 * summary object; throws if any payload fails validation.
 *
 * @param {object} [opts]
 * @param {(msg: string) => void} [opts.log] sink for step lines (default stdout)
 */
function runInProcessDemo(opts) {
  const options = opts || {};
  const log = options.log || ((msg) => process.stdout.write(`${msg}\n`));
  const validators = buildValidators();
  const server = createMockServer(validators);

  const steps = [];
  const record = (name) => {
    steps.push(name);
    log(`step ${steps.length} ${name}: validated OK`);
  };

  // 1. Register.
  const registration = readFixture('registration-valid.json');
  server.register(registration);
  record('register');

  // 2 + 3. Claim (idempotent). The idempotency key is the stable participant+task pair.
  const claimRequest = readFixture('run-claim-request-valid.json');
  const idempotencyKey = `${claimRequest.participant_id}:${claimRequest.task_id}`;
  const firstClaim = server.claim(idempotencyKey, claimRequest);
  record('claim');

  // Idempotency probe: a second claim with the same key returns the same run_id
  // as an already_claimed response — never a second live run.
  const secondClaim = server.claim(idempotencyKey, claimRequest);
  if (secondClaim.run_id !== firstClaim.run_id) {
    throw new Error(
      `idempotency broken: second claim run_id ${secondClaim.run_id} != ${firstClaim.run_id}`
    );
  }
  if (secondClaim.kind !== 'already_claimed') {
    throw new Error(`idempotency broken: expected already_claimed, got ${secondClaim.kind}`);
  }
  log(`idempotency: repeat claim -> already_claimed run_id=${secondClaim.run_id}`);

  // 4. Submit artifacts (inner result_packet re-validated).
  const submission = readFixture('artifact-submission-valid.json');
  server.submit(submission);
  record('submit');

  // 5. Read status.
  const runStatus = readFixture('run-status-valid.json');
  server.status(runStatus);
  record('status');

  const summary = {
    ok: true,
    steps,
    run_id: firstClaim.run_id,
    idempotent_run_id: secondClaim.run_id,
    already_claimed: secondClaim.kind === 'already_claimed',
  };
  log(`demo complete: ${steps.length} steps validated, run_id=${summary.run_id}`);
  return summary;
}

/**
 * OPTIONAL loopback demo. Binds an ephemeral port on 127.0.0.1 ONLY, serves the
 * fixtures via the same in-process mock server, self-requests each endpoint
 * once, validates the responses, then closes the server. Never binds a
 * non-loopback interface and never contacts an external host.
 *
 * @param {(msg: string) => void} [log]
 * @returns {Promise<object>} summary
 */
function runLoopbackDemo(log) {
  const emit = log || ((msg) => process.stdout.write(`${msg}\n`));
  const validators = buildValidators();
  const server = createMockServer(validators);

  const registration = readFixture('registration-valid.json');
  const claimRequest = readFixture('run-claim-request-valid.json');
  const submission = readFixture('artifact-submission-valid.json');
  const runStatus = readFixture('run-status-valid.json');
  const idempotencyKey = `${claimRequest.participant_id}:${claimRequest.task_id}`;

  const httpServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = null;
      if (chunks.length > 0) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch (_e) {
          body = null;
        }
      }
      const send = (code, payload) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      try {
        if (req.method === 'POST' && req.url === '/participants') {
          send(201, server.register(body));
        } else if (req.method === 'POST' && req.url === '/runs') {
          const key = req.headers['idempotency-key'] || idempotencyKey;
          send(200, server.claim(key, body));
        } else if (req.method === 'POST' && req.url.endsWith('/artifacts')) {
          send(202, server.submit(body));
        } else if (req.method === 'GET' && req.url.endsWith('/status')) {
          send(200, server.status(runStatus));
        } else {
          send(404, { error: 'not_found' });
        }
      } catch (err) {
        send(422, { error: 'validation_failed', detail: err.message });
      }
    });
  });

  return new Promise((resolve, reject) => {
    // 127.0.0.1 + port 0 => loopback-only, ephemeral port. Never 0.0.0.0.
    httpServer.listen(0, '127.0.0.1', () => {
      const { address, port } = httpServer.address();
      emit(`loopback: bound ${address}:${port} (ephemeral, 127.0.0.1 only)`);

      const call = (method, urlPath, payload, headers) =>
        new Promise((res, rej) => {
          const data = payload == null ? null : Buffer.from(JSON.stringify(payload), 'utf8');
          const request = http.request(
            {
              host: '127.0.0.1',
              port,
              method,
              path: urlPath,
              headers: {
                'content-type': 'application/json',
                ...(data ? { 'content-length': data.length } : {}),
                ...(headers || {}),
              },
            },
            (resp) => {
              const parts = [];
              resp.on('data', (c) => parts.push(c));
              resp.on('end', () => {
                const text = Buffer.concat(parts).toString('utf8');
                res({ status: resp.statusCode, body: text ? JSON.parse(text) : null });
              });
            }
          );
          request.on('error', rej);
          if (data) {
            request.write(data);
          }
          request.end();
        });

      (async () => {
        const reg = await call('POST', '/participants', registration);
        emit(`loopback: POST /participants -> ${reg.status} ${reg.body.status}`);

        const claimHeaders = { 'idempotency-key': idempotencyKey };
        const claim = await call('POST', '/runs', claimRequest, claimHeaders);
        emit(`loopback: POST /runs -> ${claim.status} ${claim.body.kind} ${claim.body.run_id}`);

        const repeat = await call('POST', '/runs', claimRequest, claimHeaders);
        emit(
          `loopback: POST /runs (repeat) -> ${repeat.status} ${repeat.body.kind} ${repeat.body.run_id}`
        );
        if (repeat.body.run_id !== claim.body.run_id) {
          throw new Error('loopback idempotency broken: run_id mismatch on repeat claim');
        }

        const submit = await call('POST', `/runs/${claim.body.run_id}/artifacts`, submission);
        emit(
          `loopback: POST /runs/.../artifacts -> ${submit.status} accepted=${submit.body.accepted}`
        );

        const status = await call('GET', `/runs/${claim.body.run_id}/status`, null);
        emit(`loopback: GET /runs/.../status -> ${status.status} state=${status.body.state}`);

        return {
          ok: true,
          run_id: claim.body.run_id,
          idempotent: repeat.body.run_id === claim.body.run_id,
          already_claimed: repeat.body.kind === 'already_claimed',
        };
      })()
        .then((summary) => {
          httpServer.close(() => {
            emit('loopback: server closed');
            resolve(summary);
          });
        })
        .catch((err) => {
          httpServer.close(() => reject(err));
        });
    });
    httpServer.on('error', reject);
  });
}

function main() {
  const useListen = process.argv.includes('--listen');
  if (useListen) {
    runLoopbackDemo()
      .then((summary) => {
        if (!summary.ok || !summary.idempotent) {
          process.exitCode = 1;
        }
      })
      .catch((err) => {
        process.stderr.write(`loopback demo failed: ${err.message}\n`);
        process.exitCode = 1;
      });
    return;
  }

  try {
    const summary = runInProcessDemo();
    process.exitCode = summary.ok ? 0 : 1;
  } catch (err) {
    process.stderr.write(`demo failed: ${err.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { runInProcessDemo, runLoopbackDemo, createMockServer, buildValidators };
