'use strict';

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
  const results = Array.isArray(journal?.results) ? journal.results : [];
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

  if (journal?.completionSentinel !== true) {
    errors.push(finding(
      'MISSING_COMPLETION_SENTINEL',
      'Execution is not complete until a durable completion sentinel is written after all action results.',
    ));
  }
  if (journal?.status !== 'executed') {
    errors.push(finding('EXECUTION_NOT_COMPLETE', 'Execution journal status must be executed.', {
      status: journal?.status || null,
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
  for (const document of manifest.javaDocuments || []) {
    errors.push(...verifyJavaExampleLayout(document).errors.map((error) => ({
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
  return result(errors);
}

module.exports = {
  verifyEmbeddedHelpers,
  verifyExecutionJournal,
  verifyJavaExampleLayout,
  verifyOperationalManifest,
  verifyPublicationAccess,
};
