'use strict';

// Audience (product-ownership) proposal + confirmation (batch 18 W-B). The one
// point in the pipeline that is a genuine JUDGMENT, not a mechanism: whether an
// interface is open-source-only (milvus), cloud-only (zilliz), or shared. The
// repo's own rule is explicit — sdk-python.md:68 "do not infer ownership from a
// parameter name or a marker such as (cloud)" — so this module does NOT guess.
// It does exactly two mechanical things:
//
//   1. propose — turn declared facts into CANDIDATES where a written ruling
//      covers the interface (config/targets-categories.json, the W-F table),
//      and collect everything else into a `mustAsk` list. Ownership with no
//      ruling is never invented; it is surfaced as a question.
//   2. confirm — require an explicit answer for every candidate and every mustAsk
//      entry before emitting final Bitable `targets` values. An unanswered entry
//      fails closed (AUDIENCE_UNCONFIRMED): the A2 seat is the only writer of the
//      truth, and nothing is silently defaulted into a live record.
//
// The confirmation output is the `targets.json` / reference-context vocabulary
// the rest of the pipeline already consumes.

const { loadTargetsCategories } = require('./review-session-store');

const AUDIENCE_CANDIDATES = Object.freeze(['shared', 'milvus', 'zilliz']);
// Audience -> the Bitable Targets field values the record carries.
const TARGETS_BY_AUDIENCE = Object.freeze({
  shared: Object.freeze(['Milvus', 'Zilliz']),
  milvus: Object.freeze(['Milvus']),
  zilliz: Object.freeze(['Zilliz']),
});

const AUDIENCE_PROPOSAL_EMPTY = 'AUDIENCE_PROPOSAL_EMPTY';
const AUDIENCE_PROPOSAL_INVALID = 'AUDIENCE_PROPOSAL_INVALID';
const AUDIENCE_UNCONFIRMED = 'AUDIENCE_UNCONFIRMED';

class AudienceProposalError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AudienceProposalError';
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

// Category rulings arrive as the W-F map (category -> ['Milvus'|'Zilliz']); the
// audience vocabulary is lowercase, so both are normalized once here.
function rulingsMap(categoryTargets) {
  if (categoryTargets instanceof Map) return categoryTargets;
  if (isObject(categoryTargets)) return new Map(Object.entries(categoryTargets));
  return loadTargetsCategories().categories;
}

function audienceFromPlatforms(platforms) {
  const normalized = [...new Set((platforms || []).map((value) => String(value).toLowerCase()))];
  const hasMilvus = normalized.includes('milvus');
  const hasZilliz = normalized.includes('zilliz');
  if (hasMilvus && hasZilliz) return 'shared';
  if (hasMilvus) return 'milvus';
  if (hasZilliz) return 'zilliz';
  throw new AudienceProposalError(AUDIENCE_PROPOSAL_INVALID, `a ruling carried no recognised platform: ${JSON.stringify(platforms)}`);
}

// Derive candidates from written rulings only. No ruling -> mustAsk, never a
// guess. Every candidate carries the evidence that produced it so the A2 seat
// confirms a fact, not a black box.
function proposeAudience({ entries, categoryTargets } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new AudienceProposalError(AUDIENCE_PROPOSAL_EMPTY, 'no entries to propose audience for');
  }
  const rulings = rulingsMap(categoryTargets);
  const proposals = [];
  const mustAsk = [];
  for (const entry of entries) {
    if (!isObject(entry) || !nonEmptyString(entry.symbol)) {
      throw new AudienceProposalError(AUDIENCE_PROPOSAL_INVALID, `each entry requires a non-empty symbol (got ${JSON.stringify(entry)})`);
    }
    const base = { symbol: entry.symbol, page: entry.page ?? null, kind: entry.kind ?? null, category: entry.category ?? null };
    const ruling = nonEmptyString(entry.category) ? rulings.get(entry.category) : null;
    if (Array.isArray(ruling) && ruling.length > 0) {
      const candidate = audienceFromPlatforms(ruling);
      proposals.push({
        ...base,
        candidate,
        derivedFrom: `ruling:${entry.category}`,
        evidence: { ruling: [...ruling], signals: Array.isArray(entry.signals) ? entry.signals : [] },
      });
    } else {
      mustAsk.push({
        ...base,
        reason: nonEmptyString(entry.category) ? 'NO_RULING_FOR_CATEGORY' : 'NO_CATEGORY',
        signals: Array.isArray(entry.signals) ? entry.signals : [],
      });
    }
  }
  return Object.freeze({
    proposals: Object.freeze(proposals),
    mustAsk: Object.freeze(mustAsk),
    summary: `derived ${proposals.length} candidate(s) from rulings; ${mustAsk.length} need an explicit answer (the KB default is not applied silently)`,
  });
}

// Turn candidates + answers into the final entries the writer consumes. Every
// proposal AND every mustAsk entry must carry an explicit answer — nothing is
// defaulted into a live record.
function confirmAudience({ proposed, confirmations, decidedAt = null } = {}) {
  if (!isObject(proposed) || !Array.isArray(proposed.proposals) || !Array.isArray(proposed.mustAsk)) {
    throw new AudienceProposalError(AUDIENCE_PROPOSAL_INVALID, 'confirmAudience requires a proposeAudience result');
  }
  if (!Array.isArray(confirmations)) {
    throw new AudienceProposalError(AUDIENCE_UNCONFIRMED, 'explicit confirmations are required for every proposed and mustAsk entry');
  }
  const candidates = new Map();
  for (const entry of [...proposed.proposals, ...proposed.mustAsk]) candidates.set(entry.symbol, entry);

  const answers = new Map();
  for (const confirmation of confirmations) {
    if (!isObject(confirmation) || !nonEmptyString(confirmation.symbol)) {
      throw new AudienceProposalError(AUDIENCE_PROPOSAL_INVALID, `each confirmation requires a non-empty symbol (got ${JSON.stringify(confirmation)})`);
    }
    if (!candidates.has(confirmation.symbol)) {
      throw new AudienceProposalError(AUDIENCE_PROPOSAL_INVALID, `confirmation names an unknown symbol: ${confirmation.symbol}`);
    }
    if (!AUDIENCE_CANDIDATES.includes(confirmation.audience)) {
      throw new AudienceProposalError(AUDIENCE_PROPOSAL_INVALID, `confirmation audience must be one of ${AUDIENCE_CANDIDATES.join(', ')} (got ${JSON.stringify(confirmation.audience)})`);
    }
    answers.set(confirmation.symbol, confirmation);
  }

  const missing = [...candidates.keys()].filter((symbol) => !answers.has(symbol));
  if (missing.length > 0) {
    throw new AudienceProposalError(
      AUDIENCE_UNCONFIRMED,
      `${missing.length} entr(ies) have no explicit audience confirmation: ${missing.join(', ')}`,
      { missing },
    );
  }

  const entries = [...candidates.values()].map((candidate) => {
    const answer = answers.get(candidate.symbol);
    return {
      symbol: candidate.symbol,
      page: candidate.page,
      kind: candidate.kind,
      category: candidate.category,
      audience: answer.audience,
      targets: [...TARGETS_BY_AUDIENCE[answer.audience]],
      evidence: candidate.evidence ?? { signals: candidate.signals ?? [] },
      ...(nonEmptyString(answer.note) ? { note: answer.note } : {}),
      decidedAt: answer.decidedAt ?? decidedAt ?? null,
    };
  });
  return Object.freeze({ entries: Object.freeze(entries) });
}

module.exports = {
  AUDIENCE_CANDIDATES,
  AUDIENCE_PROPOSAL_EMPTY,
  AUDIENCE_PROPOSAL_INVALID,
  AUDIENCE_UNCONFIRMED,
  AudienceProposalError,
  TARGETS_BY_AUDIENCE,
  confirmAudience,
  proposeAudience,
};
