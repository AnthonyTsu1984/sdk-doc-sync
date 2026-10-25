'use strict';

// Gate presentation validator (relay v2 slice A) — the other half the
// gate-registry header names. It re-derives every replyLine from the index's
// own fields through gateRegistry.gateReplyLine and reports, fail-closed, any
// presentation that a consumer (slice B board consumption, operator ritual)
// could not trust.
//
// Unlike the producer it never throws for a malformed index: it returns a
// report { valid, errors[] } in the validateCampaignApprovalReceipt style so a
// CLI can print the full rejection list. Typed codes are the producer's four
// plus PRESENTATION_UNIT_INCOMPLETE (re-exported from gate-presentation.js —
// one vocabulary, two surfaces).
//
// Checks, in order:
//   shape          — object, schema 1, registered gate, ISO stamp, string fields
//   session        — sessionPath present + sessionKey === sessionKeyOf(sessionPath)
//   digest         — null or sha256:<64-hex>; REQUIRED for every gate except
//                    APPROVE_DOCUMENT (per-unit journal digests instead)
//   replyLines     — exactly the lines gateReplyLine reconstructs from the
//                    index's digest/units; APPROVE_DOCUMENT lines additionally
//                    match the resolve-batch-review grammar
//   units          — reviewUnitId/label/links shape on every gate; DOCUMENT
//                    units must carry a journal digest AND a journal file name
//                    that encodes the same digest (sha256-<hex>.jsonl)

const { GATE_NAMES, gateReplyLine, isGateName } = require('./gate-registry');
const {
  DIGEST_PATTERN,
  DOCUMENT_LINE_PATTERN,
  JOURNAL_NAME_PATTERN,
  PRESENTATION_INPUT_INVALID,
  PRESENTATION_DIGEST_MISSING,
  PRESENTATION_REPLY_LINE_MISMATCH,
  PRESENTATION_SESSION_UNBOUND,
  PRESENTATION_UNIT_INCOMPLETE,
  PRESENTATION_SCHEMA,
  PRESENTATION_SCHEMA_LEGACY,
  sessionKeyOf,
} = require('./gate-presentation');

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function checkPresentationIndex(index) {
  const errors = [];
  const report = (code, message, details = {}) => errors.push({ code, message, ...details });

  if (!isObject(index)) {
    report(PRESENTATION_INPUT_INVALID, 'presentation index must be an object');
    return { valid: false, errors };
  }
  // Backward compatible (呈门 v2): schema-1 indexes on disk stay valid; only
  // unknown schemas are rejected.
  if (index.schema !== PRESENTATION_SCHEMA && !PRESENTATION_SCHEMA_LEGACY.includes(index.schema)) {
    report(PRESENTATION_INPUT_INVALID, `$.schema must be ${PRESENTATION_SCHEMA} (or legacy ${PRESENTATION_SCHEMA_LEGACY.join('/')})`, { path: '$.schema' });
  }
  if (!isGateName(index.gate)) {
    report(PRESENTATION_INPUT_INVALID, `$.gate must be a registered gate (${GATE_NAMES.join(', ')})`, { path: '$.gate' });
  }
  for (const field of ['title', 'notes', 'generatedAt']) {
    if (typeof index[field] !== 'string') {
      report(PRESENTATION_INPUT_INVALID, `$.${field} must be a string`, { path: `$.${field}` });
    }
  }
  if (typeof index.generatedAt === 'string' && Number.isNaN(Date.parse(index.generatedAt))) {
    report(PRESENTATION_INPUT_INVALID, '$.generatedAt must parse as a timestamp', { path: '$.generatedAt' });
  }

  // Session binding — the trust-chain root: an unbound presentation must not
  // be approvable, and the key must be the canonical derivation of the path.
  if (!nonEmptyString(index.sessionPath)) {
    report(PRESENTATION_SESSION_UNBOUND, '$.sessionPath is required — an unbound gate presentation cannot be approved', { path: '$.sessionPath' });
  } else if (sessionKeyOf(index.sessionPath) !== index.sessionKey) {
    report(PRESENTATION_INPUT_INVALID, '$.sessionKey must equal sessionKeyOf($.sessionPath)', { path: '$.sessionKey' });
  }

  // 呈门 v2 additions: source/impact are optional and consumers tolerate their
  // absence, but when present they must carry the honest shapes (a tampered
  // source cannot be allowed to display invented provenance).
  if (index.source !== null && index.source !== undefined) {
    const source = index.source;
    const sourceOk = isObject(source) && (
      (source.origin === 'pr-intake' && Array.isArray(source.prs))
      || (source.origin === 'repo-scan' && 'baselineTag' in source && 'targetTag' in source)
    );
    if (!sourceOk) {
      report(PRESENTATION_INPUT_INVALID, '$.source must be a pr-intake or repo-scan dispatch record', { path: '$.source' });
    }
  }
  if (index.impact !== null && index.impact !== undefined) {
    const impact = index.impact;
    const impactOk = isObject(impact)
      && Number.isInteger(impact.total) && impact.total >= 0
      && Number.isInteger(impact.create) && impact.create >= 0
      && Number.isInteger(impact.update) && impact.update >= 0
      && Array.isArray(impact.documents);
    if (!impactOk) {
      report(PRESENTATION_INPUT_INVALID, '$.impact must be {total, create, update, documents[]}', { path: '$.impact' });
    }
  }

  const gate = typeof index.gate === 'string' && isGateName(index.gate) ? index.gate : null;
  if (gate === null) return { valid: false, errors };

  // Digest shape. The presentation never computes one: whatever is here was
  // carried from the input artifact, so the shape must be exact.
  if (index.digest !== null && index.digest !== undefined) {
    if (typeof index.digest !== 'string' || !DIGEST_PATTERN.test(index.digest)) {
      report(PRESENTATION_INPUT_INVALID, '$.digest must be sha256:<64-hex> or null', { path: '$.digest' });
    }
  }

  const units = Array.isArray(index.units) ? index.units : null;
  if (units === null) {
    report(PRESENTATION_INPUT_INVALID, '$.units must be an array', { path: '$.units' });
  } else {
    for (const [position, unit] of units.entries()) {
      const label = `$.units[${position}]`;
      if (!isObject(unit) || !nonEmptyString(unit.reviewUnitId)) {
        report(PRESENTATION_UNIT_INCOMPLETE, `${label}.reviewUnitId must be a non-empty string`, { path: `${label}.reviewUnitId` });
        continue;
      }
      if (typeof unit.label !== 'string' || unit.label === '') {
        report(PRESENTATION_UNIT_INCOMPLETE, `${label}.label must be a non-empty string`, { path: `${label}.label`, reviewUnitId: unit.reviewUnitId });
      }
      if (!Array.isArray(unit.links) || unit.links.some((link) => typeof link !== 'string')) {
        report(PRESENTATION_UNIT_INCOMPLETE, `${label}.links must be an array of strings`, { path: `${label}.links`, reviewUnitId: unit.reviewUnitId });
      }
      if (gate === 'APPROVE_DOCUMENT') {
        if (typeof unit.journalDigest !== 'string' || !DIGEST_PATTERN.test(unit.journalDigest)) {
          report(PRESENTATION_UNIT_INCOMPLETE, `${label}.journalDigest must be sha256:<64-hex> for a DOCUMENT gate unit`, { path: `${label}.journalDigest`, reviewUnitId: unit.reviewUnitId });
        } else {
          // The journal file name must encode the very digest the reply line
          // binds (sha256-<hex>.jsonl) — a name that disagrees with the digest
          // means the row was hand-assembled, not recorded.
          if (!nonEmptyString(unit.journal) || !JOURNAL_NAME_PATTERN.test(unit.journal)) {
            report(PRESENTATION_UNIT_INCOMPLETE, `${label}.journal must be named sha256-<64-hex>.jsonl`, { path: `${label}.journal`, reviewUnitId: unit.reviewUnitId });
          } else if (`sha256:${JOURNAL_NAME_PATTERN.exec(unit.journal)[1]}` !== unit.journalDigest) {
            report(PRESENTATION_UNIT_INCOMPLETE, `${label}.journal name does not encode $.journalDigest`, { path: `${label}.journal`, reviewUnitId: unit.reviewUnitId });
          }
        }
      }
    }
  }

  // Digest requirement per gate family.
  if (gate !== 'APPROVE_DOCUMENT') {
    if (index.digest === null || index.digest === undefined) {
      report(PRESENTATION_DIGEST_MISSING, `${gate} binds a digest — $.digest must not be null (presentations never compute one)`, { path: '$.digest' });
    }
  } else if (index.digest !== null && index.digest !== undefined) {
    report(PRESENTATION_INPUT_INVALID, 'APPROVE_DOCUMENT binds per-unit journal digests — $.digest must be null', { path: '$.digest' });
  }

  // Reply-line reconstruction: the ONLY lines a consumer may act on are the
  // ones gateReplyLine rebuilds from the index's own digest/units.
  const expectedLines = [];
  if (gate === 'APPROVE_DOCUMENT') {
    if (units !== null && units.every((unit) => isObject(unit) && nonEmptyString(unit.reviewUnitId)
      && typeof unit.journalDigest === 'string' && DIGEST_PATTERN.test(unit.journalDigest))) {
      for (const unit of [...units].sort((a, b) => (a.reviewUnitId < b.reviewUnitId ? -1 : a.reviewUnitId > b.reviewUnitId ? 1 : 0))) {
        expectedLines.push(`APPROVE_DOCUMENT ${unit.reviewUnitId} ${unit.journalDigest}`);
      }
    }
  } else if (typeof index.digest === 'string' && DIGEST_PATTERN.test(index.digest)) {
    expectedLines.push(gateReplyLine(gate, { digest: index.digest }));
  }

  if (!Array.isArray(index.replyLines)) {
    report(PRESENTATION_INPUT_INVALID, '$.replyLines must be an array of strings', { path: '$.replyLines' });
  } else if (expectedLines.length > 0) {
    if (index.replyLines.length !== expectedLines.length
      || index.replyLines.some((line, position) => line !== expectedLines[position])) {
      report(
        PRESENTATION_REPLY_LINE_MISMATCH,
        '$.replyLines must be exactly the lines gateReplyLine reconstructs from $.digest/$.units',
        { path: '$.replyLines', expected: expectedLines, got: index.replyLines },
      );
    }
    for (const line of index.replyLines) {
      if (typeof line !== 'string' || line === '') {
        report(PRESENTATION_REPLY_LINE_MISMATCH, '$.replyLines entries must be non-empty strings', { path: '$.replyLines' });
        continue;
      }
      const viaRegistry = gate === 'APPROVE_DOCUMENT'
        ? gateReplyLine('APPROVE_DOCUMENT', { replyLine: line })
        : gateReplyLine(gate, { digest: line.replace(`${gate} `, '') });
      if (viaRegistry !== line) {
        report(PRESENTATION_REPLY_LINE_MISMATCH, `reply line is not reconstructible through gateRegistry.gateReplyLine: ${line}`, { path: '$.replyLines' });
      }
      if (gate === 'APPROVE_DOCUMENT' && !DOCUMENT_LINE_PATTERN.test(line)) {
        report(PRESENTATION_REPLY_LINE_MISMATCH, `reply line violates the resolve-batch-review grammar: ${line}`, { path: '$.replyLines' });
      }
    }
  }
  if (gate === 'APPROVE_DOCUMENT' && units !== null && units.length === 0) {
    report(PRESENTATION_INPUT_INVALID, 'an APPROVE_DOCUMENT presentation requires at least one unit', { path: '$.units' });
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  checkPresentationIndex,
};
