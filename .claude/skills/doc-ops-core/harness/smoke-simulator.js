'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { canonicalize } = require('../src/canonical-json');
const { digestSemantic } = require('../src/digest');

function fakeId(kind, value) {
  return `${kind}_fake_${digestSemantic(value).slice('sha256:'.length, 'sha256:'.length + 12)}`;
}

class StatefulFakeTenant {
  constructor() {
    this.folders = new Map();
    this.documents = new Map();
    this.records = new Map();
  }

  create({ corpus, corpusRoot, plan }) {
    const folderToken = fakeId('fld', plan.folderName);
    this.folders.set(folderToken, { name: plan.folderName, parent: plan.creationBatch.actions[0].target });
    for (const document of [...corpus.documents].sort((left, right) => left.id.localeCompare(right.id))) {
      const documentToken = fakeId('doc', `${plan.runId}:${document.id}`);
      const content = fs.readFileSync(path.join(corpusRoot, document.file), 'utf8');
      this.documents.set(document.id, { documentToken, folderToken, content });
      const recordId = fakeId('rec', `${plan.runId}:${document.id}`);
      this.records.set(document.id, {
        recordId,
        documentId: document.id,
        documentUrl: `https://smoke.invalid/docx/${documentToken}`,
      });
    }
  }

  patch({ corpus, corpusRoot }) {
    for (const document of corpus.documents) {
      if (!document.patchFile) continue;
      const current = this.documents.get(document.id);
      current.content = fs.readFileSync(path.join(corpusRoot, document.patchFile), 'utf8');
    }
  }

  cleanup() {
    this.records.clear();
    this.documents.clear();
    this.folders.clear();
  }

  inventory() {
    return canonicalize({
      documents: [...this.documents.entries()].map(([documentId, value]) => ({
        documentId,
        documentToken: value.documentToken,
        semanticDigest: digestSemantic(value.content),
      })).sort((left, right) => left.documentId.localeCompare(right.documentId)),
      folders: [...this.folders.entries()].map(([folderToken, value]) => ({ folderToken, name: value.name }))
        .sort((left, right) => left.folderToken.localeCompare(right.folderToken)),
      records: [...this.records.entries()].map(([documentId, value]) => ({
        documentId,
        documentUrl: value.documentUrl,
        recordId: value.recordId,
      })).sort((left, right) => left.documentId.localeCompare(right.documentId)),
    });
  }
}

function verifyState({ corpus, tenant }) {
  const errors = [];
  for (const document of [...corpus.documents].sort((left, right) => left.id.localeCompare(right.id))) {
    const live = tenant.documents.get(document.id);
    if (!live) {
      errors.push({ code: 'SMOKE_DOCUMENT_MISSING', documentId: document.id });
      continue;
    }
    for (const fragment of [...document.expected.requiredFragments].sort()) {
      if (!live.content.includes(fragment)) {
        errors.push({ code: 'SMOKE_REQUIRED_FRAGMENT_MISSING', documentId: document.id, fragment });
      }
    }
    for (const fragment of [...(document.expected.forbiddenFragments || [])].sort()) {
      if (live.content.includes(fragment)) {
        errors.push({ code: 'SMOKE_FORBIDDEN_FRAGMENT_PRESENT', documentId: document.id, fragment });
      }
    }
    const record = tenant.records.get(document.id);
    if (!record) {
      errors.push({ code: 'SMOKE_RECORD_MISSING', documentId: document.id });
    } else if (!record.documentUrl.endsWith(`/${live.documentToken}`)) {
      errors.push({ code: 'SMOKE_RECORD_LINK_MISMATCH', documentId: document.id });
    }
  }
  errors.sort((left, right) => (
    left.code.localeCompare(right.code)
    || String(left.documentId || '').localeCompare(String(right.documentId || ''))
    || String(left.fragment || '').localeCompare(String(right.fragment || ''))
  ));
  return { valid: errors.length === 0, errors };
}

function verifyCleanup(tenant) {
  const inventory = tenant.inventory();
  const errors = [];
  for (const resource of ['documents', 'folders', 'records']) {
    if (inventory[resource].length > 0) errors.push({ code: 'SMOKE_CLEANUP_INCOMPLETE', resource });
  }
  return { valid: errors.length === 0, errors };
}

function simulateSmokeRun({ corpus, corpusRoot, plan }) {
  const tenant = new StatefulFakeTenant();
  tenant.create({ corpus, corpusRoot, plan });
  const creationVerification = verifyState({ corpus, tenant });
  const creationInventory = tenant.inventory();
  tenant.patch({ corpus, corpusRoot });
  const patchVerification = verifyState({ corpus, tenant });
  const patchInventory = tenant.inventory();
  tenant.cleanup();
  const cleanupVerification = verifyCleanup(tenant);
  return canonicalize({
    schemaVersion: 1,
    cleanupVerification,
    creationInventory,
    creationVerification,
    finalInventory: tenant.inventory(),
    liveWritesPerformed: false,
    patchInventory,
    patchVerification,
    runId: plan.runId,
  });
}

module.exports = { StatefulFakeTenant, simulateSmokeRun, verifyCleanup, verifyState };
