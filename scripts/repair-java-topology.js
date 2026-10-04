#!/usr/bin/env node
'use strict';

// Canonical-governed topology repair for the java tracks (2026-10-04 operator
// disposition, campaign-control hardening batch 2): fixes the operator-
// confirmed defect classes from scripts/audit-track-topology.js —
//   A. record Slug fields carrying pasted folder URLs → text form
//      (v2-<SectionName> / v2-<SectionName>-<symbol>);
//   B. FunctionChain family: the stray root-level folder moves under Vector
//      (the web-content placement is the single source of truth:
//      Vector/FunctionChain), the anchor docx joins it, and the five family
//      records get their missing Type field;
//   C. FunctionScore family: Vector/FunctionScore subdirectory created and
//      the four flat docs move in (v2.6.x form);
//   D. v2.6.x stray duplicate FunctionScore at Vector root is deleted
//      after every claimant is repointed to the in-folder copy — the repoint
//      writes {text, link} (never a bare-URL Docs string) and the delete
//      re-verifies its premises against live state before firing (stray
//      still present and same-named, retained copy still present, zero
//      Bitable claimants, and — via the REQUIRED --page-links-json
//      collect-page-blocks dump, checked at plan time and re-read fresh at
//      execution — zero page-block references).
//   E. v3.0.x Collections/Function anchor joins its family folder (2026-10-04
//      operator ruling: consistent with v2.6.x, where the anchor lives
//      inside Collections/Function beside FunctionType).
//   F. v2.4.x/v2.5.x dropDatabaseProperties restoration (2026-10-04
//      operator-approved main plan): both records pointed at a shared copy
//      that was later deleted (v2.6's record had been repointed; these two
//      were left dangling). Each track gets a freshly authored page under
//      its own Database folder — content from the upstream
//      web-content version, preflighted through the roundtrip gate and the
//      five content rules — then the record repoints at the new copy.
//
// Governance follows scripts/repair-same-name-placement.js: `plan` is
// read-only and prints the batch digest; `execute` requires
// --approve-batch-digest matching the plan and journals every action.
// Replay-safe guards and read-after-write verification on every mutation.
// Content writes (part F) run through the governed MarkdownToFeishu writer
// (WriterGovernance bound to this plan's digest + a run manifest), and the
// refetched page must round-trip byte-exactly against the draft through the
// same normalization the pre-write roundtrip gate uses.

const fs = require('node:fs');
const path = require('node:path');
const { spawnRun } = require('../.claude/skills/api-reference-sync/src/sdk-doc-sync/lark-cli-ops');
const { sha256Digest } = require('../.claude/skills/doc-ops-core/src/digest');
const {
    indexVersionRoot,
    listBitableRecords,
} = require('../.claude/skills/api-reference-sync/scripts/build-current-placement-audit');
const larkTokenFetcher = require('../.claude/skills/api-reference-sync/lib/lark-docs/larkTokenFetcher');
const {
    listLanguageTracks,
    loadReleaseTrackRegistry,
    trackBaseToken,
    trackReleaseRootToken,
} = require('../.claude/skills/api-reference-sync/src/sdk-doc-sync/release-track-registry');
const { folderTokenFromLink, documentTokenFromLink } = require('../.claude/skills/api-reference-sync/src/sdk-doc-sync/tree-delta-reconciliation');
const MarkdownToFeishu = require('../.claude/skills/api-reference-sync/src/markdown-to-feishu');
const { docxToIr } = require('../.claude/skills/api-reference-sync/src/document-ir/docx-to-ir');
const { renderMarkdown } = require('../.claude/skills/api-reference-sync/src/document-ir/ir-to-markdown');
// Reuse the verified-doc-authoring fixed-point normalization — the same
// comparison the pre-write roundtrip gate applies.
const { normalizeRefetchMarkdown } = require('./verified-doc-authoring/feishu-authoring-adapter');

const REGISTRY_PATH = path.join(__dirname, '..', '.claude', 'skills', 'api-reference-sync', 'config', 'release-tracks.json');
const JOURNAL_DIR = path.join(__dirname, '..', 'tmp', 'api-reference-sync', 'topology-repair');
const REPO_ROOT = path.join(__dirname, '..');

function slugText(field) {
    if (typeof field === 'string') return field;
    if (Array.isArray(field)) return field.map((run) => run?.text || '').join('');
    return '';
}

async function larkJson(args) {
    const result = await spawnRun('lark-cli', [...args, '--as', 'user', '--format', 'json']);
    const text = String(result.stdout || '').trim();
    const start = text.indexOf('{');
    const parsed = JSON.parse(start >= 0 ? text.slice(start) : text);
    if (parsed.code !== undefined && parsed.code !== 0) {
        throw new Error(`lark-cli ${args[0]} ${args[1] || ''} failed: ${JSON.stringify(parsed.error || parsed).slice(0, 200)}`);
    }
    return parsed;
}

async function listFolderDefault(folderToken) {
    const token = await new larkTokenFetcher().token();
    const query = new URLSearchParams({ folder_token: folderToken, page_size: '200' });
    const files = [];
    let pageToken = null;
    do {
        const q = new URLSearchParams(query);
        if (pageToken) q.set('page_token', pageToken);
        const response = await fetch(`https://open.feishu.cn/open-apis/drive/v1/files?${q.toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();
        if (data.code !== 0) throw new Error(`listFolder failed: ${data.msg}`);
        files.push(...(data.data?.files || []));
        pageToken = data.data?.has_more ? data.data.next_page_token : null;
    } while (pageToken);
    return files;
}

async function verifyWithRetry(check, attempts = 6) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const result = await check();
        if (result.ok) return result;
        await new Promise((resolve) => setTimeout(resolve, attempt * 800));
    }
    return check();
}

async function resolveTableId(baseToken) {
    // lark-cli api rejects query strings in the path — pass --params instead.
    const data = await larkJson(['api', 'GET', `/open-apis/bitable/v1/apps/${baseToken}/tables`, '--params', '{"page_size":100}']);
    const first = (data.data?.items || [])[0];
    if (!first?.table_id) throw new Error(`No tables found in Bitable ${baseToken}`);
    return first.table_id;
}

function planDigest(plan) {
    return sha256Digest(Buffer.from(`${JSON.stringify(plan.actions)}`, 'utf8'));
}

// The plan's own approval (--approve-batch-digest, verified at entry) is the
// operator decision the governed writer envelope binds; the run manifest
// pins the working-tree source state (re-verified on first mutation).
function defaultGovernanceFactory({ digest, actionCount, targets }) {
    const { WriterGovernance } = require('../.claude/skills/doc-ops-core/src/writer-governance');
    const { createApprovalEnvelope } = require('../.claude/skills/doc-ops-core/src/approval-guard');
    const { createRunManifest } = require('../.claude/skills/doc-ops-core/src/run-manifest');
    const skill = 'api-reference-sync';
    const operation = 'topology-repair';
    const sideEffects = ['create-document'];
    const governance = new WriterGovernance({ skill, operation });
    governance.bindApproval({
        batchDigest: digest,
        actionCount,
        targets,
        sideEffects,
        approval: createApprovalEnvelope({ skill, operation, batchDigest: digest, actionCount, targets, sideEffects, decision: 'approved' }),
    });
    governance.bindRunManifest(createRunManifest({
        skill,
        skillVersion: 'repair-java-topology@2',
        repoRoot: REPO_ROOT,
        batchDigest: digest,
        sessionDigest: `repair:${digest}`,
    }), { repoRoot: REPO_ROOT });
    return governance;
}

async function defaultMarkdownWriterFactory(governance) {
    return new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null, governance });
}

async function defaultRefetchMarkdown(writer, documentId) {
    const blocks = await writer.get_document_blocks(documentId);
    const ir = docxToIr(blocks, { metadata: { token: documentId } });
    return normalizeRefetchMarkdown(renderMarkdown(ir, { lossy: true }));
}

async function buildPlan(deps = {}) {
    const registry = deps.registry || loadReleaseTrackRegistry(REGISTRY_PATH);
    const indexVersionRootFn = deps.indexVersionRoot || indexVersionRoot;
    const listBitableRecordsFn = deps.listBitableRecords || listBitableRecords;
    // Local binding shadows the module-level helper so injected test doubles
    // reach every part below.
    const listFolder = deps.listFolder || listFolderDefault;
    const tokenFetcher = deps.tokenFetcher || new larkTokenFetcher();
    const tracks = listLanguageTracks(registry, 'java');
    const trackByVersion = new Map(tracks.map((t) => [t.version, t]));
    const indexes = new Map();
    const recordsByTrack = new Map();
    for (const version of ['v2.4.x', 'v2.5.x', 'v2.6.x', 'v3.0.x']) {
        const track = trackByVersion.get(version);
        indexes.set(version, await indexVersionRootFn(tokenFetcher, trackReleaseRootToken(track)));
        recordsByTrack.set(version, await listBitableRecordsFn(tokenFetcher, trackBaseToken(track), null));
    }
    const actions = [];
    const notes = [];

    // ---- A. Docs-field text fixes ---------------------------------------
    // The Slug column is a READONLY formula: "v2-" + 父记录 title + "-" +
    // Docs.name. The URL-slug defect is the Docs field's DISPLAY TEXT (the
    // pasted folder URL); fixing a section VirtualNode's Docs text to the
    // folder name heals every family page slug through the formula. Both
    // tracks are scanned — the 2026-10-04 disposition covered v3.0.x
    // (Database, Partitions, ResourceGroup) and v2.6.x (Collections); any
    // later URL-text VirtualNode heals the same way.
    for (const [version, records] of recordsByTrack) {
        const folderNameByToken = new Map([...indexes.get(version).entries()].map(([token, entry]) => [token, entry.name]));
        for (const record of records) {
            if (slugText(record.fields?.Type) !== 'VirtualNode') continue;
            const docs = record.fields?.Docs || {};
            const text = String(docs.text ?? (Array.isArray(docs) ? slugText(docs) : '') ?? '');
            if (!text.startsWith('http')) continue;
            const link = docs.link || docs.url || '';
            const folderToken = folderTokenFromLink(link);
            const folderName = folderNameByToken.get(folderToken);
            if (!folderName) throw new Error(`cannot resolve folder name for ${record.record_id} (${folderToken}) — replan`);
            actions.push({
                kind: 'update-record-docs-text',
                track: version,
                recordId: record.record_id,
                text: folderName,
                link,
                expectedSlug: `v2-${folderName}`,
                from: text.slice(0, 90),
                detail: `Docs text URL → "${folderName}" (link unchanged); Slug formula heals the family`,
            });
        }
    }

    // ---- B. FunctionChain family归位 (v3.0.x) ---------------------------
    const v30Index = indexes.get('v3.0.x');
    const v30Root = trackReleaseRootToken(trackByVersion.get('v3.0.x'));
    const vectorFolder = [...v30Index.values()].find((e) => e.type === 'folder' && e.name === 'Vector');
    if (!vectorFolder) throw new Error('v3.0.x Vector folder not found');
    const strayChainFolder = [...v30Index.values()].find((e) => e.type === 'folder' && e.name === 'FunctionChain' && e.parentFolderToken === v30Root);
    const chainFolderUnderVector = [...v30Index.values()].find((e) => e.type === 'folder' && e.name === 'FunctionChain' && e.ancestors.includes(vectorFolder.token));
    if (strayChainFolder && !chainFolderUnderVector) {
        const vectorChildren = await listFolder(vectorFolder.token);
        if (vectorChildren.some((c) => c.name === 'FunctionChain' && (c.type || 'folder') === 'folder')) throw new Error('T1 guard: a FunctionChain FOLDER already exists under v3.0.x Vector — replan');
        const strayChildren = await listFolder(strayChainFolder.token);
        const expected = ['FunctionParamValue', 'FunctionChainStage', 'FunctionChainOp', 'FunctionChainExpr', 'FunctionChainArg'];
        const strayNames = strayChildren.map((c) => c.name).sort();
        if (JSON.stringify(strayNames) !== JSON.stringify(expected.sort())) {
            throw new Error(`stray FunctionChain folder contents drifted from expectation: ${JSON.stringify(strayNames)} — replan`);
        }
        actions.push({ kind: 'move-folder', ref: 'functionchain-folder', folderToken: strayChainFolder.token, toFolderToken: vectorFolder.token, detail: 'stray root-level FunctionChain folder → Vector/FunctionChain (web-content placement)' });
        const anchor = [...v30Index.values()].find((e) => e.type !== 'folder' && e.name === 'FunctionChain' && e.parentFolderToken === vectorFolder.token);
        if (anchor) {
            actions.push({ kind: 'move-document', ref: 'functionchain-anchor', documentToken: anchor.token, toFolderRef: 'functionchain-folder', detail: 'FunctionChain anchor docx joins its family folder' });
        } else {
            notes.push('FunctionChain anchor docx not found flat under v3.0.x Vector — skipping anchor move');
        }
        // The five family records carry an empty Type — fill it (all are
        // java classes in the upstream source).
        for (const record of recordsByTrack.get('v3.0.x')) {
            const slug = slugText(record.fields?.Slug);
            if (slug.startsWith('v2-FunctionChain-') && !slugText(record.fields?.Type)) {
                actions.push({ kind: 'update-record-field', track: 'v3.0.x', recordId: record.record_id, field: 'Type', value: 'Class', from: '(empty)' });
            }
        }
    } else if (chainFolderUnderVector) {
        notes.push('FunctionChain already under v3.0.x Vector — family placement already correct');
    }

    // ---- C. FunctionScore family归位 (v3.0.x) ---------------------------
    const scoreFolderUnderVector = [...v30Index.values()].find((e) => e.type === 'folder' && e.name === 'FunctionScore' && e.parentFolderToken === vectorFolder.token);
    if (!scoreFolderUnderVector) {
        const vectorChildren = await listFolder(vectorFolder.token);
        if (vectorChildren.some((c) => c.name === 'FunctionScore' && (c.type || 'folder') === 'folder')) throw new Error('T1 guard: a FunctionScore FOLDER already exists under v3.0.x Vector — replan');
        // Only the family docs actually flat under v3.0.x Vector move; pages
        // whose records point at older-tree documents (getFunctions/getParams)
        // are the designed page-level fallback form and stay untouched.
        const FAMILY = ['FunctionScore', 'addFunction()', 'getFunctions()', 'getParams()'];
        const flatDocs = vectorChildren.filter((c) => c.type === 'docx' && FAMILY.includes(c.name));
        if (flatDocs.length === 0) throw new Error('no flat FunctionScore family docs under v3.0.x Vector — replan');
        const absent = FAMILY.filter((name) => !flatDocs.some((c) => c.name === name));
        if (absent.length > 0) notes.push(`FunctionScore family members not flat under v3.0.x Vector (expected page-level fallback in older trees): ${absent.join(', ')}`);
        actions.push({ kind: 'create-folder', ref: 'functionscore-folder', name: 'FunctionScore', parentFolderToken: vectorFolder.token });
        for (const doc of flatDocs) {
            actions.push({ kind: 'move-document', ref: `functionscore:${doc.token}`, documentToken: doc.token, toFolderRef: 'functionscore-folder', detail: `${doc.name} → Vector/FunctionScore` });
        }
    } else {
        notes.push('FunctionScore folder already exists under v3.0.x Vector');
    }

    // ---- D. v2.6.x stray duplicate FunctionScore ------------------------
    // Protected lineage: a delete may only be planned against a supplied
    // collect-page-blocks dump (percent-decoded docx tokens) — page blocks
    // may reference the stray even when no Bitable record does.
    const pageLinkTokens = deps.pageLinkTokens ?? null;
    const v26Index = indexes.get('v2.6.x');
    const v26Vector = [...v26Index.values()].find((e) => e.type === 'folder' && e.name === 'Vector');
    const v26ScoreFolder = v26Vector && [...v26Index.values()].find((e) => e.type === 'folder' && e.name === 'FunctionScore' && e.parentFolderToken === v26Vector.token);
    const strayScore = v26Vector && [...v26Index.values()].find((e) => e.type !== 'folder' && e.name === 'FunctionScore' && e.parentFolderToken === v26Vector.token);
    const inFolderScore = v26ScoreFolder && [...v26Index.values()].find((e) => e.type !== 'folder' && e.name === 'FunctionScore' && e.parentFolderToken === v26ScoreFolder.token);
    if (strayScore && inFolderScore && strayScore.token !== inFolderScore.token) {
        if (pageLinkTokens === null) {
            throw new Error('part D requires --page-links-json (a collect-page-blocks dump): page blocks may reference the stray even when no Bitable record does — replan with the dump');
        }
        if (pageLinkTokens.includes(strayScore.token)) {
            throw new Error(`page blocks still reference the stray FunctionScore copy ${strayScore.token} — disposition the references first (replan)`);
        }
        // Make sure no v2.6 record still claims the stray copy before deleting.
        // The repoint writes {text, link} — a bare-URL Docs string poisons
        // every family slug through the Slug formula (2026-10-04 defect
        // class; TOPOLOGY_RECORD_SLUG_URL).
        const claimants = recordsByTrack.get('v2.6.x').filter((r) => documentTokenFromLink(r.fields?.Docs?.link || r.fields?.Docs?.url || '') === strayScore.token);
        for (const claimant of claimants) {
            actions.push({
                kind: 'update-record-docs-text',
                track: 'v2.6.x',
                recordId: claimant.record_id,
                text: inFolderScore.name,
                link: `https://zilliverse.feishu.cn/docx/${inFolderScore.token}`,
                expectedSlug: slugText(claimant.fields?.Slug),
                from: `stray Vector-root copy (${strayScore.token})`,
                detail: `claimant repointed to the in-folder copy before the stray is deleted (text "${inFolderScore.name}")`,
            });
        }
        actions.push({
            kind: 'delete-document',
            ref: `stray:${strayScore.token}`,
            documentToken: strayScore.token,
            documentName: strayScore.name,
            // Execution-time re-verification premises (checked live before
            // the unreplayable delete fires).
            parentFolderToken: v26Vector.token,
            duplicateOfToken: inFolderScore.token,
            duplicateOfParentToken: v26ScoreFolder.token,
            pageLinksJsonPath: deps.pageLinksJsonPath || null,
            detail: 'v2.6.x duplicate FunctionScore at Vector root (in-folder copy retained; delete lands in Drive trash)',
        });
    } else {
        notes.push('v2.6.x stray FunctionScore not found (or already cleaned)');
    }

    // ---- E. v3.0.x Collections/Function anchor归位 -----------------------
    // 2026-10-04 operator ruling: the anchor docx belongs INSIDE the family
    // folder, consistent with v2.6.x (folder holds Function + FunctionType,
    // method pages flat in Collections). Upstream web-content placement
    // (Function.md beside Function/) is the semantic source, not a placement
    // template for this tree.
    const collectionsFolder = (() => {
        for (const record of recordsByTrack.get('v3.0.x')) {
            if (slugText(record.fields?.Type) !== 'VirtualNode') continue;
            const token = folderTokenFromLink(record.fields?.Docs?.link || record.fields?.Docs?.url || '');
            const entry = token && v30Index.get(token);
            if (entry && entry.type === 'folder' && entry.name === 'Collections') return entry;
        }
        return null;
    })();
    if (collectionsFolder) {
        const fnFolder = [...v30Index.values()].find((e) => e.type === 'folder' && e.name === 'Function' && e.parentFolderToken === collectionsFolder.token);
        const besideAnchor = [...v30Index.values()].find((e) => e.type !== 'folder' && e.name === 'Function' && e.parentFolderToken === collectionsFolder.token);
        const inFolderAnchor = fnFolder && [...v30Index.values()].find((e) => e.type !== 'folder' && e.name === 'Function' && e.parentFolderToken === fnFolder.token);
        if (besideAnchor && inFolderAnchor) {
            throw new Error('v3.0.x Collections has Function anchors BOTH beside and inside the family folder — duplicate class, replan');
        }
        if (fnFolder && besideAnchor) {
            actions.push({ kind: 'move-document', ref: 'collections-function-anchor', documentToken: besideAnchor.token, toFolderToken: fnFolder.token, detail: 'v3.0.x Collections/Function anchor joins its family folder (2026-10-04 operator ruling, v2.6.x form)' });
        } else if (inFolderAnchor) {
            notes.push('v3.0.x Collections/Function anchor already inside the family folder');
        } else {
            notes.push(`v3.0.x Collections/Function: familyFolder=${Boolean(fnFolder)} besideAnchor=${Boolean(besideAnchor)} — no anchor-beside-folder form, nothing to do`);
        }
    } else {
        notes.push('v3.0.x Collections folder (VirtualNode target) not found — part E skipped');
    }

    // ---- F. v2.4.x/v2.5.x dropDatabaseProperties restoration -------------
    // Both records point at a shared copy that was deleted; each track gets
    // a freshly authored page under its own Database folder and the record
    // repoints at it. The draft is supplied via --page-markdown-file and is
    // inlined into the plan (content-bound by the batch digest) — it must
    // already pass the roundtrip gate and the five content rules.
    const RESTORE_SLUG = 'v2-Database-dropDatabaseProperties';
    const anyIndexHas = (token) => token && [...indexes.values()].some((index) => index.has(token));
    const pageMarkdown = typeof deps.pageMarkdown === 'string' ? deps.pageMarkdown : null;
    for (const version of ['v2.4.x', 'v2.5.x']) {
        const dead = (recordsByTrack.get(version) || []).filter((r) => {
            if (slugText(r.fields?.Slug) !== RESTORE_SLUG) return false;
            const token = documentTokenFromLink(r.fields?.Docs?.link || r.fields?.Docs?.url || '');
            return Boolean(token) && !anyIndexHas(token);
        });
        if (dead.length === 0) {
            notes.push(`${version} ${RESTORE_SLUG}: healthy or absent — nothing to restore`);
            continue;
        }
        if (dead.length > 1) throw new Error(`${version} carries ${dead.length} ${RESTORE_SLUG} records — replan`);
        const record = dead[0];
        const releaseRoot = trackReleaseRootToken(trackByVersion.get(version));
        const dbFolder = [...indexes.get(version).values()].find((e) => e.type === 'folder' && e.name === 'Database' && e.parentFolderToken === releaseRoot);
        if (!dbFolder) throw new Error(`${version} has no Database folder under its release root — CREATE_FOLDER_THEN_REPOINT disposition required, replan`);
        if (!pageMarkdown) throw new Error(`${version} ${RESTORE_SLUG} is dead-linked but no restoration draft was supplied (--page-markdown-file) — replan`);
        const ref = `restore:${version}`;
        actions.push({
            kind: 'create-document',
            ref,
            track: version,
            folderToken: dbFolder.token,
            title: 'dropDatabaseProperties()',
            markdown: pageMarkdown,
            markdownSha256: sha256Digest(Buffer.from(pageMarkdown, 'utf8')),
            detail: `${RESTORE_SLUG} restoration — record pointed at a deleted shared copy (2026-10-04 operator-approved main plan)`,
        });
        actions.push({
            kind: 'update-record-docs-text',
            track: version,
            recordId: record.record_id,
            text: 'dropDatabaseProperties()',
            linkRef: ref,
            expectedSlug: slugText(record.fields?.Slug),
            from: 'dead link (deleted shared copy)',
            detail: 'repoint to the restored in-tree page',
        });
    }

    return { generatedAt: new Date().toISOString(), actions, notes };
}

async function executePlan({ plan, approvedDigest, journalPath, deps = {} }) {
    const digest = planDigest(plan);
    if (String(approvedDigest).trim() !== digest) {
        const error = new Error(`REFUSED: approved digest does not match the plan (plan ${digest}, approved ${approvedDigest})`);
        error.code = 'REPAIR_PLAN_APPROVAL_MISMATCH';
        throw error;
    }
    const larkJsonFn = deps.larkJson || larkJson;
    const listFolderFn = deps.listFolder || listFolderDefault;
    const listBitableRecordsFn = deps.listBitableRecords || listBitableRecords;
    const resolveTableIdFn = deps.resolveTableId || resolveTableId;
    const verifyWithRetryFn = deps.verifyWithRetry || verifyWithRetry;
    const registry = (deps.loadRegistry || (() => loadReleaseTrackRegistry(REGISTRY_PATH)))();
    const baseByTrack = new Map(listLanguageTracks(registry, 'java').map((t) => [t.version, trackBaseToken(t)]));
    const createdFolders = new Map();
    const createdDocuments = new Map();
    let governanceInstance = null;
    // Lazy, once per run: content writes bind this plan's digest (the same
    // digest the operator approved via --approve-batch-digest) into the
    // governed writer envelope plus an immutable run manifest.
    const getGovernance = () => {
        if (governanceInstance) return governanceInstance;
        const factory = deps.governanceFactory || defaultGovernanceFactory;
        governanceInstance = factory({
            digest,
            actionCount: plan.actions.length,
            targets: plan.actions.map((action) => action.ref || action.recordId || action.documentToken).filter(Boolean),
        });
        return governanceInstance;
    };
    const journal = [];
    const appendJournal = (entry) => {
        journal.push(entry);
        fs.mkdirSync(JOURNAL_DIR, { recursive: true });
        fs.writeFileSync(journalPath, `${JSON.stringify({ planDigest: digest, journal }, null, 1)}\n`);
    };
    const tokenFetcher = deps.tokenFetcher || new larkTokenFetcher();

    let index = 0;
    for (const action of plan.actions) {
        index += 1;
        const entry = { index, action };
        try {
            if (action.kind === 'update-record-field') {
                if (action.field === 'Docs') {
                    // Close the producer entirely: the Docs cell is {text,
                    // link} via update-record-docs-text only — a hand-built
                    // plan must not smuggle a bare-URL string through the
                    // generic path (2026-10-04 defect class).
                    const forbidden = new Error('update-record-field refuses Docs writes — use update-record-docs-text ({text, link})');
                    forbidden.code = 'REPAIR_DOCS_FIELD_FORBIDDEN';
                    throw forbidden;
                }
                const baseToken = baseByTrack.get(action.track);
                const tableId = await resolveTableIdFn(baseToken);
                await larkJsonFn([
                    'base', '+record-batch-update',
                    '--base-token', baseToken,
                    '--table-id', tableId,
                    '--json', JSON.stringify({ update_records: { [action.recordId]: { [action.field]: action.value } } }),
                ]);
                const check = await verifyWithRetryFn(async () => {
                    const after = await listBitableRecordsFn(tokenFetcher, baseToken, null);
                    const reread = after.find((r) => r.record_id === action.recordId);
                    const value = slugText(reread?.fields?.[action.field]);
                    return { ok: value.includes(String(action.value).split('/').pop() || action.value), value };
                });
                if (!check.ok) throw new Error(`field update not verifiable: ${check.value}`);
                entry.result = { field: action.field, verified: true };
            } else if (action.kind === 'update-record-docs-text') {
                const baseToken = baseByTrack.get(action.track);
                const tableId = await resolveTableIdFn(baseToken);
                // linkRef resolves to a document created earlier in this
                // plan (part F repoints at the freshly authored page).
                const resolvedToken = action.linkRef ? createdDocuments.get(action.linkRef) : null;
                if (action.linkRef && !resolvedToken) {
                    throw new Error(`unresolved linkRef ${action.linkRef} for record ${action.recordId} — the create-document action must precede this repoint`);
                }
                const link = resolvedToken ? `https://zilliverse.feishu.cn/docx/${resolvedToken}` : action.link;
                // The batch-update validator rejects {text,link} URL cells;
                // the raw records PUT accepts them. Never write a bare-URL
                // string — the Slug formula poisons the family slugs.
                await larkJsonFn([
                    'api', 'PUT',
                    `/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/records/${action.recordId}`,
                    '--data', JSON.stringify({ fields: { Docs: { text: action.text, link } } }),
                ]);
                const check = await verifyWithRetryFn(async () => {
                    const after = await listBitableRecordsFn(tokenFetcher, baseToken, null);
                    const reread = after.find((r) => r.record_id === action.recordId);
                    const docs = reread?.fields?.Docs || {};
                    const text = String(docs.text ?? '');
                    const slugNow = slugText(reread?.fields?.Slug);
                    // The Slug is "v2-" + parent title + "-" + Docs.name: a
                    // section VirtualNode heals to "v2-<name>", a page record
                    // to "v2-<section>-<name>". A plan-supplied expectedSlug
                    // pins the exact terminal form (a repoint must not move
                    // the slug at all); otherwise accept the tail-match form.
                    const slugOk = action.expectedSlug ? slugNow === action.expectedSlug : slugNow.endsWith(action.text);
                    const liveToken = documentTokenFromLink(docs.link || docs.url || '');
                    return { ok: text === action.text && !slugNow.includes('http') && slugOk && liveToken === documentTokenFromLink(link), text, slugNow };
                }, 10);
                if (!check.ok) throw new Error(`Docs text / Slug formula not verifiable: text=${check.text} slug=${JSON.stringify(check.slugNow)}`);
                entry.result = { text: action.text, slug: check.slugNow, verified: true };
            } else if (action.kind === 'create-document') {
                // Governed content write: the page is authored from the
                // plan-inlined draft through MarkdownToFeishu (WriterGovernance
                // bound to this plan's digest + run manifest), then the
                // refetched page must round-trip byte-exactly against the
                // draft — the same comparison the pre-write roundtrip gate
                // applies. A failed verification rolls the fresh copy back
                // (nothing depends on a document created seconds ago).
                const content = String(action.markdown);
                if (sha256Digest(Buffer.from(content, 'utf8')) !== action.markdownSha256) {
                    throw new Error(`create-document ${action.ref}: markdown digest mismatch (plan ${action.markdownSha256}) — replan`);
                }
                const writerFactory = deps.markdownWriterFactory || defaultMarkdownWriterFactory;
                const writer = await writerFactory(getGovernance());
                const pushed = await writer.push_markdown({ markdown_content: content, title: action.title, folder_token: action.folderToken });
                const documentId = pushed?.document_id || pushed?.documentId;
                if (!documentId) throw new Error(`push_markdown returned no document id: ${JSON.stringify(pushed).slice(0, 160)}`);
                createdDocuments.set(action.ref, documentId);
                const refetch = deps.refetchMarkdown || defaultRefetchMarkdown;
                const live = await refetch(writer, documentId);
                if (live !== content) {
                    createdDocuments.delete(action.ref);
                    let rollback = 'ROLLBACK DELETE FAILED — MANUAL CLEANUP REQUIRED';
                    try {
                        await larkJsonFn(['drive', '+delete', '--file-token', documentId, '--type', 'docx', '--yes']);
                        rollback = 'rolled back (created copy deleted; Drive trash)';
                    } catch (deleteError) {
                        rollback = `${rollback} (delete error: ${deleteError.message})`;
                    }
                    throw new Error(`created document ${documentId} failed round-trip verification — ${rollback}; draft sha ${action.markdownSha256}, live sha ${sha256Digest(Buffer.from(live, 'utf8'))}`);
                }
                entry.result = { documentId, blocksCreated: pushed.blocks_created ?? null, roundtripVerified: true };
            } else if (action.kind === 'create-folder') {
                const siblings = await listFolderFn(action.parentFolderToken);
                const existingFolder = siblings.find((c) => c.name === action.name && (c.type || 'folder') === 'folder');
                if (existingFolder) {
                    // Replay-safe adoption: a partially executed prior run (or a
                    // race) created the folder; adopt it and continue.
                    const existingToken = existingFolder.token || existingFolder.file_token;
                    createdFolders.set(action.ref, existingToken);
                    entry.result = { folderToken: existingToken, alreadyExisted: true };
                } else {
                    const created = await larkJsonFn(['drive', '+create-folder', '--folder-token', action.parentFolderToken, '--name', action.name]);
                    const token = created?.data?.folder_token || created?.data?.token || created?.data?.folder?.token || created?.token;
                    if (!token) throw new Error(`create-folder returned no token: ${JSON.stringify(created).slice(0, 160)}`);
                    createdFolders.set(action.ref, token);
                    entry.result = { folderToken: token };
                }
            } else if (action.kind === 'move-folder' || action.kind === 'move-document') {
                const fileToken = action.folderToken || action.documentToken;
                if (action.kind === 'move-folder') {
                    // A moved folder becomes a resolvable target for actions
                    // that reference it (the anchor doc joining its family).
                    createdFolders.set(action.ref, fileToken);
                }
                const toFolder = createdFolders.get(action.toFolderRef) || action.toFolderToken;
                if (!toFolder) throw new Error(`unresolved target folder for ${action.ref}`);
                const children = await listFolderFn(toFolder);
                if (!children.some((c) => (c.token || c.file_token) === fileToken)) {
                    await larkJsonFn(['drive', '+move', '--file-token', fileToken, '--folder-token', toFolder, '--type', action.kind === 'move-folder' ? 'folder' : 'docx']);
                }
                const placed = await verifyWithRetryFn(async () => {
                    const after = await listFolderFn(toFolder);
                    return { ok: after.some((c) => (c.token || c.file_token) === fileToken) };
                });
                if (!placed.ok) throw new Error(`${fileToken} not found under ${toFolder} after move`);
                entry.result = { toFolderToken: toFolder, verified: true };
            } else if (action.kind === 'delete-document') {
                // Unreplayable action: re-verify every premise against live
                // state before it fires (plan and execution can be far
                // apart). A prior run's delete is adopted idempotently.
                const parentChildren = await listFolderFn(action.parentFolderToken);
                const strayLive = parentChildren.find((c) => (c.token || c.file_token) === action.documentToken);
                if (!strayLive) {
                    entry.result = { deleted: true, alreadyAbsent: true };
                } else {
                    if (String(strayLive.name) !== String(action.documentName)) {
                        throw new Error(`stray document name drifted: planned "${action.documentName}", live is "${strayLive.name}" — replan`);
                    }
                    const dupChildren = await listFolderFn(action.duplicateOfParentToken);
                    const duplicateLive = dupChildren.some((c) => (c.token || c.file_token) === action.duplicateOfToken);
                    if (!duplicateLive) {
                        throw new Error(`retained copy ${action.duplicateOfToken} no longer exists — refusing to delete the stray — replan`);
                    }
                    // Claimant re-sweep: no record in either java track may
                    // still point at the stray token.
                    for (const [version, baseToken] of baseByTrack) {
                        const records = await listBitableRecordsFn(tokenFetcher, baseToken, null);
                        const stale = records.filter((r) => documentTokenFromLink(r.fields?.Docs?.link || r.fields?.Docs?.url || '') === action.documentToken);
                        if (stale.length > 0) {
                            throw new Error(`${stale.length} ${version} record(s) still claim the stray ${action.documentToken} — replan`);
                        }
                    }
                    // Page-block claimants: when the plan binds a
                    // collect-page-blocks dump, re-read it fresh and refuse
                    // if any page still references the stray token.
                    if (action.pageLinksJsonPath) {
                        const tokens = JSON.parse(fs.readFileSync(action.pageLinksJsonPath, 'utf8'));
                        if (Array.isArray(tokens) && tokens.includes(action.documentToken)) {
                            throw new Error(`page blocks still reference ${action.documentToken} per ${action.pageLinksJsonPath} — disposition the references first (replan)`);
                        }
                    }
                    await larkJsonFn(['drive', '+delete', '--file-token', action.documentToken, '--type', 'docx', '--yes']);
                    entry.result = { deleted: true, trash: true };
                }
            } else {
                throw new Error(`unknown action kind ${action.kind}`);
            }
            entry.ok = true;
        } catch (error) {
            entry.ok = false;
            entry.error = error.message;
            appendJournal(entry);
            const wrapped = new Error(`action ${index}/${plan.actions.length} (${action.kind} ${action.ref || action.recordId}) failed: ${error.message}`);
            wrapped.code = error.code || 'REPAIR_ACTION_FAILED';
            throw wrapped;
        }
        appendJournal(entry);
    }
    return { digest, journal: journal.length };
}

async function main(argv = process.argv) {
    const mode = argv[2] || 'plan';
    const options = {};
    for (let i = 3; i < argv.length; i += 1) {
        if (argv[i] === '--approve-batch-digest') options.approvedDigest = argv[++i];
        else if (argv[i] === '--plan-json') options.planJson = argv[++i];
        else if (argv[i] === '--page-links-json') options.pageLinksJson = argv[++i];
        else if (argv[i] === '--page-markdown-file') options.pageMarkdownFile = argv[++i];
        else throw new Error(`Unknown argument: ${argv[i]}`);
    }
    if (mode === 'plan') {
        const pageLinkTokens = options.pageLinksJson
            ? JSON.parse(fs.readFileSync(options.pageLinksJson, 'utf8'))
            : null;
        const pageMarkdown = options.pageMarkdownFile
            ? fs.readFileSync(options.pageMarkdownFile, 'utf8')
            : null;
        const plan = await buildPlan({ pageLinkTokens, pageLinksJsonPath: options.pageLinksJson || null, pageMarkdown });
        fs.mkdirSync(JOURNAL_DIR, { recursive: true });
        const planPath = path.join(JOURNAL_DIR, `plan-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 1)}\n`);
        process.stdout.write(`${JSON.stringify({ ...plan, digest: planDigest(plan), planPath }, null, 1)}\n`);
        return;
    }
    if (mode === 'execute') {
        if (!options.approvedDigest) throw new Error('execute requires --approve-batch-digest <digest> (review the plan first)');
        if (!options.planJson) throw new Error('execute requires --plan-json <file>');
        const plan = JSON.parse(fs.readFileSync(options.planJson, 'utf8'));
        const journalPath = path.join(JOURNAL_DIR, `journal-${planDigest(plan).slice(7, 19)}.json`);
        const result = await executePlan({ plan, approvedDigest: options.approvedDigest, journalPath });
        process.stdout.write(`${JSON.stringify({ ...result, journalPath }, null, 1)}\n`);
        return;
    }
    throw new Error(`Unknown mode: ${mode} (plan | execute)`);
}

if (require.main === module) {
    main(process.argv).catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}

module.exports = { buildPlan, executePlan, planDigest };
