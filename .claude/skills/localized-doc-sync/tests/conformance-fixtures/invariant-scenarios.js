'use strict';

// Executable conformance scenarios for the localization.* invariants. Every
// scenario invokes production code (planner, scan manifest, CLI, translation
// content, review evidence, translation state) and returns a typed decision
// that the shared doc-ops-core conformance runner compares against the
// fixture's assertions.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildReviewUnits } = require('../../src/planner');
const { buildScanManifest } = require('../../src/issue-classifier');
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

// A complete dual-Base snapshot: every table carries the digests scanBase()
// derives (field schema, view scope, record set).
function completeBase(baseToken, tableId, seed) {
  return {
    baseToken,
    revision: 9,
    tables: [{
      tableId,
      fieldSchemaDigest: `sha256:${seed}-fields`,
      viewScopeDigest: `sha256:${seed}-views`,
      recordSetDigest: `sha256:${seed}-records`,
    }],
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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
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
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localization-conformance-'));
    const manifestPath = path.join(directory, 'manifest.json');
    const outputPath = path.join(directory, 'units.json');
    // A hand-assembled snapshot without the per-table scan digests is a
    // partial scan: the manifest derives completeInventory=false.
    const partialManifest = buildScanManifest({
      sourceBase: { baseToken: 'en', revision: 9, tables: [{ tableId: 'en-dev' }] },
      targetBase: completeBase('zh', 'zh-dev', 'bb'),
      tableMappings: [], placementIdentities: [], translationPairs: [],
      translationReceiptDigests: [], hierarchyPolicies: [],
      localePolicyDigest: `sha256:${'c'.repeat(64)}`,
      issues: [],
    });
    writeJson(manifestPath, partialManifest);
    const { runCli } = require('../../bin/localized-doc-sync');
    let code = null;
    try {
      await runCli({
        argv: ['node', 'localized-doc-sync.js', 'plan', '--scan-manifest', manifestPath, '--output', outputPath],
        dependencies: { onStdout() {} },
      });
    } catch (error) {
      code = error.code || null;
    }
    return { code, completeInventory: partialManifest.completeInventory };
  },

  async localizationStaleManifestRefused() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localization-conformance-'));
    const manifestPath = path.join(directory, 'manifest.json');
    const outputPath = path.join(directory, 'units.json');
    // The claimed inventory digest no longer recomputes from the manifest's
    // own snapshots: the queue decision is stale.
    const staleManifest = { ...manifestFixture(), inventoryDigest: `sha256:${'0'.repeat(64)}` };
    writeJson(manifestPath, staleManifest);
    const { runCli } = require('../../bin/localized-doc-sync');
    let code = null;
    try {
      await runCli({
        argv: ['node', 'localized-doc-sync.js', 'plan', '--scan-manifest', manifestPath, '--output', outputPath],
        dependencies: { onStdout() {} },
      });
    } catch (error) {
      code = error.code || null;
    }
    return { code };
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
