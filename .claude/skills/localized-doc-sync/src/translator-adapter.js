'use strict';

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { createActionBatch } = require('../../doc-ops-core/src/action-batch');
const { prepareTranslationContent, applyTranslationResponse } = require('./translation-content');
const { loadTranslationContract, validateLocaleContractUnits } = require('./translation-contract');
const { parseAndAuthorizeReview } = require('./review-evidence');
const { classifyTranslationDrift } = require('./translation-state');

function revisionOf(record, contentDigest) {
  const revision = record?.metadata?.revision
    || record?.metadata?.revisionId
    || record?.metadata?.revision_id
    || record?.revision
    || record?.revisionId;
  if (revision) return { value: String(revision), kind: 'record-metadata' };
  return { value: `content:${contentDigest}`, kind: 'content-digest' };
}

function documentIdentity({ baseToken, tableId, rootToken, record }) {
  return {
    baseToken,
    tableId,
    rootToken,
    recordId: record.id,
    documentToken: record.metadata?.token || null,
    slug: record.metadata?.slug || null,
  };
}

function exactCorrections(response, authorizedUnitIds) {
  if (!response || typeof response !== 'object' || Array.isArray(response) || JSON.stringify(Object.keys(response).sort()) !== JSON.stringify(['corrections'])) {
    throw new Error('Correction response must use the exact schema {corrections:[{id,text}]}');
  }
  if (!Array.isArray(response.corrections) || response.corrections.length !== authorizedUnitIds.length) {
    throw new Error('Correction response must return every authorized semantic unit ID exactly once');
  }
  const authorized = new Set(authorizedUnitIds);
  const byId = new Map();
  for (const entry of response.corrections) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(['id', 'text']) || typeof entry.id !== 'string' || typeof entry.text !== 'string' || !authorized.has(entry.id) || byId.has(entry.id)) {
      throw new Error('Correction response must return every authorized semantic unit ID exactly once');
    }
    byId.set(entry.id, entry.text);
  }
  return byId;
}

async function buildLocalizationDryRun({
  legacyActions,
  sourceBitable,
  targetBitable,
  sourceTableId,
  targetTableId,
  sourceRoot,
  targetRoot,
  locale,
  audienceProfile,
  productProfile,
  translatorAdapterVersion,
  localizationSkillRoot,
  translator,
  translationReceiptStore,
  readSourceMarkdown,
  readTargetMarkdown,
}) {
  const contract = loadTranslationContract({
    skillRoot: localizationSkillRoot,
    locale,
    audienceProfile,
    productProfile,
    translatorAdapterVersion,
  });
  const localizationActions = [];

  for (const legacyAction of legacyActions) {
    if (legacyAction.type !== 'UPDATE') continue;
    const sourceMarkdown = await readSourceMarkdown(legacyAction.source);
    const targetMarkdown = await readTargetMarkdown(legacyAction.target);
    const translationPairId = `translation-pair:${legacyAction.slug}`;
    const sourceContentDigest = digestSemantic(sourceMarkdown);
    const targetContentDigest = digestSemantic(targetMarkdown);
    const receipt = translationReceiptStore?.latest(translationPairId) || null;
    const driftEvidence = {
      sourceChanged: !receipt || sourceContentDigest !== receipt.englishSourceDigest,
      targetChanged: !receipt || targetContentDigest !== receipt.chineseTargetDigest,
      contractStale: !receipt || contract.translationContractDigest !== receipt.translationContractDigest,
    };
    let code = classifyTranslationDrift({
      englishSourceDigest: sourceContentDigest,
      chineseTargetDigest: targetContentDigest,
      translationContractDigest: contract.translationContractDigest,
      receipt,
    });
    const staleTargetEdit = code === 'TRANSLATION_CONTRACT_STALE' && driftEvidence.targetChanged;
    if (staleTargetEdit) code = 'TRANSLATION_DIVERGED';
    const prepared = prepareTranslationContent(sourceMarkdown, { idPrefix: translationPairId });
    const sourceRevision = revisionOf(legacyAction.source, sourceContentDigest);
    const targetRevision = revisionOf(legacyAction.target, targetContentDigest);
    const baseAction = {
      code,
      translationPairId,
      sourceDocumentIdentity: documentIdentity({
        baseToken: sourceBitable,
        tableId: sourceTableId,
        rootToken: sourceRoot,
        record: legacyAction.source,
      }),
      targetDocumentIdentity: documentIdentity({
        baseToken: targetBitable,
        tableId: targetTableId,
        rootToken: targetRoot,
        record: legacyAction.target,
      }),
      sourceRevision: sourceRevision.value,
      targetRevision: targetRevision.value,
      sourceRevisionKind: sourceRevision.kind,
      targetRevisionKind: targetRevision.kind,
      sourceContentDigest,
      targetContentDigest,
      semanticUnitsDigest: prepared.semanticUnitsDigest,
      translationContractDigest: contract.translationContractDigest,
      promptContractDigest: contract.promptContractDigest,
      translatorAdapterVersion,
      model: translator?.model || 'unknown',
      driftEvidence,
    };
    if (code === 'TARGET_LOCAL_EDIT' || code === 'TRANSLATION_DIVERGED') {
      localizationActions.push({
        ...baseAction,
        disposition: 'BLOCKED',
        blockingReasons: staleTargetEdit
          ? ['TRANSLATION_CONTRACT_STALE', 'TARGET_LOCAL_EDIT']
          : [code],
        ...(staleTargetEdit ? {
          recoveryAllowed: false,
          invalidationReasons: ['TRANSLATION_CONTRACT_STALE'],
          invalidatedReceiptDigest: receipt?.receiptDigest || null,
        } : {}),
        candidateMarkdown: null,
      });
      continue;
    }
    if (code !== 'UPDATE_CONTENT' && code !== 'TRANSLATION_CONTRACT_STALE') {
      throw new Error(`Localization dry-run does not yet handle ${code}`);
    }
    if (!translator || typeof translator.translateSemanticUnits !== 'function') {
      throw new TypeError('translator must expose translateSemanticUnits() in localization contract mode');
    }

    const response = await translator.translateSemanticUnits({
      sourceContent: sourceMarkdown,
      units: prepared.units,
      localeContract: contract.localeContract,
      audienceProfile,
      productProfile,
      translationContractDigest: contract.translationContractDigest,
      promptContractDigest: contract.promptContractDigest,
      prompts: contract.prompts,
    });
    applyTranslationResponse(prepared, response);
    let draftUnits = prepared.units.map((unit) => ({
      ...unit,
      text: response.translations.find((entry) => entry.id === unit.id).text,
    }));
    let terminologyIssues = validateLocaleContractUnits(prepared.units, draftUnits, contract.localeContract);
    if (terminologyIssues.length) {
      throw new Error(`Locale contract validation failed: ${terminologyIssues.map((issue) => issue.message).join('; ')}`);
    }
    if (typeof translator.reviewSemanticUnits !== 'function') {
      throw new TypeError('translator must expose reviewSemanticUnits() in localization contract mode');
    }
    const reviewText = await translator.reviewSemanticUnits({
      sourceContent: sourceMarkdown,
      sourceUnits: prepared.units,
      draftUnits,
      localeContract: contract.localeContract,
      audienceProfile,
      productProfile,
      translationContractDigest: contract.translationContractDigest,
      promptContractDigest: contract.promptContractDigest,
      prompt: contract.prompts.review,
    });
    const authorization = parseAndAuthorizeReview(reviewText, {
      sourceUnits: prepared.units,
      draftUnits,
      localeContract: contract.localeContract,
    });
    let finalResponse = response;
    let finalAuthorization = authorization;
    if (authorization.correctionAuthorized) {
      if (typeof translator.correctSemanticUnits !== 'function') {
        throw new TypeError('translator must expose correctSemanticUnits() when review authorizes correction');
      }
      const authorized = new Set(authorization.authorizedUnitIds);
      const correction = await translator.correctSemanticUnits({
        sourceUnits: prepared.units.filter((unit) => authorized.has(unit.id)),
        units: draftUnits.filter((unit) => authorized.has(unit.id)),
        authorizedUnitIds: authorization.authorizedUnitIds,
        authorizedIssues: authorization.authorizedIssues,
        localeContract: contract.localeContract,
        audienceProfile,
        productProfile,
        translationContractDigest: contract.translationContractDigest,
        promptContractDigest: contract.promptContractDigest,
        prompt: contract.prompts.correction,
      });
      const corrections = exactCorrections(correction, authorization.authorizedUnitIds);
      draftUnits = draftUnits.map((unit) => corrections.has(unit.id) ? { ...unit, text: corrections.get(unit.id) } : unit);
      finalResponse = { translations: draftUnits.map(({ id, text }) => ({ id, text })) };
      terminologyIssues = validateLocaleContractUnits(prepared.units, draftUnits, contract.localeContract);
      if (terminologyIssues.length) {
        throw new Error(`Corrected locale contract validation failed: ${terminologyIssues.map((issue) => issue.message).join('; ')}`);
      }
      const finalReviewText = await translator.reviewSemanticUnits({
        sourceContent: sourceMarkdown,
        sourceUnits: prepared.units,
        draftUnits,
        localeContract: contract.localeContract,
        audienceProfile,
        productProfile,
        translationContractDigest: contract.translationContractDigest,
        promptContractDigest: contract.promptContractDigest,
        prompt: contract.prompts.review,
        phase: 'post-correction',
      });
      finalAuthorization = parseAndAuthorizeReview(finalReviewText, {
        sourceUnits: prepared.units,
        draftUnits,
        localeContract: contract.localeContract,
      });
      if (!finalAuthorization.effectivePass) {
        throw new Error('Post-correction review still contains evidence-backed issues');
      }
    }
    const candidateMarkdown = applyTranslationResponse(prepared, finalResponse);
    const reviewEvidence = {
      initial: {
        reviewerPass: authorization.reviewerPass,
        effectivePass: authorization.effectivePass,
        correctionAuthorized: authorization.correctionAuthorized,
        authorizedUnitIds: authorization.authorizedUnitIds,
        authorizedIssues: authorization.authorizedIssues,
        unsupportedIssues: authorization.unsupportedIssues,
      },
      final: {
        reviewerPass: finalAuthorization.reviewerPass,
        effectivePass: finalAuthorization.effectivePass,
        correctionAuthorized: finalAuthorization.correctionAuthorized,
        authorizedUnitIds: finalAuthorization.authorizedUnitIds,
        authorizedIssues: finalAuthorization.authorizedIssues,
        unsupportedIssues: finalAuthorization.unsupportedIssues,
      },
      correctionApplied: authorization.correctionAuthorized,
    };

    localizationActions.push({
      ...baseAction,
      disposition: 'PROPOSED',
      ...(code === 'TRANSLATION_CONTRACT_STALE' ? {
        recoveryAllowed: false,
        invalidationReasons: ['TRANSLATION_CONTRACT_STALE'],
        invalidatedReceiptDigest: receipt?.receiptDigest || null,
      } : {}),
      reviewEvidence,
      candidateMarkdown,
    });
  }

  return localizationActions;
}

function createLocalizationBatch(localizationActions) {
  const actions = localizationActions
    .filter((action) => action.disposition === 'PROPOSED' && typeof action.candidateMarkdown === 'string')
    .map((action) => ({
      actionId: `${action.translationPairId}:content`,
      target: `feishu-document:${action.targetDocumentIdentity.documentToken || action.targetDocumentIdentity.recordId}`,
      dependsOn: [],
      sideEffects: ['feishu.doc.patch', 'feishu.bitable.update'],
      kind: 'localized-content-update',
      state: action.code,
      sourceDocumentIdentity: action.sourceDocumentIdentity,
      targetDocumentIdentity: action.targetDocumentIdentity,
      sourceRevision: action.sourceRevision,
      targetRevision: action.targetRevision,
      sourceRevisionKind: action.sourceRevisionKind,
      targetRevisionKind: action.targetRevisionKind,
      sourceContentDigest: action.sourceContentDigest,
      targetContentDigest: action.targetContentDigest,
      candidateContentDigest: digestSemantic(action.candidateMarkdown),
      candidateMarkdown: action.candidateMarkdown,
      semanticUnitsDigest: action.semanticUnitsDigest,
      translationContractDigest: action.translationContractDigest,
      promptContractDigest: action.promptContractDigest,
      translatorAdapterVersion: action.translatorAdapterVersion,
      model: action.model,
      reviewEvidence: action.reviewEvidence,
      driftEvidence: action.driftEvidence,
      recoveryAllowed: action.recoveryAllowed !== false,
      invalidationReasons: action.invalidationReasons || [],
      invalidatedReceiptDigest: action.invalidatedReceiptDigest || null,
      executionAuthority: 'approval-envelope-required',
    }));
  return createActionBatch({ skill: 'localized-doc-sync', operation: 'sync', actions });
}

module.exports = { buildLocalizationDryRun, createLocalizationBatch };
