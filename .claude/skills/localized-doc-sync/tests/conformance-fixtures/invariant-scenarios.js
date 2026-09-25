'use strict';

// Executable conformance scenarios for the localization.* invariants. Every
// scenario invokes production code (planner, scan manifest, CLI, translation
// content, review evidence, translation state) and returns a typed decision
// that the shared doc-ops-core conformance runner compares against the
// fixture's assertions.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createActionBatch } = require('../../../doc-ops-core/src/action-batch');
const { createApprovalEnvelope } = require('../../../doc-ops-core/src/approval-guard');
const { digestSemantic } = require('../../../doc-ops-core/src/digest');
const { executeReviewUnit } = require('../../src/executor');
const { buildReviewUnits } = require('../../src/planner');
const { baseInventoryDigest, buildScanManifest, reEnumerateForFreshness } = require('../../src/issue-classifier');
const { applyTranslationResponse, prepareTranslationContent } = require('../../src/translation-content');
const { parseAndAuthorizeReview } = require('../../src/review-evidence');
const { TranslationReceiptStore, assertTranslationRecoveryCompatible } = require('../../src/translation-state');

function planningError(fn) {
  try {
    fn();
    return { code: null };
  } catch (error) {
    return { code: error.code || null };
  }
}

// A complete dual-Base snapshot: every table MATERIALIZES its inventory and
// the digests recompute from the actual arrays (opaque strings are refused).
function completeBase(baseToken, tableId, seed) {
  const fields = [{ id: `${tableId}-field`, name: 'Slug' }];
  const views = [{ id: `${tableId}-view`, name: 'grid' }];
  const records = [{ record_id: `${tableId}-rec-1`, fields: { Slug: `${tableId}-slug` } }];
  const table = {
    tableId,
    name: `${tableId}-name`,
    primaryFieldId: null,
    fields,
    views,
    records,
    recordCount: records.length,
    tableDigest: digestSemantic({ tableId, name: `${tableId}-name`, primaryFieldId: null, fields, views, records }),
    fieldSchemaDigest: digestSemantic(fields),
    viewScopeDigest: digestSemantic(views),
    recordSetDigest: digestSemantic(records),
  };
  return { baseToken, revision: 9, title: null, timezone: null, tables: [table] };
}

// Paginated live client over the given bases, mirroring scanBase's contract.
function clientFor(...bases) {
  const byToken = new Map(bases.map((base) => [base.baseToken, base]));
  const page = (items) => ({ items, hasMore: false });
  return {
    async getBase({ baseToken }) {
      const base = byToken.get(baseToken);
      if (!base) throw new Error(`unknown base ${baseToken}`);
      return { title: base.title || null, revision: base.revision ?? null, timezone: base.timezone || null };
    },
    async listTables({ baseToken }) {
      return page(byToken.get(baseToken).tables.map(({ tableId, name, primaryFieldId }) => ({ tableId, name, primaryFieldId })));
    },
    async listFields({ baseToken, tableId }) {
      return page(byToken.get(baseToken).tables.find((table) => table.tableId === tableId)?.fields || []);
    },
    async listViews({ baseToken, tableId }) {
      return page(byToken.get(baseToken).tables.find((table) => table.tableId === tableId)?.views || []);
    },
    async listRecords({ baseToken, tableId }) {
      return page(byToken.get(baseToken).tables.find((table) => table.tableId === tableId)?.records || []);
    },
  };
}

function manifestFixture() {
  return buildScanManifest({
    sourceBase: completeBase('en', 'en-dev', 'aa'),
    targetBase: completeBase('zh', 'zh-dev', 'bb'),
    tableMappings: [],
    placementIdentities: [],
    translationPairs: [],
    translationReceiptDigests: [],
    hierarchyPolicies: [],
    localePolicyDigest: `sha256:${'c'.repeat(64)}`,
    issues: [],
  });
}

async function planRefusal(manifest, { client = null } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localization-conformance-'));
  const manifestPath = path.join(directory, 'manifest.json');
  const outputPath = path.join(directory, 'units.json');
  writeJson(manifestPath, manifest);
  const { runCli } = require('../../bin/localized-doc-sync');
  const argv = ['node', 'localized-doc-sync.js', 'plan', '--scan-manifest', manifestPath, '--output', outputPath];
  let code = null;
  try {
    await runCli({ argv, dependencies: { onStdout() {}, client } });
  } catch (error) {
    code = error.code || null;
  }
  return { code };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function tmpJournalPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localization-conformance-')), 'journal.jsonl');
}

const scenarios = {
  // --- localization.source-read-only ---

  localizationSourceActionsRefused() {
    return planningError(() => buildReviewUnits({
      scanManifestDigest: manifestFixture().semanticDigest,
      issues: [{
        issueId: 'issue:src-1', code: 'UPDATE_CONTENT', locale: 'en', placement: 'canonical',
        actions: [{ actionId: 'a:source-write', sideEffects: ['record:update'] }],
      }],
    }));
  },

  // --- localization.complete-dual-base-enumeration ---

  async localizationIncompleteScanRefused() {
    // Hand-built snapshots with forged digest strings are NOT complete: the
    // digests must recompute from the materialized arrays.
    const forgedBase = {
      baseToken: 'en', revision: 9,
      tables: [{ tableId: 'en-dev', fieldSchemaDigest: 'forged', viewScopeDigest: 'forged', recordSetDigest: 'forged' }],
    };
    const partialManifest = buildScanManifest({
      sourceBase: forgedBase,
      targetBase: completeBase('zh', 'zh-dev', 'bb'),
      tableMappings: [], placementIdentities: [], translationPairs: [],
      translationReceiptDigests: [], hierarchyPolicies: [],
      localePolicyDigest: `sha256:${'c'.repeat(64)}`,
      issues: [],
    });
    const { code } = await planRefusal(partialManifest, { client: clientFor(forgedBase, completeBase('zh', 'zh-dev', 'bb')) });
    return { code, completeInventory: partialManifest.completeInventory };
  },

  async localizationStaleManifestRefused() {
    // Injecting an issue (with an executable action) after the scan breaks
    // the manifest's semantic digest: the tampered queue is refused.
    const manifest = manifestFixture();
    const tampered = {
      ...manifest,
      issues: [{ issueId: 'issue:injected', code: 'NEW', locale: 'zh', placement: 'canonical', actions: [{ actionId: 'a:injected', sideEffects: ['record:update'] }] }],
    };
    const tamperedResult = await planRefusal(tampered, { client: clientFor(manifest.sourceBase, manifest.targetBase) });

    // A base that gained a table after the scan is stale: the live
    // re-enumeration no longer matches the manifest's snapshots.
    const grown = JSON.parse(JSON.stringify(manifest.sourceBase));
    grown.tables.push(completeBase('en', 'en-extra', 'cc').tables[0]);
    const stale = await planRefusal(manifest, { client: clientFor(grown, manifest.targetBase) });
    return { tamperedCode: tamperedResult.code, staleCode: stale.code };
  },

  async localizationFreshnessRescanRequired() {
    // No client, no queue decision: a self-generated artifact cannot
    // substitute for live re-enumeration.
    const result = await planRefusal(manifestFixture(), {});
    return { code: result.code };
  },

  // --- localization.target-only-preserve ---

  localizationTargetOnlyDeletionRefused() {
    const units = [];
    const refusal = planningError(() => {
      units.push(...buildReviewUnits({
        scanManifestDigest: manifestFixture().semanticDigest,
        issues: [{
          issueId: 'issue:orphan-1', code: 'TARGET_ONLY', locale: 'zh', placement: 'canonical',
          actions: [{ actionId: 'a:delete-orphan', sideEffects: ['record:delete'] }],
        }],
      }));
    });
    return { code: refusal.code, unitsFormed: units.length };
  },

  // --- localization.protected-marker-preservation ---

  localizationMarkerReorderedRefused() {
    const prepared = prepareTranslationContent('Use `alpha()` before `beta()`.', { idPrefix: 'conformance' });
    const translations = prepared.units.map((unit) => {
      const markers = [...unit.text.matchAll(/⟦LDS:[a-z-]+:\d{4}:[a-f0-9]{8}⟧/g)].map((match) => match[0]);
      // Same multiset, swapped order: this silently exchanges the two API
      // names between their slots.
      const swapped = markers.length === 2 ? [...markers].reverse().join(' 与 ') : unit.text;
      return { id: unit.id, text: swapped };
    });
    let code = null;
    try {
      applyTranslationResponse(prepared, { translations });
    } catch (error) {
      code = error.code || null;
    }
    return { code };
  },

  localizationMarkerLostRefused() {
    const prepared = prepareTranslationContent('Run `npm test` now.', { idPrefix: 'conformance' });
    const unit = prepared.units[0];
    let code = null;
    try {
      applyTranslationResponse(prepared, {
        translations: [{ id: unit.id, text: '现在 运行 npm test。' }],
      });
    } catch (error) {
      code = error.code || null;
    }
    return { code };
  },

  localizationMarkerRoundtripPositive() {
    const source = 'Run `npm test` now, see https://example.test/docs.';
    const prepared = prepareTranslationContent(source, { idPrefix: 'conformance' });
    const translations = prepared.units.map((unit) => ({
      id: unit.id,
      text: unit.text.replace(/run/i, '运行').replace(/now/i, '现在').replace(/see/i, '见'),
    }));
    const output = applyTranslationResponse(prepared, { translations });
    return {
      inlineCodePreserved: output.includes('`npm test`'),
      urlPreserved: output.includes('https://example.test/docs'),
      noMarkerLeft: !/⟦LDS:/.test(output),
    };
  },

  // --- localization.review-evidence-contiguity ---

  localizationReviewEvidenceTypedRefusals() {
    const sourceUnits = [{ id: 'u1', text: 'The default is ten items.' }];
    const draftUnits = [{ id: 'u1', text: '默认是十个项目。' }];
    const localeContract = { forbiddenTranslations: [{ source: 'default', targets: ['缺省'] }] };
    const review = JSON.stringify({
      pass: false,
      issues: [
        { location: 'u9', severity: 'medium', type: 'terminology', source_quote: 'default', draft_quote: '默认', comment: 'ghost unit' },
        { location: 'u1', severity: 'low', type: 'consistency', source_quote: 'not in source', draft_quote: '默认', comment: 'non-contiguous' },
        { location: 'u1', severity: 'low', type: 'terminology', source_quote: 'default', draft_quote: '缺省', comment: 'forbidden term used' },
      ],
    });
    const result = parseAndAuthorizeReview(review, { sourceUnits, draftUnits, localeContract });
    return {
      codes: result.unsupportedIssues.map((entry) => entry.code),
      correctionAuthorized: result.correctionAuthorized,
    };
  },

  localizationReviewEvidenceAuthorizedPositive() {
    const sourceUnits = [{ id: 'u1', text: 'The default is ten items.' }];
    const draftUnits = [{ id: 'u1', text: '默认是十个项目。' }];
    const review = JSON.stringify({
      pass: false,
      issues: [{
        location: 'u1', severity: 'medium', type: 'accuracy_mistranslation',
        source_quote: 'ten items', draft_quote: '十个项目', comment: 'mistranslated count basis',
      }],
    });
    const result = parseAndAuthorizeReview(review, { sourceUnits, draftUnits, localeContract: {} });
    return {
      correctionAuthorized: result.correctionAuthorized,
      authorizedUnitIds: result.authorizedUnitIds,
      authorizedIssues: result.authorizedIssues.length,
    };
  },

  // --- localization.target-local-prose ---

  localizationTargetLocalMergeDecisionRequired() {
    const refusal = planningError(() => buildReviewUnits({
      scanManifestDigest: manifestFixture().semanticDigest,
      issues: [{
        issueId: 'issue:local-1', code: 'TARGET_LOCAL_EDIT', locale: 'zh', placement: 'canonical',
        actions: [{ actionId: 'a:overwrite', sideEffects: ['feishu.doc.patch'] }],
      }],
    }));
    return { code: refusal.code };
  },

  localizationTargetLocalDecisionPositive() {
    const units = buildReviewUnits({
      scanManifestDigest: manifestFixture().semanticDigest,
      issues: [{
        issueId: 'issue:local-2', code: 'TRANSLATION_DIVERGED', locale: 'zh', placement: 'canonical',
        mergeDecision: 'reviewed: keep target-local note and merge upstream change',
        actions: [{ actionId: 'a:merge', sideEffects: ['feishu.doc.patch'] }],
      }],
    });
    return {
      unitsFormed: units.length,
      requiresDocumentAcceptance: units[0]?.requiresDocumentAcceptance === true,
      actionCarried: units[0]?.actions?.[0]?.actionId === 'a:merge',
    };
  },

  // --- localization.source-read-only (executor boundary) ---

  async localizationSourceBatchExecRefused() {
    // The reviewer's exact bypass: a source-locale unit paired with a
    // separately approved batch against a source record. The batch matches
    // the unit exactly, so the refusal is the source-locale guard itself.
    const actions = [{ actionId: 'record:update:en', target: 'record:english-source', dependsOn: [], sideEffects: ['record:update'] }];
    const unit = { reviewUnitId: 'unit:en-1', locale: 'en', requiresDocumentAcceptance: false, actions };
    const batch = createActionBatch({ skill: 'localized-doc-sync', operation: 'sync', actions });
    const approval = createApprovalEnvelope({
      skill: batch.skill, operation: batch.operation, batchDigest: batch.batchDigest,
      actionCount: batch.actions.length, targets: batch.targets, sideEffects: batch.sideEffects, decision: 'approved',
    });
    let adapterCalls = 0;
    let code = null;
    try {
      await executeReviewUnit({
        unit, batch, approval,
        journalPath: tmpJournalPath(),
        adapter: {
          async execute() { adapterCalls += 1; return {}; },
          async verify() { return { verified: true }; },
        },
      });
    } catch (error) {
      code = error.code || null;
    }
    return { code, adapterCalls };
  },

  async localizationBatchUnitMismatchRefused() {
    // A matching-unit batch is required: an approved batch for DIFFERENT
    // actions cannot ride on this unit.
    const unitActions = [{ actionId: 'record:update:a', target: 'record:a', dependsOn: [], sideEffects: ['record:update'] }];
    const unit = { reviewUnitId: 'unit:zh-1', locale: 'zh', requiresDocumentAcceptance: true, actions: unitActions };
    const otherActions = [{ actionId: 'record:update:b', target: 'record:b', dependsOn: [], sideEffects: ['record:update'] }];
    const batch = createActionBatch({ skill: 'localized-doc-sync', operation: 'sync', actions: otherActions });
    const approval = createApprovalEnvelope({
      skill: batch.skill, operation: batch.operation, batchDigest: batch.batchDigest,
      actionCount: batch.actions.length, targets: batch.targets, sideEffects: batch.sideEffects, decision: 'approved',
    });
    let adapterCalls = 0;
    let code = null;
    try {
      await executeReviewUnit({
        unit, batch, approval,
        journalPath: tmpJournalPath(),
        adapter: {
          async execute() { adapterCalls += 1; return {}; },
          async verify() { return { verified: true }; },
        },
      });
    } catch (error) {
      code = error.code || null;
    }
    return { code, adapterCalls };
  },

  // --- localization.receipt-identity ---

  localizationReceiptIdentityTyped() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localization-conformance-'));
    const store = new TranslationReceiptStore({ filePath: path.join(directory, 'receipts.jsonl') });
    const receipt = {
      schemaVersion: 2,
      translationPairId: 'pair:1',
      englishDocumentIdentity: 'doc-en', chineseDocumentIdentity: 'doc-zh',
      englishSourceDigest: `sha256:${'a'.repeat(64)}`, chineseTargetDigest: `sha256:${'b'.repeat(64)}`,
      englishMetaDigest: `sha256:${'c'.repeat(64)}`, chineseMetaDigest: `sha256:${'d'.repeat(64)}`,
      acceptedExecutionJournalDigest: `sha256:${'e'.repeat(64)}`, acceptedDecisionDigest: `sha256:${'f'.repeat(64)}`,
      sourceRevision: 3, targetRevision: 5, semanticUnitsDigest: `sha256:${'1'.repeat(64)}`,
      translationContractDigest: `sha256:${'2'.repeat(64)}`, promptContractDigest: `sha256:${'3'.repeat(64)}`,
      translatorAdapterVersion: 'adapter-1', model: 'conformance-model',
    };
    const codes = {};
    try {
      store.append(receipt, { liveVerified: false, accepted: true });
    } catch (error) { codes.unverified = error.code || null; }
    try {
      store.append({ ...receipt, acceptedExecutionJournalDigest: null }, { liveVerified: true, accepted: true });
    } catch (error) { codes.missingIdentity = error.code || null; }
    try {
      store.append(receipt, { liveVerified: true, accepted: true });
    } catch (error) { codes.appended = error.code || null; }
    return codes;
  },

  localizationRecoveryDriftRefused() {
    const receipt = {
      schemaVersion: 2,
      translationPairId: 'pair:1',
      englishDocumentIdentity: 'doc-en', chineseDocumentIdentity: 'doc-zh',
      englishSourceDigest: `sha256:${'a'.repeat(64)}`, chineseTargetDigest: `sha256:${'b'.repeat(64)}`,
      englishMetaDigest: `sha256:${'c'.repeat(64)}`, chineseMetaDigest: `sha256:${'d'.repeat(64)}`,
      acceptedExecutionJournalDigest: `sha256:${'e'.repeat(64)}`, acceptedDecisionDigest: `sha256:${'f'.repeat(64)}`,
      sourceRevision: 3, targetRevision: 5, semanticUnitsDigest: `sha256:${'1'.repeat(64)}`,
      translationContractDigest: `sha256:${'2'.repeat(64)}`, promptContractDigest: `sha256:${'3'.repeat(64)}`,
      translatorAdapterVersion: 'adapter-1', model: 'conformance-model',
      receiptDigest: `sha256:${'4'.repeat(64)}`,
    };
    const identity = Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'receiptDigest'));
    let code = null;
    try {
      assertTranslationRecoveryCompatible({ receipt, expected: identity });
    } catch (error) {
      code = error.code || null;
    }
    // A drifted receipt (source digest changed without a new accepted run)
    // must fail the recovery identity check.
    let driftCode = null;
    try {
      assertTranslationRecoveryCompatible({
        receipt: { ...receipt, englishSourceDigest: `sha256:${'9'.repeat(64)}` },
        expected: identity,
      });
    } catch (error) {
      driftCode = error.code || null;
    }
    return { selfAssertedDigestCode: code, driftCode };
  },
};

module.exports = { scenarios };
