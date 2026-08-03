'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { canonicalStringify, canonicalize } = require('../src/canonical-json');
const { digestSemantic } = require('../src/digest');
const { createResult, validateResult } = require('../src/result-contract');
const { extractMarkdownCodeSnippets, normalizeCodeLanguage } = require('../src/markdown-code-snippets');
const { compareMarkdownInventory, inventoryMarkdown } = require('./smoke-content-inventory');

const CANONICAL_SKILLS = Object.freeze([
  'api-reference-sync',
  'doc-code-verify',
  'localized-doc-sync',
  'procedure-code-sync',
  'verified-doc-authoring',
]);

const CAPABILITY_IDS = Object.freeze({
  'api-reference-sync': ['api.exact-approval', 'api.phase-gates', 'api.recoverable-execution'],
  'doc-code-verify': ['verify.read-only', 'verify.result-contract', 'verify.strongest-safe-check'],
  'localized-doc-sync': ['localization.exact-approval', 'localization.round-trip', 'localization.source-read-only'],
  'procedure-code-sync': ['procedure.exact-approval', 'procedure.language-order', 'procedure.round-trip', 'procedure.scoped-patch'],
  'verified-doc-authoring': ['authoring.evidence-contract', 'authoring.result-contract', 'authoring.unresolved-visible'],
});

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

function parseXmlTree(xml) {
  const root = { tag: '#root', text: '', children: [], parent: null };
  const stack = [root];
  const tokenPattern = /<\/?([a-z][a-z0-9-]*)\b[^>]*>|([^<]+)/gi;
  for (const match of String(xml || '').matchAll(tokenPattern)) {
    if (match[2] !== undefined) {
      stack.at(-1).text += decodeXmlText(match[2]);
      continue;
    }
    const token = match[0];
    const tag = match[1].toLowerCase();
    if (token.startsWith('</')) {
      while (stack.length > 1) {
        const closed = stack.pop();
        if (closed.tag === tag) break;
      }
      continue;
    }
    const parent = stack.at(-1);
    const node = { tag, text: '', children: [], parent };
    parent.children.push(node);
    if (!token.endsWith('/>')) stack.push(node);
  }
  return root;
}

function walk(node, output = []) {
  output.push(node);
  for (const child of node.children || []) walk(child, output);
  return output;
}

function inspectSiblingRelation(xml, anchorText, siblingText) {
  const nodes = walk(parseXmlTree(xml)).filter(node => node.tag === 'li');
  const anchors = nodes.filter(node => normalizeText(node.text) === anchorText);
  const siblings = nodes.filter(node => normalizeText(node.text) === siblingText);
  return canonicalize({
    siblingOccurrences: siblings.length,
    siblingRelationVerified: anchors.length === 1
      && siblings.length === 1
      && anchors[0].parent === siblings[0].parent,
  });
}

function countOccurrences(content, fragment) {
  if (!fragment) return 0;
  return String(content || '').split(fragment).length - 1;
}

function verifierMarkdownSnippets(markdown, leadingTitle) {
  return extractMarkdownCodeSnippets(markdown, { leadingTitle })
    .map(({ hash, index, language, section }) => ({ hash, index, language, section }));
}

function pathEndsWithSegments(observedPath, relativePath) {
  if (typeof observedPath !== 'string' || !relativePath) return false;
  const observed = path.normalize(observedPath).split(path.sep).filter(Boolean);
  const expected = path.normalize(relativePath).split(path.sep).filter(Boolean);
  return expected.length > 0
    && observed.length >= expected.length
    && expected.every((segment, index) => segment === observed[observed.length - expected.length + index]);
}

function verifierBindingChecks({ corpus, corpusRoot, plan, readback, verifierReport }) {
  const document = (corpus?.documents || []).find(item => item.id === 'verification-only');
  const creationAction = (plan?.creationBatch?.actions || [])
    .find(action => action.actionId === 'doc:create:verification-only');
  const expected = verifierMarkdownSnippets(
    readback.documents?.['verification-only']?.content || '',
    creationAction?.title,
  );
  const actual = Array.isArray(verifierReport?.results) ? verifierReport.results : [];
  const sourceFile = document?.file || '';
  const expectedPath = corpusRoot && sourceFile ? path.resolve(corpusRoot, sourceFile) : null;
  const expectedTitle = path.basename(sourceFile);
  const sameLength = actual.length === expected.length && expected.length > 0;
  const source = sameLength && actual.every(result => {
    const observedPath = result?.source?.path;
    const pathMatches = expectedPath
      ? typeof observedPath === 'string' && path.resolve(observedPath) === expectedPath
      : pathEndsWithSegments(observedPath, sourceFile);
    return result?.source?.type === 'markdown'
      && result?.source?.title === expectedTitle
      && pathMatches
      && result?.id === `${expectedTitle}:${result.index}`
      && result?.blockId === null;
  });
  const compare = (field, transform = value => value) => sameLength
    && actual.every((result, index) => transform(result?.[field]) === expected[index][field]);
  return {
    resultCount: sameLength,
    source,
    hash: compare('hash'),
    section: compare('section'),
    language: compare('language', normalizeCodeLanguage),
    execution: sameLength && actual.every(result => result?.verification?.status === 'passed'
      && result?.classification?.action === 'compile'
      && result?.verification?.harness?.strength === 'compile'),
  };
}

function verifierReportConsistency(verifierReport) {
  const results = Array.isArray(verifierReport?.results) ? verifierReport.results : [];
  const evidence = verifierReport?.contract?.evidence || {};
  const summary = verifierReport?.summary || {};
  const sourceKeys = new Set(results.map(result => JSON.stringify({
    id: result?.source?.id || null,
    path: result?.source?.path || null,
    title: result?.source?.title || null,
    type: result?.source?.type || null,
  })));
  const derived = {
    failed: results.filter(result => result?.verification?.status === 'failed').length,
    manualUncovered: results.filter(result => result?.verification?.status === 'manual'
      && result?.scenarioCoverage?.status !== 'passed').length,
    passed: results.filter(result => result?.verification?.status === 'passed').length,
    snippets: results.length,
    sources: sourceKeys.size,
  };
  const summaryValues = {
    failed: summary.failed,
    manualUncovered: summary.manualUncovered,
    passed: summary.passed,
    snippets: summary.filteredSnippets ?? summary.snippets,
    sources: summary.sources,
  };
  const contractEvidence = Object.entries(summaryValues)
    .every(([field, value]) => Number.isInteger(value) && evidence[field] === value);
  const resultTotals = Object.entries(derived).every(([field, value]) => summaryValues[field] === value
    && evidence[field] === value);
  return {
    contractEvidence,
    contractStatus: verifierReport?.contract?.status === 'VERIFIED'
      && verifierReport?.contract?.exitCode === 0,
    resultTotals,
  };
}

function diagnostic(code, target, details = {}) {
  return { code, target, ...details };
}

function expectedInventoryAction(plan, documentId) {
  return (plan?.patchBatch?.actions || []).find(action => action.actionId === `doc:patch:${documentId}`)
    || (plan?.creationBatch?.actions || []).find(action => action.actionId === `doc:create:${documentId}`)
    || null;
}

function validateContentInventory({ corpus, corpusRoot, current, documentId, plan }) {
  const observedInventory = inventoryMarkdown(current.content);
  const observedDigest = digestSemantic(observedInventory);
  const action = expectedInventoryAction(plan, documentId);
  const document = (corpus?.documents || []).find(item => item.id === documentId);
  const relativePath = action?.actionId?.startsWith('doc:patch:') ? document?.patchFile : document?.file;
  if (action?.expectedInventoryDigest) {
    if (corpusRoot && relativePath) {
      const expectedInventory = inventoryMarkdown(fs.readFileSync(path.join(corpusRoot, relativePath), 'utf8'));
      const expectedDigest = digestSemantic(expectedInventory);
      const comparison = compareMarkdownInventory(expectedInventory, observedInventory);
      return {
        diagnostic: expectedDigest === action.expectedInventoryDigest && comparison.ok
          ? null
          : diagnostic('SMOKE_ACCEPTANCE_CONTENT_INVENTORY_MISMATCH', documentId, {
            expectedInventoryDigest: action.expectedInventoryDigest,
            inventoryDigest: observedDigest,
          }),
        inventoryDigest: observedDigest,
      };
    }
    return {
      diagnostic: observedDigest === action.expectedInventoryDigest
        ? null
        : diagnostic('SMOKE_ACCEPTANCE_CONTENT_INVENTORY_MISMATCH', documentId, {
          expectedInventoryDigest: action.expectedInventoryDigest,
          inventoryDigest: observedDigest,
        }),
      inventoryDigest: observedDigest,
    };
  }
  return {
    diagnostic: diagnostic('SMOKE_ACCEPTANCE_EXPECTED_INVENTORY_MISSING', documentId, {
      inventoryDigest: observedDigest,
    }),
    inventoryDigest: observedDigest,
  };
}

function verifiedJournalActions(batch, entries, diagnostics, target) {
  if (!batch || !Array.isArray(entries)) {
    diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_JOURNAL_MISSING', target));
    return new Set();
  }
  if (entries.some(entry => entry.batchDigest !== batch.batchDigest)) {
    diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_JOURNAL_DIGEST_MISMATCH', target));
  }
  if (!entries.some(entry => entry.type === 'completion' && entry.completionSentinel === true)) {
    diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_JOURNAL_INCOMPLETE', target));
  }
  const verified = new Set(entries
    .filter(entry => entry.type === 'observed' && entry.status === 'success' && entry.verified === true)
    .map(entry => entry.actionId));
  for (const action of batch.actions || []) {
    if (!verified.has(action.actionId)) {
      diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_ACTION_UNVERIFIED', action.actionId));
    }
  }
  return verified;
}

function contentChecks(skill, corpus, corpusRoot, plan, readback, patchActionIds, verifierReport, diagnostics) {
  const content = id => readback.documents?.[id]?.content || '';
  if (skill === 'api-reference-sync') {
    const value = content('api-reference-roundtrip');
    const contract = (corpus?.documents || []).find(document => document.id === 'api-reference-roundtrip')?.expected || {};
    const checks = {
      codePatchPresent: value.includes('ids.push_back(4);'),
      forbiddenFragmentsAbsent: (contract.forbiddenFragments || []).every(fragment => !value.includes(fragment)),
      linkPreserved: value.includes('[Milvus API reference](https://milvus.io/docs)'),
      requiredFragmentsPreserved: (contract.requiredFragments || []).every(fragment => value.includes(fragment)),
      siblingOccurrences: readback.documents?.['api-reference-roundtrip']?.siblingOccurrences ?? 0,
      siblingRelationVerified: readback.documents?.['api-reference-roundtrip']?.siblingRelationVerified === true,
    };
    for (const [name, ok] of Object.entries(checks)) {
      if ((name === 'siblingOccurrences' && ok !== 1) || (name !== 'siblingOccurrences' && ok !== true)) {
        diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_API_INVARIANT_FAILED', 'api-reference-roundtrip', { check: name }));
      }
    }
    return checks;
  }
  if (skill === 'procedure-code-sync') {
    const value = content('procedure-language-sync');
    const pythonIndex = value.indexOf('### Python');
    const javaIndex = value.indexOf('### Java');
    const checks = {
      canonicalLanguageOrderVerified: pythonIndex >= 0 && javaIndex > pythonIndex
        && countOccurrences(value, '### Python') === 1 && countOccurrences(value, '### Java') === 1,
      javaExampleInserted: value.includes('MilvusClientV2 client = new MilvusClientV2')
        && value.includes('client.createCollection(CreateCollectionReq.builder()'),
      pythonWorkflowPreserved: value.includes('# include-start milvus')
        && value.includes('client.create_collection(collection_name="doc_ops_smoke", dimension=8)'),
      unrelatedProsePreserved: value.includes('Unrelated prose must remain byte-for-byte equivalent after a scoped language patch.'),
    };
    for (const [name, ok] of Object.entries(checks)) {
      if (!ok) diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_PROCEDURE_INVARIANT_FAILED', 'procedure-language-sync', { check: name }));
    }
    return checks;
  }
  if (skill === 'localized-doc-sync') {
    const source = content('localized-source-en');
    const target = content('localized-target-zh');
    const checks = {
      protectedCodePreserved: source.includes('await client.createCollection({')
        && target.includes('await client.createCollection({')
        && source.includes('collection_name: "doc_ops_smoke"')
        && target.includes('collection_name: "doc_ops_smoke"'),
      sourceReadOnlyVerified: !patchActionIds.has('doc:patch:localized-source-en')
        && !source.includes('该页面只属于隔离的 smoke tenant'),
      sourceTextPreserved: source.includes('Create a collection with a fixed dimension and a synthetic test name.'),
      targetPatchVerified: target.includes('该页面只属于隔离的 smoke tenant。'),
    };
    for (const [name, ok] of Object.entries(checks)) {
      if (!ok) diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_LOCALIZATION_INVARIANT_FAILED', 'source-target-localization', { check: name }));
    }
    return checks;
  }
  if (skill === 'verified-doc-authoring') {
    const value = content('source-verified-authoring');
    const checks = {
      unresolvedClaimRemainsVisible: value.includes('| The default metric is stable | No canonical evidence in this fixture | Unresolved |'),
      unresolvedNotPromotedToFact: value.includes('remains explicitly unresolved and is not promoted into factual prose.')
        && !value.includes('UNVERIFIED_AS_FACT'),
      verifiedClaimPreserved: value.includes('| The request accepts `dimension` |') && value.includes('| Verified |'),
    };
    for (const [name, ok] of Object.entries(checks)) {
      if (!ok) diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_AUTHORING_INVARIANT_FAILED', 'source-verified-authoring', { check: name }));
    }
    return checks;
  }
  const contractValidation = validateResult(verifierReport?.contract || {});
  const liveActionsPerformed = verifierReport?.liveVerification?.enabledThisRun === true;
  const summary = verifierReport?.summary || {};
  const binding = verifierBindingChecks({ corpus, corpusRoot, plan, readback, verifierReport });
  const reportConsistency = verifierReportConsistency(verifierReport);
  const reportConsistent = Object.values(reportConsistency).every(Boolean);
  const checks = {
    binding,
    contractValid: contractValidation.valid,
    liveActionsPerformed,
    readOnlyVerified: !patchActionIds.has('doc:patch:verification-only') && !liveActionsPerformed,
    reportConsistency,
    reportConsistent,
    strongestSafeCheckPassed: summary.snippets === 1 && summary.passed === 1 && summary.failed === 0
      && Object.values(binding).every(Boolean) && reportConsistent,
    unattendedGapsAbsent: summary.manual === 0 && summary.skipped === 0,
  };
  if (!checks.contractValid) diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_VERIFIER_CONTRACT_INVALID', 'doc-code-verify'));
  if (checks.liveActionsPerformed) diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_VERIFIER_LIVE_ACTION', 'doc-code-verify'));
  for (const [name, ok] of Object.entries(reportConsistency)) {
    if (!ok) diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_VERIFIER_REPORT_MISMATCH', 'doc-code-verify', { check: name }));
  }
  for (const [name, ok] of Object.entries(binding)) {
    if (!ok) diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_VERIFIER_BINDING_MISMATCH', 'doc-code-verify', { check: name }));
  }
  for (const name of ['readOnlyVerified', 'strongestSafeCheckPassed', 'unattendedGapsAbsent']) {
    if (!checks[name]) diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_VERIFIER_INVARIANT_FAILED', 'doc-code-verify', { check: name }));
  }
  return checks;
}

function buildSkillAcceptanceArtifacts({
  corpus,
  corpusRoot,
  creationJournalEntries,
  patchJournalEntries,
  plan,
  readback,
  runDir,
  state,
  verifierReport,
}) {
  const sharedDiagnostics = [];
  if (state?.runId !== plan?.runId || state?.profile !== plan?.profile || state?.tenantMarker !== plan?.tenantMarker) {
    sharedDiagnostics.push(diagnostic('SMOKE_ACCEPTANCE_STATE_MISMATCH', 'run'));
  }
  if (readback?.canaryFolderVerified !== true) {
    sharedDiagnostics.push(diagnostic('SMOKE_ACCEPTANCE_CANARY_FOLDER_INVALID', 'run'));
  }
  const creationActions = verifiedJournalActions(
    plan?.creationBatch,
    creationJournalEntries,
    sharedDiagnostics,
    'creation',
  );
  const patchActions = verifiedJournalActions(
    plan?.patchBatch,
    patchJournalEntries,
    sharedDiagnostics,
    'patch',
  );
  const scenarioBySkill = new Map((corpus?.scenarios || []).map(scenario => [scenario.skill, scenario]));
  const artifacts = {};
  for (const skill of CANONICAL_SKILLS) {
    const diagnostics = [...sharedDiagnostics];
    const scenario = scenarioBySkill.get(skill);
    if (!scenario) diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_SCENARIO_MISSING', skill));
    const documentEvidence = [];
    for (const documentId of scenario?.documentIds || []) {
      const current = readback?.documents?.[documentId];
      const recorded = state?.documents?.[documentId];
      if (!current || !recorded) {
        diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_DOCUMENT_EVIDENCE_MISSING', documentId));
        continue;
      }
      if (current.contentDigest !== recorded.contentDigest) {
        diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_CONTENT_DRIFT', documentId));
      }
      const inventoryValidation = validateContentInventory({
        corpus,
        corpusRoot,
        current,
        documentId,
        plan,
      });
      if (inventoryValidation.diagnostic) diagnostics.push(inventoryValidation.diagnostic);
      if (!current.parentVerified) diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_PARENT_MISMATCH', documentId));
      if (!current.recordBindingVerified) diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_RECORD_BINDING_MISMATCH', documentId));
      if (!creationActions.has(`doc:create:${documentId}`)
        || !creationActions.has(`record:create:${documentId}`)) {
        diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_CREATION_LINEAGE_MISSING', documentId));
      }
      documentEvidence.push({
        contentDigest: current.contentDigest,
        id: documentId,
        inventoryDigest: inventoryValidation.inventoryDigest,
        parentVerified: current.parentVerified === true,
        recordBindingVerified: current.recordBindingVerified === true,
      });
    }
    const checks = contentChecks(skill, corpus, corpusRoot, plan, readback, patchActions, verifierReport, diagnostics);
    const expectedPatchIds = new Set((plan?.patchBatch?.actions || [])
      .filter(action => scenario?.documentIds?.some(id => action.actionId === `doc:patch:${id}`))
      .map(action => action.actionId));
    for (const actionId of expectedPatchIds) {
      if (!patchActions.has(actionId)) diagnostics.push(diagnostic('SMOKE_ACCEPTANCE_PATCH_LINEAGE_MISSING', actionId));
    }
    const artifactPath = path.join(runDir, 'artifacts', 'skill-acceptance', `${skill}.json`);
    artifacts[skill] = createResult({
      skill,
      operation: 'smoke-acceptance',
      status: diagnostics.length === 0 ? 'VERIFIED' : 'FAILED',
      artifactPaths: skill === 'doc-code-verify'
        ? [artifactPath, ...(verifierReport?.contract?.artifactPaths || [])]
        : [artifactPath],
      diagnostics,
      evidence: {
        acceptanceLiveWritesPerformed: false,
        capabilityIds: CAPABILITY_IDS[skill],
        checks,
        corpusId: corpus?.corpusId,
        documents: documentEvidence,
        journal: {
          creationBatchDigest: plan?.creationBatch?.batchDigest || null,
          patchBatchDigest: plan?.patchBatch?.batchDigest || null,
        },
        runId: plan?.runId,
        scenarioId: scenario?.id || null,
        ...(skill === 'doc-code-verify' ? {
          verifierSemanticDigest: verifierReport?.contract?.semanticDigest || null,
        } : {}),
      },
    });
  }
  return canonicalize(artifacts);
}

async function collectAcceptanceReadback({ adapter, corpus, plan, state }) {
  await adapter.verifyIdentity({ plan, state });
  const listed = await adapter.listCanaryDocuments({ corpus, plan, state });
  const expectedIds = [...(corpus?.documents || [])].map(document => document.id).sort();
  const listedIds = [...listed].map(item => item.id).sort();
  const documents = {};
  for (const documentId of expectedIds) {
    const fetched = await adapter.fetchSyntheticDocument(documentId, { corpus, plan, state });
    const recordBindingVerified = await adapter.verifySyntheticRecordBinding(documentId, { corpus, plan, state });
    const structure = documentId === 'api-reference-roundtrip'
      ? await adapter.inspectApiSiblingRelation(documentId, { corpus, plan, state })
      : {};
    documents[documentId] = {
      content: fetched.content,
      contentDigest: fetched.contentDigest || digestSemantic(fetched.content),
      inventoryDigest: fetched.inventoryDigest || digestSemantic(inventoryMarkdown(fetched.content)),
      parentVerified: fetched.parentVerified === true,
      recordBindingVerified: recordBindingVerified === true,
      ...structure,
    };
  }
  return canonicalize({
    canaryFolderVerified: expectedIds.length === listedIds.length
      && expectedIds.every((id, index) => id === listedIds[index]),
    documents,
  });
}

function readJournal(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

async function runSmokeAcceptance({ corpus, corpusRoot, plan, runDir, adapter }) {
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));
  const creationJournalEntries = readJournal(path.join(runDir, 'create.journal.jsonl'));
  const patchJournalEntries = readJournal(path.join(runDir, 'patch.journal.jsonl'));
  const verifierReport = JSON.parse(fs.readFileSync(path.join(runDir, 'artifacts', 'doc-code-verify.json'), 'utf8'));
  const readback = await collectAcceptanceReadback({ adapter, corpus, plan, state });
  const artifacts = buildSkillAcceptanceArtifacts({
    corpus,
    corpusRoot,
    creationJournalEntries,
    patchJournalEntries,
    plan,
    readback,
    runDir: path.relative(process.cwd(), runDir) || '.',
    state,
    verifierReport,
  });
  const artifactDir = path.join(runDir, 'artifacts', 'skill-acceptance');
  fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
  const summaries = [];
  for (const skill of CANONICAL_SKILLS) {
    const filePath = path.join(artifactDir, `${skill}.json`);
    fs.writeFileSync(filePath, canonicalStringify(artifacts[skill]), { mode: 0o600 });
    fs.chmodSync(filePath, 0o600);
    summaries.push({
      artifactPath: path.relative(process.cwd(), filePath),
      semanticDigest: artifacts[skill].semanticDigest,
      skill,
      status: artifacts[skill].status,
    });
  }
  const status = summaries.every(item => item.status === 'VERIFIED') ? 'VERIFIED' : 'FAILED';
  const index = canonicalize({
    artifacts: summaries,
    liveWritesPerformed: false,
    runId: plan.runId,
    status,
  });
  const indexPath = path.join(artifactDir, 'index.json');
  fs.writeFileSync(indexPath, canonicalStringify(index), { mode: 0o600 });
  fs.chmodSync(indexPath, 0o600);
  return index;
}

module.exports = {
  CANONICAL_SKILLS,
  buildSkillAcceptanceArtifacts,
  collectAcceptanceReadback,
  inspectSiblingRelation,
  runSmokeAcceptance,
};
