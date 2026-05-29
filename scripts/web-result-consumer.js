#!/usr/bin/env node
/**
 * Agent Olympics Web Result Consumer
 *
 * Reads a scoreboard JSON (from scripts/score.js) and produces static HTML
 * output: a leaderboard page, per-entry detail pages, and comparison views.
 *
 * This is the first source-only consumer slice of the web-result data bridge
 * (docs/web-result-data-bridge.md).  It operates on local files only — no
 * deployment, no live serving, no database writes.
 *
 * Usage:
 *   node scripts/web-result-consumer.js <scoreboard.json> [options]
 *
 * Options:
 *   --output-dir <dir>   Output directory (default: ./web-output)
 *   --blind              Apply blind display rules (anonymized labels)
 *   --title <string>     Custom page title
 *
 * Output:
 *   <output-dir>/index.html           — Leaderboard page
 *   <output-dir>/detail/<id>.html     — Per-entry detail pages
 *   <output-dir>/compare/<task>.html  — Comparison view (entries with same task_id)
 *   <output-dir>/assets/style.css     — Inline styles (embedded in each HTML page)
 *
 * The consumer is safe for CI: it reads no external data, writes no secrets,
 * and fails cleanly on malformed input.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const CSS = `
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  margin: 0;
  padding: 20px;
  background: #f5f7fa;
  color: #1a1a2e;
}
.container { max-width: 1200px; margin: 0 auto; }
h1 { font-size: 1.8rem; margin-bottom: 0.3rem; }
h2 { font-size: 1.3rem; margin-top: 1.8rem; margin-bottom: 0.6rem; }
h3 { font-size: 1.1rem; margin-top: 1.2rem; margin-bottom: 0.4rem; }
.subtitle { color: #64748b; font-size: 0.9rem; margin-bottom: 1rem; }
.summary-box { 
  background: white; border-radius: 8px; padding: 16px 20px; 
  margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  display: flex; gap: 24px; flex-wrap: wrap;
}
.summary-item { text-align: center; }
.summary-item .num { font-size: 1.4rem; font-weight: 700; color: #3b82f6; }
.summary-item .label { font-size: 0.75rem; color: #64748b; text-transform: uppercase; }
table { 
  width: 100%; border-collapse: collapse; background: white; 
  border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  margin-bottom: 20px;
}
th { 
  background: #1e293b; color: white; padding: 10px 12px; 
  text-align: left; font-size: 0.78rem; text-transform: uppercase; white-space: nowrap; cursor: default;
}
td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 0.88rem; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: #f8fafc; }
.rank { font-weight: 700; font-size: 1rem; text-align: center; width: 40px; }
.rank-1 { color: #f59e0b; } .rank-2 { color: #94a3b8; } .rank-3 { color: #cd7f32; }
.agent-link { font-weight: 600; color: #2563eb; text-decoration: none; }
.agent-link:hover { text-decoration: underline; }
.badge {
  display: inline-block; padding: 2px 8px; border-radius: 4px;
  font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
}
.badge-pass { background: #d1fae5; color: #065f46; }
.badge-conditional_pass { background: #fef3c7; color: #92400e; }
.badge-fail { background: #fee2e2; color: #991b1b; }
.badge-disqualification { background: #e2e8f0; color: #475569; }
.badge-completed { background: #dbeafe; color: #1e40af; }
.badge-partial { background: #fef3c7; color: #92400e; border: 1px dashed #d97706; }
.badge-blocked { background: #f1f5f9; color: #64748b; }
.badge-failed { background: #fee2e2; color: #991b1b; }
.badge-disqualified { background: #e2e8f0; color: #475569; text-decoration: line-through; }
.dim-bar { 
  display: inline-block; height: 8px; border-radius: 4px; 
  background: #e2e8f0; width: 80px; vertical-align: middle; margin-right: 6px;
}
.dim-fill { height: 8px; border-radius: 4px; transition: width 0.3s; }
.dim-green { background: #22c55e; } .dim-yellow { background: #eab308; } .dim-red { background: #ef4444; }
.score-cell { white-space: nowrap; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
@media (max-width: 768px) { .detail-grid { grid-template-columns: 1fr; } }
.card {
  background: white; border-radius: 8px; padding: 16px 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
.card h3 { margin-top: 0; }
.field-label { font-size: 0.78rem; color: #64748b; text-transform: uppercase; margin-bottom: 2px; }
.field-value { font-size: 0.92rem; margin-bottom: 10px; word-break: break-word; }
.dim-card { 
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 0; border-bottom: 1px solid #f1f5f9;
}
.dim-card:last-child { border-bottom: none; }
.dim-name { font-weight: 500; font-size: 0.88rem; flex: 1; }
.dim-score { font-size: 0.85rem; color: #475569; white-space: nowrap; }
.compare-table { margin-top: 12px; }
.compare-table th { font-size: 0.72rem; }
.compare-table td { font-size: 0.82rem; }
.pending-note { 
  background: #fefce8; border: 1px solid #fde047; border-radius: 6px;
  padding: 10px 14px; font-size: 0.85rem; color: #713f12; margin-bottom: 16px;
}
.provisional-banner {
  background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px;
  padding: 10px 14px; font-size: 0.85rem; color: #475569; margin-bottom: 16px;
}
.blind-banner {
  background: #e0e7ff; border: 1px solid #a5b4fc; border-radius: 6px;
  padding: 10px 14px; font-size: 0.85rem; color: #312e81; margin-bottom: 16px;
}
.nav-bar { 
  background: #1e293b; color: white; padding: 12px 20px; 
  margin: -20px -20px 20px -20px;
}
.nav-bar a { color: #93c5fd; text-decoration: none; }
.nav-bar a:hover { text-decoration: underline; }
.nav-bar .nav-title { font-weight: 700; font-size: 1rem; }
pre.evidence-json { 
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px;
  padding: 12px; font-size: 0.78rem; overflow-x: auto; max-height: 300px;
}
.evidence-card { 
  border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; margin-bottom: 8px;
}
.evidence-card .ev-label { font-weight: 600; font-size: 0.82rem; }
.caveat-item { font-size: 0.82rem; color: #b45309; padding: 4px 0; }
.empty-state { color: #94a3b8; font-style: italic; padding: 20px; text-align: center; }
.footer { text-align: center; font-size: 0.78rem; color: #94a3b8; margin-top: 30px; }
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  if (typeof s !== 'string') return String(s == null ? '' : s);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
}

function dimColor(score, max) {
  if (max <= 0) return 'dim-green';
  const pct = score / max;
  if (pct >= 0.8) return 'dim-green';
  if (pct >= 0.6) return 'dim-yellow';
  return 'dim-red';
}

function dimBarHtml(score, max) {
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  const color = dimColor(score, max);
  return `<span class="dim-bar"><span class="dim-fill ${color}" style="width:${pct}%"></span></span>`;
}

function formatScore(score, max) {
  return `${score}/${max} (${max > 0 ? Math.round(score / max * 100) : 0}%)`;
}

function formatWallTime(seconds) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function statusBadge(status) {
  return `<span class="badge badge-${status}">${escapeHtml(status)}</span>`;
}

function verdictBadge(verdict) {
  return `<span class="badge badge-${verdict}">${escapeHtml(verdict)}</span>`;
}

function randClass(rank) {
  if (rank === 1) return 'rank-1';
  if (rank === 2) return 'rank-2';
  if (rank === 3) return 'rank-3';
  return '';
}

// ---------------------------------------------------------------------------
// Rank computation (per web-result-data-bridge.md §2.1)
// ---------------------------------------------------------------------------

function computeRanks(entries) {
  // Filter blocked/disqualified
  const ranked = entries
    .filter(e => e.status !== 'blocked' && e.status !== 'disqualified')
    .sort((a, b) => {
      // Sort by total_score desc
      const sa = (a.score && a.score.total_score) || 0;
      const sb = (b.score && b.score.total_score) || 0;
      if (sb !== sa) return sb - sa;
      // Tie-break: wall_time_seconds asc
      const wa = a.submission_metadata?.performance_profile?.raw_measurements?.wall_time_seconds;
      const wb = b.submission_metadata?.performance_profile?.raw_measurements?.wall_time_seconds;
      if (wa != null && wb != null && wa !== wb) return wa - wb;
      // Double tie-break: entry_id deterministic
      return (a.entry_id || '').localeCompare(b.entry_id || '');
    });

  const rankMap = new Map();
  ranked.forEach((e, i) => rankMap.set(e.entry_id, i + 1));
  return rankMap;
}

// ---------------------------------------------------------------------------
// Page rendering
// ---------------------------------------------------------------------------

function pageHeader(navHtml, blindMode) {
  const blindNote = blindMode
    ? '<div class="blind-banner">⚠ Blind scoring mode — participant identities are anonymized. Identifying metadata is withheld.</div>'
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Agent Olympics - ${blindMode ? 'Blind ' : ''}Leaderboard</title>
<style>${CSS}</style>
</head>
<body>
<div class="nav-bar"><div class="container">
<a href="index.html" style="margin-right:20px;" class="nav-title">🏆 Agent Olympics</a>
</div></div>
<div class="container">
${blindNote}
`;
}

function pageFooter() {
  return `<div class="footer">Generated by Agent Olympics web-result-consumer.js | Scoreboard data is safe for web display</div>
</div></body></html>`;
}

/**
 * Render the leaderboard page.
 */
function renderLeaderboard(scoreboard, blindMode, title) {
  const sb = scoreboard;
  const entries = sb.entries || [];
  const ranks = computeRanks(entries);

  // Summary stats
  const totalEntries = entries.length;
  const entriesWithScore = entries.filter(e => e.score && e.score.total_score != null).length;
  const entriesPending = entries.filter(e => e.judge_type === 'pending').length;
  const comparable = entries.filter(e => e.comparable === true).length;
  const passCount = entries.filter(e => e.score && e.score.verdict === 'pass').length;

  const displayTitle = title || `Agent Olympics ${blindMode ? '(Blind) ' : ''}Leaderboard`;
  const displaySubtitle = `Round: ${escapeHtml(sb.round_id || '—')} | Generated: ${sb.generated_at || '—'}`;

  let html = pageHeader('', blindMode);
  html += `<h1>${escapeHtml(displayTitle)}</h1>
<div class="subtitle">${displaySubtitle}</div>`;

  // Summary box
  html += `<div class="summary-box">
<div class="summary-item"><div class="num">${totalEntries}</div><div class="label">Total Entries</div></div>
<div class="summary-item"><div class="num">${sb.participants?.length || 0}</div><div class="label">Participants</div></div>
<div class="summary-item"><div class="num">${entriesWithScore}</div><div class="label">Scored</div></div>
<div class="summary-item"><div class="num">${passCount}</div><div class="label">Passed</div></div>
<div class="summary-item"><div class="num">${entriesPending}</div><div class="label">Pending Human Review</div></div>
<div class="summary-item"><div class="num">${comparable}</div><div class="label">Comparable</div></div>
</div>`;

  // Table
  html += `<table>
<thead><tr>
<th>Rank</th><th>Participant</th><th>Task</th><th>Adapter</th><th>Runtime</th>
<th>Score</th><th>Correctness</th><th>Evidence</th><th>Safety</th>
<th>Status</th><th>Verdict</th><th>Wall Time</th>
</tr></thead><tbody>`;

  const allEntriesSorted = [...entries].sort((a, b) => {
    const ra = ranks.get(a.entry_id) || 999;
    const rb = ranks.get(b.entry_id) || 999;
    return ra - rb;
  });

  for (const entry of allEntriesSorted) {
    const rank = ranks.get(entry.entry_id);
    const rankStr = rank != null ? String(rank) : '—';
    const rankClass = rank != null ? `rank ${randClass(rank)}` : 'rank';
    const subMeta = entry.submission_metadata || {};
    const sc = entry.score || {};
    const dims = sc.dimensions || {};

    const detailUrl = `detail/${encodeURIComponent(entry.entry_id)}.html`;

    const totalScore = sc.total_score != null ? sc.total_score : '—';
    const corr = dims.correctness;
    const ev = dims.evidence_quality;
    const saf = dims.safety;
    const wallTime = subMeta.performance_profile?.raw_measurements?.wall_time_seconds;

    html += `<tr>
<td class="${rankClass}">${rankStr}</td>
<td><a href="${detailUrl}" class="agent-link">${escapeHtml(entry.agent_id)}</a></td>
<td><code>${escapeHtml(entry.task_id)}</code></td>
<td>${escapeHtml(subMeta.adapter || '—')}</td>
<td>${escapeHtml(subMeta.runtime || '—')}</td>
<td class="score-cell"><strong>${escapeHtml(String(totalScore))}</strong></td>
<td class="score-cell">${corr ? `${dimBarHtml(corr.score, corr.max)} ${corr.score}` : '—'}</td>
<td class="score-cell">${ev ? `${dimBarHtml(ev.score, ev.max)} ${ev.score}` : '—'}</td>
<td class="score-cell">${saf ? `${dimBarHtml(saf.score, saf.max)} ${saf.score}` : '—'}</td>
<td>${statusBadge(entry.status)}</td>
<td>${sc.verdict ? verdictBadge(sc.verdict) : '—'}</td>
<td>${formatWallTime(wallTime)}</td>
</tr>`;
  }

  html += '</tbody></table>';
  html += pageFooter();
  return html;
}

/**
 * Render a detail page for a single entry.
 */
function renderDetail(entry, blindMode) {
  if (!entry) return '<div class="empty-state">Entry not found</div>';

  const subMeta = entry.submission_metadata || {};
  const sc = entry.score || {};
  const dims = sc.dimensions || {};
  const hw = subMeta.hardware_profile || {};
  const perf = subMeta.performance_profile?.raw_measurements || {};

  let html = pageHeader(
    `<a href="../index.html">← Leaderboard</a> <span style="margin-left:16px;">${escapeHtml(entry.entry_id)}</span>`,
    blindMode
  );

  const provisionalNote = (entry.schema_validation && !entry.schema_validation.valid)
    ? '<div class="provisional-banner">⚠ This result has schema validation errors. Shown as provisional only.</div>'
    : '';

  const pendingNote = (entry.pending_dimensions && entry.pending_dimensions.length > 0)
    ? `<div class="pending-note">⏳ Pending human review dimensions: ${entry.pending_dimensions.join(', ')}</div>`
    : '';

  html += `<h1>${escapeHtml(entry.agent_id)} — ${escapeHtml(entry.task_id)}</h1>
<div class="subtitle">Entry ID: ${escapeHtml(entry.entry_id)} | Run: ${escapeHtml(entry.run_id)}</div>
${provisionalNote}
${pendingNote}`;

  // Scorecard
  html += `<div class="card" style="margin-bottom:20px;">
<h3>Scorecard</h3>
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
  <span style="font-size:1.3rem;font-weight:700;">Total: ${sc.total_score != null ? sc.total_score : '—'}</span>
  ${sc.verdict ? verdictBadge(sc.verdict) : ''}
  ${statusBadge(entry.status)}
</div>`;

  for (const [dimName, dimScore] of Object.entries(dims)) {
    html += `<div class="dim-card">
<span class="dim-name">${escapeHtml(dimName)}</span>
<span class="dim-score">${dimBarHtml(dimScore.score, dimScore.max)} ${formatScore(dimScore.score, dimScore.max)}</span>
</div>`;
  }

  // Pending dimensions
  if (entry.pending_dimensions) {
    for (const pd of entry.pending_dimensions) {
      if (!dims[pd]) {
        html += `<div class="dim-card">
<span class="dim-name">${escapeHtml(pd)}</span>
<span class="dim-score" style="color:#eab308;">⏳ Pending review</span>
</div>`;
      }
    }
  }
  html += '</div>';

  // Detail grid
  html += '<div class="detail-grid">';

  // Participant metadata card
  html += `<div class="card">
<h3>Participant Metadata</h3>
<div class="field-label">Participant</div><div class="field-value">${escapeHtml(entry.agent_id)}</div>
<div class="field-label">Runtime</div><div class="field-value">${escapeHtml(subMeta.runtime || '—')}${subMeta.runtime_version ? ' v' + escapeHtml(subMeta.runtime_version) : ''}</div>
<div class="field-label">Adapter</div><div class="field-value">${escapeHtml(subMeta.adapter || '—')}</div>
<div class="field-label">Model</div><div class="field-value">${escapeHtml(subMeta.model || '—')}${subMeta.model_provider ? ' (' + escapeHtml(subMeta.model_provider) + ')' : ''}</div>
<div class="field-label">Node</div><div class="field-value">${escapeHtml(subMeta.node || '—')}</div>
${subMeta.config_profile ? `<div class="field-label">Config Profile</div><div class="field-value">${escapeHtml(subMeta.config_profile)}</div>` : ''}
${subMeta.fixture_ref ? `<div class="field-label">Fixture Ref</div><div class="field-value"><code>${escapeHtml(subMeta.fixture_ref)}</code></div>` : ''}
${subMeta.task_version ? `<div class="field-label">Task Version</div><div class="field-value">${escapeHtml(subMeta.task_version)}</div>` : ''}
</div>`;

  // Hardware profile card
  html += `<div class="card">
<h3>Hardware Profile</h3>
<div class="field-label">CPU Class</div><div class="field-value">${escapeHtml(hw.cpu_class || '—')}</div>
<div class="field-label">Memory</div><div class="field-value">${hw.memory_gb != null ? hw.memory_gb + ' GB' : '—'}</div>
<div class="field-label">Storage</div><div class="field-value">${escapeHtml(hw.storage_class || '—')}</div>
<div class="field-label">OS</div><div class="field-value">${escapeHtml(hw.os_family || '—')}</div>
<div class="field-label">GPU</div><div class="field-value">${escapeHtml(hw.gpu_model || '—')}</div>
</div>`;

  // Performance card
  if (Object.keys(perf).length > 0) {
    html += `<div class="card">
<h3>Performance Measurements</h3>`;
    for (const [key, val] of Object.entries(perf)) {
      html += `<div class="field-label">${escapeHtml(key)}</div><div class="field-value">${escapeHtml(String(val))}</div>`;
    }
    html += '</div>';
  }

  // Validation card
  html += `<div class="card">
<h3>Validation</h3>
<div class="field-label">Schema Valid</div><div class="field-value">${entry.schema_validation ? (entry.schema_validation.valid ? '✅ Yes' : '❌ No') : '—'}</div>
<div class="field-label">Semantic Checks</div><div class="field-value">${entry.semantic_checks ? (entry.semantic_checks.passed ? '✅ Passed' : '❌ Failed') : '—'}</div>
<div class="field-label">Evidence Count</div><div class="field-value">${entry.presence_checks?.evidence_count ?? '—'}</div>
<div class="field-label">Findings Count</div><div class="field-value">${entry.presence_checks?.finding_count ?? '—'}</div>
<div class="field-label">Judge Type</div><div class="field-value">${escapeHtml(entry.judge_type || '—')}</div>
${entry.judge_record_ref ? `<div class="field-label">Judge Record</div><div class="field-value"><code>${escapeHtml(entry.judge_record_ref)}</code></div>` : ''}
${entry.packet_ref ? `<div class="field-label">Packet Ref</div><div class="field-value"><code>${escapeHtml(entry.packet_ref)}</code></div>` : ''}
</div>`;

  // Comparability card
  html += `<div class="card">
<h3>Comparability</h3>
<div class="field-value" style="margin-bottom:6px;">${entry.comparable ? '✅ Comparable' : '❌ Not comparable'}</div>`;
  if (entry.comparability_caveats && entry.comparability_caveats.length > 0) {
    for (const c of entry.comparability_caveats) {
      html += `<div class="caveat-item">⚠ ${escapeHtml(c)}</div>`;
    }
  }
  html += '</div>';

  // Evidence card
  html += `<div class="card" style="grid-column:1/-1;">
<h3>Evidence Items</h3>`;
  if (entry.packet_ref) {
    // Try to load the actual result packet for human-readable evidence
    try {
      const yaml = require('js-yaml');
      const packetPath = path.resolve(entry.packet_ref);
      if (fs.existsSync(packetPath)) {
        const packet = yaml.load(fs.readFileSync(packetPath, 'utf8'));
        if (packet && packet.evidence && packet.evidence.length > 0) {
          for (const ev of packet.evidence) {
            html += `<div class="evidence-card">
<div class="ev-label">${escapeHtml(ev.id || '—')} <span class="badge badge-${escapeHtml(ev.kind || 'other')}" style="background:#e2e8f0;color:#475569;">${escapeHtml(ev.kind || '')}</span>${ev.redacted ? ' <span style="color:#dc2626;">🔴 Redacted</span>' : ''}</div>
<div style="font-size:0.85rem;margin-top:4px;">${escapeHtml(ev.summary || '')}</div>
<div style="font-size:0.78rem;color:#64748b;margin-top:2px;">Source: ${escapeHtml(ev.source || '—')}</div>
</div>`;
          }
        } else {
          html += '<div class="empty-state">No evidence items in packet</div>';
        }
      } else {
        html += `<div class="empty-state">Packet file not found: ${escapeHtml(entry.packet_ref)}</div>`;
      }
    } catch {
      html += `<div class="empty-state">Could not load packet ref: ${escapeHtml(entry.packet_ref)}</div>`;
    }
  } else {
    html += '<div class="empty-state">No packet reference available</div>';
  }
  html += '</div>';

  // Warnings/errors card
  const warns = entry.warnings || [];
  const errs = entry.errors || [];
  if (warns.length > 0 || errs.length > 0) {
    html += `<div class="card" style="grid-column:1/-1;">
<h3>Warnings & Errors</h3>`;
    for (const w of warns) { html += `<div style="color:#b45309;">⚠ ${escapeHtml(w)}</div>`; }
    for (const e of errs) { html += `<div style="color:#dc2626;">❌ ${escapeHtml(e)}</div>`; }
    html += '</div>';
  }

  html += '</div>'; // end detail-grid

  // Back link
  html += `<p><a href="../index.html">← Back to Leaderboard</a></p>`;
  html += pageFooter();
  return html;
}

/**
 * Render a comparison view for entries with the same task_id.
 */
function renderComparison(entries, taskId, blindMode) {
  let html = pageHeader(
    `<a href="../index.html">← Leaderboard</a> <span style="margin-left:16px;">Comparison: ${escapeHtml(taskId)}</span>`,
    blindMode
  );

  html += `<h1>Comparison: ${escapeHtml(taskId)}</h1>
<div class="subtitle">${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}</div>`;

  // Check comparability caveats
  const allCaveats = entries.flatMap(e => e.comparability_caveats || []);
  if (allCaveats.length > 0) {
    html += '<div class="pending-note">⚠ Comparability notes:<ul>';
    for (const c of [...new Set(allCaveats)]) {
      html += `<li>${escapeHtml(c)}</li>`;
    }
    html += '</ul></div>';
  }

  // Score comparison table
  html += `<h2>Score Comparison</h2>
<table class="compare-table">
<thead><tr><th>Participant</th><th>Total</th>`;

  // Collect dimension names
  const allDims = new Set();
  for (const e of entries) {
    if (e.score?.dimensions) {
      for (const dim of Object.keys(e.score.dimensions)) allDims.add(dim);
    }
    if (e.pending_dimensions) {
      for (const pd of e.pending_dimensions) allDims.add(pd);
    }
  }
  for (const dim of allDims) { html += `<th>${escapeHtml(dim)}</th>`; }
  html += `<th>Wall Time</th><th>Verdict</th></tr></thead><tbody>`;

  for (const entry of entries) {
    const sc = entry.score || {};
    const dims = sc.dimensions || {};
    const wallTime = entry.submission_metadata?.performance_profile?.raw_measurements?.wall_time_seconds;
    html += `<tr>
<td><a href="../detail/${encodeURIComponent(entry.entry_id)}.html">${escapeHtml(entry.agent_id)}</a></td>
<td><strong>${sc.total_score != null ? sc.total_score : '—'}</strong></td>`;
    for (const dim of allDims) {
      if (dims[dim]) {
        html += `<td>${formatScore(dims[dim].score, dims[dim].max)}</td>`;
      } else if (entry.pending_dimensions && entry.pending_dimensions.includes(dim)) {
        html += `<td style="color:#eab308;">⏳ Pending</td>`;
      } else {
        html += `<td>—</td>`;
      }
    }
    html += `<td>${formatWallTime(wallTime)}</td>
<td>${sc.verdict ? verdictBadge(sc.verdict) : '—'}</td>
</tr>`;
  }
  html += '</tbody></table>';

  // Hardware comparison
  html += `<h2>Hardware Comparison</h2>
<table class="compare-table">
<thead><tr><th>Participant</th><th>CPU Class</th><th>Memory</th><th>Storage</th><th>OS</th><th>GPU</th></tr></thead><tbody>`;
  for (const entry of entries) {
    const hw = entry.submission_metadata?.hardware_profile || {};
    html += `<tr>
<td>${escapeHtml(entry.agent_id)}</td>
<td>${escapeHtml(hw.cpu_class || '—')}</td>
<td>${hw.memory_gb != null ? hw.memory_gb + ' GB' : '—'}</td>
<td>${escapeHtml(hw.storage_class || '—')}</td>
<td>${escapeHtml(hw.os_family || '—')}</td>
<td>${escapeHtml(hw.gpu_model || '—')}</td>
</tr>`;
  }
  html += '</tbody></table>';

  html += `<p><a href="../index.html">← Back to Leaderboard</a></p>`;
  html += pageFooter();
  return html;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const scoreboardPath = args[0];
  if (!scoreboardPath) {
    console.error('Usage: node scripts/web-result-consumer.js <scoreboard.json> [options]');
    console.error('Options:');
    console.error('  --output-dir <dir>   Output directory (default: ./web-output)');
    console.error('  --blind              Apply blind display rules');
    console.error('  --title <string>     Custom page title');
    process.exit(1);
  }

  const blindFlagIdx = args.indexOf('--blind');
  const blindMode = blindFlagIdx !== -1;
  const titleIdx = args.indexOf('--title');
  const title = titleIdx !== -1 && titleIdx + 1 < args.length ? args[titleIdx + 1] : null;

  const outIdx = args.indexOf('--output-dir');
  const outputDir = outIdx !== -1 && outIdx + 1 < args.length
    ? path.resolve(args[outIdx + 1])
    : path.resolve('web-output');

  // Load scoreboard
  if (!fs.existsSync(scoreboardPath)) {
    console.error(`Scoreboard not found: ${scoreboardPath}`);
    process.exit(1);
  }
  const scoreboard = JSON.parse(fs.readFileSync(scoreboardPath, 'utf8'));

  // Validate required fields
  if (!scoreboard.entries || !Array.isArray(scoreboard.entries)) {
    console.error('Scoreboard is missing entries array');
    process.exit(1);
  }

  // Create output directories
  const detailDir = path.join(outputDir, 'detail');
  const compareDir = path.join(outputDir, 'compare');
  fs.mkdirSync(detailDir, { recursive: true });
  fs.mkdirSync(compareDir, { recursive: true });

  // --- Leaderboard ---
  const leaderboardHtml = renderLeaderboard(scoreboard, blindMode, title);
  const indexPath = path.join(outputDir, 'index.html');
  fs.writeFileSync(indexPath, leaderboardHtml);
  console.log(`✓ Leaderboard: ${indexPath}`);

  // --- Detail pages ---
  let detailCount = 0;
  for (const entry of scoreboard.entries) {
    const detailHtml = renderDetail(entry, blindMode);
    const detailPath = path.join(detailDir, `${entry.entry_id}.html`);
    fs.writeFileSync(detailPath, detailHtml);
    detailCount++;
  }
  console.log(`✓ Detail pages: ${detailCount} files → ${detailDir}/`);

  // --- Comparison views ---
  const byTask = new Map();
  for (const entry of scoreboard.entries) {
    const taskId = entry.task_id || 'unknown';
    if (!byTask.has(taskId)) byTask.set(taskId, []);
    byTask.get(taskId).push(entry);
  }

  let compareCount = 0;
  for (const [taskId, taskEntries] of byTask.entries()) {
    if (taskEntries.length < 2) continue; // Only compare when ≥2 entries
    const compareHtml = renderComparison(taskEntries, taskId, blindMode);
    const comparePath = path.join(compareDir, `${taskId}.html`);
    fs.writeFileSync(comparePath, compareHtml);
    compareCount++;
  }
  console.log(`✓ Comparison views: ${compareCount} task groups → ${compareDir}/`);

  // Summary
  const outputSize = fs.readdirSync(outputDir, { recursive: true })
    .filter(f => f.endsWith('.html')).length;
  console.log(`\n--- Summary ---`);
  console.log(`Output directory: ${outputDir}`);
  console.log(`HTML pages generated: ${outputSize}`);
  console.log(`Data source: ${scoreboardPath}`);
  console.log(`Blind mode: ${blindMode ? 'ON' : 'OFF'}`);
}

main();
