'use strict';

const { validateRenderedApiBlocks } = require('./feishu-block-safety');

function finding(code, message, details = {}) {
  return { code, message, ...details };
}

function result(errors) {
  return { valid: errors.length === 0, errors };
}

function verifyExecutionJournal({ approvedActions = [], journal = null } = {}) {
  const errors = [];
  const approvedIds = approvedActions.map((action) => action?.actionId).filter(Boolean);
  const approved = new Set(approvedIds);
  const sharedEntries = Array.isArray(journal) ? journal : null;
  const results = sharedEntries
    ? sharedEntries.filter(entry => entry?.type === 'observed').map(entry => ({
      actionId: entry.actionId,
      status: entry.status,
    }))
    : Array.isArray(journal?.results) ? journal.results : [];
  const resultCounts = new Map();

  for (const item of results) {
    if (!item?.actionId) continue;
    resultCounts.set(item.actionId, (resultCounts.get(item.actionId) || 0) + 1);
    if (!approved.has(item.actionId)) {
      errors.push(finding('UNAPPROVED_ACTION_RESULT', `Execution journal contains unapproved action ${item.actionId}.`, {
        actionId: item.actionId,
      }));
    } else if (item.status !== 'success') {
      errors.push(finding('ACTION_NOT_SUCCESSFUL', `Approved action ${item.actionId} did not complete successfully.`, {
        actionId: item.actionId,
        status: item.status || null,
      }));
    }
  }

  for (const actionId of approvedIds) {
    const count = resultCounts.get(actionId) || 0;
    if (count === 0) {
      errors.push(finding('MISSING_ACTION_RESULT', `Execution journal has no result for approved action ${actionId}.`, {
        actionId,
      }));
    } else if (count > 1) {
      errors.push(finding('DUPLICATE_ACTION_RESULT', `Execution journal has ${count} results for approved action ${actionId}.`, {
        actionId,
        count,
      }));
    }
  }

  const completion = sharedEntries
    ? sharedEntries.find(entry => entry?.type === 'completion')
    : journal;
  if (completion?.completionSentinel !== true) {
    errors.push(finding(
      'MISSING_COMPLETION_SENTINEL',
      'Execution is not complete until a durable completion sentinel is written after all action results.',
    ));
  }
  if (completion?.status !== 'executed') {
    errors.push(finding('EXECUTION_NOT_COMPLETE', 'Execution journal status must be executed.', {
      status: completion?.status || null,
    }));
  }

  return result(errors);
}

function canonicalOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function verifyPublicationAccess({ tenantHost, records = [] } = {}) {
  const errors = [];
  const expectedOrigin = canonicalOrigin(tenantHost);
  if (!expectedOrigin) {
    errors.push(finding('INVALID_TENANT_HOST', 'tenantHost must be an absolute HTTP(S) URL.'));
    return result(errors);
  }

  for (const record of records) {
    const recordId = record?.recordId || null;
    const linkOrigin = canonicalOrigin(record?.docsLink);
    if (linkOrigin !== expectedOrigin) {
      errors.push(finding('NON_CANONICAL_DOC_HOST', `Record ${recordId || '(unknown)'} does not use the configured tenant host.`, {
        recordId,
        documentToken: record?.documentToken || null,
        expectedOrigin,
        actualOrigin: linkOrigin,
      }));
    }
    if (!record?.actualFolderToken || !record?.targetFolderToken) {
      errors.push(finding('MISSING_FOLDER_EVIDENCE', `Record ${recordId || '(unknown)'} lacks canonical folder evidence.`, {
        recordId,
        documentToken: record?.documentToken || null,
        actualFolderToken: record?.actualFolderToken || null,
        targetFolderToken: record?.targetFolderToken || null,
      }));
    } else if (record.actualFolderToken !== record.targetFolderToken) {
      errors.push(finding('WRONG_DOCUMENT_FOLDER', `Record ${recordId || '(unknown)'} points to a document outside its canonical folder.`, {
        recordId,
        documentToken: record?.documentToken || null,
        actualFolderToken: record.actualFolderToken,
        targetFolderToken: record.targetFolderToken,
      }));
    }
    if (record?.humanAccessVerified !== true) {
      errors.push(finding('HUMAN_ACCESS_UNVERIFIED', `Record ${recordId || '(unknown)'} has not been verified through a human-visible access path.`, {
        recordId,
        documentToken: record?.documentToken || null,
        botReadable: record?.botReadable === true,
      }));
    }
  }

  return result(errors);
}

function blockText(block) {
  const container = block?.heading3 || block?.heading2 || block?.text || block?.code;
  return (container?.elements || [])
    .map((element) => element?.text_run?.content || '')
    .join('')
    .trim();
}

function verifyJavaExampleLayout({ blocks = [] } = {}) {
  const errors = [];
  for (const block of blocks) {
    if (block?.block_type !== 5) continue;
    if (/^java examples?$/i.test(blockText(block))) {
      errors.push(finding(
        'REDUNDANT_JAVA_EXAMPLE_HEADING',
        'Java API pages must not render a nested Java example heading beneath the Example section.',
        { blockId: block.block_id || null },
      ));
    }
  }
  return result(errors);
}

function verifyJavaRichTextLayout({ blocks = [], linkedInlineCodeRequirements = [] } = {}) {
  const errors = validateRenderedApiBlocks(blocks, {
    requiredLinkedInlineCode: linkedInlineCodeRequirements,
    requireLinkedIdentifiersInlineCode: true,
  }).errors
    .filter((error) => [
      'LINKED_CODE_RENDERED_AS_LITERAL_BACKTICKS',
      'LINKED_API_IDENTIFIER_NOT_INLINE_CODE',
      'REQUIRED_LINKED_INLINE_CODE_MISSING',
    ].includes(error.code))
    .map((error) => finding(
      error.code,
      error.code === 'REQUIRED_LINKED_INLINE_CODE_MISSING'
        ? 'A declared Java canonical reference is missing a rich-text run that combines the exact link and inline-code style.'
        : 'A linked Java identifier must use a real inline-code rich-text style, not plain text or visible Markdown backticks.',
      {
        blockId: error.blockId || null,
        text: error.text || null,
        link: error.link || null,
      },
    ));
  return result(errors);
}

function verifyEmbeddedHelpers({ embeddedHelpers = [], records = [] } = {}) {
  const errors = [];
  const recordsByStableId = new Map(records
    .filter((record) => record?.stableId)
    .map((record) => [record.stableId, record]));

  for (const helper of embeddedHelpers) {
    const helperRecord = recordsByStableId.get(helper?.helperStableId);
    if (helperRecord) {
      errors.push(finding(
        'STANDALONE_EMBEDDED_HELPER',
        `Embedded helper ${helper.helperStableId} still has a standalone documentation record.`,
        {
          helperStableId: helper.helperStableId,
          recordId: helperRecord.recordId || null,
          ownerStableIds: helper.ownerStableIds || [],
        },
      ));
    }
    for (const ownerStableId of helper?.ownerStableIds || []) {
      if (!recordsByStableId.has(ownerStableId)) {
        errors.push(finding(
          'MISSING_EMBEDDED_HELPER_OWNER',
          `Embedded helper ${helper.helperStableId} is missing owner record ${ownerStableId}.`,
          { helperStableId: helper.helperStableId, ownerStableId },
        ));
      }
    }
  }

  return result(errors);
}

function verifyAcceptanceFinalization({
  scanStateUpdated = false,
  touchedRecordIds = [],
  acceptance = null,
} = {}) {
  const errors = [];
  const userConfirmed = acceptance?.userConfirmed === true;
  const acceptanceByRecord = new Map((acceptance?.records || [])
    .filter((record) => record?.recordId)
    .map((record) => [record.recordId, record]));

  if (scanStateUpdated === true && !userConfirmed) {
    errors.push(finding(
      'ACCEPTANCE_NOT_CONFIRMED',
      'scan-state.json cannot advance until the user explicitly confirms that all touched documentation is accepted.',
    ));
  }
  if (userConfirmed && scanStateUpdated !== true) {
    errors.push(finding(
      'ACCEPTED_SCAN_STATE_NOT_UPDATED',
      'After acceptance and verified WIP-to-Draft transitions, scan-state.json must be updated.',
    ));
  }

  if (scanStateUpdated === true || userConfirmed) {
    for (const recordId of [...new Set(touchedRecordIds.filter(Boolean))]) {
      const record = acceptanceByRecord.get(recordId);
      if (!record
        || record.beforeProgress !== 'WIP'
        || record.afterProgress !== 'Draft'
        || record.verified !== true) {
        errors.push(finding(
          'MISSING_DRAFT_ACCEPTANCE_EVIDENCE',
          `Touched record ${recordId} lacks a verified WIP-to-Draft acceptance transition.`,
          { recordId },
        ));
      }
    }
  }

  return result(errors);
}

function verifyOperationalManifest(manifest = {}) {
  const errors = [];
  if (!manifest.execution && !manifest.approvedActions) {
    errors.push(finding(
      'MISSING_EXECUTION_EVIDENCE',
      'Operational verification requires the approved action list and durable execution journal.',
    ));
  } else {
    errors.push(...verifyExecutionJournal({
      approvedActions: manifest.approvedActions || [],
      journal: manifest.execution || null,
    }).errors);
  }
  if (!Array.isArray(manifest.publicationAccess) || manifest.publicationAccess.length === 0) {
    errors.push(finding(
      'MISSING_PUBLICATION_ACCESS_EVIDENCE',
      'Operational verification requires publication access evidence for touched documents.',
    ));
  } else {
    errors.push(...verifyPublicationAccess({
      tenantHost: manifest.tenantHost,
      records: manifest.publicationAccess,
    }).errors);
  }
  if (String(manifest.language || '').toLowerCase() === 'java'
    && (!Array.isArray(manifest.javaDocuments) || manifest.javaDocuments.length === 0)) {
    errors.push(finding(
      'MISSING_JAVA_DOCUMENT_EVIDENCE',
      'A Java operational manifest must include refetched live blocks for every touched Java document.',
    ));
  }
  if (String(manifest.language || '').toLowerCase() === 'java'
    && Array.isArray(manifest.javaDocuments)
    && manifest.javaDocuments.length > 0) {
    const evidencedTokens = new Set((manifest.javaDocuments || [])
      .map((document) => document?.documentToken)
      .filter(Boolean));
    for (const record of manifest.publicationAccess || []) {
      if (record?.documentToken && !evidencedTokens.has(record.documentToken)) {
        errors.push(finding(
          'MISSING_JAVA_DOCUMENT_EVIDENCE',
          `Java document ${record.documentToken} lacks refetched live block evidence.`,
          { documentToken: record.documentToken, recordId: record.recordId || null },
        ));
      }
    }
  }
  for (const document of manifest.javaDocuments || []) {
    errors.push(...verifyJavaExampleLayout(document).errors.map((error) => ({
      ...error,
      documentToken: document.documentToken || error.documentToken || null,
    })));
    errors.push(...verifyJavaRichTextLayout(document).errors.map((error) => ({
      ...error,
      documentToken: document.documentToken || error.documentToken || null,
    })));
  }
  if (manifest.embeddedHelpers) {
    errors.push(...verifyEmbeddedHelpers({
      embeddedHelpers: manifest.embeddedHelpers,
      records: manifest.records || [],
    }).errors);
  }
  if (Object.prototype.hasOwnProperty.call(manifest, 'scanStateUpdated') || manifest.acceptance) {
    errors.push(...verifyAcceptanceFinalization({
      scanStateUpdated: manifest.scanStateUpdated === true,
      touchedRecordIds: (manifest.publicationAccess || []).map((record) => record?.recordId).filter(Boolean),
      acceptance: manifest.acceptance || null,
    }).errors);
  }
  return result(errors);
}

module.exports = {
  verifyAcceptanceFinalization,
  verifyEmbeddedHelpers,
  verifyExecutionJournal,
  verifyJavaExampleLayout,
  verifyJavaRichTextLayout,
  verifyOperationalManifest,
  verifyPublicationAccess,
};
