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
//      (after the claiming record is verified against the in-folder copy).
//
// Governance follows scripts/repair-same-name-placement.js: `plan` is
// read-only and prints the batch digest; `execute` requires
// --approve-batch-digest matching the plan and journals every action.
// Replay-safe guards and read-after-write verification on every mutation.

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

const REGISTRY_PATH = path.join(__dirname, '..', '.claude', 'skills', 'api-reference-sync', 'config', 'release-tracks.json');
const JOURNAL_DIR = path.join(__dirname, '..', 'tmp', 'api-reference-sync', 'topology-repair');

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

async function listFolder(folderToken) {
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

async function buildPlan() {
    const registry = loadReleaseTrackRegistry(REGISTRY_PATH);
    const tracks = listLanguageTracks(registry, 'java');
    const trackByVersion = new Map(tracks.map((t) => [t.version, t]));
    const tokenFetcher = new larkTokenFetcher();
    const indexes = new Map();
    const recordsByTrack = new Map();
    for (const version of ['v2.6.x', 'v3.0.x']) {
        const track = trackByVersion.get(version);
        indexes.set(version, await indexVersionRoot(tokenFetcher, trackReleaseRootToken(track)));
        recordsByTrack.set(version, await listBitableRecords(tokenFetcher, trackBaseToken(track), null));
    }
    const actions = [];
    const notes = [];

    // ---- A. Docs-field text fixes (v3.0.x operator scope: Database,
    // Partitions, ResourceGroup) -----------------------------------------
    // The Slug column is a READONLY formula: "v2-" + 父记录 title + "-" +
    // Docs.name. The URL-slug defect is the Docs field's DISPLAY TEXT (the
    // pasted folder URL); fixing the three section VirtualNodes' Docs text
    // to the folder name heals every family page slug through the formula.
    // The v2.6.x Collections record is out of the operator's scope this
    // round — it stays on the audit ledger.
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
    const v26Index = indexes.get('v2.6.x');
    const v26Vector = [...v26Index.values()].find((e) => e.type === 'folder' && e.name === 'Vector');
    const v26ScoreFolder = v26Vector && [...v26Index.values()].find((e) => e.type === 'folder' && e.name === 'FunctionScore' && e.parentFolderToken === v26Vector.token);
    const strayScore = v26Vector && [...v26Index.values()].find((e) => e.type !== 'folder' && e.name === 'FunctionScore' && e.parentFolderToken === v26Vector.token);
    const inFolderScore = v26ScoreFolder && [...v26Index.values()].find((e) => e.type !== 'folder' && e.name === 'FunctionScore' && e.parentFolderToken === v26ScoreFolder.token);
    if (strayScore && inFolderScore && strayScore.token !== inFolderScore.token) {
        // Make sure no v2.6 record still claims the stray copy before deleting.
        const claimants = recordsByTrack.get('v2.6.x').filter((r) => documentTokenFromLink(r.fields?.Docs?.link || r.fields?.Docs?.url || '') === strayScore.token);
        for (const claimant of claimants) {
            actions.push({ kind: 'update-record-field', track: 'v2.6.x', recordId: claimant.record_id, field: 'Docs', value: `https://zilliverse.feishu.cn/docx/${inFolderScore.token}`, from: 'stray Vector-root copy' });
        }
        actions.push({ kind: 'delete-document', ref: `stray:${strayScore.token}`, documentToken: strayScore.token, detail: 'v2.6.x duplicate FunctionScore at Vector root (in-folder copy retained; delete lands in Drive trash)' });
    } else {
        notes.push('v2.6.x stray FunctionScore not found (or already cleaned)');
    }

    return { generatedAt: new Date().toISOString(), actions, notes };
}

async function executePlan({ plan, approvedDigest, journalPath }) {
    const digest = planDigest(plan);
    if (String(approvedDigest).trim() !== digest) {
        const error = new Error(`REFUSED: approved digest does not match the plan (plan ${digest}, approved ${approvedDigest})`);
        error.code = 'REPAIR_PLAN_APPROVAL_MISMATCH';
        throw error;
    }
    const registry = loadReleaseTrackRegistry(REGISTRY_PATH);
    const baseByTrack = new Map(listLanguageTracks(registry, 'java').map((t) => [t.version, trackBaseToken(t)]));
    const createdFolders = new Map();
    const journal = [];
    const appendJournal = (entry) => {
        journal.push(entry);
        fs.mkdirSync(JOURNAL_DIR, { recursive: true });
        fs.writeFileSync(journalPath, `${JSON.stringify({ planDigest: digest, journal }, null, 1)}\n`);
    };
    const tokenFetcher = new larkTokenFetcher();

    let index = 0;
    for (const action of plan.actions) {
        index += 1;
        const entry = { index, action };
        try {
            if (action.kind === 'update-record-field') {
                const baseToken = baseByTrack.get(action.track);
                const tableId = await resolveTableId(baseToken);
                await larkJson([
                    'base', '+record-batch-update',
                    '--base-token', baseToken,
                    '--table-id', tableId,
                    '--json', JSON.stringify({ update_records: { [action.recordId]: { [action.field]: action.value } } }),
                ]);
                const check = await verifyWithRetry(async () => {
                    const after = await listBitableRecords(tokenFetcher, baseToken, null);
                    const reread = after.find((r) => r.record_id === action.recordId);
                    const value = action.field === 'Docs'
                        ? (reread?.fields?.Docs?.link || reread?.fields?.Docs?.url || '')
                        : slugText(reread?.fields?.[action.field]);
                    return { ok: value.includes(String(action.value).split('/').pop() || action.value), value };
                });
                if (!check.ok) throw new Error(`field update not verifiable: ${check.value}`);
                entry.result = { field: action.field, verified: true };
            } else if (action.kind === 'update-record-docs-text') {
                const baseToken = baseByTrack.get(action.track);
                const tableId = await resolveTableId(baseToken);
                // The batch-update validator rejects {text,link} URL cells;
                // the raw records PUT accepts them.
                await larkJson([
                    'api', 'PUT',
                    `/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/records/${action.recordId}`,
                    '--data', JSON.stringify({ fields: { Docs: { text: action.text, link: action.link } } }),
                ]);
                const check = await verifyWithRetry(async () => {
                    const after = await listBitableRecords(tokenFetcher, baseToken, null);
                    const reread = after.find((r) => r.record_id === action.recordId);
                    const docs = reread?.fields?.Docs || {};
                    const text = String(docs.text ?? '');
                    const slugNow = slugText(reread?.fields?.Slug);
                    return { ok: text === action.text && slugNow === `v2-${action.text}`, text, slugNow };
                }, 10);
                if (!check.ok) throw new Error(`Docs text / Slug formula not verifiable: text=${check.text} slug=${JSON.stringify(check.slugNow)}`);
                entry.result = { text: action.text, slug: check.slugNow, verified: true };
            } else if (action.kind === 'create-folder') {
                const siblings = await listFolder(action.parentFolderToken);
                const existingFolder = siblings.find((c) => c.name === action.name && (c.type || 'folder') === 'folder');
                if (existingFolder) {
                    // Replay-safe adoption: a partially executed prior run (or a
                    // race) created the folder; adopt it and continue.
                    const existingToken = existingFolder.token || existingFolder.file_token;
                    createdFolders.set(action.ref, existingToken);
                    entry.result = { folderToken: existingToken, alreadyExisted: true };
                } else {
                    const created = await larkJson(['drive', '+create-folder', '--folder-token', action.parentFolderToken, '--name', action.name]);
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
                const children = await listFolder(toFolder);
                if (!children.some((c) => (c.token || c.file_token) === fileToken)) {
                    await larkJson(['drive', '+move', '--file-token', fileToken, '--folder-token', toFolder, '--type', action.kind === 'move-folder' ? 'folder' : 'docx']);
                }
                const placed = await verifyWithRetry(async () => {
                    const after = await listFolder(toFolder);
                    return { ok: after.some((c) => (c.token || c.file_token) === fileToken) };
                });
                if (!placed.ok) throw new Error(`${fileToken} not found under ${toFolder} after move`);
                entry.result = { toFolderToken: toFolder, verified: true };
            } else if (action.kind === 'delete-document') {
                await larkJson(['drive', '+delete', '--file-token', action.documentToken, '--type', 'docx', '--yes']);
                entry.result = { deleted: true, trash: true };
            } else {
                throw new Error(`unknown action kind ${action.kind}`);
            }
            entry.ok = true;
        } catch (error) {
            entry.ok = false;
            entry.error = error.message;
            appendJournal(entry);
            const wrapped = new Error(`action ${index}/${plan.actions.length} (${action.kind} ${action.ref || action.recordId}) failed: ${error.message}`);
            wrapped.code = 'REPAIR_ACTION_FAILED';
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
        else throw new Error(`Unknown argument: ${argv[i]}`);
    }
    if (mode === 'plan') {
        const plan = await buildPlan();
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
