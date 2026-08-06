'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runCli } = require('../bin/verified-doc-authoring');

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
}

test('claims and plan commands produce digest-bound artifacts without writing a tenant', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'authoring-cli-'));
  const claimsInput = path.join(directory, 'claims-input.json');
  const markdownPath = path.join(directory, 'draft.md');
  const inventoryPath = path.join(directory, 'claims.json');
  const draftPath = path.join(directory, 'draft-artifact.json');
  const targetPath = path.join(directory, 'target.json');
  const diffPath = path.join(directory, 'diff.json');
  const planPath = path.join(directory, 'plan.json');
  const sessionPath = path.join(directory, 'session.json');
  writeJson(claimsInput, {
    inventoryId: 'claims:cli:1', target: { kind: 'existing', documentId: 'doc-1' },
    claims: [{
      claimId: 'claim:route', text: 'The route exists.',
      sourceLocator: { type: 'local-source', path: 'handler.go', symbol: 'route' },
      apiShapeEvidence: [{ type: 'route', locator: 'handler.go:route' }],
      behavioralEvidence: [], status: 'verified', notes: 'Shape-only claim.',
    }],
    visibleUnresolvedClaimIds: [],
  });
  fs.writeFileSync(markdownPath, '# Verified guide\n');
  writeJson(targetPath, { kind: 'existing', documentId: 'doc-1', strategy: 'smart', revision: 1, protectedBlocksDigest: `sha256:${'a'.repeat(64)}`, protectedBlocks: [] });
  writeJson(diffPath, { headingsAdded: ['Verified guide'] });

  await runCli({
    argv: ['node', 'verified-doc-authoring.js', 'claims', '--input', claimsInput, '--markdown', markdownPath, '--inventory-output', inventoryPath, '--draft-output', draftPath],
    dependencies: { onStdout() {} },
  });
  const plan = await runCli({
    argv: ['node', 'verified-doc-authoring.js', 'plan', '--target', targetPath, '--semantic-diff', diffPath, '--claim-inventory', inventoryPath, '--draft-artifact', draftPath, '--output', planPath, '--session', sessionPath, '--session-id', 'authoring:cli:1'],
    dependencies: { onStdout() {} },
  });
  assert.match(plan.planDigest, /^sha256:/);
  assert.equal(JSON.parse(fs.readFileSync(sessionPath, 'utf8')).status, 'approval_ready');
});
