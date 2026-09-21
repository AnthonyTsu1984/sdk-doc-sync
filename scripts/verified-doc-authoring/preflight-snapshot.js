#!/usr/bin/env node
'use strict';

// Read-only live preflight for a verified-doc-authoring plan.
//
// Fetches the live document state through the same adapter the executor
// uses and checks the two preflight bindings (revision and protected-block
// digest) plus a content digest when the plan's draft artifact is present.
// Never mutates anything. Run before requesting approval and again right
// after: any DRIFT means re-export, fold user edits, and re-plan.
//
// Usage: node preflight-snapshot.js <plan.json> [adapter.js]

const path = require('node:path');

(async () => {
  const planPath = process.argv[2];
  if (!planPath) throw new Error('usage: preflight-snapshot.js <plan.json> [adapter.js]');
  const adapterPath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(__dirname, 'feishu-authoring-adapter.js');
  const adapter = require(adapterPath);
  const plan = require(path.resolve(planPath));

  const live = await adapter.snapshot(plan.target);
  const refetched = await adapter.refetch(plan.target.documentId);
  console.log('live documentId:', live.documentId, '(plan expects', plan.target.documentId + ')');
  console.log('live revision:', live.revision, '(plan expects', String(plan.target.revision) + ')');
  console.log('live protectedBlocksDigest:', live.protectedBlocksDigest);
  console.log('plan protectedBlocksDigest:', plan.target.protectedBlocksDigest);
  console.log('live contentDigest:', refetched.contentDigest);
  if (plan.draftArtifact && plan.draftArtifact.markdownDigest) {
    console.log('plan markdownDigest:    ', plan.draftArtifact.markdownDigest,
      refetched.contentDigest === plan.draftArtifact.markdownDigest ? '(content already live)' : '(content differs from plan draft)');
  }
  const ok = live.documentId === plan.target.documentId
    && String(live.revision) === String(plan.target.revision)
    && live.protectedBlocksDigest === plan.target.protectedBlocksDigest;
  console.log('PREFLIGHT:', ok ? 'OK - target unchanged, auth working' : 'DRIFT - target changed since plan; re-export, fold edits, re-plan');
  process.exitCode = ok ? 0 : 1;
})().catch((e) => { console.error('PREFLIGHT ERROR:', e.message); process.exit(1); });
