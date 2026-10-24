'use strict';

// Gate presentation kernel (relay v2 slice A): the canonical card producer the
// gate-registry header names as a consumer. It fills a hole — the dwf workflow
// layer used to inline-produce `tmp/api-reference-sync/gate-presentation/`
// artifacts and that layer is gone, while bin/sdk-review-session.js handoff
// recipes still tell the worker to run `scripts/gate-presentation.js`.
//
// Division of labor (mirror of the registry's own comment):
//   - gate-registry.js        — gate names + the EXACT reply-line builder
//   - gate-presentation.js    — THIS module: build the machine-truth index and
//                               render the human card (pure; all IO lives in
//                               scripts/gate-presentation.js)
//   - gate-presentation-check.js — the validator half, re-derives every
//                               replyLine from the index's own fields
//
// Iron rules:
//   1. A presentation NEVER computes or invents a digest. The digest is read
//      verbatim from the input artifact (dry-run receipt / gate manifest) and
//      only carried through. Field names are the real ones on disk:
//        dry-run full JSON   → proposedExecutionBatch.batchDigest
//        dry-run bounded sum → proposedBatchDigest
//        gate manifest       → digest, or the gate's native receipt field
//                              (proposalDigest / rollbackManifestDigest /
//                               acceptanceManifestDigest / campaignPlanDigest)
//   2. Every replyLine in the index must be reconstructible through
//      gateRegistry.gateReplyLine — the builder derives them (never accepts a
//      free-form override) and self-checks; drift is a typed rejection.
//   3. A presentation MUST be bound to a session (sessionPath). An unbound
//      gate presentation cannot be approved — this is the root of the slice-B
//      trust chain (card matching = gate kind + session).
//
// Manifest gates may bind session state: for APPROVE_DOCUMENT the CLI hands in
// the loaded session and every unit must match a pendingExecution by
// (reviewUnitId, executionJournalDigest) — a card describing executions the
// session does not hold is unbound (PRESENTATION_SESSION_UNBOUND).

const path = require('node:path');

const { GATE_NAMES, gateReplyLine, isGateName } = require('./gate-registry');
const { sortApprovalUnits } = require('./campaign-approval');

const PRESENTATION_SCHEMA = 1;
const PRESENTATION_INPUT_INVALID = 'PRESENTATION_INPUT_INVALID';
const PRESENTATION_DIGEST_MISSING = 'PRESENTATION_DIGEST_MISSING';
const PRESENTATION_REPLY_LINE_MISMATCH = 'PRESENTATION_REPLY_LINE_MISMATCH';
const PRESENTATION_SESSION_UNBOUND = 'PRESENTATION_SESSION_UNBOUND';
const PRESENTATION_UNIT_INCOMPLETE = 'PRESENTATION_UNIT_INCOMPLETE';

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
// Mirror of bin/sdk-review-session.js APPROVE_DOCUMENT_LINE_RE — the strict
// grammar resolve-batch-review parses. The presentation must emit lines the
// resolver accepts verbatim.
const DOCUMENT_LINE_PATTERN = /^APPROVE_DOCUMENT\s+(\S+)\s+sha256:([0-9a-f]{64})$/;
// Execution journals on disk are named sha256-<64hex>.jsonl (review-session-
// store.js receipt naming and every campaign-plans journal).
const JOURNAL_NAME_PATTERN = /^sha256-([0-9a-f]{64})\.jsonl$/;

// Native receipt field per digest-bound gate — verified against the producers:
//   grouping-proposal.js     → proposalDigest        (APPROVE_GROUPING <proposalDigest>)
//   rollback-planner.js      → rollbackManifestDigest
//   acceptance-finalizer.js  → acceptanceManifestDigest
//   campaign-approval.js     → campaignPlanDigest
// APPROVE_WRITES has no manifest carrier (its binding is the dry-run batch
// digest); APPROVE_DOCUMENT binds per-unit journal digests instead.
const DIGEST_FIELD_BY_GATE = Object.freeze({
  APPROVE_GROUPING: 'proposalDigest',
  APPROVE_ROLLBACK: 'rollbackManifestDigest',
  APPROVE_ACCEPTANCE: 'acceptanceManifestDigest',
  APPROVE_CAMPAIGN: 'campaignPlanDigest',
});

class PresentationError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PresentationError';
    this.code = code;
    this.details = details;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// Filesystem-safe, readability-preserving session key: every character outside
// [A-Za-z0-9._-] becomes '-' (no collapsing — the mapping stays injective so
// two sessions can never share an output directory).
function sessionKeyOf(sessionPath) {
  if (!nonEmptyString(sessionPath)) return null;
  return sessionPath.split(path.sep).join('/').replace(/[^A-Za-z0-9._-]/g, '-');
}

function toPosixRelative(sessionPath) {
  return sessionPath.split(path.sep).join('/');
}

// ---------- input shaping ----------

function extractDryRunDigest(dryRun) {
  // Full engine result first (bin/sdk-doc-sync.js --json), bounded summary
  // second (createBoundedSummary). No fallback to proposedReleaseBatchDigest:
  // the APPROVE_WRITES gate binds the EXECUTION batch, and a release batch is
  // a different signing surface.
  const full = dryRun?.proposedExecutionBatch?.batchDigest;
  const bounded = dryRun?.proposedBatchDigest;
  if (full !== undefined && full !== null) return { digest: full, field: 'proposedExecutionBatch.batchDigest' };
  if (bounded !== undefined && bounded !== null) return { digest: bounded, field: 'proposedBatchDigest' };
  return { digest: null, field: null };
}

// Batch-scoped unit rows for the write-gate card. Prefer the dry-run's own
// writeApprovalPresentation (built from the exact actionable batch, carries
// title + live links); fall back to the active review unit; else no rows (a
// digest-only card — the digest remains the only binding).
function writeUnitsFromDryRun(dryRun) {
  const manifestUnits = Array.isArray(dryRun?.reviewUnitManifest?.units)
    ? dryRun.reviewUnitManifest.units
    : [];
  const stableIdToUnit = new Map(manifestUnits.map((unit) => [unit?.documentStableId, unit]));
  const previews = Array.isArray(dryRun?.reviewUnitPreviews) ? dryRun.reviewUnitPreviews : [];
  const previewByUnitId = new Map(previews.map((preview) => [preview?.reviewUnitId, preview]));

  const presentation = Array.isArray(dryRun?.writeApprovalPresentation)
    ? dryRun.writeApprovalPresentation
    : [];
  if (presentation.length > 0) {
    return presentation.map((entry) => {
      const bound = stableIdToUnit.get(entry?.stableId) || null;
      const reviewUnitId = bound?.reviewUnitId || entry?.stableId || null;
      const preview = reviewUnitId ? previewByUnitId.get(reviewUnitId) : null;
      return {
        reviewUnitId,
        label: nonEmptyString(entry?.title) ? entry.title : (reviewUnitId || ''),
        journal: null,
        journalDigest: null,
        // per-unit batch digest is display-only context, never the binding
        unitBatchDigest: preview?.batchDigest || null,
        links: [entry?.documentLink, entry?.recordLink].filter(nonEmptyString),
      };
    }).filter((unit) => nonEmptyString(unit.reviewUnitId));
  }

  const active = dryRun?.activeReviewUnit;
  if (isObject(active) && nonEmptyString(active.reviewUnitId)) {
    const preview = previewByUnitId.get(active.reviewUnitId) || null;
    return [{
      reviewUnitId: active.reviewUnitId,
      label: nonEmptyString(active.documentStableId) ? active.documentStableId : active.reviewUnitId,
      journal: null,
      journalDigest: null,
      unitBatchDigest: preview?.batchDigest || null,
      links: [],
    }];
  }
  return [];
}

function manifestUnitsFromInput(manifest, gate) {
  const rawUnits = manifest?.units;
  // Digest-bound gates may present on the digest alone (grouping receipt,
  // campaign plan, acceptance manifest, rollback manifest); only the DOCUMENT
  // gate binds per-unit rows and therefore requires the array.
  if (rawUnits === undefined || rawUnits === null) {
    if (gate === 'APPROVE_DOCUMENT') {
      throw new PresentationError(PRESENTATION_INPUT_INVALID, 'gate manifest requires a units array', { field: 'units' });
    }
    return [];
  }
  if (!Array.isArray(rawUnits)) {
    throw new PresentationError(PRESENTATION_INPUT_INVALID, 'gate manifest requires a units array', { field: 'units' });
  }
  const units = rawUnits.map((unit) => {
    if (!isObject(unit) || !nonEmptyString(unit.reviewUnitId)) {
      throw new PresentationError(
        PRESENTATION_UNIT_INCOMPLETE,
        'every gate manifest unit requires a non-empty reviewUnitId',
        { field: 'units[].reviewUnitId' },
      );
    }
    const journalDigest = nonEmptyString(unit.journalDigest)
      ? unit.journalDigest
      : (nonEmptyString(unit.executionJournalDigest) ? unit.executionJournalDigest : null);
    let journal = null;
    if (nonEmptyString(unit.journalPath)) journal = path.basename(unit.journalPath);
    else if (nonEmptyString(unit.journal)) journal = unit.journal;
    const links = Array.isArray(unit.links) ? unit.links.filter(nonEmptyString) : [];
    const row = {
      reviewUnitId: unit.reviewUnitId,
      label: nonEmptyString(unit.label)
        ? unit.label
        : (nonEmptyString(unit.documentStableId) ? unit.documentStableId : unit.reviewUnitId),
      journal,
      journalDigest,
      unitBatchDigest: nonEmptyString(unit.batchDigest) ? unit.batchDigest : null,
      links,
    };
    if (gate === 'APPROVE_DOCUMENT') {
      if (typeof journalDigest !== 'string' || !DIGEST_PATTERN.test(journalDigest)) {
        throw new PresentationError(
          PRESENTATION_UNIT_INCOMPLETE,
          `DOCUMENT gate unit ${unit.reviewUnitId} requires a sha256:<64-hex> journal digest (executionJournalDigest)`,
          { reviewUnitId: unit.reviewUnitId },
        );
      }
    }
    return row;
  });
  return units;
}

// The session truth check (APPROVE_DOCUMENT only): every presented unit must
// bind a pendingExecution of the loaded session. A card describing executions
// the session does not hold is unbound — fail closed.
function assertDocumentUnitsBoundToSession(units, session) {
  if (!isObject(session) || !Array.isArray(session.pendingExecutions)) {
    throw new PresentationError(
      PRESENTATION_SESSION_UNBOUND,
      'the bound session exposes no pendingExecutions — a DOCUMENT gate presentation cannot be bound',
      { sessionPath: null },
    );
  }
  const pending = new Map(session.pendingExecutions
    .filter((row) => isObject(row) && nonEmptyString(row.reviewUnitId))
    .map((row) => [row.reviewUnitId, row.executionJournalDigest]));
  for (const unit of units) {
    if (!pending.has(unit.reviewUnitId)) {
      throw new PresentationError(
        PRESENTATION_SESSION_UNBOUND,
        `unit ${unit.reviewUnitId} is not a pending execution of the bound session`,
        { reviewUnitId: unit.reviewUnitId },
      );
    }
    if (pending.get(unit.reviewUnitId) !== unit.journalDigest) {
      throw new PresentationError(
        PRESENTATION_SESSION_UNBOUND,
        `unit ${unit.reviewUnitId} journal digest ${unit.journalDigest} does not bind the session's pending execution (${pending.get(unit.reviewUnitId)})`,
        { reviewUnitId: unit.reviewUnitId },
      );
    }
  }
}

// ---------- reply-line derivation (through the registry, always) ----------

function deriveReplyLines({ gate, digest, units }) {
  if (gate === 'APPROVE_DOCUMENT') {
    return sortApprovalUnits(units).map((unit) => {
      const line = `APPROVE_DOCUMENT ${unit.reviewUnitId} ${unit.journalDigest}`;
      if (!DOCUMENT_LINE_PATTERN.test(line)) {
        throw new PresentationError(
          PRESENTATION_REPLY_LINE_MISMATCH,
          `derived reply line for ${unit.reviewUnitId} violates the APPROVE_DOCUMENT grammar the batch resolver parses`,
          { reviewUnitId: unit.reviewUnitId, line },
        );
      }
      // The registry is the single reconstruction surface: the exact line the
      // registry would emit for a manifest carrying this replyLine.
      if (gateReplyLine('APPROVE_DOCUMENT', { replyLine: line }) !== line) {
        throw new PresentationError(
          PRESENTATION_REPLY_LINE_MISMATCH,
          `reply line for ${unit.reviewUnitId} is not reconstructible through gateRegistry.gateReplyLine`,
          { reviewUnitId: unit.reviewUnitId, line },
        );
      }
      return line;
    });
  }
  if (typeof digest !== 'string' || !DIGEST_PATTERN.test(digest)) {
    throw new PresentationError(PRESENTATION_REPLY_LINE_MISMATCH, 'reply-line derivation requires a well-formed digest', { gate });
  }
  const line = gateReplyLine(gate, { digest });
  if (line === null || line !== `${gate} ${digest}`) {
    throw new PresentationError(
      PRESENTATION_REPLY_LINE_MISMATCH,
      `gateReplyLine(${gate}) did not reconstruct the digest line — registry drift`,
      { gate, digest },
    );
  }
  return [line];
}

function defaultTitle(gate, unitCount) {
  return unitCount > 0 ? `${gate} — ${unitCount} 单元` : `${gate} — 批准门`;
}

// ---------- buildPresentationIndex ----------

// input:
//   fromDryrun — parsed dry-run receipt (engine --json result or bounded summary); gate = APPROVE_WRITES
//   manifest   — parsed gate manifest { gate, units[], digest? }; any registered gate
//   sessionPath     (required) repo-relative POSIX path of the sync session
//   session         (optional) parsed session object — enables the DOCUMENT binding check
//   title / notes   (optional) human text
//   generatedAt     (optional) ISO stamp override (tests); defaults to now
function buildPresentationIndex(input = {}) {
  if (!isObject(input)) {
    throw new PresentationError(PRESENTATION_INPUT_INVALID, 'presentation input must be an object');
  }
  if (!nonEmptyString(input.sessionPath)) {
    throw new PresentationError(
      PRESENTATION_SESSION_UNBOUND,
      'a gate presentation must be bound to a sync session (--session) — unbound presentations cannot be approved',
      { field: 'sessionPath' },
    );
  }
  const sessionPath = toPosixRelative(input.sessionPath);
  const sessionKey = sessionKeyOf(sessionPath);
  if (!nonEmptyString(sessionKey)) {
    throw new PresentationError(PRESENTATION_SESSION_UNBOUND, 'sessionPath must derive a filesystem-safe session key', { sessionPath });
  }

  const hasDryrun = input.fromDryrun !== undefined && input.fromDryrun !== null;
  const hasManifest = input.manifest !== undefined && input.manifest !== null;
  if (hasDryrun === hasManifest) {
    throw new PresentationError(
      PRESENTATION_INPUT_INVALID,
      'buildPresentationIndex requires exactly one source: fromDryrun or manifest',
    );
  }

  let gate;
  let digest = null;
  let units;
  let providedReplyLines = null;

  if (hasDryrun) {
    const dryRun = input.fromDryrun;
    if (!isObject(dryRun)) {
      throw new PresentationError(PRESENTATION_INPUT_INVALID, 'fromDryrun must be a parsed dry-run receipt object');
    }
    gate = 'APPROVE_WRITES';
    const extracted = extractDryRunDigest(dryRun);
    digest = extracted.digest;
    if (digest === null) {
      throw new PresentationError(
        PRESENTATION_DIGEST_MISSING,
        'the dry-run receipt carries no execution batch digest'
          + (dryRun.reviewUnitSelectionRequired === true
            ? ' (review-unit selection required — select one unit with --review-unit-id and re-run the dry-run)'
            : ` (looked for proposedExecutionBatch.batchDigest / proposedBatchDigest)`),
        { fields: ['proposedExecutionBatch.batchDigest', 'proposedBatchDigest'] },
      );
    }
    if (typeof digest !== 'string' || !DIGEST_PATTERN.test(digest)) {
      throw new PresentationError(PRESENTATION_INPUT_INVALID, `dry-run batch digest must be sha256:<64-hex> (got ${JSON.stringify(digest)})`);
    }
    units = writeUnitsFromDryRun(dryRun);
  } else {
    const manifest = input.manifest;
    if (!isObject(manifest)) {
      throw new PresentationError(PRESENTATION_INPUT_INVALID, 'manifest must be a parsed gate manifest object');
    }
    if (!isGateName(manifest.gate)) {
      throw new PresentationError(
        PRESENTATION_INPUT_INVALID,
        `gate manifest requires a registered gate (got ${JSON.stringify(manifest.gate)}); registered: ${GATE_NAMES.join(', ')}`,
      );
    }
    gate = manifest.gate;
    units = manifestUnitsFromInput(manifest, gate);
    if (gate === 'APPROVE_DOCUMENT') {
      if (manifest.digest !== undefined && manifest.digest !== null) {
        throw new PresentationError(
          PRESENTATION_INPUT_INVALID,
          'APPROVE_DOCUMENT binds per-unit journal digests, not a top-level digest',
          { field: 'digest' },
        );
      }
    } else {
      const nativeField = DIGEST_FIELD_BY_GATE[gate] || null;
      digest = manifest.digest !== undefined && manifest.digest !== null
        ? manifest.digest
        : (nativeField && manifest[nativeField] !== undefined && manifest[nativeField] !== null ? manifest[nativeField] : null);
      if (digest === null) {
        throw new PresentationError(
          PRESENTATION_DIGEST_MISSING,
          `the ${gate} manifest carries no digest (looked for digest${nativeField ? ` / ${nativeField}` : ''}) — a presentation never computes one`,
          { fields: nativeField ? ['digest', nativeField] : ['digest'] },
        );
      }
      if (typeof digest !== 'string' || !DIGEST_PATTERN.test(digest)) {
        throw new PresentationError(PRESENTATION_INPUT_INVALID, `${gate} digest must be sha256:<64-hex> (got ${JSON.stringify(digest)})`);
      }
    }
    if (Array.isArray(manifest.replyLines)) providedReplyLines = manifest.replyLines;
    if (gate === 'APPROVE_DOCUMENT' && units.length === 0) {
      throw new PresentationError(PRESENTATION_INPUT_INVALID, 'an APPROVE_DOCUMENT presentation requires at least one unit');
    }
  }

  const sortedUnits = sortApprovalUnits(units);
  const replyLines = deriveReplyLines({ gate, digest, units: sortedUnits });

  // Supplied reply lines are verified, never trusted: drift is a typed reject.
  if (providedReplyLines !== null) {
    if (!Array.isArray(providedReplyLines)
      || providedReplyLines.length !== replyLines.length
      || providedReplyLines.some((line, index) => line !== replyLines[index])) {
      throw new PresentationError(
        PRESENTATION_REPLY_LINE_MISMATCH,
        'manifest replyLines disagree with the lines derived from the bound digest/units through gateRegistry.gateReplyLine',
        { provided: providedReplyLines, derived: replyLines },
      );
    }
  }
  if (gate === 'APPROVE_DOCUMENT' && nonEmptyString(input.manifest.replyLine)) {
    if (!replyLines.includes(input.manifest.replyLine.trim())) {
      throw new PresentationError(
        PRESENTATION_REPLY_LINE_MISMATCH,
        'manifest replyLine is not one of the per-unit lines derived from the units',
        { provided: input.manifest.replyLine, derived: replyLines },
      );
    }
  }

  // Document gate sessions must actually hold the presented executions.
  if (gate === 'APPROVE_DOCUMENT' && input.session !== undefined && input.session !== null) {
    assertDocumentUnitsBoundToSession(sortedUnits, input.session);
  }

  const generatedAt = nonEmptyString(input.generatedAt) ? input.generatedAt : new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new PresentationError(PRESENTATION_INPUT_INVALID, `generatedAt must be an ISO timestamp (got ${JSON.stringify(input.generatedAt)})`);
  }

  return {
    schema: PRESENTATION_SCHEMA,
    sessionKey,
    sessionPath,
    gate,
    title: nonEmptyString(input.title) ? input.title : defaultTitle(gate, sortedUnits.length),
    generatedAt,
    digest,
    replyLines,
    units: sortedUnits.map((unit) => ({
      reviewUnitId: unit.reviewUnitId,
      label: unit.label,
      journal: unit.journal,
      journalDigest: unit.journalDigest,
      unitBatchDigest: unit.unitBatchDigest,
      links: [...unit.links],
    })),
    notes: nonEmptyString(input.notes) ? input.notes : '',
  };
}

// ---------- human card (dark tone of the last dwf-era latest.html) ----------

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Kept parseable by scripts/dashboard/gate-watch.js parseGatePresentation so
// the board keeps attaching the card until slice B upgrades it to index.json:
// <h1>GATE — …</h1>, `bound digest: <code>sha256:…</code>` (digest gates only),
// `session: <code>…</code>`, `generated: <ISO>` and per-unit anchors
// `<a href="…">N. <reviewUnitId> — …</a>` in the link summary.
// NOTE: the parser's regexes match BARE `<h1>` and `<code>` tags — these three
// spots must stay attribute-free (styling happens through the body defaults).
function renderCardHtml(index) {
  if (!isObject(index)) {
    throw new PresentationError(PRESENTATION_INPUT_INVALID, 'renderCardHtml requires a built presentation index');
  }
  const unitRows = index.units.map((unit, i) => {
    const ordinal = i + 1;
    const journalLine = unit.journalDigest
      ? `<div style="font-size:12px;color:#9aa4b2;margin-top:6px">journal: ${esc(unit.journal || '')}（digest ${esc(unit.journalDigest)}）</div>`
      : (unit.unitBatchDigest
        ? `<div style="font-size:12px;color:#9aa4b2;margin-top:6px">单元批次 digest（展示用）：${esc(unit.unitBatchDigest)}</div>`
        : '');
    const linkCell = unit.links.length > 0
      ? unit.links.map((link, j) => `<a href="${esc(link)}">${ordinal}.${String.fromCharCode(97 + j)} 链接 ↗</a>`).join('<br>')
      : '<span style="color:#5f6672">—</span>';
    return [
      '<tr>',
      `<td style="padding:8px 12px;border-bottom:1px solid #333;vertical-align:top">${ordinal}</td>`,
      `<td style="padding:8px 12px;border-bottom:1px solid #333">`,
      `<div style="font-weight:600;font-size:15px">${esc(unit.label)}</div>`,
      `<div style="color:#9aa4b2;font-size:12px;margin:2px 0">${esc(unit.reviewUnitId)}</div>`,
      journalLine,
      '</td>',
      `<td style="padding:8px 12px;border-bottom:1px solid #333;white-space:nowrap;vertical-align:top">${linkCell}</td>`,
      '</tr>',
    ].join('');
  }).join('\n');

  const replyBlocks = index.replyLines.map((line) => (
    `<p style="margin:6px 0"><code style="display:inline-block;padding:6px 12px;background:#1f2330;border:1px solid #3a4150;border-radius:6px;font-size:13px">${esc(line)}</code></p>`
  )).join('\n');

  const digestLine = index.digest
    ? `<div>bound digest: <code>${esc(index.digest)}</code></div>`
    : '<div>bound digest: <span style="color:#9aa4b2">（逐单元 journal digest，见回行）</span></div>';

  const summaryItems = [];
  for (const unit of index.units) {
    const ordinal = index.units.indexOf(unit) + 1;
    for (const link of unit.links) {
      summaryItems.push(`<li><a href="${esc(link)}">${ordinal}. ${esc(unit.reviewUnitId)} — ${esc(unit.label)}</a></li>`);
    }
  }

  const notesLine = index.notes ? `<div style="margin-top:4px">${esc(index.notes)}</div>` : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(index.title)}</title></head>
<body style="font-family:-apple-system,sans-serif;background:#16181d;color:#e8eaed;max-width:960px;margin:32px auto;padding:0 24px">
<h1>${esc(index.title)}</h1>
<p style="color:#9aa4b2;font-size:13px;line-height:1.7">
<div>session: <code>${esc(index.sessionPath)}</code></div>
<div>generated: ${esc(index.generatedAt)}</div>
${digestLine}${notesLine}
</p>
<h2 style="font-size:15px;margin-top:20px">批准回行（逐字复制到会话）</h2>
${replyBlocks}
<table style="border-collapse:collapse;width:100%;font-size:13px;margin-top:16px">
<tr style="color:#9aa4b2;text-align:left"><th style="padding:8px 12px">#</th><th style="padding:8px 12px">单元</th><th style="padding:8px 12px">链接</th></tr>
${unitRows}
</table>
<h2 style="font-size:15px;margin-top:24px">链接总表</h2>
<ul style="font-size:13px;line-height:1.8">${summaryItems.join('')}</ul>
<p style="color:#9aa4b2;font-size:12px;margin-top:24px">digest 行是唯一绑定；本卡片与 index.json 只是呈现。未列出的单元不在本门范围内。</p>
</body></html>
`;
}

module.exports = {
  PRESENTATION_SCHEMA,
  PRESENTATION_INPUT_INVALID,
  PRESENTATION_DIGEST_MISSING,
  PRESENTATION_REPLY_LINE_MISMATCH,
  PRESENTATION_SESSION_UNBOUND,
  PRESENTATION_UNIT_INCOMPLETE,
  DIGEST_PATTERN,
  DOCUMENT_LINE_PATTERN,
  JOURNAL_NAME_PATTERN,
  DIGEST_FIELD_BY_GATE,
  GATE_NAMES,
  PresentationError,
  sessionKeyOf,
  buildPresentationIndex,
  renderCardHtml,
};
