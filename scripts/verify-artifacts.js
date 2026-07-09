#!/usr/bin/env node
/**
 * Agent Olympics Artifact Integrity Verifier
 *
 * Verifies the content integrity of a run directory's artifacts by
 * comparing checksums recorded in manifest.yaml against actual file
 * hashes. Also validates cross-references between artifacts.
 *
 * Usage:
 *   node scripts/verify-artifacts.js <run-dir>          — Verify one run directory
 *   node scripts/verify-artifacts.js <run-dir> <...>    — Verify multiple run dirs
 *   node scripts/verify-artifacts.js <round-dir>        — Verify all runs in a round
 *
 * Options:
 *   --fix-checksums   Update manifest checksums to match disk (dangerous)
 *   --skip-content    Skip content hash verification (references only)
 *
 * Exit code: 0 = all checks pass, 1 = any check failed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const fixChecksums = args.includes('--fix-checksums');
const skipContent = args.includes('--skip-content');
const runDirs = args.filter((a) => !a.startsWith('--'));

let errors = 0;
let warnings = 0;

function err(msg) {
  console.error(`  ERROR  ${msg}`);
  errors++;
}

function warn(msg) {
  console.error(`  WARN   ${msg}`);
  warnings++;
}

function ok(msg) {
  console.log(`  OK     ${msg}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadYaml(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return yaml.load(raw);
  } catch (e) {
    return null;
  }
}

function computeHash(filePath, algorithm = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function listDir(dirPath) {
  const results = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else results.push(full);
    }
  }
  walk(dirPath);
  return results.sort();
}

// ---------------------------------------------------------------------------
// Verification functions
// ---------------------------------------------------------------------------

async function verifyRunDir(runDir) {
  const rel = path.relative(ROOT, runDir);
  console.log(`\n=== ${rel === '' ? runDir : rel} ===`);

  // Snapshot global counters so the per-directory summary reports deltas
  const errorsBefore = errors;
  const warningsBefore = warnings;

  // 1. Check manifest.yaml exists
  const manifestPath = path.join(runDir, 'manifest.yaml');
  if (!fs.existsSync(manifestPath)) {
    err('manifest.yaml not found — run directory is incomplete');
    return;
  }
  ok('manifest.yaml exists');

  // 2. Parse manifest
  const manifest = loadYaml(manifestPath);
  if (!manifest || !manifest.artifacts || !Array.isArray(manifest.artifacts)) {
    err('manifest.yaml is missing or has no artifacts array');
    return;
  }

  // 3. Basic manifest fields
  const requiredFields = ['manifest_id', 'run_id', 'round_id', 'task_id', 'agent_id', 'status'];
  for (const field of requiredFields) {
    if (!manifest[field]) {
      err(`manifest.yaml missing required field: "${field}"`);
    }
  }
  if (manifest.run_id && path.basename(runDir) !== manifest.run_id) {
    warn(`run_id "${manifest.run_id}" does not match directory name "${path.basename(runDir)}"`);
  }

  // 4. Verify each artifact in the manifest
  const manifestPaths = new Set();
  let checksumsUpdated = false;
  for (const artifact of manifest.artifacts) {
    if (!artifact.path) {
      err('Artifact entry missing "path" field');
      continue;
    }

    const artifactPath = path.resolve(runDir, artifact.path);

    manifestPaths.add(artifact.path);

    // Check file exists
    if (!fs.existsSync(artifactPath)) {
      err(`Artifact "${artifact.path}" listed in manifest but does not exist on disk`);
      continue;
    }

    // Check run_id consistency in result-packet and evidence-bundle
    if (artifact.kind === 'result_packet') {
      try {
        const packetRaw = fs.readFileSync(artifactPath, 'utf8');
        if (packetRaw.includes('run_id:') && manifest.run_id) {
          const match = packetRaw.match(/^run_id:\s*['"]?([^\s'"]+)['"]?/m);
          if (match && match[1] !== manifest.run_id) {
            warn(
              `result-packet.yaml run_id "${match[1]}" does not match manifest run_id "${manifest.run_id}"`
            );
          }
        }
      } catch (e) {
        warn(`Could not read result-packet.yaml for run_id check: ${e.message}`);
      }
    }

    // Check manifest_id consistency in evidence-bundle
    if (artifact.kind === 'evidence_bundle') {
      try {
        const bundleRaw = fs.readFileSync(artifactPath, 'utf8');
        if (bundleRaw.includes('bundle_id:') && manifest.manifest_id) {
          // Just note the association — bundle_id and manifest_id have different conventions
        }
      } catch (e) {
        // ignore
      }
    }

    // Verify checksum if present
    if (!skipContent && artifact.checksum) {
      // Skip self-referential manifest checksum (chicken-and-egg problem)
      if (artifact.kind === 'manifest') {
        ok(`Skipping self-checksum for manifest (self-referential)`);
        continue;
      }

      const { algorithm = 'sha256', value } = artifact.checksum;
      if (!value) {
        warn(`Artifact "${artifact.path}" has checksum object but no value`);
        continue;
      }

      try {
        const actualHash = await computeHash(artifactPath, algorithm);
        if (actualHash !== value) {
          if (fixChecksums) {
            // Update manifest
            artifact.checksum.value = actualHash;
            checksumsUpdated = true;
            warn(`Checksum mismatch for "${artifact.path}" — UPDATED to match disk`);
          } else {
            err(`Checksum mismatch for "${artifact.path}": expected ${value}, got ${actualHash}`);
          }
        } else {
          ok(`Checksum valid for "${artifact.path}" (${algorithm})`);
        }
      } catch (e) {
        err(`Could not compute hash for "${artifact.path}": ${e.message}`);
      }
    } else if (!skipContent && !artifact.checksum) {
      // Non-manifest artifacts should ideally have checksums
      if (artifact.kind !== 'manifest') {
        warn(`Artifact "${artifact.path}" (kind: ${artifact.kind}) has no checksum`);
      }
    }
  }

  // 4b. Write updated checksums back to the manifest on disk
  if (fixChecksums && checksumsUpdated) {
    fs.writeFileSync(
      manifestPath,
      yaml.dump(manifest, { indent: 2, lineWidth: 120, noRefs: true })
    );
    ok(`manifest.yaml written back with updated checksums`);
  }

  // 5. Check for files on disk not in manifest
  const diskFiles = listDir(runDir)
    .map((f) => path.relative(runDir, f))
    .filter((f) => f !== 'manifest.yaml'); // manifest.yaml is expected

  for (const diskFile of diskFiles) {
    // Check if any manifest entry matches this path
    const pathPrefixMatch = [...manifestPaths].filter(
      (mp) => diskFile.startsWith(mp) || mp.startsWith(diskFile)
    );
    if (pathPrefixMatch.length === 0) {
      warn(`File "${diskFile}" exists on disk but is not listed in manifest artifacts`);
    }
  }

  // 6. Check references.resolve to existing files
  if (manifest.references) {
    for (const [refKey, refValue] of Object.entries(manifest.references)) {
      if (!refValue || refKey === 'oracle_ref') continue;
      if (refKey === 'evidence_dir') {
        const evidencePath = path.resolve(runDir, refValue);
        if (!fs.existsSync(evidencePath)) {
          warn(`Evidence directory "${refValue}" referenced in manifest but does not exist`);
        }
      } else if (refKey.endsWith('_path')) {
        const refFilePath = path.resolve(runDir, refValue);
        if (!fs.existsSync(refFilePath)) {
          warn(`Reference "${refKey}" points to "${refValue}" but file does not exist`);
        }
      }
    }
  }

  // 7. Check evidence bundle cross-references (if present)
  const bundlePath = path.join(runDir, 'evidence-bundle.yaml');
  if (fs.existsSync(bundlePath)) {
    const bundle = loadYaml(bundlePath);
    if (bundle && bundle.items && Array.isArray(bundle.items)) {
      for (const item of bundle.items) {
        if (
          item.content_ref &&
          !/^https?:\/\//.test(item.content_ref) &&
          !/^data:/.test(item.content_ref)
        ) {
          const contentPath = path.resolve(runDir, item.content_ref);
          if (!fs.existsSync(contentPath)) {
            warn(
              `Evidence item "${item.id}" content_ref "${item.content_ref}" does not exist at ${contentPath}`
            );
          }
        }
      }
    }
  }

  console.log(
    `  --- ${errors - errorsBefore} error(s), ${warnings - warningsBefore} warning(s) ---`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (runDirs.length === 0) {
    console.log(`
Agent Olympics Artifact Integrity Verifier

Usage:
  node scripts/verify-artifacts.js <run-dir>          — Verify one run directory
  node scripts/verify-artifacts.js <run-dir> <...>    — Verify multiple run dirs
  node scripts/verify-artifacts.js <round-dir>        — Verify all runs in a round

Options:
  --fix-checksums  Update manifest checksums to match disk (destructive)
  --skip-content   Skip content hash verification (references only)

Exit code: 0 = all checks pass, 1 = any check failed.
`);
    process.exit(0);
  }

  for (const target of runDirs) {
    const resolved = path.resolve(ROOT, target);

    if (!fs.existsSync(resolved)) {
      err(`Path does not exist: ${target}`);
      continue;
    }

    if (fs.statSync(resolved).isDirectory()) {
      const manifestPath = path.join(resolved, 'manifest.yaml');
      if (fs.existsSync(manifestPath)) {
        // Single run directory
        await verifyRunDir(resolved);
      } else {
        // Round directory — verify all subdirectories with manifests
        for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            const subManifest = path.join(resolved, entry.name, 'manifest.yaml');
            if (fs.existsSync(subManifest)) {
              await verifyRunDir(path.join(resolved, entry.name));
            }
          }
        }
      }
    }
  }

  if (fixChecksums) {
    console.log('\nNote: --fix-checksums was used. Manifest files may have been modified.');
  }

  console.log(`\nTotal: ${errors} error(s), ${warnings} warning(s)`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`Fatal error: ${e.message}`);
  process.exit(1);
});
