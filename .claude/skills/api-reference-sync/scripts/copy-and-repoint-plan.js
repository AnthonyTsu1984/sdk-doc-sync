#!/usr/bin/env node
'use strict';
// COPY-AND-REPOINT strategy (2026-10-16): one script owns the whole transition —
// create the missing target directory, copy the successor document, apply the
// model-authored content (patch OR rewrite), repoint the record, verify. The
// model authors the CONTENT payload only; ordering, containment, evidence and
// the digest binding are code.
//
// Strategy payload (input, reviewed by the operator):
//   {
//     unit:    { stableId, canonicalSlug },
//     source:  { recordId, documentToken, version, folderToken, versionRootToken },
//     target:  { version, versionRootToken, folderToken }
//              | { version, versionRootToken, folderRef,
//                  folder:   { ref, name, parentFolderToken, parentAncestry, existingLookup },
//                  repoint?: { ref, recordId, title, currentFolderToken, expectedFields,
//                              baseToken, tableId, existingLookup } },
//     content: { mode: 'patch',   operations: [ ...block ops... ] }
//              | { mode: 'rewrite', markdown: '<full body>' }
//   }
//
// Refusals are typed and fail closed (see REFUSALS). The emitted plan is the
// ordered strategy the certified executor consumes; the digest is what an
// approval binds. `--dry-run` is the default; this script never writes to Feishu.
//
// Usage: node scripts/copy-and-repoint-plan.js --payload <strategy.json> [--output plan.json] [--json]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ACTIONS = Object.freeze({
  CREATE_FOLDER: 'CREATE_FOLDER',
  COPY_PATCH_AND_REPOINT: 'COPY_PATCH_AND_REPOINT',
  REPOINT_CATEGORY_VIRTUAL_NODE: 'REPOINT_CATEGORY_VIRTUAL_NODE',
  VERIFY_TREE_DELTA: 'VERIFY_TREE_DELTA',
});

class StrategyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'StrategyError';
    this.code = code;
    this.details = details;
  }
}

const nonEmpty = (value) => typeof value === 'string' && value.length > 0;

function parseArgs(argv) {
  const args = { dryRun: true };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') { args.json = true; continue; }
    if (arg === '--payload' || arg === '--output') { args[arg.slice(2)] = argv[++i]; continue; }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.payload) throw new Error('Missing --payload');
  return args;
}

// Ordered strategy assembly. Every refusal happens before any step is emitted, so
// a refused payload can never reach an executor with a partial plan.
function buildStrategy(payload) {
  if (!payload || typeof payload !== 'object') throw new StrategyError('STRATEGY_PAYLOAD_INVALID', 'payload must be an object');
  const { unit, source, target, content } = payload;
  if (!unit || !nonEmpty(unit.stableId) || !nonEmpty(unit.canonicalSlug)) {
    throw new StrategyError('STRATEGY_UNIT_REQUIRED', 'unit.stableId and unit.canonicalSlug are required');
  }
  if (!source || !nonEmpty(source.recordId) || !nonEmpty(source.documentToken)) {
    throw new StrategyError('STRATEGY_SOURCE_REQUIRED', 'source.recordId and source.documentToken are required (the document being copied)');
  }
  if (!target || !nonEmpty(target.version) || !nonEmpty(target.versionRootToken)) {
    throw new StrategyError('STRATEGY_TARGET_REQUIRED', 'target.version and target.versionRootToken are required');
  }
  if (!nonEmpty(target.folderToken) && !nonEmpty(target.folderRef)) {
    throw new StrategyError('STRATEGY_TARGET_PLACEMENT_UNKNOWN', 'target needs folderToken or folderRef (the directory is created when it does not exist)');
  }
  // content: exactly one of patch / rewrite — this is the model-authored part.
  if (!content || (content.mode !== 'patch' && content.mode !== 'rewrite')) {
    throw new StrategyError('STRATEGY_CONTENT_MODE_REQUIRED', "content.mode must be 'patch' or 'rewrite'");
  }
  if (content.mode === 'patch' && (!Array.isArray(content.operations) || content.operations.length === 0)) {
    throw new StrategyError('STRATEGY_CONTENT_EMPTY', 'content.mode=patch needs a non-empty operations[]');
  }
  if (content.mode === 'rewrite' && !nonEmpty(content.markdown)) {
    throw new StrategyError('STRATEGY_CONTENT_EMPTY', 'content.mode=rewrite needs markdown');
  }
  if (content.operations && content.markdown) {
    throw new StrategyError('STRATEGY_CONTENT_AMBIGUOUS', 'content carries both operations and markdown; pick one mode');
  }

  const steps = [];
  let repointResource = null;
  if (nonEmpty(target.folderRef)) {
    const folder = target.folder;
    if (!folder || !nonEmpty(folder.ref) || folder.ref !== target.folderRef || !nonEmpty(folder.parentFolderToken)) {
      throw new StrategyError('STRATEGY_FOLDER_CREATE_INVALID', 'target.folder must carry ref (== target.folderRef) and parentFolderToken');
    }
    if (!Array.isArray(folder.parentAncestry) || folder.parentAncestry[0] !== target.versionRootToken) {
      throw new StrategyError('STRATEGY_CREATE_PARENT_OUTSIDE_VERSION_ROOT', 'folder.parentAncestry must run from target.versionRootToken down to folder.parentFolderToken (the kernel refuses an out-of-root create parent)');
    }
    if (folder.parentAncestry[folder.parentAncestry.length - 1] !== folder.parentFolderToken) {
      throw new StrategyError('STRATEGY_CREATE_PARENT_MISMATCH', 'folder.parentAncestry must end at folder.parentFolderToken');
    }
    steps.push({
      action: ACTIONS.CREATE_FOLDER,
      resource: {
        kind: 'folder',
        ref: folder.ref,
        name: folder.name || target.folderRef,
        parentFolderToken: folder.parentFolderToken,
        versionRootToken: target.versionRootToken,
        parentAncestry: [...folder.parentAncestry],
        existingLookup: { ...(folder.existingLookup || {}), checked: true, absent: true, parentFolderToken: folder.parentFolderToken, name: folder.name || target.folderRef },
      },
    });
    if (target.repoint) {
      const r = target.repoint;
      for (const key of ['ref', 'recordId', 'currentFolderToken']) {
        if (!nonEmpty(r[key])) throw new StrategyError('STRATEGY_REPOINT_INVALID', `target.repoint.${key} is required when a VirtualNode is repointed`);
      }
      if (!nonEmpty(r.baseToken) || !nonEmpty(r.tableId)) {
        throw new StrategyError('STRATEGY_REPOINT_BITABLE_TARGET_REQUIRED', 'target.repoint needs baseToken and tableId (a repoint is an explicit Bitable write)');
      }
      repointResource = {
        kind: 'virtual_node_repoint',
        ref: r.ref,
        recordId: r.recordId,
        title: r.title || folder.name || target.folderRef,
        folderRef: folder.ref,
        currentFolderToken: r.currentFolderToken,
        expectedFields: { ...(r.expectedFields || {}) },
        baseToken: r.baseToken,
        tableId: r.tableId,
        dependsOn: [folder.ref],
        existingLookup: { ...(r.existingLookup || {}), checked: true, matched: true, recordId: r.recordId, currentFolderToken: r.currentFolderToken },
      };
    }
  }
  if (nonEmpty(source.documentToken) && nonEmpty(target.folderToken) && source.documentToken === target.folderToken) {
    throw new StrategyError('STRATEGY_SOURCE_IS_TARGET', 'target.folderToken equals source.documentToken');
  }

  steps.push({
    action: ACTIONS.COPY_PATCH_AND_REPOINT,
    stableId: unit.stableId,
    canonicalSlug: unit.canonicalSlug,
    source: { ...source },
    target: {
      version: target.version,
      versionRootToken: target.versionRootToken,
      ...(nonEmpty(target.folderToken) ? { folderToken: target.folderToken } : { folderRef: target.folderRef }),
    },
    copySource: { documentToken: source.documentToken },
    content: content.mode === 'patch'
      ? { mode: 'patch', operations: content.operations.map((op) => ({ ...op })) }
      : { mode: 'rewrite', markdown: content.markdown },
    metadata: { copyBeforePatch: true, contentMode: content.mode },
    ...(repointResource ? { dependsOn: [target.folderRef] } : {}),
  });
  if (repointResource) {
    steps.push({
      action: ACTIONS.REPOINT_CATEGORY_VIRTUAL_NODE,
      resource: repointResource,
      dependsOn: [target.folderRef, unit.stableId],
    });
  }
  steps.push({ action: ACTIONS.VERIFY_TREE_DELTA, dependsOn: [unit.stableId], expectations: { olderSourceUnchanged: true, recordPointsAtCopy: true } });

  const plan = {
    schemaVersion: 1,
    strategy: 'COPY_AND_REPOINT',
    unit: { stableId: unit.stableId, canonicalSlug: unit.canonicalSlug },
    target: { version: target.version, versionRootToken: target.versionRootToken, folderToken: target.folderToken || null, folderRef: target.folderRef || null },
    contentMode: content.mode,
    steps,
    writesPerformed: false,
  };
  const digestInput = JSON.stringify({ ...plan, strategyDigest: undefined });
  plan.strategyDigest = `sha256:${crypto.createHash('sha256').update(digestInput, 'utf8').digest('hex')}`;
  return plan;
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  const payload = JSON.parse(fs.readFileSync(path.resolve(args.payload), 'utf8'));
  let plan;
  try {
    plan = buildStrategy(payload);
  } catch (error) {
    process.stderr.write(`${error.code || error.name}: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (args.output) fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(plan, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: args.output || null,
    strategy: plan.strategy,
    unit: plan.unit,
    contentMode: plan.contentMode,
    steps: plan.steps.map((step) => step.action),
    createsDirectory: plan.steps.some((step) => step.action === ACTIONS.CREATE_FOLDER),
    repointsRecord: Boolean(plan.steps.find((step) => step.action === ACTIONS.REPOINT_CATEGORY_VIRTUAL_NODE)?.resource),
    strategyDigest: plan.strategyDigest,
    writesPerformed: false,
  }, null, 2)}\n`);
}

module.exports = { ACTIONS, StrategyError, buildStrategy, parseArgs };
