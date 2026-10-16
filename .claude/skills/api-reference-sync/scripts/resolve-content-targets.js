#!/usr/bin/env node
'use strict';
// Content-wave target-directory resolution — the rule, as code
// (2026-10-16 operator ruling; batch-15 canonical chain).
//
// R1  OUR STRUCTURE GOVERNS. A unit's target directory is the one this track's
//     tree assigns to its family, never the layout upstream happens to use:
//       (a) the live parent folder, when the document already lives in this track
//           (in-place: a wave never proposes a move for such a page);
//       (b) otherwise a reviewed category-create entry — the new directory is
//           created in THIS track and the record repointed to it;
//       (c) otherwise the walk folder named after the unit family, when this track
//           has one (the copy lands beside its family);
//       (d) otherwise the landing-page folder of the family in this track;
//       (e) otherwise the unit is BLOCKED with a typed reason (never a silent
//           fallback to the inherited pointer).
// R2  AN INHERITED POINTER IS NORMAL (sparse-delta model). A record whose
//     document/folder lives in another version's tree is a lawful SOURCE and the
//     expected state of an unchanged entry; it is never a copy destination and a
//     content wave never rewrites it. Only the successor-side copy (R1's outcome)
//     lands in this track.
// R3  KERNEL CONTAINMENT. A create whose parent folder lies outside the version
//     root is refused by versioned-tree-policy
//     (TREE_DELTA_TARGET_OUTSIDE_VERSION_ROOT), so such families are reported as
//     blocked with their live-row count — normalising them means moving the whole
//     branch, not repointing the few pages a wave touches.
//
// Read-only apart from its own outputs; --write-decisions rewrites the target
// folders in the decisions file it was given (the review artifact), and says so.
//
// Usage:
//   node resolve-content-targets.js --language python --track v3.0.x \
//     --walk <walk.json> --snapshot <snapshot.json> --decisions <decisions.json> \
//     [--category-creates <plan.json>] --output <targets.json> [--write-decisions]
const fs = require('node:fs');
const path = require('node:path');

const BINDINGS = Object.freeze({
  IN_TRACK: 'in-track',
  INHERITED: 'inherited',
});
const RULES = Object.freeze({
  LIVE_PARENT_FOLDER: 'R1a document already in this track (in-place, never moved)',
  CATEGORY_CREATE: 'R1b reviewed category create in this track',
  FAMILY_FOLDER: 'R1c family folder in this track (copy lands beside its family)',
  FAMILY_LANDING_FOLDER: 'R1d family landing page folder in this track',
  BLOCKED: 'R1e unresolved',
});

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { args._.push(arg); continue; }
    if (arg === '--write-decisions') { args.writeDecisions = true; continue; }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    args[arg.replace(/^--/, '').replace(/-([a-z])/g, (_, l) => l.toUpperCase())] = value;
    i += 1;
  }
  for (const key of ['language', 'track', 'walk', 'snapshot', 'decisions', 'output']) {
    if (!args[key]) throw new Error(`Missing --${key}`);
  }
  return args;
}

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function resolveTargets({ walk, snapshot, decisions, categoryCreates = null, track }) {
  const nodes = walk.nodes || [];
  const byToken = new Map(nodes.map((node) => [node.token, node]));
  const folderTokens = new Set(nodes.filter((node) => node.type === 'folder').map((node) => node.token));
  const folderByName = new Map(nodes.filter((node) => node.type === 'folder').map((node) => [node.name, node.token]));
  const chainTo = (token) => {
    if (!folderTokens.has(token)) return null;
    const chain = [];
    let cur = token;
    let guard = 0;
    while (cur && guard++ < 12) {
      chain.unshift(cur);
      if (cur === walk.rootToken) return chain;
      cur = (byToken.get(cur) || {}).parentFolderToken;
    }
    return null;
  };
  const createByCategory = new Map();
  for (const entry of (categoryCreates && categoryCreates.tracks && categoryCreates.tracks[track]
    ? categoryCreates.tracks[track].categories : []) || []) {
    createByCategory.set(entry.category, entry);
  }
  const landingFolderOf = (slug) => {
    const family = String(slug || '').startsWith('MilvusClient-') ? slug.slice('MilvusClient-'.length) : null;
    if (!family) return null;
    const row = (snapshot.rows || []).find((r) => (r.slug || '') === `MilvusClient-${family}`);
    if (!row) return null;
    const docToken = (String(row.docLink || '').match(/\/(?:docx|folder)\/([A-Za-z0-9]+)\s*$/) || [])[1] || null;
    const node = docToken ? byToken.get(docToken) : null;
    return node && folderTokens.has(node.parentFolderToken) ? node.parentFolderToken : null;
  };

  const rows = [];
  const createNeeded = [];
  const blocked = [];
  for (const unit of decisions.units) {
    const identity = unit.decision.docIdentity;
    const existing = unit.decision.existingBitable || {};
    const family = identity.category;
    const slugFamily = String(identity.canonicalSlug || '').startsWith('MilvusClient-')
      ? String(identity.canonicalSlug).slice('MilvusClient-'.length)
      : null;
    const docToken = existing.currentDocumentToken || null;
    const docNode = docToken ? byToken.get(docToken) : null;
    const inTrack = Boolean(docNode && folderTokens.has(docNode.parentFolderToken));
    const createEntry = createByCategory.get(family) || (slugFamily ? createByCategory.get(slugFamily) : null);

    let targetFolderToken = null;
    let folderRef = null;
    let rule = null;
    if (inTrack) {
      // A document that already lives in this track is updated where it is:
      // a wave never proposes a move for it.
      targetFolderToken = docNode.parentFolderToken;
      rule = RULES.LIVE_PARENT_FOLDER;
    } else if (createEntry) {
      folderRef = createEntry.folder.ref;
      rule = RULES.CATEGORY_CREATE;
    } else if (folderByName.has(family)) {
      targetFolderToken = folderByName.get(family);
      rule = RULES.FAMILY_FOLDER;
    } else {
      const landing = landingFolderOf(identity.canonicalSlug);
      if (landing) {
        targetFolderToken = landing;
        rule = RULES.FAMILY_LANDING_FOLDER;
      }
    }
    const binding = inTrack ? BINDINGS.IN_TRACK : BINDINGS.INHERITED;
    // R3 applies to every resolved candidate, not only to creates: a family
    // folder outside the version root (the ORM branch case) is not a lawful
    // target, so the unit is blocked rather than bound to it.
    if (targetFolderToken && !chainTo(targetFolderToken)) {
      blocked.push({
        stableId: unit.sourceStableId,
        canonicalSlug: identity.canonicalSlug,
        category: family,
        binding,
        candidateFolderToken: targetFolderToken,
        reason: 'TREE_DELTA_TARGET_OUTSIDE_VERSION_ROOT: the family folder is not under the track version root',
      });
      targetFolderToken = null;
      rule = RULES.BLOCKED;
    }
    if (!targetFolderToken && !folderRef) {
      rule = RULES.BLOCKED;
      if (!blocked.some((entry) => entry.stableId === unit.sourceStableId)) {
        blocked.push({
          stableId: unit.sourceStableId,
          canonicalSlug: identity.canonicalSlug,
          category: family,
          binding,
          reason: 'no folder in this track, no in-track document, no landing folder, and no reviewed category create',
        });
      }
    }
    if (folderRef && createEntry) {
      if (!createNeeded.some((c) => c.category === createEntry.category)) {
        createNeeded.push({
          category: createEntry.category,
          folderRef,
          parentFolderToken: createEntry.folder.parentFolderToken,
          parentAncestry: createEntry.folder.parentAncestry,
          repointRecordId: createEntry.repoint ? createEntry.repoint.recordId : null,
        });
      }
      const chain = createEntry.folder.parentAncestry || null;
      if (!Array.isArray(chain) || chain[0] !== walk.rootToken) {
        blocked.push({
          stableId: unit.sourceStableId,
          canonicalSlug: identity.canonicalSlug,
          category: family,
          binding,
          reason: 'TREE_DELTA_TARGET_OUTSIDE_VERSION_ROOT: the create parent is not under the track version root',
        });
      }
    }
    const chain = targetFolderToken ? chainTo(targetFolderToken) : null;
    rows.push({
      stableId: unit.sourceStableId,
      canonicalSlug: identity.canonicalSlug,
      category: family,
      binding,
      rule,
      targetFolderToken,
      folderRef,
      targetFolderPath: chain ? chain.map((token) => (byToken.get(token) || {}).name || token).join(' > ') : null,
      sourceFolderToken: docNode ? docNode.parentFolderToken : null,
      sourceIsOtherVersion: !inTrack && Boolean(docToken),
      documentToken: docToken,
    });
  }
  return {
    track,
    versionRootToken: walk.rootToken,
    rules: RULES,
    units: rows.length,
    inTrack: rows.filter((r) => r.binding === BINDINGS.IN_TRACK).length,
    inherited: rows.filter((r) => r.binding === BINDINGS.INHERITED).length,
    createNeeded,
    blocked,
    rows,
  };
}

function applyToDecisions(decisions, resolution) {
  const byStableId = new Map(resolution.rows.map((row) => [row.stableId, row]));
  let changed = 0;
  for (const unit of decisions.units) {
    const row = byStableId.get(unit.sourceStableId);
    if (!row) continue;
    const previous = unit.decision.docIdentity.targetFolderToken || null;
    const next = row.targetFolderToken || null;
    unit.decision.docIdentity.targetFolderToken = next;
    if (row.folderRef) {
      unit.decision.docIdentity.targetFolderRef = row.folderRef;
      unit.decision.docIdentity.targetFolderStatus = 'to-create (category-create plan)';
    } else {
      delete unit.decision.docIdentity.targetFolderRef;
      unit.decision.docIdentity.targetFolderStatus = next ? 'existing' : 'unresolved (no in-track folder and no create contract)';
    }
    unit.decision.docIdentity.targetFolderPath = row.targetFolderPath ? `${row.track} > ${row.targetFolderPath}` : `${row.track} > (unresolved)`;
    unit.decision.docIdentity.binding = row.binding;
    unit.decision.docIdentity.targetRule = row.rule;
    if (next !== previous) changed += 1;
  }
  decisions.notes.push(
    `Target-directory resolution (resolve-content-targets.js): ${resolution.inTrack} in-track binding(s), ${resolution.inherited} inherited binding(s) (normal sparse-delta state, never a copy destination), ${resolution.createNeeded.length} directory create(s) in this track (${resolution.createNeeded.map((c) => c.category).join(', ') || 'none'}), ${resolution.blocked.length} blocked unit(s). ${changed} target token(s) changed in this rewrite.`,
  );
  return changed;
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  const walk = read(args.walk);
  const snapshot = read(args.snapshot);
  const decisions = read(args.decisions);
  const categoryCreates = args.categoryCreates ? read(args.categoryCreates) : null;
  if (walk.nodes.length === 0) throw new Error('walk has no nodes');
  const resolution = resolveTargets({ walk, snapshot, decisions, categoryCreates, track: args.track });
  if (args.writeDecisions) {
    const changed = applyToDecisions(decisions, resolution);
    fs.writeFileSync(args.decisions, `${JSON.stringify(decisions, null, 2)}\n`);
    process.stderr.write(`rewrote ${changed} target token(s) in ${args.decisions}\n`);
  }
  fs.writeFileSync(args.output, `${JSON.stringify({ schemaVersion: 1, language: args.language, ...resolution, writesPerformed: false }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    output: args.output,
    track: args.track,
    units: resolution.units,
    inTrack: resolution.inTrack,
    inherited: resolution.inherited,
    createNeeded: resolution.createNeeded.map((c) => c.category),
    blocked: resolution.blocked.length,
  }, null, 2)}\n`);
}

module.exports = { BINDINGS, RULES, parseArgs, resolveTargets, applyToDecisions };
