'use strict';

// derive orchestrator: compile one rust track from base@SHA + overlay tree.
// Deterministic by construction — no timestamps, no environment leakage; the
// same (base sha, overlay tree) pair always yields byte-identical artifacts.
// Read-only: never writes Feishu; the artifact feeds the canonical candidate
// pipeline at the first campaign (rust-overlay-pilot 批3 item 16).

const path = require('node:path');
const fs = require('node:fs');

const { loadOverlayTree } = require('./overlay-schema');
const { listBasePages, readBasePage } = require('./base-loader');
const { applyRules } = require('./rules-applier');
const { applyPatches, detectPageKind, digest, AnchorError } = require('./overlay-applier');
const { gateTargets } = require('./targets-gate');
const { diffPageDigests } = require('./diff-producer');

function pageIdentityFor(basePage, overlayPageIdentity) {
  return overlayPageIdentity || basePage.identity;
}

// Layer order (§2.6): base -> rules (deterministic) -> polish (passthrough in
// the pilot) -> patches (deterministic).
function compileTrack({ webContentDir, sdkName, track, baseSha, overlayDir, previousArtifact }) {
  const overlay = loadOverlayTree(overlayDir);
  if (!overlay.ok) return { ok: false, kind: 'schema', errors: overlay.errors };
  const tree = overlay.tree;
  if (tree.language !== 'rust') return { ok: false, kind: 'schema', errors: [{ code: 'OVERLAY_SCHEMA_VIOLATION', path: 'manifest.json.language', message: `expected rust, got ${tree.language}` }] };
  if (tree.track !== track) return { ok: false, kind: 'schema', errors: [{ code: 'OVERLAY_SCHEMA_VIOLATION', path: 'manifest.json.track', message: `expected ${track}, got ${tree.track}` }] };

  const basePages = listBasePages({ webContentDir, sdkName, track, sha: baseSha });
  const patchIndex = new Map();
  for (const patch of tree.patches) {
    patchIndex.set(patch.page, [...(patchIndex.get(patch.page) || []), patch]);
  }

  // A patch file whose page identity matches nothing (typo, renamed page,
  // track mismatch) must fail loudly: without this check every entry in the
  // file silently never applies (review r1 P0-1). Overlay-owned pages are
  // hand-authored content and never patch targets — a patch aimed at one is
  // a layering mistake and fails the same way (review r2 N1).
  const knownIdentities = new Set(basePages.map((page) => page.identity));
  for (const page of patchIndex.keys()) {
    if (!knownIdentities.has(page)) {
      return { ok: false, kind: 'anchor', error: { code: 'OVERLAY_PAGE_MISS', page, baseSha } };
    }
  }

  const pages = [];
  const diagnostics = [];
  for (const basePage of basePages) {
    if (path.basename(basePage.path) === 'About.md') continue; // overview ships as base; overlay pages/ owns zilliz-specific overviews later
    let markdown = readBasePage({ webContentDir, sha: baseSha, filePath: basePage.path });
    const pageKind = detectPageKind(markdown);
    markdown = applyRules(markdown, tree.rules);
    let applied = [];
    try {
      ({ markdown, applied } = applyPatches(markdown, patchIndex.get(basePage.identity) || [], basePage.identity));
    } catch (error) {
      if (error instanceof AnchorError) {
        return { ok: false, kind: 'anchor', error: { code: error.code, ...error.detail, page: basePage.identity, baseSha } };
      }
      throw error;
    }
    pages.push({ identity: pageIdentityFor(basePage), path: basePage.path, pageKind, markdown, digest: digest(markdown), patchesApplied: applied });
  }

  for (const overlayPage of tree.pages) {
    pages.push({
      identity: overlayPage.identity,
      path: `overlay:pages/${overlayPage.path}`,
      pageKind: detectPageKind(overlayPage.content),
      markdown: applyRules(overlayPage.content, tree.rules),
      digest: digest(applyRules(overlayPage.content, tree.rules)),
      patchesApplied: [],
    });
  }

  const targets = gateTargets({ pages, targets: tree.targets });
  const pageDigests = Object.fromEntries([...pages].sort((a, b) => a.identity.localeCompare(b.identity)).map((page) => [page.identity, page.digest]));

  const artifact = {
    schemaVersion: 1,
    kind: 'derive-release-scope',
    language: 'rust',
    track,
    base: { sdkName, sha: baseSha },
    overlayDigest: tree.overlayDigest,
    pageDigests,
    pages: pages.map((page) => ({
      identity: page.identity,
      path: page.path,
      pageKind: page.pageKind,
      digest: page.digest,
      patchesApplied: page.patchesApplied,
    })),
    targetsGate: { registered: targets.registered, mustAskCount: targets.mustAsk.length },
    diagnostics,
  };

  const diff = previousArtifact ? diffPageDigests(pageDigests, previousArtifact.pageDigests || {}) : null;
  return { ok: true, artifact, pages, mustAsk: targets.mustAsk, targetsSummary: targets.summary, diff };
}

function writeArtifact(artifactPath, result) {
  const file = path.resolve(artifactPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(result.artifact, null, 2)}\n`);
  return file;
}

module.exports = { compileTrack, writeArtifact };
