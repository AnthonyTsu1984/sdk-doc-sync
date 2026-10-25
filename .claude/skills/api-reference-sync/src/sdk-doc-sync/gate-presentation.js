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
//                              (rollbackManifestDigest / campaignPlanDigest)
//   2. Every replyLine in the index must be reconstructible through
//      gateRegistry.gateReplyLine — the builder derives them (never accepts a
//      free-form override) and self-checks; drift is a typed rejection.
//   3. A presentation MUST be bound to a session (sessionPath). An unbound
//      gate presentation cannot be approved — this is the root of the slice-B
//      trust chain (card matching = gate kind + session).
//
// 2026-10-24 ruling: the only digest-bound operator gates are
// APPROVE_CAMPAIGN (the dry-run path below presents exactly this gate) and
// APPROVE_ROLLBACK. The retired per-unit document/acceptance stops no longer
// build cards — a verified unit finalizes automatically with a
// journal-derived receipt.

const path = require('node:path');

const { GATE_NAMES, gateReplyLine, isGateName } = require('./gate-registry');
const { sortApprovalUnits } = require('./campaign-approval');

// Schema 2 (呈门卡片 v2, 2026-10-24): adds optional `source` (dispatch-origin
// passthrough: pr-intake PR list / repo-scan tag range) and `impact` (derived
// document action split) to the schema-1 shape. Backward compatible: both
// fields are nullable and every consumer must tolerate their absence — legacy
// schema-1 indexes on disk remain valid input to checkPresentationIndex.
const PRESENTATION_SCHEMA = 2;
const PRESENTATION_SCHEMA_LEGACY = [1];
const PRESENTATION_INPUT_INVALID = 'PRESENTATION_INPUT_INVALID';
const PRESENTATION_DIGEST_MISSING = 'PRESENTATION_DIGEST_MISSING';
const PRESENTATION_REPLY_LINE_MISMATCH = 'PRESENTATION_REPLY_LINE_MISMATCH';
const PRESENTATION_SESSION_UNBOUND = 'PRESENTATION_SESSION_UNBOUND';
const PRESENTATION_UNIT_INCOMPLETE = 'PRESENTATION_UNIT_INCOMPLETE';

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

// Native receipt field per digest-bound gate — verified against the producers:
//   rollback-planner.js      → rollbackManifestDigest
//   campaign-approval.js     → campaignPlanDigest
// APPROVE_CAMPAIGN presented from a dry-run receipt binds the execution
// batch digest directly (no manifest carrier needed).
const DIGEST_FIELD_BY_GATE = Object.freeze({
  APPROVE_ROLLBACK: 'rollbackManifestDigest',
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

// ---------- source passthrough (呈门三件套之一：来源面) ----------
//
// source.json 是 supervisor 派单时的账本快照，这里只透传、只验形，绝不加工：
//   pr-intake  → { origin:'pr-intake', prs:[{number,url,title}] }
//   repo-scan  → { origin:'repo-scan', baselineTag, targetTag }（占位形态，
//                字段允许 null —— daily-scan 尚无仓库扫描来源，接入时在此分叉）

function validSource(value) {
  if (!isObject(value)) return false;
  if (value.origin === 'pr-intake') {
    return Array.isArray(value.prs) && value.prs.every((pr) => isObject(pr)
      && Number.isInteger(pr.number) && pr.number >= 0
      && nonEmptyString(pr.url)
      && (pr.title === null || typeof pr.title === 'string'));
  }
  if (value.origin === 'repo-scan') {
    return (value.baselineTag === null || nonEmptyString(value.baselineTag))
      && (value.targetTag === null || nonEmptyString(value.targetTag));
  }
  return false;
}

// ---------- impact derivation (呈门三件套之一：动作面) ----------
//
// 求证结论（2026-10-24，读盘实证，字段名是真实产出字段）：
//   dry-run 全量回执 (bin/sdk-doc-sync.js --json):
//     writeApprovalPresentation[] = { stableId, action, title, documentLink,
//     recordLink }，action = plan.action；plans[] = { action, stableId,
//     metadata.reason }。资源计划的 stableId 带 resource: 前缀。
//   bounded summary (createBoundedSummary):
//     diff[] = { type, slug, stableId, symbol, reason }，type ∈
//     {CREATE, DEPRECATE, UPDATE, SKIP, ORPHAN}。
//   分组提案（candidate-spec 阶段，grouping-proposal.js schema 钉死）:
//     units[] = { id, sourceStableId, actionIntent, decision, risks }，
//     actionIntent ∈ {CREATE, UPDATE, DEPRECATE, BACKFILL, REBUILD, NO_ACTION}。
//   gate manifest: units 只有 reviewUnitId/label/journalDigest —— 没有动作
//     分类，impact 如实降级为 null（绝不编数）。
//
// 动作映射是**显示语义**，绝不参与 digest 绑定：CREATE 桶收 CREATE/BACKFILL
// （BACKFILL 是补文档空缺的 create，sync-planner 注释实证），UPDATE 桶收
// UPDATE/COPY_PATCH/REBUILD/DEPRECATE。映射不到的两类动作进 other 桶。

const RESOURCE_STABLE_ID_PREFIX = 'resource:';

const IMPACT_ACTION_BY_PLAN = Object.freeze({
  CREATE: 'CREATE',
  BACKFILL: 'CREATE',
  UPDATE: 'UPDATE',
  COPY_PATCH: 'UPDATE',
  REBUILD: 'UPDATE',
  DEPRECATE: 'UPDATE',
});

const IMPACT_ACTION_BY_DIFF_TYPE = Object.freeze({
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DEPRECATE: 'UPDATE',
});

const IMPACT_ACTION_BY_INTENT = Object.freeze({
  CREATE: 'CREATE',
  BACKFILL: 'CREATE',
  UPDATE: 'UPDATE',
  REBUILD: 'UPDATE',
  DEPRECATE: 'UPDATE',
});

function isDocumentStableId(stableId) {
  return nonEmptyString(stableId) && !stableId.startsWith(RESOURCE_STABLE_ID_PREFIX);
}

function impactFromRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const documents = rows
    .filter((row) => nonEmptyString(row.unitId))
    .map((row) => ({ title: nonEmptyString(row.title) ? row.title : row.unitId, action: row.action ?? null, unitId: row.unitId }));
  if (documents.length === 0) return null;
  // 至少一行有分类才成 impact；全部待分类 = 工件没有分类数据，如实降级 null。
  if (documents.every((row) => row.action === null)) return null;
  return {
    total: documents.length,
    create: documents.filter((row) => row.action === 'CREATE').length,
    update: documents.filter((row) => row.action === 'UPDATE').length,
    other: documents.filter((row) => row.action === null).length,
    documents,
  };
}

function impactFromDryRun(dryRun) {
  const presentation = Array.isArray(dryRun?.writeApprovalPresentation)
    ? dryRun.writeApprovalPresentation.filter((entry) => isObject(entry) && isDocumentStableId(entry?.stableId))
    : [];
  if (presentation.length > 0) {
    return impactFromRows(presentation.map((entry) => ({
      title: entry.title,
      action: IMPACT_ACTION_BY_PLAN[entry.action] ?? null,
      unitId: entry.stableId,
    })));
  }
  const plans = Array.isArray(dryRun?.plans) ? dryRun.plans : [];
  const documentPlans = plans.filter((plan) => isObject(plan)
    && plan.action !== 'NOOP' && isDocumentStableId(plan?.stableId));
  if (documentPlans.length > 0) {
    return impactFromRows(documentPlans.map((plan) => ({
      title: plan.stableId,
      action: IMPACT_ACTION_BY_PLAN[plan.action] ?? null,
      unitId: plan.stableId,
    })));
  }
  // bounded summary 末档：diff[] 的 type 分类（SKIP/ORPHAN 不进文档清单）。
  const diff = Array.isArray(dryRun?.diff) ? dryRun.diff : [];
  return impactFromRows(diff
    .filter((row) => isObject(row) && IMPACT_ACTION_BY_DIFF_TYPE[row?.type] !== undefined)
    .map((row) => ({
      title: nonEmptyString(row.symbol) ? row.symbol : (nonEmptyString(row.slug) ? row.slug : null),
      action: IMPACT_ACTION_BY_DIFF_TYPE[row.type],
      unitId: nonEmptyString(row.stableId) ? row.stableId : row.slug,
    })));
}

function impactFromManifest(manifest) {
  const rawUnits = Array.isArray(manifest?.units) ? manifest.units : [];
  return impactFromRows(rawUnits.map((unit) => {
    if (!isObject(unit)) return { unitId: null };
    const unitId = nonEmptyString(unit.reviewUnitId)
      ? unit.reviewUnitId
      : (nonEmptyString(unit.id) ? unit.id : unit.sourceStableId);
    const intent = unit.actionIntent;
    return {
      title: nonEmptyString(unit.label) ? unit.label : (nonEmptyString(unit.title) ? unit.title : null),
      action: intent !== undefined && intent !== null ? (IMPACT_ACTION_BY_INTENT[intent] ?? null) : null,
      unitId,
    };
  }));
}

function deriveImpact({ fromDryrun, manifest }) {
  if (fromDryrun !== undefined && fromDryrun !== null) return impactFromDryRun(fromDryrun);
  if (manifest !== undefined && manifest !== null) return impactFromManifest(manifest);
  return null;
}

// ---------- input shaping ----------

function extractDryRunDigest(dryRun) {
  // Full engine result first (bin/sdk-doc-sync.js --json), bounded summary
  // second (createBoundedSummary). No fallback to proposedReleaseBatchDigest:
  // the campaign gate binds the EXECUTION batch, and a release batch is
  // a different signing surface.
  const full = dryRun?.proposedExecutionBatch?.batchDigest;
  const bounded = dryRun?.proposedBatchDigest;
  if (full !== undefined && full !== null) return { digest: full, field: 'proposedExecutionBatch.batchDigest' };
  if (bounded !== undefined && bounded !== null) return { digest: bounded, field: 'proposedBatchDigest' };
  return { digest: null, field: null };
}

// Batch-scoped unit rows for the campaign card. Prefer the dry-run's own
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
  // Digest-bound gates may present on the digest alone (campaign plan,
  // rollback manifest); the unit rows are presentation context only.
  if (rawUnits === undefined || rawUnits === null) {
    return [];
  }
  if (!Array.isArray(rawUnits)) {
    throw new PresentationError(PRESENTATION_INPUT_INVALID, 'gate manifest requires a units array', { field: 'units' });
  }
  const units = rawUnits.map((unit) => {
    // 呈门 v2：--manifest 也直接吃分组提案/candidate-spec 形态的单元
    // （grouping-proposal.js：{id, sourceStableId, actionIntent,…}）——id 即
    // 呈现层的 reviewUnitId。
    const reviewUnitId = nonEmptyString(unit?.reviewUnitId)
      ? unit.reviewUnitId
      : (nonEmptyString(unit?.id) ? unit.id : unit?.reviewUnitId);
    if (!isObject(unit) || !nonEmptyString(reviewUnitId)) {
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
    return {
      reviewUnitId,
      label: nonEmptyString(unit.label)
        ? unit.label
        : (nonEmptyString(unit.documentStableId) ? unit.documentStableId : reviewUnitId),
      journal,
      journalDigest,
      unitBatchDigest: nonEmptyString(unit.batchDigest) ? unit.batchDigest : null,
      links,
    };
  });
  return units;
}

// ---------- reply-line derivation (through the registry, always) ----------

function deriveReplyLines({ gate, digest }) {
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
//   fromDryrun — parsed dry-run receipt (engine --json result or bounded summary); gate = APPROVE_CAMPAIGN
//   manifest   — parsed gate manifest { gate, units[], digest? }; any registered gate
//   sessionPath     (required) repo-relative POSIX path of the sync session
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
    gate = 'APPROVE_CAMPAIGN';
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
    if (Array.isArray(manifest.replyLines)) providedReplyLines = manifest.replyLines;
  }

  // source 三件套透传（呈门 v2）：给了就必须合法 —— 一个坏 source 会让卡片
  // 显示编造的来源，宁可 typed 拒绝。未给 = null（消费端容错缺字段）。
  let source = null;
  if (input.source !== undefined && input.source !== null) {
    if (!validSource(input.source)) {
      throw new PresentationError(
        PRESENTATION_INPUT_INVALID,
        'source must be {origin:"pr-intake",prs:[{number,url,title}]} or {origin:"repo-scan",baselineTag,targetTag} (tags nullable)',
        { field: 'source' },
      );
    }
    source = input.source;
  }
  // impact 动作面（呈门 v2）：从输入工件推导；工件没有分类数据时如实为
  // null（卡片显示"待 dry-run 细化"），绝不编数。
  const impact = deriveImpact({ fromDryrun: hasDryrun ? input.fromDryrun : null, manifest: hasManifest ? input.manifest : null });

  const sortedUnits = sortApprovalUnits(units);
  const replyLines = deriveReplyLines({ gate, digest });

  // Supplied reply lines are verified, never trusted: drift is a typed reject.
  if (providedReplyLines !== null) {
    if (!Array.isArray(providedReplyLines)
      || providedReplyLines.length !== replyLines.length
      || providedReplyLines.some((line, index) => line !== replyLines[index])) {
      throw new PresentationError(
        PRESENTATION_REPLY_LINE_MISMATCH,
        'manifest replyLines disagree with the lines derived from the bound digest through gateRegistry.gateReplyLine',
        { provided: providedReplyLines, derived: replyLines },
      );
    }
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
    source,
    impact,
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

// 来源面 headline（board 卡片与飞书卡片共用同一口径）：pr-intake 列 PR 号，
// repo-scan 列 tag 迁移；字段缺位如实显示，绝不编造。
function sourceHeadline(source) {
  if (!validSource(source)) return null;
  if (source.origin === 'repo-scan') {
    return source.baselineTag && source.targetTag
      ? `来源 仓库扫描：${source.baselineTag} → ${source.targetTag}`
      : '来源 仓库扫描：版本信息未登记';
  }
  const total = source.prs.length;
  if (total === 0) return '来源 PR intake：无待办 PR';
  const head = source.prs.slice(0, 5).map((pr) => `#${pr.number}`).join(' ');
  return total > 5 ? `来源 PR intake：${head} 等 ${total} 条` : `来源 PR intake：${head}`;
}

function impactHeadline(impact) {
  if (!impact) return null;
  const parts = [`文档 ${impact.total} 篇`, `CREATE ${impact.create}`, `UPDATE ${impact.update}`];
  if (impact.other > 0) parts.push(`其他 ${impact.other}`);
  return parts.join(' · ');
}

function renderSourceHtml(source) {
  const headline = sourceHeadline(source);
  if (headline === null) return '';
  if (source?.origin === 'pr-intake' && Array.isArray(source.prs) && source.prs.length > 0) {
    const links = source.prs.slice(0, 5)
      .map((pr) => `<a href="${esc(pr.url)}">#${pr.number}</a>`)
      .join(' ');
    const suffix = source.prs.length > 5 ? ` 等 ${source.prs.length} 条` : '';
    return `<div>${esc('来源 PR intake：')} ${links}${esc(suffix)}</div>`;
  }
  return `<div>${esc(headline)}</div>`;
}

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
    : '<div>bound digest: <span style="color:#9aa4b2">（缺失）</span></div>';

  const summaryItems = [];
  for (const unit of index.units) {
    const ordinal = index.units.indexOf(unit) + 1;
    for (const link of unit.links) {
      summaryItems.push(`<li><a href="${esc(link)}">${ordinal}. ${esc(unit.reviewUnitId)} — ${esc(unit.label)}</a></li>`);
    }
  }

  const notesLine = index.notes ? `<div style="margin-top:4px">${esc(index.notes)}</div>` : '';

  // 呈门 v2 三件套（来源面 + 动作面）：工件没有对应数据时如实降级，绝不编数。
  const sourceLine = renderSourceHtml(index.source);
  const impactLine = index.impact
    ? `<div>动作面: ${esc(impactHeadline(index.impact))}</div>`
    : '<div>动作面: 待 dry-run 细化</div>';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(index.title)}</title></head>
<body style="font-family:-apple-system,sans-serif;background:#16181d;color:#e8eaed;max-width:960px;margin:32px auto;padding:0 24px">
<h1>${esc(index.title)}</h1>
<p style="color:#9aa4b2;font-size:13px;line-height:1.7">
<div>session: <code>${esc(index.sessionPath)}</code></div>
<div>generated: ${esc(index.generatedAt)}</div>
${sourceLine}${impactLine}
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
  PRESENTATION_SCHEMA_LEGACY,
  PRESENTATION_INPUT_INVALID,
  PRESENTATION_DIGEST_MISSING,
  PRESENTATION_REPLY_LINE_MISMATCH,
  PRESENTATION_SESSION_UNBOUND,
  PRESENTATION_UNIT_INCOMPLETE,
  DIGEST_PATTERN,
  DIGEST_FIELD_BY_GATE,
  GATE_NAMES,
  PresentationError,
  sessionKeyOf,
  sourceHeadline,
  impactHeadline,
  deriveImpact,
  buildPresentationIndex,
  renderCardHtml,
};
