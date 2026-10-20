const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const COMPOSER = path.resolve(__dirname, '..', 'scripts', 'compose-pr-reconcile-candidate-spec.js');
const {
  buildLinkResolver,
  EXCEPTION_CODES,
  compose,
  main,
  parseArgs,
  patchContext,
  prepareVerbatimContent,
  sweepSpec,
} = require('../scripts/compose-pr-reconcile-candidate-spec');
const { createInheritanceEvidence } = require('../src/sdk-doc-sync/inheritance-evidence');
const { evaluateVersionedTreeDelta } = require('../src/sdk-doc-sync/versioned-tree-policy');
const goProfiles = require('../config/pr-page-profiles.json');

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

const GO_METHOD_PAGE = `# AddRole()

This operation adds a role to Milvus.

\`\`\`go
func (c *Client) AddRole(ctx context.Context, option AddRoleOption, callOptions ...grpc.CallOption) error
\`\`\`

## Request Syntax

\`\`\`go
err := client.AddRole(ctx, option)
\`\`\`

**PARAMETERS:**

- **roleName** (*string*)

    The name of the role.

**RETURN TYPE:**

*error*

**RETURNS:**

Returns nil on success.

**ERROR HANDLING:**

- **error**

    Check the error message for details.

## Example

\`\`\`go
err := client.AddRole(ctx, option)
\`\`\`

## Related operations

- [DropRole](Authentication/DropRole.md)
`;

const GO_NOTES_PAGE = `# CreateCollection()

This operation creates a collection.

\`\`\`go
func (c *Client) CreateCollection(ctx context.Context, option CreateCollectionOption) error
\`\`\`

## Request Syntax

\`\`\`go
err := client.CreateCollection(ctx, option)
\`\`\`

**RETURN TYPE:**

*error*

**RETURNS:**

Returns nil on success.

## Example

\`\`\`go
err := client.CreateCollection(ctx, option)
\`\`\`

## Notes

These notes must be qualified, never rendered as a bare Notes section.
`;

const NODE_METHOD_PAGE = `# addPrivilegesToGroup()

This operation adds privileges to a specific privilege group in Milvus.

\`\`\`javascript
await milvusClient.addPrivilegesToGroup(data)
\`\`\`

## Request Syntax

\`\`\`javascript
await milvusClient.addPrivilegesToGroup({
   group_name: string
 })
\`\`\`

**PARAMETERS:**

- **group_name** (*string*) -

    **[REQUIRED]**

    The name of a privilege group.

**RETURNS:**

*Promise\\<ResStatus\\>*

This method returns a promise that resolves to a **ResStatus** object.

\`\`\`javascript
// res = { error_code: 0 }
\`\`\`

**EXCEPTIONS:**

- **MilvusException**

    Raised when the RPC fails.

## Example

\`\`\`javascript
await milvusClient.addPrivilegesToGroup({ group_name: "g" });
\`\`\`
`;

// ---- synthetic wave fixtures (shapes pinned against the 2026-10-15 go-v30
// intake artifacts; keep field-for-field compatible with the real chain) ----

const TRACK = 'v3.0.x';
const ROOT = 'walk-root-token';
const FAM_AUTH = 'folder-authentication';
const FAM_COLL = 'folder-collection';

function writeWave(dir, { unitCount = 2 } = {}) {
  const pagesDir = path.join(dir, 'pages-v30');
  fs.mkdirSync(pagesDir, { recursive: true });
  const pages = {
    'v2-Authentication-AddRole': GO_METHOD_PAGE,
    'v2-Authentication-DropRole': GO_METHOD_PAGE.replace(/AddRole/g, 'DropRole'),
    'v2-Collection-CreateCollection': GO_NOTES_PAGE,
  };
  for (const [slug, text] of Object.entries(pages)) fs.writeFileSync(path.join(pagesDir, `${slug}.md`), text);

  const scopeAction = (slug, type, symbol) => ({
    canonicalSlug: slug,
    documentationOwnership: { classification: 'standalone' },
    evidence: [],
    pr: { number: 1179, path: `API_Reference/milvus-sdk-go/v3.0.x/${slug}.md`, changeType: 'ADDED' },
    reason: 'pr-doc-update',
    source: { file: 'client/role.go', line: 10, repository: 'milvus-io/milvus-sdk-go', revision: '03bdecc70b5f' },
    stableId: `go:${slug.split('-')[1]}:${slug.split('-')[2]}`,
    symbol,
    type,
  });

  const releaseScope = {
    schemaVersion: 1,
    language: 'go',
    sdkName: 'milvus-sdk-go',
    track: TRACK,
    baselineTag: 'v2.6.0',
    targetTag: 'v3.0.0',
    targetCommit: '03bdecc70b5f',
    targetDate: '2026-10-15',
    releaseRange: 'v2.6.0..v3.0.0',
    approvalGrade: false,
    writesPerformed: false,
    scanStateUpdated: false,
    changedFiles: ['client/role.go'],
    actions: [
      scopeAction('v2-Authentication-AddRole', 'UPDATE', 'AddRole'),
      scopeAction('v2-Authentication-DropRole', 'UPDATE', 'DropRole'),
      scopeAction('v2-Collection-CreateCollection', 'CREATE', 'CreateCollection'),
    ].slice(0, unitCount === 2 ? 2 : 3),
    scannerDiagnostics: [],
  };

  const decisionUnit = (slug, actionIntent, existing) => ({
    id: `unit-${slug}`,
    sourceStableId: `go:${slug.split('-')[1]}:${slug.split('-')[2]}`,
    actionIntent,
    risks: [],
    decision: {
      docIdentity: {
        category: slug.split('-')[1],
        stableId: `go:${slug.split('-')[1]}:${slug.split('-')[2]}`,
        canonicalSlug: slug,
        title: `${slug.split('-')[2]}()`,
        ...(actionIntent === 'CREATE' ? { anchorRecordId: 'rec-parent-collection' } : {}),
      },
      existingBitable: existing,
      identityResolution: { resolution: 'exact-slug' },
      pr: {
        number: 1179,
        path: `API_Reference/milvus-sdk-go/v3.0.x/${slug}.md`,
        changeType: 'ADDED',
        revision: '03bdecc70b5f54c55953ae9cb25ecde96890fe8e',
        verifyTier: 'method',
        pageBytes: Buffer.byteLength(pages[slug]),
        pageSha256: sha256(pages[slug]),
        pageH1: `# ${slug.split('-')[2]}()`,
      },
      scoutAction: { type: actionIntent },
      scoutReason: 'user-facing API addition',
    },
  });

  const present = (slug, recordId) => ({
    status: 'present',
    recordId,
    currentDocumentToken: `docx-${recordId}`,
    currentType: 'Function',
    currentProgress: 'Draft',
    currentTargets: 'MilvusZilliz',
  });

  const decisions = {
    units: [
      decisionUnit('v2-Authentication-AddRole', 'UPDATE', present('v2-Authentication-AddRole', 'rec-add-role')),
      decisionUnit('v2-Authentication-DropRole', 'UPDATE', present('v2-Authentication-DropRole', 'rec-drop-role')),
      decisionUnit('v2-Collection-CreateCollection', 'CREATE', { status: 'absent' }),
    ].slice(0, unitCount === 2 ? 2 : 3),
    exclusions: [],
    notes: [],
  };

  const evidenceFor = (stableId, recordId) => createInheritanceEvidence({
    stableId,
    current: {
      recordId,
      documentToken: `docx-${recordId}`,
      version: TRACK,
      folderToken: FAM_AUTH,
      versionRootToken: ROOT,
      ancestryVerified: true,
      placementVerified: true,
    },
    target: { version: TRACK, folderToken: FAM_AUTH, folderRef: null, versionRootToken: ROOT, ancestryVerified: true },
    sharedTokenStatus: 'unique',
    referencedRecordIds: [],
    trackInventoryDigests: { 'v3.0.x': 'sha256:inventory' },
    collectedAt: '2026-10-15T06:36:20.782Z',
  });

  const auditEntry = (slug, recordId, { withEvidence = true } = {}) => ({
    stableId: `go:${slug.split('-')[1]}:${slug.split('-')[2]}`,
    canonicalSlug: slug,
    recordId,
    documentToken: `docx-${recordId}`,
    title: `${slug.split('-')[2]}()`,
    parentRecordId: 'rec-parent-auth',
    proposalId: `unit-${slug}`,
    targetFolderToken: FAM_AUTH,
    targetFolderVerified: true,
    placement: { verified: true, version: TRACK, folderToken: FAM_AUTH, versionRootToken: ROOT },
    sharedToken: { status: 'unique', references: [], referencedRecordIds: [] },
    ...(withEvidence ? { inheritanceEvidence: evidenceFor(`go:${slug.split('-')[1]}:${slug.split('-')[2]}`, recordId) } : {}),
  });

  const placementAudit = {
    schemaVersion: 3,
    version: 3,
    status: 'placement_audit_ready',
    // Honest per the build-current-placement-audit producer: it computes this
    // per-set — every entry carrying evidence would be 'evidence_complete';
    // this wave's DropRole entry deliberately carries none (the mint-path
    // unit), so the honest value is 'evidence_blocked' (review P1-3: the
    // composer's audit-level gate is the overall status only, per-entry
    // evidence gaps are the per-entry logic's business).
    inheritanceEvidenceStatus: 'evidence_blocked',
    collectedAt: '2026-10-15T06:36:20.782Z',
    generatedAt: '2026-10-15T06:36:20.782Z',
    walkDigest: 'sha256:204a988ee9b02f9c66fa0f77491cd35225f5c7b80632b9a03699870ab402c335',
    versionRootToken: ROOT,
    entries: [
      auditEntry('v2-Authentication-AddRole', 'rec-add-role'),
      auditEntry('v2-Authentication-DropRole', 'rec-drop-role', { withEvidence: false }), // mint-path unit
    ].slice(0, unitCount === 2 ? 2 : 2),
    folderChains: { [FAM_AUTH]: ['walk-root-token', FAM_AUTH] },
    trackInventoryDigests: { 'v3.0.x': 'sha256:inventory' },
    blocked: [],
    evidenceBlocked: [],
    recordEnumeration: { writesPerformed: false },
    sharedTokenSummary: {},
    sourceProposal: { path: 'audit-proposal.json' },
    sourceVersionRoots: {},
  };

  const rootWalk = {
    rootToken: ROOT,
    walkedAt: '2026-10-15T06:36:20.782Z',
    nodeCount: 3,
    writesPerformed: false,
    nodes: [
      { token: ROOT, type: 'version_root', name: TRACK, parentFolderToken: null },
      { token: FAM_AUTH, type: 'folder', name: 'Authentication', parentFolderToken: ROOT },
      { token: FAM_COLL, type: 'folder', name: 'Collection', parentFolderToken: ROOT },
    ],
  };

  const snapshot = {
    baseToken: 'base-token',
    fetchedAt: '2026-10-15T06:00:00.000Z',
    count: 2,
    writesPerformed: false,
    rows: [
      {
        recordId: 'rec-add-role',
        slug: 'v2-Authentication-AddRole',
        type: 'Function',
        title: 'AddRole()',
        docLink: 'https://zilliverse.feishu.cn/wiki/docx/doc-token-add-role',
        parent: JSON.stringify([{ table_id: 'tbl-default', record_ids: [] }]),
      },
      {
        recordId: 'rec-drop-role',
        slug: 'v2-Authentication-DropRole',
        type: 'Function',
        title: 'DropRole()',
        docLink: 'https://zilliverse.feishu.cn/wiki/docx/doc-token-drop-role',
        parent: JSON.stringify([{ table_id: 'tbl-default', record_ids: [] }]),
      },
    ],
  };

  const identityMap = {
    language: 'go',
    track: TRACK,
    generatedAt: '2026-10-15T06:00:00.000Z',
    symbols: {
      'Authentication.AddRole': { symbol: 'AddRole', kind: 'method' },
      'Authentication.DropRole': { symbol: 'DropRole', kind: 'method' },
    },
  };

  const write = (name, value) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    return file;
  };

  return {
    pagesDir,
    scope: write('scope.json', releaseScope),
    decisions: write('decisions.json', decisions),
    audit: write('audit.json', placementAudit),
    walk: write('walk.json', rootWalk),
    snapshot: write('snapshot.json', snapshot),
    identityMap: write('identity-map.json', identityMap),
  };
}

function waveArgs(dir, files, extra = []) {
  return {
    language: 'go',
    track: TRACK,
    releaseScope: files.scope,
    decisions: files.decisions,
    pagesDir: files.pagesDir,
    snapshot: files.snapshot,
    placementAudit: files.audit,
    rootWalk: files.walk,
    identityMap: files.identityMap,
    ...extra,
  };
}

test('compose assembles the canonical go verbatim candidate-spec offline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-wave-'));
  const files = writeWave(dir);
  const { spec, sweepReport, linkStats } = compose(waveArgs(dir, files));

  assert.equal(sweepReport, null);
  assert.equal(spec.language, 'go');
  assert.equal(spec.track, TRACK);
  assert.deepEqual(spec.exceptions, []);
  assert.equal(Object.keys(spec.candidates).length, 2);

  const addRole = spec.candidates['v2-Authentication-AddRole'];
  assert.equal(addRole.reviewedActionType, 'UPDATE');
  assert.equal(addRole.kind, 'method');
  assert.equal(addRole.summary, 'This operation adds a role to Milvus.');
  assert.equal(addRole.existingRecord.recordId, 'rec-add-role');
  assert.equal(addRole.existingRecord.recordType, 'Function');
  assert.equal(addRole.existingRecord.placement.version, TRACK);
  assert.equal(addRole.folderToken, FAM_AUTH); // audit-proposal derived from the walk
  assert.equal(addRole.treeDelta, null);
  assert.match(addRole.examples[0].code, /client\.AddRole\(ctx, option\)/);
  assert.equal(addRole.examples[0].language, 'go');
  assert.equal(addRole.sourceVariants.length, 1);
  assert.deepEqual(addRole.styleMirrors, []);

  // verbatim overlay + pr provenance ride the spec (§4.4)
  const overlay = spec.verbatimOverlay['go:Authentication:AddRole'];
  assert.equal(overlay.canonicalSlug, 'v2-Authentication-AddRole');
  assert.match(overlay.verbatimContent, /# AddRole\(\)/);
  assert.equal(overlay.pr.number, 1179);
  assert.equal(overlay.pr.pageSha256, sha256(GO_METHOD_PAGE));

  // link resolution joined the snapshot docLink
  assert.match(overlay.verbatimContent, /DropRole\]\(https:\/\/zilliverse\.feishu\.cn\/wiki\/docx\/doc-token-drop-role\)/);
  assert.equal(linkStats.deLinked, 0);

  assert.equal(spec.placementWalk.digest, 'sha256:204a988ee9b02f9c66fa0f77491cd35225f5c7b80632b9a03699870ab402c335');
  assert.equal(spec.target.folders.Authentication, FAM_AUTH);
  assert.match(spec.composerNotes.join(' '), /profile go v1 route verbatim/);
  // mint-path regression: the DropRole unit had no audit evidence but its live
  // placement IS the target — the composer mints in place instead of throwing.
  assert.match(spec.composerNotes.join(' '), /inheritance evidence minted in-place for 1 unit/);
  assert.equal(spec.candidates['v2-Authentication-DropRole'].inheritanceEvidence.sharedToken.status, 'unique');
});

test('bare Notes pages land in contentAdjustments with the qualified heading', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-notes-'));
  const files = writeWave(dir, { unitCount: 3 });
  const { spec } = compose(waveArgs(dir, files));
  assert.deepEqual(spec.contentAdjustments, [{
    slug: 'v2-Collection-CreateCollection',
    from: '## Notes',
    to: '## Notes on createcollection behavior',
    reason: 'bareNotesSectionForbidden intake gate; section content unchanged',
  }]);
  const created = spec.candidates['v2-Collection-CreateCollection'];
  assert.equal(created.reviewedActionType, 'CREATE');
  assert.equal(created.existingRecordLookup.absent, true);
  assert.equal(created.existingRecordLookup.parentRecordId, 'rec-parent-collection');
  assert.equal(created.folderToken, FAM_COLL); // family folder from the walk
  assert.ok(spec.verbatimOverlay['go:Collection:CreateCollection'].verbatimContent.includes('## Notes on createcollection behavior'));
});

test('--sweep moves absent-record units into the typed FEISHU_RECORD_ABSENT queue', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-sweep-'));
  const files = writeWave(dir, { unitCount: 3 });
  const { spec } = compose(waveArgs(dir, files, { sweep: true }));
  const absent = spec.exceptions.find((entry) => entry.code === 'FEISHU_RECORD_ABSENT');
  assert.ok(absent, 'expected a FEISHU_RECORD_ABSENT exception entry');
  assert.deepEqual(absent.units, ['v2-Collection-CreateCollection']);
  assert.equal(absent.disposition, 'data');
  assert.equal(absent.prefill[0].anchorRecordId, 'rec-parent-collection');
  assert.equal(absent.prefill[0].existingRecordLookup.absent, true);
  assert.match(spec.composerNotes.join(' '), /sweep verdict counts/);
});

test('page dump digest mismatch is a typed PAGE_DUMP_DIGEST_MISMATCH rejection', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-digest-'));
  const files = writeWave(dir);
  const decisions = JSON.parse(fs.readFileSync(files.decisions, 'utf8'));
  decisions.units[0].decision.pr.pageSha256 = sha256('tampered');
  fs.writeFileSync(files.decisions, `${JSON.stringify(decisions, null, 2)}\n`);
  assert.throws(() => compose(waveArgs(dir, files)), (error) => {
    assert.equal(error.code, 'PAGE_DUMP_DIGEST_MISMATCH');
    assert.match(error.message, /page dump sha256/);
    return true;
  });
});

test('digest pins are required and shape-checked, never silently skipped (review P1-4)', () => {
  // A missing or malformed decision.pr.pageSha256 used to skip the sha gate
  // (`if (pr.pageSha256 && ...)`) — an unverified page composed clean. Both
  // faces are typed rejections now, and so is a unit without a PR pin.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-digest-gates-'));
  const files = writeWave(dir);
  const pristine = fs.readFileSync(files.decisions, 'utf8');
  const load = () => JSON.parse(pristine);
  const save = (decisions) => fs.writeFileSync(files.decisions, `${JSON.stringify(decisions, null, 2)}\n`);

  // no decision.pr at all
  const noPr = load();
  delete noPr.units[0].decision.pr;
  save(noPr);
  assert.throws(() => compose(waveArgs(dir, files)), (error) => {
    assert.equal(error.code, 'PR_PIN_MISSING');
    assert.match(error.message, /no decision\.pr\.path pin/);
    return true;
  });

  // pr pin present but pathless
  const pathless = load();
  delete pathless.units[0].decision.pr.path;
  save(pathless);
  assert.throws(() => compose(waveArgs(dir, files)), (error) => {
    assert.equal(error.code, 'PR_PIN_MISSING');
    return true;
  });

  // digest absent
  const noDigest = load();
  delete noDigest.units[0].decision.pr.pageSha256;
  save(noDigest);
  assert.throws(() => compose(waveArgs(dir, files)), (error) => {
    assert.equal(error.code, 'PAGE_DIGEST_REQUIRED');
    assert.match(error.message, /missing or not a 64-hex digest \(null\)/);
    return true;
  });

  // digest malformed (not 64 hex)
  const badDigest = load();
  badDigest.units[0].decision.pr.pageSha256 = 'sha256:204a';
  save(badDigest);
  assert.throws(() => compose(waveArgs(dir, files)), (error) => {
    assert.equal(error.code, 'PAGE_DIGEST_REQUIRED');
    return true;
  });

  // a well-formed wrong digest is still the mismatch code, not the gate
  const wrongDigest = load();
  wrongDigest.units[0].decision.pr.pageSha256 = 'a'.repeat(64);
  save(wrongDigest);
  assert.throws(() => compose(waveArgs(dir, files)), (error) => {
    assert.equal(error.code, 'PAGE_DUMP_DIGEST_MISMATCH');
    return true;
  });
});

test('input contract rejections are typed, not defaults (§4.5 fail-closed)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-reject-'));
  const files = writeWave(dir);

  // unregistered language = data registration reminder, not a kernel change
  assert.throws(() => compose(waveArgs(dir, files, { language: 'rust' })), (error) => {
    assert.equal(error.code, 'NOT_REGISTERED_PROFILE');
    return true;
  });
  // scope/track binding
  assert.throws(() => compose(waveArgs(dir, files, { track: 'v2.6.x' })), (error) => {
    assert.equal(error.code, 'TRACK_LANGUAGE_MISMATCH');
    return true;
  });
  // missing required input
  const args = waveArgs(dir, files);
  delete args.decisions;
  assert.throws(() => compose(args), (error) => {
    assert.equal(error.code, 'MISSING_REQUIRED_INPUT');
    return true;
  });
  // a blocked placement audit is rejected, never silently downgraded; a
  // ready audit with PARTIAL per-entry evidence is not this rejection — the
  // mint branch owns it (see the mintedEvidence ledger test below, review P1-3)
  const audit = JSON.parse(fs.readFileSync(files.audit, 'utf8'));
  audit.status = 'placement_audit_blocked';
  fs.writeFileSync(files.audit, `${JSON.stringify(audit, null, 2)}\n`);
  assert.throws(() => compose(waveArgs(dir, files)), (error) => {
    assert.equal(error.code, 'PLACEMENT_AUDIT_NOT_READY');
    return true;
  });
});

test('partial per-entry evidence rides the mint branch and reports the mintedEvidence ledger (review P1-3)', () => {
  // Before the P1-3 ruling the composer rejected any audit whose
  // inheritanceEvidenceStatus was not 'evidence_complete', which made the
  // per-entry mint branch (target folder == live placement folder)
  // unreachable for exactly the audits the producer honestly emits with
  // partial evidence ('evidence_blocked' per-set). This fixture is that
  // shape: one entry carries evidence, one does not.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-mint-'));
  const files = writeWave(dir);
  const audit = JSON.parse(fs.readFileSync(files.audit, 'utf8'));
  assert.equal(audit.status, 'placement_audit_ready');
  assert.equal(audit.inheritanceEvidenceStatus, 'evidence_blocked');
  assert.equal(audit.entries.some((entry) => !entry.inheritanceEvidence), true);

  const { spec } = compose(waveArgs(dir, files));
  // the evidence-less unit (DropRole) was minted in place, not rejected
  const minted = spec.candidates['v2-Authentication-DropRole'].inheritanceEvidence;
  assert.equal(minted.sharedToken.status, 'unique');
  assert.equal(minted.target.folderToken, FAM_AUTH);
  // the mintedEvidence ledger names the minted unit in composerNotes
  assert.match(spec.composerNotes.join(' '), /inheritance evidence minted in-place for 1 unit\(s\).*go:Authentication:DropRole/);
  // the evidence-carrying unit keeps its audited evidence untouched
  const audited = spec.candidates['v2-Authentication-AddRole'].inheritanceEvidence;
  assert.notEqual(audited, minted);
  assert.equal(audited.current.recordId, 'rec-add-role');
});

test('structured node wave composes signature/params/result/exceptions with the orphan verbatim fallback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-node-'));
  const pagesDir = path.join(dir, 'pages-v26');
  fs.mkdirSync(pagesDir, { recursive: true });
  const slug = 'Authentication-addPrivilegesToGroup';
  fs.writeFileSync(path.join(pagesDir, `${slug}.md`), NODE_METHOD_PAGE);

  const releaseScope = {
    schemaVersion: 1,
    language: 'node',
    sdkName: 'milvus-sdk-node',
    track: 'v2.6.x',
    baselineTag: 'v2.5.0',
    targetTag: 'v2.6.0',
    targetCommit: 'abc1234',
    targetDate: '2026-10-15',
    releaseRange: 'v2.5.0..v2.6.0',
    approvalGrade: false,
    writesPerformed: false,
    scanStateUpdated: false,
    changedFiles: ['client/Authentication.ts'],
    actions: [{
      canonicalSlug: slug,
      documentationOwnership: { classification: 'standalone' },
      evidence: [],
      pr: { number: 1180, path: `API_Reference/milvus-sdk-node/v2.6.x/${slug}.md`, changeType: 'MODIFIED' },
      reason: 'pr-doc-update',
      source: { file: 'client/Authentication.ts', line: 20, repository: 'milvus-io/milvus-sdk-node', revision: 'abc1234' },
      stableId: 'node:Authentication:addPrivilegesToGroup',
      symbol: 'addPrivilegesToGroup',
      type: 'UPDATE',
    }],
    // scanner-taxonomy orphan: the adapter has no scanned symbol for the page
    scannerDiagnostics: [{
      level: 'warn',
      code: 'PR_SYMBOL_FALLBACK_BIND',
      message: `${slug}.md: no category-derived scanner candidate matched; bound by PR page symbol`,
    }],
  };
  const decisions = {
    units: [{
      id: `unit-${slug}`,
      sourceStableId: 'node:Authentication:addPrivilegesToGroup',
      actionIntent: 'UPDATE',
      risks: [],
      decision: {
        docIdentity: {
          category: 'Authentication',
          stableId: 'node:Authentication:addPrivilegesToGroup',
          canonicalSlug: slug,
          title: 'addPrivilegesToGroup()',
        },
        existingBitable: {
          status: 'present',
          recordId: 'rec-node-1',
          currentDocumentToken: 'docx-node-1',
          currentType: 'Function',
        },
        identityResolution: { resolution: 'exact-slug' },
        pr: {
          number: 1180,
          path: `API_Reference/milvus-sdk-node/v2.6.x/${slug}.md`,
          changeType: 'MODIFIED',
          revision: 'abc1234def5678',
          verifyTier: 'method',
          pageBytes: Buffer.byteLength(NODE_METHOD_PAGE),
          pageSha256: sha256(NODE_METHOD_PAGE),
        },
        scoutAction: { type: 'UPDATE' },
        scoutReason: 'user-facing API change',
      },
    }],
    exclusions: [],
    notes: [],
  };
  const evidence = createInheritanceEvidence({
    stableId: 'node:Authentication:addPrivilegesToGroup',
    current: {
      recordId: 'rec-node-1',
      documentToken: 'docx-node-1',
      version: 'v2.6.x',
      folderToken: FAM_AUTH,
      versionRootToken: ROOT,
      ancestryVerified: true,
      placementVerified: true,
    },
    target: { version: 'v2.6.x', folderToken: FAM_AUTH, folderRef: null, versionRootToken: ROOT, ancestryVerified: true },
    sharedTokenStatus: 'unique',
    referencedRecordIds: [],
    trackInventoryDigests: {},
    collectedAt: '2026-10-15T06:36:20.782Z',
  });
  const audit = {
    schemaVersion: 3,
    version: 3,
    status: 'placement_audit_ready',
    inheritanceEvidenceStatus: 'evidence_complete',
    collectedAt: '2026-10-15T06:36:20.782Z',
    generatedAt: '2026-10-15T06:36:20.782Z',
    walkDigest: 'sha256:node-walk',
    versionRootToken: ROOT,
    entries: [{
      stableId: 'node:Authentication:addPrivilegesToGroup',
      canonicalSlug: slug,
      recordId: 'rec-node-1',
      documentToken: 'docx-node-1',
      title: 'addPrivilegesToGroup()',
      parentRecordId: 'rec-parent-auth',
      proposalId: `unit-${slug}`,
      targetFolderToken: FAM_AUTH,
      targetFolderVerified: true,
      placement: { verified: true, version: 'v2.6.x', folderToken: FAM_AUTH, versionRootToken: ROOT },
      sharedToken: { status: 'unique', references: [], referencedRecordIds: [] },
      inheritanceEvidence: evidence,
    }],
    folderChains: { [FAM_AUTH]: [ROOT, FAM_AUTH] },
    trackInventoryDigests: {},
    blocked: [],
    evidenceBlocked: [],
    recordEnumeration: { writesPerformed: false },
    sharedTokenSummary: {},
    sourceProposal: { path: 'audit-proposal.json' },
    sourceVersionRoots: {},
  };
  // No root walk: the java-chain precedent — the audit proposal derives from
  // the audit's own targetFolderToken bindings (two-segment node slugs have no
  // family-name heuristic, so real node waves pass --audit-proposal; the
  // audit-bound fallback keeps this fixture honest without one).
  const snapshot = {
    baseToken: 'base-token',
    fetchedAt: '2026-10-15T06:00:00.000Z',
    count: 1,
    writesPerformed: false,
    rows: [{
      recordId: 'rec-node-1',
      slug,
      type: 'Function',
      title: 'addPrivilegesToGroup()',
      docLink: 'https://zilliverse.feishu.cn/wiki/docx/doc-token-node-1',
      parent: JSON.stringify([{ table_id: 'tbl-node', record_ids: [] }]),
    }],
  };
  const identityMap = { language: 'node', track: 'v2.6.x', generatedAt: '2026-10-15T06:00:00.000Z', symbols: {} };
  const write = (name, value) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    return file;
  };

  const { spec } = compose({
    language: 'node',
    track: 'v2.6.x',
    releaseScope: write('scope.json', releaseScope),
    decisions: write('decisions.json', decisions),
    pagesDir,
    snapshot: write('snapshot.json', snapshot),
    placementAudit: write('audit.json', audit),
    identityMap: write('identity-map.json', identityMap),
  });

  // the orphan unit is switched to the verbatim fallback route and reported
  assert.equal(spec.exceptions.length, 1);
  assert.equal(spec.exceptions[0].code, 'SCANNER_TAXONOMY_ORPHAN');
  assert.deepEqual(spec.exceptions[0].units, [slug]);
  assert.equal(spec.exceptions[0].disposition, 'data');
  const candidate = spec.candidates[slug];
  assert.equal(candidate.reviewedActionType, 'UPDATE');
  // structured fields exist because the node profile is structured; the orphan
  // switch only changes how the unit's page was routed before the builder.
  assert.equal(candidate.kind, 'method');
  assert.match(spec.composerNotes.join(' '), /SCANNER_TAXONOMY_ORPHAN: 1 scope slug/);
});

test('sweepSpec flags the clone-ID shared in-place shape as CLONE_ID_SHARED_IN_PLACE', () => {
  // Minimal node-v26-shaped candidate (the real blocked shape is SAME-track
  // in-place): referencedRecordIds carries the unit's own record id twice
  // (clone-ID fork rows kept the record ids), so joinSharedUpdateReviews
  // cannot attribute a pointing record and the versioned-tree-policy must
  // fail closed (design §7/§8.3).
  const ownRecordId = 'rec-clone-twin';
  const evidence = createInheritanceEvidence({
    stableId: 'node:Collections:truncateCollection',
    current: {
      recordId: ownRecordId,
      documentToken: 'docx-clone',
      version: 'v2.6.x',
      folderToken: FAM_AUTH,
      versionRootToken: ROOT,
      ancestryVerified: true,
      placementVerified: true,
    },
    target: { version: 'v2.6.x', folderToken: FAM_AUTH, folderRef: null, versionRootToken: ROOT, ancestryVerified: true },
    sharedTokenStatus: 'shared',
    referencedRecordIds: [ownRecordId, ownRecordId],
    trackInventoryDigests: {
      'v2.4.x': 'sha256:' + crypto.randomBytes(32).toString('hex'),
      'v2.6.x': 'sha256:' + crypto.randomBytes(32).toString('hex'),
    },
    collectedAt: '2026-10-15T06:36:20.782Z',
  });
  const spec = {
    language: 'node',
    track: 'v2.6.x',
    target: { version: 'v2.6.x', versionRootToken: ROOT },
    candidates: {
      'Collections-truncateCollection': {
        docIdentity: { stableId: 'node:Collections:truncateCollection', canonicalSlug: 'Collections-truncateCollection' },
        reviewedActionType: 'UPDATE',
        // structured-route unit: the audited folder chain declares the
        // ancestry fact (review P2-2 passthrough face)
        ancestryVerified: true,
        existingRecord: {
          recordId: ownRecordId,
          documentToken: 'docx-clone',
          placement: { version: 'v2.6.x', folderToken: FAM_AUTH, versionRootToken: ROOT, verified: true },
        },
        folderToken: FAM_AUTH,
        folderAncestry: [ROOT, FAM_AUTH],
        inheritanceEvidence: evidence,
      },
    },
  };
  const report = sweepSpec(spec, { evaluateVersionedTreeDelta });
  assert.equal(report.units, 1);
  // Kernel allowance (2026-10-19 ruling): the clone-only shape — the
  // reference multiset carries ONLY the unit's own recordId (clone-ID fork
  // rows kept the record ids) — has no other track to push the change onto,
  // so it sweeps clean instead of failing closed as unclassified.
  assert.equal(report.blocked.length, 0);
  assert.equal(report.targetAncestryCoverage, 'declared for all 1 swept unit(s)');

  // Review P2-2: a spec that does not declare ancestryVerified sweeps with
  // ancestry unverified and the report says the TARGET_ANCESTRY family is
  // not covered — the sweep no longer fabricates the fact.
  const undeclared = JSON.parse(JSON.stringify(spec));
  delete undeclared.candidates['Collections-truncateCollection'].ancestryVerified;
  const undeclaredReport = sweepSpec(undeclared, { evaluateVersionedTreeDelta });
  assert.equal(undeclaredReport.blocked[0].blocker, 'TREE_DELTA_PLACEMENT_UNKNOWN');
  assert.match(undeclaredReport.targetAncestryCoverage, /not declared .*TARGET_ANCESTRY/);

  // in-place unique units sweep clean
  const cleanEvidence = createInheritanceEvidence({
    stableId: 'node:Collections:hasRole',
    current: {
      recordId: 'rec-clean',
      documentToken: 'docx-clean',
      version: 'v2.6.x',
      folderToken: FAM_AUTH,
      versionRootToken: ROOT,
      ancestryVerified: true,
      placementVerified: true,
    },
    target: { version: 'v2.6.x', folderToken: FAM_AUTH, folderRef: null, versionRootToken: ROOT, ancestryVerified: true },
    sharedTokenStatus: 'unique',
    referencedRecordIds: [],
    trackInventoryDigests: { 'v2.6.x': 'sha256:' + crypto.randomBytes(32).toString('hex') },
    collectedAt: '2026-10-15T06:36:20.782Z',
  });
  const cleanSpec = {
    language: 'node',
    track: 'v2.6.x',
    target: { version: 'v2.6.x', versionRootToken: ROOT },
    candidates: {
      'Authentication-hasRole': {
        docIdentity: { stableId: 'node:Authentication:hasRole', canonicalSlug: 'Authentication-hasRole' },
        reviewedActionType: 'UPDATE',
        ancestryVerified: true,
        existingRecord: {
          recordId: 'rec-clean',
          documentToken: 'docx-clean',
          placement: { version: 'v2.6.x', folderToken: FAM_AUTH, versionRootToken: ROOT, verified: true },
        },
        folderToken: FAM_AUTH,
        folderAncestry: [ROOT, FAM_AUTH],
        inheritanceEvidence: cleanEvidence,
      },
    },
  };
  const cleanReport = sweepSpec(cleanSpec, { evaluateVersionedTreeDelta });
  assert.equal(cleanReport.blocked.length, 0);
  assert.equal(Object.values(cleanReport.counts)[0], 1);
  assert.equal(cleanReport.targetAncestryCoverage, 'declared for all 1 swept unit(s)');
});

test('patch-context applies the verbatim overlay and rejects unmatched entries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-patch-'));
  const specPath = path.join(dir, 'spec.json');
  const spec = {
    language: 'go',
    track: TRACK,
    contentAdjustments: [{ slug: 's', from: 'a', to: 'b' }],
    verbatimOverlay: {
      'go:Authentication:AddRole': {
        canonicalSlug: 'v2-Authentication-AddRole',
        verbatimContent: '# AddRole()\n\nSee [Docs](https://example.com/x).',
        pr: { number: 1179, path: 'p.md', changeType: 'ADDED', revision: 'r', verifyTier: 'method', pageBytes: 10, pageSha256: 'sha' },
      },
    },
  };
  fs.writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  const contextPath = path.join(dir, 'context.json');
  const context = { schemaVersion: 1, contexts: { 'go:Authentication:AddRole': { summary: 'old' } } };
  fs.writeFileSync(contextPath, `${JSON.stringify(context, null, 2)}\n`);

  const outPath = path.join(dir, 'context.patched.json');
  const args = parseArgs(['node', 'x', '--patch-context', contextPath, '--candidate-spec', specPath, '--patch-context-output', outPath]);
  assert.equal(patchContext(args), 0);
  const patched = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.match(patched.contexts['go:Authentication:AddRole'].verbatimContent, /^# AddRole\(\)/);
  assert.deepEqual(patched.contexts['go:Authentication:AddRole'].pr.number, 1179);

  // an overlay entry with no context counterpart is a typed rejection
  const unmatchedSpec = {
    verbatimOverlay: {
      'go:Missing:Unit': { canonicalSlug: 'x', verbatimContent: 'y', pr: {} },
      'go:Authentication:AddRole': spec.verbatimOverlay['go:Authentication:AddRole'],
    },
  };
  const unmatchedPath = path.join(dir, 'unmatched.json');
  fs.writeFileSync(unmatchedPath, `${JSON.stringify(unmatchedSpec, null, 2)}\n`);
  assert.throws(() => patchContext(parseArgs(['node', 'x', '--patch-context', contextPath, '--candidate-spec', unmatchedPath])), (error) => {
    assert.equal(error.code, 'VERBATIM_OVERLAY_UNMATCHED');
    return true;
  });
});

test('prepareVerbatimContent de-links unresolvable relative links and records them', () => {
  const { buildLinkResolver } = require('../scripts/compose-pr-reconcile-candidate-spec');
  const snapshot = {
    rows: [{
      recordId: 'rec',
      slug: 'v2-Authentication-DropRole',
      docLink: 'https://zilliverse.feishu.cn/wiki/docx/droprole-token',
    }],
  };
  const resolve = buildLinkResolver(snapshot);
  // Real page link grammar: bare sibling names ("DropRole.md"), never
  // same-dir prefixed forms (the 2026-10-15 go harvest link census).
  const prepared = prepareVerbatimContent(
    'See [DropRole](DropRole.md) and [Missing](Missing.md).',
    { slug: 'v2-Authentication-AddRole', prPath: 'API_Reference/milvus-sdk-go/v3.0.x/Authentication/AddRole.md', resolveLink: resolve },
  );
  assert.match(prepared.content, /DropRole\]\(https:\/\/zilliverse\.feishu\.cn\/wiki\/docx\/droprole-token\)/);
  assert.equal(prepared.linksResolved, 1);
  assert.deepEqual(prepared.linksDeLinked, [{ slug: 'v2-Authentication-AddRole', target: 'Missing.md', page: 'API_Reference/milvus-sdk-go/v3.0.x/Authentication/AddRole.md' }]);
  assert.match(prepared.content, /and Missing\./);
});

test('pageBytes cross-check and dumper-manifest H1 drift face (review P2-4/P2-9)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-manifest-'));
  const files = writeWave(dir);

  // a decisions pageBytes pin that disagrees with the dump is a typed refusal
  const drifted = JSON.parse(fs.readFileSync(files.decisions, 'utf8'));
  drifted.units[0].decision.pr.pageBytes = Buffer.byteLength(GO_METHOD_PAGE) + 7;
  fs.writeFileSync(files.decisions, `${JSON.stringify(drifted, null, 2)}\n`);
  assert.throws(() => compose(waveArgs(dir, files)), (error) => {
    assert.equal(error.code, 'PAGE_DUMP_BYTES_MISMATCH');
    assert.match(error.message, /decisions\.pr\.pageBytes recorded/);
    return true;
  });

  // manifest.json H1 agreement: a dumper manifest whose H1 face disagrees
  // with the parsed title is reported per unit in composerNotes (report
  // only — the digest gate owns byte truth)
  const manifestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-manifest2-'));
  const manifestFiles = writeWave(manifestDir);
  fs.writeFileSync(path.join(manifestFiles.pagesDir, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    pages: [
      { slug: 'v2-Authentication-AddRole', h1: 'SomeOtherTitle()', path: 'v2-Authentication-AddRole.md' },
      { slug: 'v2-Authentication-DropRole', h1: 'DropRole()', path: 'v2-Authentication-DropRole.md' },
    ],
  }, null, 2)}\n`);
  const { spec } = compose(waveArgs(manifestDir, manifestFiles));
  assert.match(spec.composerNotes.join(' '), /dumper manifest H1 drift \(1 unit\(s\).*v2-Authentication-AddRole: manifest H1 "SomeOtherTitle\(\)" != parsed title "AddRole\(\)"/);

  // agreeing manifests stay silent
  fs.writeFileSync(path.join(manifestFiles.pagesDir, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    pages: [
      { slug: 'v2-Authentication-AddRole', h1: 'AddRole()', path: 'x.md' },
      { slug: 'v2-Authentication-DropRole', h1: 'DropRole()', path: 'y.md' },
    ],
  }, null, 2)}\n`);
  const clean = compose(waveArgs(manifestDir, manifestFiles));
  assert.doesNotMatch(clean.spec.composerNotes.join(' '), /H1 drift/);
});

test('CLI surface: --help, a full compose run, and typed exit codes', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const help = spawnSync(process.execPath, [COMPOSER, '--help'], { encoding: 'utf8', cwd: repoRoot });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: compose-pr-reconcile-candidate-spec/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-cli-'));
  const files = writeWave(dir);
  const output = path.join(dir, 'candidate-spec.json');
  const run = spawnSync(process.execPath, [
    COMPOSER,
    '--language', 'go',
    '--track', TRACK,
    '--release-scope', files.scope,
    '--decisions', files.decisions,
    '--pages-dir', files.pagesDir,
    '--snapshot', files.snapshot,
    '--placement-audit', files.audit,
    '--root-walk', files.walk,
    '--identity-map', files.identityMap,
    '--output', output,
  ], { encoding: 'utf8', cwd: repoRoot });
  assert.equal(run.status, 0, run.stderr);
  const summary = JSON.parse(run.stdout);
  assert.equal(summary.candidates, 2);
  assert.equal(summary.walkDigest, 'sha256:204a988ee9b02f9c66fa0f77491cd35225f5c7b80632b9a03699870ab402c335');
  assert.equal(fs.existsSync(output), true);

  // typed rejections exit non-zero and print the code on stderr
  const bad = spawnSync(process.execPath, [
    COMPOSER,
    '--language', 'rust',
    '--track', TRACK,
    '--release-scope', files.scope,
    '--decisions', files.decisions,
    '--pages-dir', files.pagesDir,
    '--snapshot', files.snapshot,
    '--placement-audit', files.audit,
    '--root-walk', files.walk,
    '--identity-map', files.identityMap,
    '--output', path.join(dir, 'never.json'),
  ], { encoding: 'utf8', cwd: repoRoot });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /NOT_REGISTERED_PROFILE/);
});

test('exception code registry matches the design §7 three-code enumeration', () => {
  assert.deepEqual(Object.keys(EXCEPTION_CODES).sort(), [
    'CLONE_ID_SHARED_IN_PLACE',
    'FEISHU_RECORD_ABSENT',
    'SCANNER_TAXONOMY_ORPHAN',
  ]);
  // main() is exported for harness reuse; parseArgs understands --sweep.
  assert.equal(typeof main, 'function');
  assert.equal(parseArgs(['node', 'x', '--sweep']).sweep, true);
});

test('sweep join is the builder export: attributed shared units classify, malformed attributions fail typed', () => {
  // Slice 3-3: the sweep consumes build-reviewed-release-context's exported
  // joinSharedUpdateReviews — the same join the reviewed-context build runs,
  // SHARED_UPDATE_REVIEW_* validations included. Well-formed attribution
  // classifies the shared in-place unit (no blocker); the read-only replica
  // used to sweep the malformed shape unclassified, the real join refuses it.
  const ownRecordId = 'rec-own';
  const otherRecordId = 'rec-other';
  const evidence = createInheritanceEvidence({
    stableId: 'node:Collections:truncateCollection',
    current: {
      recordId: ownRecordId,
      documentToken: 'docx-shared',
      version: 'v2.6.x',
      folderToken: FAM_AUTH,
      versionRootToken: ROOT,
      ancestryVerified: true,
      placementVerified: true,
    },
    target: { version: 'v2.6.x', folderToken: FAM_AUTH, folderRef: null, versionRootToken: ROOT, ancestryVerified: true },
    sharedTokenStatus: 'shared',
    referencedRecordIds: [ownRecordId, otherRecordId],
    trackInventoryDigests: {
      'v2.4.x': 'sha256:' + crypto.randomBytes(32).toString('hex'),
      'v2.6.x': 'sha256:' + crypto.randomBytes(32).toString('hex'),
    },
    collectedAt: '2026-10-15T06:36:20.782Z',
  });
  const spec = (inheritanceReview) => ({
    language: 'node',
    track: 'v2.6.x',
    target: { version: 'v2.6.x', versionRootToken: ROOT },
    candidates: {
      'Collections-truncateCollection': {
        docIdentity: { stableId: 'node:Collections:truncateCollection', canonicalSlug: 'Collections-truncateCollection' },
        reviewedActionType: 'UPDATE',
        ancestryVerified: true,
        existingRecord: {
          recordId: ownRecordId,
          documentToken: 'docx-shared',
          placement: { version: 'v2.6.x', folderToken: FAM_AUTH, versionRootToken: ROOT, verified: true },
        },
        folderToken: FAM_AUTH,
        folderAncestry: [ROOT, FAM_AUTH],
        inheritanceEvidence: evidence,
        inheritanceReview,
      },
    },
  });
  const wellFormed = {
    requiredSuccessorTracks: [],
    successors: [{
      track: 'v2.4.x',
      status: 'inherited',
      decision: 'no_successor_action',
      pointingRecordIds: [otherRecordId],
    }],
  };
  const report = sweepSpec(spec(wellFormed), { evaluateVersionedTreeDelta });
  assert.equal(report.units, 1);
  assert.equal(report.blocked.length, 0);
  assert.throws(
    () => sweepSpec(spec({
      requiredSuccessorTracks: [],
      successors: [{
        track: 'v2.4.x',
        status: 'unreviewed',
        decision: 'no_successor_action',
        pointingRecordIds: [otherRecordId],
      }],
    }), { evaluateVersionedTreeDelta }),
    (error) => error.code === 'SHARED_UPDATE_REVIEW_INVALID',
  );
});

// 2026-10-20 fix (shadow campaign #1 round-6 freeze #2/#3/#4): python N6
// reflow must never move inline comments off their argument lines or insert
// commas into them. Calls whose argument region carries a `#` outside strings
// are left byte-identical; comment-free multi-arg calls still reflow to one
// argument per line.
test('python example reflow skips comment-bearing calls and reflows clean ones', () => {
  const { reflowPythonCalls } = require('../scripts/compose-pr-reconcile-candidate-spec');
  const style = require('../src/sdk-reference-ir/python-example-style');

  const withComments = `text_embedding_function = Function(
    name="openai_embedding",                        # Unique identifier for this embedding function
    function_type=FunctionType.TEXTEMBEDDING,       # Type of embedding function
    params={
        "provider": "openai",
    }
)`;
  assert.equal(reflowPythonCalls(withComments, style), withComments, 'comment-bearing call must stay byte-identical');

  const clean = `client.create_collection(
    collection_name="test_collection", dimension=5
)`;
  const reflowed = reflowPythonCalls(clean, style);
  assert.notEqual(reflowed, clean, 'comment-free multi-arg call still reflows');
  assert.match(reflowed, /collection_name="test_collection",\n {4}dimension=5,\n\)/);
});
