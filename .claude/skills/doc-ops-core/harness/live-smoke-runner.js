'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { createApprovalEnvelope } = require('../src/approval-guard');
const { createActionBatch } = require('../src/action-batch');
const { canonicalStringify, canonicalize } = require('../src/canonical-json');
const { executeDag } = require('../src/dag-executor');
const { ExecutionJournal } = require('../src/journal');
const { digestSemantic } = require('../src/digest');
const { inspectSiblingRelation } = require('./smoke-acceptance');
const {
  LARK_IMPORT_TRANSPORT_SCHEMA_VERSION,
  compareMarkdownInventory,
  inventoryMarkdown,
  prepareMarkdownForLarkImport,
} = require('./smoke-content-inventory');

class LiveSmokeError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = 'LiveSmokeError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

const PHASES = Object.freeze({
  create: 'creationBatch',
  patch: 'patchBatch',
  cleanup: 'cleanupBatch',
  'cleanup-resume': 'cleanupResumeBatch',
  'recovery-cleanup': 'recoveryCleanupBatch',
});

function extractJsonObjects(value) {
  const text = String(value || '');
  const objects = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let cursor = index; cursor < text.length; cursor += 1) {
      const char = text[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            objects.push(JSON.parse(text.slice(index, cursor + 1)));
            index = cursor;
          } catch {
            // Continue scanning later braces.
          }
          break;
        }
      }
    }
  }
  return objects;
}

function selectSandboxEnvelope(value) {
  return extractJsonObjects(value).find(item => item && (
    item.ok !== undefined
    || item.data
    || item.identity
    || (item.profile && item.appId)
  ));
}

function documentTokenFromDocsCell(value) {
  let link = '';
  if (typeof value === 'string') {
    const text = value.trim();
    const markdownLink = text.match(/^\[[^\]]*\]\((https?:\/\/[^\s)]+)\)$/);
    link = markdownLink?.[1] || text;
  } else if (value && typeof value === 'object') {
    link = typeof value.link === 'string'
      ? value.link.trim()
      : (typeof value.url === 'string' ? value.url.trim() : '');
  }
  if (!link) return '';
  try {
    const url = new URL(link);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.pathname.match(/\/(?:docx|wiki)\/([^/]+)\/?$/)?.[1] || '';
  } catch {
    return '';
  }
}

function isRecordTombstone(record) {
  const fields = record?.fields || {};
  return !record || (!fields['Case ID'] && !fields['Run ID'] && !fields.Docs);
}

function decodeXmlText(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function resolveBlockAnchorId(xml, anchor) {
  if (!anchor || typeof anchor.tag !== 'string' || !/^[a-z][a-z0-9]*$/.test(anchor.tag)
    || typeof anchor.text !== 'string' || anchor.text === '') {
    throw new LiveSmokeError('SMOKE_PATCH_ANCHOR_INVALID', 'structural patch anchor is invalid');
  }
  const matches = [];
  const pattern = new RegExp(`<${anchor.tag}\\b([^>]*)>([^<]*)`, 'g');
  for (const match of String(xml || '').matchAll(pattern)) {
    const id = match[1].match(/\bid="([^"]+)"/)?.[1];
    const text = decodeXmlText(match[2]).replace(/\s+/g, ' ').trim();
    if (id && text === anchor.text) matches.push(id);
  }
  if (matches.length === 0) {
    throw new LiveSmokeError('SMOKE_PATCH_ANCHOR_MISSING', 'structural patch anchor was not found');
  }
  if (matches.length > 1) {
    throw new LiveSmokeError('SMOKE_PATCH_ANCHOR_AMBIGUOUS', 'structural patch anchor is not unique');
  }
  return matches[0];
}

function createSandboxCommandRunner({ repoRoot }) {
  if (!repoRoot) throw new LiveSmokeError('SMOKE_LIVE_REPO_ROOT_REQUIRED', 'repoRoot is required');
  return async function runLark(args, { input = undefined } = {}) {
    const result = spawnSync('npm', ['run', 'smoke:sandbox:lark', '--', ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      input,
      maxBuffer: 16 * 1024 * 1024,
    });
    const envelope = selectSandboxEnvelope(`${result.stdout || ''}\n${result.stderr || ''}`);
    if (result.status !== 0 || envelope?.ok === false) {
      throw new LiveSmokeError('SMOKE_LARK_COMMAND_FAILED', `sandbox lark command failed: ${args.slice(0, 2).join(' ')}`, {
        exitCode: result.status,
        errorType: envelope?.error?.type || null,
        errorSubtype: envelope?.error?.subtype || null,
      });
    }
    if (!envelope) throw new LiveSmokeError('SMOKE_LARK_OUTPUT_INVALID', 'sandbox lark command returned no JSON envelope');
    return envelope;
  };
}

function computeSandboxIdentityFingerprint({ authStatus, profile }) {
  return digestSemantic({
    appId: profile?.appId || null,
    identity: authStatus?.identity || null,
    openId: authStatus?.identities?.user?.openId || null,
    profile: profile?.profile || null,
  });
}

class LarkSandboxAdapter {
  constructor(options = {}) {
    this.config = options.config || {};
    this.corpus = options.corpus || {};
    this.corpusRoot = options.corpusRoot;
    this.runLark = options.runLark;
    if (typeof this.runLark !== 'function') {
      throw new LiveSmokeError('SMOKE_LIVE_COMMAND_RUNNER_REQUIRED', 'runLark is required');
    }
    this.identityVerified = false;
    this.fieldNames = null;
  }

  async _verifyIdentity(context) {
    if (this.identityVerified) return;
    const authStatus = await this.runLark(['auth', 'status', '--json', '--verify']);
    const profile = await this.runLark(['config', 'show', '--profile', context.plan.profile]);
    const fingerprint = computeSandboxIdentityFingerprint({ authStatus, profile });
    if (authStatus.identity !== 'user'
      || authStatus.verified !== true
      || authStatus.identities?.user?.tokenStatus !== 'valid') {
      throw new LiveSmokeError('SMOKE_IDENTITY_INVALID', 'sandbox user identity is not verified and valid');
    }
    if (fingerprint !== this.config.identityFingerprint
      || fingerprint !== context.plan.identityFingerprint) {
      throw new LiveSmokeError('SMOKE_IDENTITY_FINGERPRINT_MISMATCH', 'sandbox identity changed after planning');
    }
    this.identityVerified = true;
  }

  async _listFolder(folderToken) {
    const envelope = await this.runLark([
      'drive', 'files', 'list',
      '--folder-token', folderToken,
      '--page-size', '50',
      '--as', 'user',
    ]);
    return envelope.data?.files || envelope.data?.items || envelope.files || [];
  }

  _documentId(action) {
    return action.actionId.split(':').slice(2).join(':');
  }

  _document(action) {
    const documentId = this._documentId(action);
    const document = (this.corpus.documents || []).find(item => item.id === documentId);
    if (!document) throw new LiveSmokeError('SMOKE_DOCUMENT_UNKNOWN', `Unknown corpus document: ${documentId}`);
    return document;
  }

  _verifyLocalArtifacts(action, document) {
    const source = fs.readFileSync(path.join(this.corpusRoot, document.file), 'utf8');
    if (digestSemantic(source) !== action.sourceDigest) {
      throw new LiveSmokeError('ARTIFACT_DIGEST_MISMATCH', `${document.id} source changed after approval`);
    }
    const capabilityPath = path.resolve(this.corpusRoot, '..', '..', action.coveredSkill, 'capabilities.json');
    const capability = JSON.parse(fs.readFileSync(capabilityPath, 'utf8'));
    if (digestSemantic(capability) !== action.capabilityContractDigest) {
      throw new LiveSmokeError('CAPABILITY_CONTRACT_DIGEST_MISMATCH', `${action.coveredSkill} capability contract changed`);
    }
    if (action.actionId.startsWith('doc:create:')) {
      if (!action.expectedInventoryDigest) {
        throw new LiveSmokeError('ARTIFACT_DIGEST_MISMATCH', `${document.id} source inventory is not approval-bound`);
      }
      if (digestSemantic(inventoryMarkdown(source)) !== action.expectedInventoryDigest) {
        throw new LiveSmokeError('ARTIFACT_DIGEST_MISMATCH', `${document.id} source inventory changed after approval`);
      }
    }
    return source;
  }

  _verifyPatchArtifact(action, document) {
    this._verifyLocalArtifacts(action, document);
    const patchContent = fs.readFileSync(path.join(this.corpusRoot, document.patchFile), 'utf8');
    if (digestSemantic(patchContent) !== action.patchDigest) {
      throw new LiveSmokeError('ARTIFACT_DIGEST_MISMATCH', `${document.id} patch changed after approval`);
    }
    if (digestSemantic(inventoryMarkdown(patchContent)) !== action.expectedInventoryDigest) {
      throw new LiveSmokeError('ARTIFACT_DIGEST_MISMATCH', `${document.id} patch inventory changed after approval`);
    }
    if (!Array.isArray(document.patchOperations) || document.patchOperations.length === 0) {
      throw new LiveSmokeError('SMOKE_PATCH_OPERATIONS_MISSING', `${document.id} has no exact patch operations`);
    }
    if (digestSemantic(document.patchOperations) !== action.patchOperationsDigest) {
      throw new LiveSmokeError('ARTIFACT_DIGEST_MISMATCH', `${document.id} patch operations changed after approval`);
    }
    return { operations: document.patchOperations, patchContent };
  }

  _inventoryDiagnostic(expectedContent, observedContent) {
    const comparison = compareMarkdownInventory(
      inventoryMarkdown(expectedContent),
      inventoryMarkdown(observedContent),
    );
    if (comparison.ok) return null;
    return {
      code: 'SMOKE_CONTENT_INVENTORY_MISMATCH',
      missingKinds: [...new Set(comparison.missing.map(item => item.kind))].sort(),
      unexpectedKinds: [...new Set(comparison.unexpected.map(item => item.kind))].sort(),
    };
  }

  async _fetchDocument(documentToken) {
    const envelope = await this.runLark([
      'docs', '+fetch',
      '--doc', documentToken,
      '--doc-format', 'markdown',
      '--detail', 'full',
      '--scope', 'full',
      '--as', 'user',
      '--json',
    ]);
    const document = envelope.data?.document || envelope.data || {};
    return {
      content: document.content || '',
      documentToken: document.document_id || documentToken,
      revisionId: document.revision_id,
    };
  }

  async _fetchDocumentXml(documentToken) {
    const envelope = await this.runLark([
      'docs', '+fetch',
      '--doc', documentToken,
      '--doc-format', 'xml',
      '--detail', 'full',
      '--as', 'user',
      '--json',
    ]);
    const document = envelope.data?.document || envelope.data || {};
    return {
      content: document.content || '',
      documentToken: document.document_id || documentToken,
      revisionId: document.revision_id,
    };
  }

  async _ensureFields() {
    if (this.fieldNames) return this.fieldNames;
    const envelope = await this.runLark([
      'base', '+field-list',
      '--base-token', this.config.baseToken,
      '--table-id', this.config.tableId,
      '--limit', '200',
      '--as', 'user',
      '--json',
    ]);
    const fields = envelope.data?.fields || envelope.data?.items || envelope.fields || [];
    this.fieldNames = new Set(fields.map(field => field.field_name || field.name).filter(Boolean));
    const required = [
      'Docs', 'Case ID', 'Run ID', 'Progress', 'Type', 'Skill',
      'Corpus Version', 'Expected Digest', 'Disposable', 'Last Modified At',
    ];
    const missing = required.filter(field => !this.fieldNames.has(field));
    if (missing.length > 0) {
      throw new LiveSmokeError('SMOKE_BASE_SCHEMA_MISMATCH', `Cases is missing fields: ${missing.join(', ')}`);
    }
    return this.fieldNames;
  }

  async _searchRecords(runId) {
    const envelope = await this.runLark([
      'base', '+record-search',
      '--base-token', this.config.baseToken,
      '--table-id', this.config.tableId,
      '--keyword', runId,
      '--search-field', 'Run ID',
      '--limit', '50',
      '--format', 'json',
      '--as', 'user',
    ]);
    return this._recordsFromEnvelope(envelope);
  }

  _recordsFromEnvelope(envelope) {
    const data = envelope?.data;
    const records = data?.records || data?.items || envelope?.records;
    if (Array.isArray(records)) return records;
    if (!Array.isArray(data?.data) || !Array.isArray(data?.fields)) return [];
    const recordIds = Array.isArray(data.record_id_list) ? data.record_id_list : [];
    return data.data.map((row, rowIndex) => ({
      fields: Object.fromEntries(data.fields.map((field, fieldIndex) => {
        const key = String(fieldIndex);
        const value = Array.isArray(row)
          ? row[fieldIndex]
          : (Object.hasOwn(row || {}, key) ? row[key] : undefined);
        return [field, value];
      })),
      record_id: recordIds[rowIndex] || null,
    }));
  }

  async _getRecord(recordId) {
    const envelope = await this.runLark([
      'base', '+record-get',
      '--base-token', this.config.baseToken,
      '--table-id', this.config.tableId,
      '--record-id', recordId,
      '--field-id', 'Docs',
      '--field-id', 'Case ID',
      '--field-id', 'Run ID',
      '--format', 'json',
      '--as', 'user',
    ]);
    return this._recordsFromEnvelope(envelope)
      .find(record => (record.record_id || record.id) === recordId) || null;
  }

  async _inspectRecordCleanup(recordId, runId) {
    const [exactRecord, searchedRecords] = await Promise.all([
      this._getRecord(recordId),
      this._searchRecords(runId),
    ]);
    const searchedRecord = searchedRecords
      .find(item => (item.record_id || item.id) === recordId) || null;
    const exactTombstone = isRecordTombstone(exactRecord);
    return {
      absent: exactTombstone && !searchedRecord,
      evidence: exactTombstone ? searchedRecord : exactRecord,
      exactTombstone,
      inconsistent: exactTombstone && Boolean(searchedRecord),
      searchedRecord,
    };
  }

  async verifyIdentity({ plan }) {
    await this._verifyIdentity({ plan });
  }

  async listCanaryDocuments({ state }) {
    const rootEntry = (await this._listFolder(this.config.rootToken))
      .find(item => (item.token || item.folder_token) === state.folderToken);
    if (!rootEntry) return [];
    const entries = await this._listFolder(state.folderToken);
    const idByToken = new Map(Object.entries(state.documents || {})
      .map(([id, document]) => [document.documentToken, id]));
    return entries.map(item => ({ id: idByToken.get(item.token || item.file_token) || null }))
      .filter(item => item.id);
  }

  async fetchSyntheticDocument(documentId, { state }) {
    const documentState = state.documents?.[documentId];
    if (!documentState?.documentToken) {
      throw new LiveSmokeError('SMOKE_DOCUMENT_STATE_MISSING', `${documentId} has no recorded document`);
    }
    const fetched = await this._fetchDocument(documentState.documentToken);
    const parentVerified = (await this._listFolder(state.folderToken))
      .some(item => (item.token || item.file_token) === documentState.documentToken);
    return {
      content: fetched.content,
      contentDigest: digestSemantic(fetched.content),
      inventoryDigest: digestSemantic(inventoryMarkdown(fetched.content)),
      parentVerified,
    };
  }

  async verifySyntheticRecordBinding(documentId, { plan, state }) {
    const recordId = state.records?.[documentId]?.recordId;
    const documentToken = state.documents?.[documentId]?.documentToken;
    if (!recordId || !documentToken) return false;
    const record = await this._getRecord(recordId);
    return Boolean(record)
      && record.fields?.['Case ID'] === documentId
      && record.fields?.['Run ID'] === plan.runId
      && documentTokenFromDocsCell(record.fields?.Docs) === documentToken;
  }

  async inspectApiSiblingRelation(documentId, { state }) {
    const documentState = state.documents?.[documentId];
    if (!documentState?.documentToken) {
      throw new LiveSmokeError('SMOKE_DOCUMENT_STATE_MISSING', `${documentId} has no recorded document`);
    }
    const fetched = await this._fetchDocumentXml(documentState.documentToken);
    return inspectSiblingRelation(fetched.content, 'child item', 'patched sibling item');
  }

  async reconcileCleanup(action, context) {
    await this._verifyIdentity(context);
    if (action.actionId.startsWith('record:delete:')) {
      const document = this._document(action);
      const recordId = context.state.records?.[document.id]?.recordId;
      if (!recordId || action.target !== `base-record-id:${recordId}`) {
        return { status: 'divergent' };
      }
      const inspection = await this._inspectRecordCleanup(recordId, context.plan.runId);
      if (inspection.inconsistent) return { status: 'unknown' };
      if (inspection.absent) {
        return { status: 'verified', statePatch: { records: { [document.id]: { deleted: true } } } };
      }
      if (inspection.evidence?.fields?.['Case ID'] !== document.id
        || inspection.evidence?.fields?.['Run ID'] !== context.plan.runId) {
        return { status: 'divergent' };
      }
      return { status: 'not_started' };
    }
    if (action.actionId.startsWith('doc:delete:')) {
      const document = this._document(action);
      const documentState = context.state.documents?.[document.id];
      if (!documentState?.documentToken || action.target !== `docx-token:${documentState.documentToken}`) {
        return { status: 'divergent' };
      }
      const entry = (await this._listFolder(context.state.folderToken))
        .find(item => (item.token || item.file_token) === documentState.documentToken);
      if (!entry) return { status: 'verified', statePatch: { documents: { [document.id]: { deleted: true } } } };
      const fetched = await this._fetchDocument(documentState.documentToken);
      return digestSemantic(fetched.content) === documentState.contentDigest
        ? { status: 'not_started' }
        : { status: 'divergent' };
    }
    if (action.actionId === 'folder:delete') {
      if (!context.state.folderToken || action.target !== `drive-folder-token:${context.state.folderToken}`) {
        return { status: 'divergent' };
      }
      const entry = (await this._listFolder(this.config.rootToken))
        .find(item => (item.token || item.folder_token) === context.state.folderToken);
      return entry
        ? { status: 'not_started' }
        : { status: 'verified', statePatch: { folderDeleted: true } };
    }
    return { status: 'unknown' };
  }

  _runTimestamp(runId) {
    const match = String(runId).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-/);
    if (!match) throw new LiveSmokeError('SMOKE_RUN_ID_INVALID', 'runId timestamp is invalid');
    return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`;
  }

  async precondition(action, context) {
    await this._verifyIdentity(context);
    if (action.identityFingerprint !== context.plan.identityFingerprint) {
      throw new LiveSmokeError('SMOKE_ACTION_IDENTITY_MISMATCH', `${action.actionId} is not bound to the planned identity`);
    }
    if (action.actionId === 'folder:create') {
      if (context.plan.tenantMarker !== 'DOC_OPS_TEST'
        || action.tenantMarker !== context.plan.tenantMarker
        || !context.plan.folderName.startsWith('__DOC_OPS_SMOKE__')) {
        throw new LiveSmokeError('SMOKE_CANARY_BOUNDARY_INVALID', 'folder creation escaped the smoke namespace');
      }
      const matches = (await this._listFolder(this.config.rootToken))
        .filter(item => (item.name || item.title) === context.plan.folderName);
      if (matches.length > 0) {
        throw new LiveSmokeError('SMOKE_PRECONDITION_FAILED', 'approved canary folder already exists');
      }
      return { absent: true };
    }
    if (action.actionId.startsWith('doc:create:')) {
      const document = this._document(action);
      this._verifyLocalArtifacts(action, document);
      if (!context.state.folderToken) {
        throw new LiveSmokeError('SMOKE_FOLDER_STATE_MISSING', 'document creation requires the recorded canary folder');
      }
      const matches = (await this._listFolder(context.state.folderToken))
        .filter(item => (item.name || item.title) === action.title);
      if (matches.length > 0) {
        throw new LiveSmokeError('SMOKE_PRECONDITION_FAILED', `${document.id} already exists in the canary folder`);
      }
      return { absent: true, folderToken: context.state.folderToken };
    }
    if (action.actionId.startsWith('record:create:')) {
      const document = this._document(action);
      this._verifyLocalArtifacts(action, document);
      if (!context.state.documents?.[document.id]?.documentToken) {
        throw new LiveSmokeError('SMOKE_DOCUMENT_STATE_MISSING', `${document.id} record requires a created document`);
      }
      await this._ensureFields();
      const matches = (await this._searchRecords(context.plan.runId))
        .filter(record => record.fields?.['Case ID'] === document.id);
      if (matches.length > 0) {
        throw new LiveSmokeError('SMOKE_PRECONDITION_FAILED', `${document.id} record already exists`);
      }
      return { absent: true };
    }
    if (action.actionId.startsWith('doc:patch:')) {
      const document = this._document(action);
      const patch = this._verifyPatchArtifact(action, document);
      const documentState = context.state.documents?.[document.id];
      if (documentState?.creationVerified !== true) {
        throw new LiveSmokeError('SMOKE_CREATION_LINEAGE_INVALID', `${document.id} creation was not verified`);
      }
      if (!documentState?.documentToken || !documentState?.contentDigest) {
        throw new LiveSmokeError('SMOKE_DOCUMENT_STATE_MISSING', `${document.id} patch requires verified creation state`);
      }
      const fetched = await this._fetchDocument(documentState.documentToken);
      if (fetched.revisionId !== documentState.revisionId
        || digestSemantic(fetched.content) !== documentState.contentDigest) {
        throw new LiveSmokeError('SMOKE_DOCUMENT_PRECONDITION_DRIFT', `${document.id} changed after creation approval`);
      }
      const parentEntry = (await this._listFolder(context.state.folderToken))
        .find(item => (item.token || item.file_token) === documentState.documentToken);
      if (!parentEntry) throw new LiveSmokeError('SMOKE_DOCUMENT_PARENT_MISMATCH', `${document.id} left the canary folder`);
      let xml = null;
      const operations = [];
      for (const operation of patch.operations) {
        if (operation.type !== 'block_insert_after') {
          operations.push(operation);
          continue;
        }
        if (!xml) xml = await this._fetchDocumentXml(documentState.documentToken);
        if (xml.revisionId !== fetched.revisionId) {
          throw new LiveSmokeError('SMOKE_DOCUMENT_PRECONDITION_DRIFT', `${document.id} changed during structural anchor resolution`);
        }
        operations.push({ ...operation, blockId: resolveBlockAnchorId(xml.content, operation.anchor) });
      }
      return { ...patch, operations, revisionId: fetched.revisionId };
    }
    if (action.actionId.startsWith('record:delete:')) {
      const document = this._document(action);
      const recordId = context.state.records?.[document.id]?.recordId;
      if (!recordId || action.target !== `base-record-id:${recordId}`) {
        throw new LiveSmokeError('SMOKE_CLEANUP_TARGET_MISMATCH', `${document.id} record target is not creation-bound`);
      }
      const inspection = await this._inspectRecordCleanup(recordId, context.plan.runId);
      if (inspection.inconsistent) {
        throw new LiveSmokeError('SMOKE_CLEANUP_PRECONDITION_FAILED', `${document.id} exact record and run search disagree`);
      }
      if (inspection.absent) return { alreadyAbsent: true, recordId };
      if (inspection.evidence?.fields?.['Case ID'] !== document.id
        || inspection.evidence?.fields?.['Run ID'] !== context.plan.runId) {
        throw new LiveSmokeError('SMOKE_CLEANUP_PRECONDITION_FAILED', `${document.id} record provenance is invalid`);
      }
      return { alreadyAbsent: false, recordId };
    }
    if (action.actionId.startsWith('doc:delete:')) {
      const document = this._document(action);
      const documentState = context.state.documents?.[document.id];
      if (!documentState?.documentToken || action.target !== `docx-token:${documentState.documentToken}`) {
        throw new LiveSmokeError('SMOKE_CLEANUP_TARGET_MISMATCH', `${document.id} document target is not creation-bound`);
      }
      if (context.state.records?.[document.id]
        && context.state.records[document.id].deleted !== true) {
        throw new LiveSmokeError('SMOKE_CLEANUP_DEPENDENCY_FAILED', `${document.id} record must be deleted first`);
      }
      const fetched = await this._fetchDocument(documentState.documentToken);
      if (digestSemantic(fetched.content) !== documentState.contentDigest) {
        throw new LiveSmokeError('SMOKE_DOCUMENT_PRECONDITION_DRIFT', `${document.id} changed after patch verification`);
      }
      const parentEntry = (await this._listFolder(context.state.folderToken))
        .find(item => (item.token || item.file_token) === documentState.documentToken);
      if (!parentEntry) throw new LiveSmokeError('SMOKE_DOCUMENT_PARENT_MISMATCH', `${document.id} left the canary folder`);
      return { documentToken: documentState.documentToken };
    }
    if (action.actionId === 'folder:delete') {
      if (!context.state.folderToken || action.target !== `drive-folder-token:${context.state.folderToken}`) {
        throw new LiveSmokeError('SMOKE_CLEANUP_TARGET_MISMATCH', 'folder target is not creation-bound');
      }
      const remaining = await this._listFolder(context.state.folderToken);
      if (remaining.length > 0) {
        throw new LiveSmokeError('SMOKE_CLEANUP_FOLDER_NOT_EMPTY', 'canary folder still contains resources');
      }
      return { folderToken: context.state.folderToken };
    }
    throw new LiveSmokeError('SMOKE_LIVE_ACTION_UNSUPPORTED', `Unsupported precondition action: ${action.actionId}`);
  }

  async mutate(action, context) {
    if (action.actionId === 'folder:create') {
      const envelope = await this.runLark([
        'drive', '+create-folder',
        '--name', context.plan.folderName,
        '--folder-token', this.config.rootToken,
        '--as', 'user',
        '--json',
      ]);
      const folder = envelope.data?.folder || envelope.data || {};
      const folderToken = folder.token || folder.folder_token;
      if (!folderToken) throw new LiveSmokeError('SMOKE_FOLDER_CREATE_INVALID', 'folder create returned no token');
      return { receipt: { created: true }, statePatch: { folderToken } };
    }
    if (action.actionId.startsWith('doc:create:')) {
      const document = this._document(action);
      const content = this._verifyLocalArtifacts(action, document);
      const transportContent = prepareMarkdownForLarkImport(content);
      if (action.transportSchemaVersion !== LARK_IMPORT_TRANSPORT_SCHEMA_VERSION) {
        throw new LiveSmokeError(
          'SMOKE_TRANSPORT_SCHEMA_MISMATCH',
          `${document.id} creation transport schema is not approval-bound to the current encoder`,
        );
      }
      if (digestSemantic(transportContent) !== action.transportDigest) {
        throw new LiveSmokeError(
          'SMOKE_TRANSPORT_DIGEST_MISMATCH',
          `${document.id} creation transport changed after approval`,
        );
      }
      const envelope = await this.runLark([
        'docs', '+create',
        '--doc-format', 'markdown',
        '--title', action.title,
        '--content', '-',
        '--parent-token', context.state.folderToken,
        '--as', 'user',
        '--json',
      ], { input: transportContent });
      const created = envelope.data?.document || envelope.data || {};
      const documentToken = created.document_id || created.document_token;
      if (!documentToken) throw new LiveSmokeError('SMOKE_DOCUMENT_CREATE_INVALID', `${document.id} returned no document token`);
      return {
        receipt: { created: true },
        statePatch: {
          documents: {
            [document.id]: {
              documentToken,
              revisionId: created.revision_id,
              title: action.title,
              url: created.url || null,
            },
          },
        },
      };
    }
    if (action.actionId.startsWith('record:create:')) {
      const document = this._document(action);
      const documentState = context.state.documents?.[document.id];
      const fields = [
        'Docs', 'Case ID', 'Run ID', 'Progress', 'Type', 'Skill',
        'Corpus Version', 'Expected Digest', 'Disposable', 'Last Modified At',
      ];
      const row = [
        documentState.url,
        document.id,
        context.plan.runId,
        'WIP',
        'Smoke',
        [action.coveredSkill],
        this.corpus.corpusId,
        action.sourceDigest,
        true,
        this._runTimestamp(context.plan.runId),
      ];
      const envelope = await this.runLark([
        'base', '+record-batch-create',
        '--base-token', this.config.baseToken,
        '--table-id', this.config.tableId,
        '--json', JSON.stringify({ fields, rows: [row] }),
        '--as', 'user',
      ]);
      const recordId = envelope.data?.record_id_list?.[0]
        || envelope.data?.records?.[0]?.record_id
        || envelope.record_id_list?.[0];
      if (!recordId) throw new LiveSmokeError('SMOKE_RECORD_CREATE_INVALID', `${document.id} returned no record ID`);
      return {
        receipt: { created: true },
        statePatch: { records: { [document.id]: { recordId } } },
      };
    }
    if (action.actionId.startsWith('doc:patch:')) {
      const document = this._document(action);
      const documentState = context.state.documents?.[document.id];
      let revisionId = context.precondition.revisionId;
      for (const operation of context.precondition.operations) {
        const args = [
          'docs', '+update',
          '--doc', documentState.documentToken,
          '--command', operation.type,
          '--doc-format', operation.type === 'block_insert_after' ? operation.contentFormat : 'markdown',
        ];
        if (operation.type === 'block_insert_after') {
          args.push('--block-id', operation.blockId);
        } else {
          args.push('--pattern', operation.before);
        }
        args.push(
          '--content', '-',
          '--revision-id', String(revisionId),
          '--as', 'user',
          '--json',
        );
        const envelope = await this.runLark(args, {
          input: operation.type === 'block_insert_after' ? operation.content : operation.after,
        });
        const update = envelope.data?.document || envelope.data || {};
        revisionId = update.revision_id;
        if (!Number.isInteger(revisionId)) {
          throw new LiveSmokeError('SMOKE_DOCUMENT_PATCH_INVALID', `${document.id} patch returned no revision`);
        }
      }
      return {
        receipt: { operationCount: context.precondition.operations.length, patched: true },
        statePatch: { documents: { [document.id]: { revisionId } } },
      };
    }
    if (action.actionId.startsWith('record:delete:')) {
      const document = this._document(action);
      const recordId = context.precondition.recordId;
      if (context.precondition.alreadyAbsent) {
        return {
          receipt: { alreadyAbsent: true, deleted: false },
          statePatch: { records: { [document.id]: { deleted: true } } },
        };
      }
      await this.runLark([
        'base', '+record-delete',
        '--base-token', this.config.baseToken,
        '--table-id', this.config.tableId,
        '--record-id', recordId,
        '--as', 'user',
        '--yes',
      ]);
      return {
        receipt: { deleted: true },
        statePatch: { records: { [document.id]: { deleted: true } } },
      };
    }
    if (action.actionId.startsWith('doc:delete:')) {
      const document = this._document(action);
      await this.runLark([
        'drive', '+delete',
        '--file-token', context.precondition.documentToken,
        '--type', 'docx',
        '--as', 'user',
        '--yes',
        '--json',
      ]);
      return {
        receipt: { deleted: true },
        statePatch: { documents: { [document.id]: { deleted: true } } },
      };
    }
    if (action.actionId === 'folder:delete') {
      await this.runLark([
        'drive', '+delete',
        '--file-token', context.precondition.folderToken,
        '--type', 'folder',
        '--as', 'user',
        '--yes',
        '--json',
      ]);
      return { receipt: { deleted: true }, statePatch: { folderDeleted: true } };
    }
    throw new LiveSmokeError('SMOKE_LIVE_ACTION_UNSUPPORTED', `Unsupported mutation action: ${action.actionId}`);
  }

  async refetch(action, mutationResult, context) {
    if (action.actionId === 'folder:create') {
      const matches = (await this._listFolder(this.config.rootToken))
        .filter(item => (item.name || item.title) === context.plan.folderName);
      if (matches.length !== 1) {
        throw new LiveSmokeError('SMOKE_FOLDER_REFETCH_AMBIGUOUS', 'created canary folder is missing or duplicated');
      }
      const folderToken = matches[0].token || matches[0].folder_token;
      return { folderToken, name: matches[0].name || matches[0].title };
    }
    if (action.actionId.startsWith('doc:create:')) {
      const document = this._document(action);
      const documentToken = context.state.documents?.[document.id]?.documentToken;
      const fetched = await this._fetchDocument(documentToken);
      const parentEntry = (await this._listFolder(context.state.folderToken))
        .find(item => (item.token || item.file_token) === documentToken);
      return { ...fetched, parentVerified: Boolean(parentEntry) };
    }
    if (action.actionId.startsWith('record:create:')) {
      const document = this._document(action);
      const recordId = context.state.records?.[document.id]?.recordId;
      const record = await this._getRecord(recordId);
      return { record: record || null };
    }
    if (action.actionId.startsWith('doc:patch:')) {
      const document = this._document(action);
      const documentToken = context.state.documents?.[document.id]?.documentToken;
      const fetched = await this._fetchDocument(documentToken);
      const parentEntry = (await this._listFolder(context.state.folderToken))
        .find(item => (item.token || item.file_token) === documentToken);
      return { ...fetched, parentVerified: Boolean(parentEntry) };
    }
    if (action.actionId.startsWith('record:delete:')) {
      const document = this._document(action);
      const recordId = context.state.records?.[document.id]?.recordId;
      const inspection = await this._inspectRecordCleanup(recordId, context.plan.runId);
      return { absent: inspection.absent };
    }
    if (action.actionId.startsWith('doc:delete:')) {
      const document = this._document(action);
      const documentToken = context.state.documents?.[document.id]?.documentToken;
      const entry = (await this._listFolder(context.state.folderToken))
        .find(item => (item.token || item.file_token) === documentToken);
      return { absent: !entry };
    }
    if (action.actionId === 'folder:delete') {
      const entry = (await this._listFolder(this.config.rootToken))
        .find(item => (item.token || item.folder_token) === context.state.folderToken);
      return { absent: !entry };
    }
    throw new LiveSmokeError('SMOKE_LIVE_ACTION_UNSUPPORTED', `Unsupported refetch action: ${action.actionId}`);
  }

  async verify(action, { mutationResult, observed }, context) {
    if (action.actionId === 'folder:create') {
      const expected = mutationResult?.statePatch?.folderToken;
      const ok = Boolean(expected) && observed?.folderToken === expected;
      return {
        diagnostics: ok ? [] : [{ code: 'SMOKE_FOLDER_TOKEN_MISMATCH' }],
        ok,
      };
    }
    if (action.actionId.startsWith('doc:create:')) {
      const document = this._document(action);
      const source = this._verifyLocalArtifacts(action, document);
      const diagnostics = [];
      for (const fragment of document.expected.requiredFragments || []) {
        if (!observed.content.includes(fragment)) diagnostics.push({ code: 'SMOKE_REQUIRED_FRAGMENT_MISSING', fragment });
      }
      for (const fragment of document.expected.forbiddenFragments || []) {
        if (observed.content.includes(fragment)) diagnostics.push({ code: 'SMOKE_FORBIDDEN_FRAGMENT_PRESENT', fragment });
      }
      const inventoryDiagnostic = this._inventoryDiagnostic(source, observed.content);
      if (inventoryDiagnostic) diagnostics.push(inventoryDiagnostic);
      if (!observed.parentVerified) diagnostics.push({ code: 'SMOKE_DOCUMENT_PARENT_MISMATCH' });
      const contentDigest = digestSemantic(observed.content);
      const inventoryDigest = digestSemantic(inventoryMarkdown(observed.content));
      return {
        diagnostics,
        ok: diagnostics.length === 0,
        statePatch: {
          documents: {
            [document.id]: {
              contentDigest,
              creationContentDigest: contentDigest,
              creationInventoryDigest: inventoryDigest,
              creationRevisionId: observed.revisionId,
              creationVerified: diagnostics.length === 0,
              inventoryDigest,
              revisionId: observed.revisionId,
            },
          },
        },
      };
    }
    if (action.actionId.startsWith('record:create:')) {
      const document = this._document(action);
      const record = observed.record;
      const diagnostics = [];
      if (!record) diagnostics.push({ code: 'SMOKE_RECORD_MISSING' });
      if (record && record.fields?.['Case ID'] !== document.id) diagnostics.push({ code: 'SMOKE_RECORD_CASE_MISMATCH' });
      if (record && record.fields?.['Run ID'] !== context.plan.runId) diagnostics.push({ code: 'SMOKE_RECORD_RUN_MISMATCH' });
      const docsValue = record?.fields?.Docs;
      const linkedDocumentToken = documentTokenFromDocsCell(docsValue);
      const documentToken = context.state.documents?.[document.id]?.documentToken;
      if (record && linkedDocumentToken !== documentToken) diagnostics.push({ code: 'SMOKE_RECORD_LINK_MISMATCH' });
      return { diagnostics, ok: diagnostics.length === 0 };
    }
    if (action.actionId.startsWith('doc:patch:')) {
      const document = this._document(action);
      const { patchContent } = this._verifyPatchArtifact(action, document);
      const diagnostics = [];
      for (const fragment of document.expected.requiredFragments || []) {
        if (!observed.content.includes(fragment)) diagnostics.push({ code: 'SMOKE_REQUIRED_FRAGMENT_MISSING', fragment });
      }
      for (const fragment of document.expected.forbiddenFragments || []) {
        if (observed.content.includes(fragment)) diagnostics.push({ code: 'SMOKE_FORBIDDEN_FRAGMENT_PRESENT', fragment });
      }
      for (const operation of document.patchOperations || []) {
        const expectedFragment = operation.type === 'block_insert_after'
          ? operation.expectedFragment
          : operation.after;
        if (!observed.content.includes(expectedFragment)) {
          diagnostics.push({ code: 'SMOKE_PATCH_FRAGMENT_MISSING', fragment: expectedFragment });
        }
      }
      const inventoryDiagnostic = this._inventoryDiagnostic(patchContent, observed.content);
      if (inventoryDiagnostic) diagnostics.push(inventoryDiagnostic);
      if (!observed.parentVerified) diagnostics.push({ code: 'SMOKE_DOCUMENT_PARENT_MISMATCH' });
      return {
        diagnostics,
        ok: diagnostics.length === 0,
        statePatch: {
          documents: {
            [document.id]: {
              contentDigest: digestSemantic(observed.content),
              inventoryDigest: digestSemantic(inventoryMarkdown(observed.content)),
              revisionId: observed.revisionId,
            },
          },
        },
      };
    }
    if (action.actionId.startsWith('record:delete:')
      || action.actionId.startsWith('doc:delete:')
      || action.actionId === 'folder:delete') {
      return {
        diagnostics: observed.absent ? [] : [{ code: 'SMOKE_CLEANUP_RESOURCE_REMAINS' }],
        ok: observed.absent === true,
      };
    }
    throw new LiveSmokeError('SMOKE_LIVE_ACTION_UNSUPPORTED', `Unsupported verify action: ${action.actionId}`);
  }
}

function loadState(statePath) {
  if (!fs.existsSync(statePath)) return {};
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function saveState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(statePath, canonicalStringify(state), { mode: 0o600 });
  fs.chmodSync(statePath, 0o600);
}

function mergeStatePatch(target, patch) {
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
      mergeStatePatch(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function materializeCleanupBatch({ plan, runDir } = {}) {
  if (!plan || !runDir) {
    throw new LiveSmokeError('SMOKE_CLEANUP_INPUT_REQUIRED', 'plan and runDir are required');
  }
  const statePath = path.join(runDir, 'state.json');
  const journalPath = path.join(runDir, 'create.journal.jsonl');
  if (!fs.existsSync(statePath) || !fs.existsSync(journalPath)) {
    throw new LiveSmokeError('SMOKE_CLEANUP_CREATION_EVIDENCE_MISSING', 'verified creation state and journal are required');
  }
  const state = loadState(statePath);
  if (state.runId !== plan.runId
    || state.profile !== plan.profile
    || state.tenantMarker !== plan.tenantMarker) {
    throw new LiveSmokeError('SMOKE_CLEANUP_STATE_MISMATCH', 'creation state does not belong to this smoke plan');
  }
  const journalEntries = fs.readFileSync(journalPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  if (journalEntries.some(entry => entry.batchDigest !== plan.creationBatch.batchDigest)) {
    throw new LiveSmokeError('SMOKE_CLEANUP_JOURNAL_MISMATCH', 'creation journal digest does not match the plan');
  }
  const completion = journalEntries.find(entry => entry.type === 'completion' && entry.completionSentinel === true);
  if (!completion) {
    throw new LiveSmokeError('SMOKE_CLEANUP_CREATION_INCOMPLETE', 'creation journal has no completion sentinel');
  }
  if (!state.folderToken) {
    throw new LiveSmokeError('SMOKE_CLEANUP_FOLDER_MISSING', 'creation state has no canary folder token');
  }
  const templateById = new Map((plan.cleanupBatch?.actions || []).map(action => [action.actionId, action]));
  const documentIds = plan.creationBatch.actions
    .filter(action => action.actionId.startsWith('doc:create:'))
    .map(action => action.actionId.split(':').slice(2).join(':'))
    .sort();
  const actions = [];
  for (const documentId of documentIds) {
    const documentState = state.documents?.[documentId];
    const recordState = state.records?.[documentId];
    if (!documentState?.documentToken || !recordState?.recordId) {
      throw new LiveSmokeError('SMOKE_CLEANUP_RESOURCE_MISSING', `${documentId} lacks exact creation receipts`);
    }
    const recordActionId = `record:delete:${documentId}`;
    const documentActionId = `doc:delete:${documentId}`;
    const recordTemplate = templateById.get(recordActionId) || {};
    const documentTemplate = templateById.get(documentActionId) || {};
    actions.push({
      ...recordTemplate,
      actionId: recordActionId,
      dependsOn: [],
      target: `base-record-id:${recordState.recordId}`,
    });
    actions.push({
      ...documentTemplate,
      actionId: documentActionId,
      dependsOn: [recordActionId],
      target: `docx-token:${documentState.documentToken}`,
    });
  }
  const folderTemplate = templateById.get('folder:delete') || {};
  actions.push({
    ...folderTemplate,
    actionId: 'folder:delete',
    dependsOn: documentIds.map(documentId => `doc:delete:${documentId}`),
    target: `drive-folder-token:${state.folderToken}`,
  });
  return createActionBatch({ skill: 'doc-ops-core', operation: 'smoke-cleanup', actions });
}

async function materializeCleanupResumeBatch({ plan, runDir, adapter } = {}) {
  if (!plan || !runDir || typeof adapter?.reconcileCleanup !== 'function') {
    throw new LiveSmokeError('SMOKE_CLEANUP_RESUME_INPUT_REQUIRED', 'plan, runDir, and reconciliation adapter are required');
  }
  const fullBatch = materializeCleanupBatch({ plan, runDir });
  const journalPath = path.join(runDir, 'cleanup.journal.jsonl');
  if (!fs.existsSync(journalPath)) {
    throw new LiveSmokeError('SMOKE_CLEANUP_RESUME_JOURNAL_MISSING', 'partial cleanup journal is required');
  }
  const statePath = path.join(runDir, 'state.json');
  const state = loadState(statePath);
  const actionIds = new Set(fullBatch.actions.map(action => action.actionId));
  const journalNames = ['cleanup.journal.jsonl', ...fs.readdirSync(runDir)
    .filter(name => /^cleanup-resume.*\.journal\.jsonl$/.test(name))
    .sort()];
  const entriesByName = new Map();
  for (const name of journalNames) {
    let journalEntries;
    try {
      journalEntries = fs.readFileSync(path.join(runDir, name), 'utf8').trim()
        .split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (error) {
      throw new LiveSmokeError('SMOKE_CLEANUP_RESUME_JOURNAL_MISMATCH', `${name} is not valid JSONL`, { cause: error.message });
    }
    const invalidEntry = journalEntries.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry));
    const digests = new Set(journalEntries.map(entry => entry?.batchDigest));
    const invalidAction = journalEntries.some(entry => (
      (entry?.type === 'prepared' || entry?.type === 'observed' || entry?.actionId !== undefined)
      && !actionIds.has(entry?.actionId)
    ));
    const resumeMatch = name.match(/^cleanup-resume\.([a-f0-9]{16})\.journal\.jsonl$/);
    const digest = journalEntries[0]?.batchDigest;
    const invalidDigest = digests.size !== 1 || !/^sha256:[a-f0-9]{64}$/.test(digest || '')
      || (name === 'cleanup.journal.jsonl'
        ? digest !== fullBatch.batchDigest
        : !resumeMatch || resumeMatch[1] !== digest.slice('sha256:'.length, 'sha256:'.length + 16));
    if (invalidEntry || invalidDigest || invalidAction) {
      throw new LiveSmokeError('SMOKE_CLEANUP_RESUME_JOURNAL_MISMATCH', `${name} is not bound to the exact cleanup batch`);
    }
    entriesByName.set(name, journalEntries);
  }
  const originalEntries = entriesByName.get('cleanup.journal.jsonl');
  const entries = [...entriesByName.values()].flat();
  if (originalEntries.some(entry => entry.type === 'completion' && entry.completionSentinel === true)) {
    throw new LiveSmokeError('SMOKE_CLEANUP_ALREADY_COMPLETE', 'cleanup journal already has a completion sentinel');
  }
  await adapter.verifyIdentity?.({ plan, state });
  const attempted = new Set(entries
    .filter(entry => entry.type === 'prepared' || entry.type === 'observed')
    .map(entry => entry.actionId));
  const pending = [];
  for (const action of fullBatch.actions) {
    if (attempted.has(action.actionId)) {
      const reconciliation = await adapter.reconcileCleanup(action, { plan, state });
      if (reconciliation?.status === 'verified') {
        mergeStatePatch(state, reconciliation.statePatch || {});
        continue;
      }
      if (reconciliation?.status !== 'not_started') {
        throw new LiveSmokeError(
          'SMOKE_CLEANUP_RECONCILIATION_BLOCKED',
          `${action.actionId} reconciled as ${reconciliation?.status || 'unknown'}`,
        );
      }
    }
    pending.push(action);
  }
  if (pending.length === 0) {
    saveState(statePath, state);
    throw new LiveSmokeError('SMOKE_CLEANUP_ALREADY_COMPLETE', 'all cleanup resources are already verified deleted');
  }
  const pendingIds = new Set(pending.map(action => action.actionId));
  const actions = pending.map(action => ({
    ...action,
    dependsOn: (action.dependsOn || []).filter(dependency => pendingIds.has(dependency)),
  }));
  saveState(statePath, state);
  return createActionBatch({ skill: 'doc-ops-core', operation: 'smoke-cleanup-resume', actions });
}

function materializeRecoveryCleanupBatch({ plan, runDir } = {}) {
  if (!plan || !runDir) {
    throw new LiveSmokeError('SMOKE_RECOVERY_INPUT_REQUIRED', 'plan and runDir are required');
  }
  const statePath = path.join(runDir, 'state.json');
  const journalPath = path.join(runDir, 'create.journal.jsonl');
  if (!fs.existsSync(statePath) || !fs.existsSync(journalPath)) {
    throw new LiveSmokeError('SMOKE_RECOVERY_EVIDENCE_MISSING', 'partial creation state and journal are required');
  }
  const state = loadState(statePath);
  if (state.runId !== plan.runId
    || state.profile !== plan.profile
    || state.tenantMarker !== plan.tenantMarker) {
    throw new LiveSmokeError('SMOKE_RECOVERY_STATE_MISMATCH', 'partial state does not belong to this smoke plan');
  }
  const journalEntries = fs.readFileSync(journalPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  if (journalEntries.some(entry => entry.batchDigest !== plan.creationBatch.batchDigest)) {
    throw new LiveSmokeError('SMOKE_RECOVERY_JOURNAL_MISMATCH', 'creation journal digest does not match the plan');
  }
  if (journalEntries.some(entry => entry.type === 'completion' && entry.completionSentinel === true)) {
    throw new LiveSmokeError('SMOKE_RECOVERY_NOT_PARTIAL', 'completed creation runs must use the normal cleanup batch');
  }
  const prepared = new Set(journalEntries.filter(entry => entry.type === 'prepared').map(entry => entry.actionId));
  const observed = new Set(journalEntries.filter(entry => entry.type === 'observed').map(entry => entry.actionId));
  const verifiedRecoveryActions = new Set();
  for (const name of fs.readdirSync(runDir).filter(item => /^recovery-cleanup(?:\.[a-f0-9]+)?\.journal\.jsonl$/.test(item))) {
    const recoveryEntries = fs.readFileSync(path.join(runDir, name), 'utf8').trim()
      .split('\n').filter(Boolean).map(line => JSON.parse(line));
    for (const entry of recoveryEntries) {
      if (entry.type === 'observed' && entry.status === 'success' && entry.verified === true) {
        verifiedRecoveryActions.add(entry.actionId);
      }
    }
  }
  const creationActionIds = new Set((plan.creationBatch.actions || []).map(action => action.actionId));
  const assertObservedCreation = actionId => {
    if (!creationActionIds.has(actionId) || !prepared.has(actionId) || !observed.has(actionId)) {
      throw new LiveSmokeError(
        'SMOKE_RECOVERY_JOURNAL_EVIDENCE_MISSING',
        `${actionId} has no complete partial-run journal evidence`,
      );
    }
  };
  if (!state.folderToken) throw new LiveSmokeError('SMOKE_RECOVERY_FOLDER_MISSING', 'partial state has no canary folder token');
  assertObservedCreation('folder:create');

  const templateById = new Map((plan.cleanupBatch?.actions || []).map(action => [action.actionId, action]));
  const documentIds = Object.keys(state.documents || {}).sort();
  const recordIds = Object.keys(state.records || {}).sort();
  for (const documentId of recordIds) {
    if (!state.documents?.[documentId]) {
      throw new LiveSmokeError('SMOKE_RECOVERY_STATE_INVALID', `${documentId} record has no document state`);
    }
  }

  const actions = [];
  const outstandingRecordIds = recordIds
    .filter(documentId => !verifiedRecoveryActions.has(`record:delete:${documentId}`));
  for (const documentId of outstandingRecordIds) {
    const recordState = state.records[documentId];
      if (!recordState.recordId) {
        throw new LiveSmokeError('SMOKE_RECOVERY_RECORD_INVALID', `${documentId} lacks an exact record ID`);
      }
      assertObservedCreation(`record:create:${documentId}`);
      const recordActionId = `record:delete:${documentId}`;
      actions.push({
        ...(templateById.get(recordActionId) || {}),
        actionId: recordActionId,
        dependsOn: [],
        target: `base-record-id:${recordState.recordId}`,
      });
  }
  const outstandingDocumentIds = documentIds
    .filter(documentId => !verifiedRecoveryActions.has(`doc:delete:${documentId}`));
  for (const documentId of outstandingDocumentIds) {
    const documentState = state.documents[documentId];
    if (!documentState?.documentToken || !documentState?.contentDigest) {
      throw new LiveSmokeError('SMOKE_RECOVERY_DOCUMENT_INVALID', `${documentId} lacks exact document evidence`);
    }
    assertObservedCreation(`doc:create:${documentId}`);
    const recordActionId = `record:delete:${documentId}`;
    const documentActionId = `doc:delete:${documentId}`;
    actions.push({
      ...(templateById.get(documentActionId) || {}),
      actionId: documentActionId,
      dependsOn: outstandingRecordIds.includes(documentId) ? [recordActionId] : [],
      target: `docx-token:${documentState.documentToken}`,
    });
  }
  if (!verifiedRecoveryActions.has('folder:delete')) {
    actions.push({
      ...(templateById.get('folder:delete') || {}),
      actionId: 'folder:delete',
      dependsOn: outstandingDocumentIds.map(documentId => `doc:delete:${documentId}`),
      target: `drive-folder-token:${state.folderToken}`,
    });
  }
  if (actions.length === 0) {
    throw new LiveSmokeError('SMOKE_RECOVERY_ALREADY_COMPLETE', 'all partial-run resources are already verified deleted');
  }
  return createActionBatch({ skill: 'doc-ops-core', operation: 'smoke-recovery-cleanup', actions });
}

function requireAdapter(adapter) {
  for (const method of ['precondition', 'mutate', 'refetch', 'verify']) {
    if (typeof adapter?.[method] !== 'function') {
      throw new LiveSmokeError('SMOKE_LIVE_ADAPTER_INVALID', `adapter.${method} is required`);
    }
  }
}

async function executeLivePhase({
  phase,
  plan,
  approvedBatchDigest,
  adapter,
  runDir,
} = {}) {
  const batchKey = PHASES[phase];
  const batch = batchKey && plan?.[batchKey];
  if (!batch) throw new LiveSmokeError('SMOKE_LIVE_PHASE_INVALID', `Unknown or unavailable phase: ${phase || '(missing)'}`);
  if (approvedBatchDigest !== batch.batchDigest) {
    throw new LiveSmokeError('APPROVAL_BATCH_MISMATCH', 'approved digest does not match the planned live batch');
  }
  if (!runDir) throw new LiveSmokeError('SMOKE_LIVE_RUN_DIR_REQUIRED', 'runDir is required');
  requireAdapter(adapter);

  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(runDir, 0o700);
  const legacyJournalPath = path.join(runDir, `${phase}.journal.jsonl`);
  const digestSuffix = String(batch.batchDigest).replace(/^sha256:/, '').slice(0, 16);
  const resumablePhase = phase === 'recovery-cleanup' || phase === 'cleanup-resume';
  const journalPath = resumablePhase
    ? path.join(runDir, `${phase}.${digestSuffix}.journal.jsonl`)
    : legacyJournalPath;
  if (phase === 'recovery-cleanup'
    && fs.existsSync(legacyJournalPath)
    && fs.readFileSync(legacyJournalPath, 'utf8').includes(batch.batchDigest)) {
    throw new LiveSmokeError(
      'EXECUTION_RECONCILIATION_REQUIRED',
      `${phase} journal already exists for this batch; inspect live state before any relaunch`,
    );
  }
  if (fs.existsSync(journalPath) && fs.statSync(journalPath).size > 0) {
    throw new LiveSmokeError(
      'EXECUTION_RECONCILIATION_REQUIRED',
      `${phase} journal already exists; inspect live state before any relaunch`,
    );
  }
  const statePath = path.join(runDir, 'state.json');
  const state = {
    ...loadState(statePath),
    profile: plan.profile || null,
    runId: plan.runId,
    tenantMarker: plan.tenantMarker || null,
  };
  if (phase === 'patch' && state.creationBatchDigest !== plan.creationBatch?.batchDigest) {
    throw new LiveSmokeError(
      'SMOKE_CREATION_LINEAGE_INVALID',
      'patch requires a fully verified creation batch from the same plan',
    );
  }
  saveState(statePath, state);

  const approval = createApprovalEnvelope({
    skill: batch.skill,
    operation: batch.operation,
    batchDigest: batch.batchDigest,
    actionCount: batch.actions.length,
    targets: batch.targets,
    sideEffects: batch.sideEffects,
    decision: 'approved',
  });
  const journal = new ExecutionJournal({
    filePath: journalPath,
    batchDigest: batch.batchDigest,
    approvedActionIds: batch.actions.map(action => action.actionId),
  });
  const context = Object.freeze({
    phase,
    plan,
    runDir,
    state,
    statePath,
  });
  const execution = await executeDag({
    skill: batch.skill,
    operation: batch.operation,
    actions: batch.actions,
    batchDigest: batch.batchDigest,
    approval,
    journal,
    precondition: action => adapter.precondition(action, context),
    mutate: async (action, precondition) => {
      const result = await adapter.mutate(action, { ...context, precondition });
      if (result?.statePatch && typeof result.statePatch === 'object') {
        mergeStatePatch(state, result.statePatch);
        saveState(statePath, state);
      }
      return result;
    },
    refetch: (action, mutationResult) => adapter.refetch(action, mutationResult, context),
    verify: async (action, payload) => {
      const verification = await adapter.verify(action, payload, context);
      if (verification?.statePatch && typeof verification.statePatch === 'object') {
        mergeStatePatch(state, verification.statePatch);
        saveState(statePath, state);
      }
      return verification;
    },
  });

  if (phase === 'create' && execution.status === 'EXECUTED') {
    state.creationBatchDigest = batch.batchDigest;
    saveState(statePath, state);
  }

  return canonicalize({
    actionResults: execution.results.map(item => ({
      actionId: item.actionId,
      diagnostics: item.verification?.diagnostics || [],
      status: item.verification?.ok === true ? 'success' : 'failure',
    })),
    batchDigest: batch.batchDigest,
    liveWritesPerformed: execution.results.length > 0,
    phase,
    runId: plan.runId,
    status: execution.status,
  });
}

module.exports = {
  LarkSandboxAdapter,
  LiveSmokeError,
  PHASES,
  computeSandboxIdentityFingerprint,
  createSandboxCommandRunner,
  executeLivePhase,
  extractJsonObjects,
  loadState,
  materializeCleanupBatch,
  materializeCleanupResumeBatch,
  materializeRecoveryCleanupBatch,
  mergeStatePatch,
  saveState,
  selectSandboxEnvelope,
  resolveBlockAnchorId,
};
