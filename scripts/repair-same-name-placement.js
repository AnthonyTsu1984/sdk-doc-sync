#!/usr/bin/env node
'use strict';

// Governed repair for SAME_NAME_COPY_MISPLACED findings (api.same-name-
// sibling-placement, 2026-10-03 java audit): relocate newer-track copies out
// of older version directories into the claiming track's own category folder,
// and repoint the affected category VirtualNode records so the newer track's
// navigation follows the moved copies. Multi-version directories themselves
// are legitimate structure — only the misplaced copies move; the older
// track's own copy and every record Docs link (token-level) stay untouched.
//
// The failure mode being repaired (user ruling, 2026-10-03): copy-patch-and-
// repoint created the new document in place inside the older directory and
// repointed only the record, so one same-title file landed in the older
// version's table and the duplicate in the newer version's table.
//
// Modes:
//   plan     derive every action from live state (tree walk + Bitable rows +
//            the production same-name classifier), write a plan JSON, and
//            print its batch digest. Nothing is written to Drive.
//   execute  verify --approve-batch-digest against the plan digest, then run
//            the actions through lark-cli (create-folder -> move -> repoint),
//            verifying each action live before moving on, and append a
//            per-action journal under tmp/api-reference-sync/.
//
// Detect-only by construction: without --approve-batch-digest, execute
// refuses before the first mutation.

const fs = require('node:fs');
const path = require('node:path');
const { spawnRun } = require('../.claude/skills/api-reference-sync/src/sdk-doc-sync/lark-cli-ops');
const {
    classifySameNameSiblings,
} = require('../.claude/skills/api-reference-sync/src/sdk-doc-sync/content-reconciliation');
const {
    deriveFolderAncestry,
    folderTokenFromLink,
} = require('../.claude/skills/api-reference-sync/src/sdk-doc-sync/tree-delta-reconciliation');
const {
    listLanguageTracks,
    loadReleaseTrackRegistry,
    trackBaseToken,
    trackReleaseRootToken,
} = require('../.claude/skills/api-reference-sync/src/sdk-doc-sync/release-track-registry');
const BitableWriter = require('../.claude/skills/api-reference-sync/src/sdk-doc-sync/bitable-writer');
const { sha256Digest } = require('../.claude/skills/doc-ops-core/src/digest');
const { canonicalStringify } = require('../.claude/skills/doc-ops-core/src/canonical-json');

const REGISTRY_PATH = path.join(__dirname, '..', '.claude', 'skills', 'api-reference-sync', 'config', 'release-tracks.json');
const JOURNAL_DIR = path.join(__dirname, '..', 'tmp', 'api-reference-sync');

function parseArgs(argv) {
    const options = {};
    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--language') options.language = argv[++index];
        else if (arg === '--mode') options.mode = argv[++index];
        else if (arg === '--plan') options.planPath = path.resolve(argv[++index]);
        else if (arg === '--output') options.outputPath = path.resolve(argv[++index]);
        else if (arg === '--approve-batch-digest') options.approvedDigest = argv[++index];
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!options.language) throw new Error('--language is required');
    if (!options.mode || !['plan', 'execute'].includes(options.mode)) {
        throw new Error('--mode plan|execute is required');
    }
    if (options.mode === 'execute') {
        if (!options.planPath) throw new Error('execute requires --plan <plan.json>');
        if (!options.approvedDigest) {
            throw new Error('execute requires --approve-batch-digest <digest> (review the plan first)');
        }
    }
    return options;
}

function scalarText(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(scalarText).filter(Boolean).join('');
    return value.text || value.name || value.value || null;
}

function normalizeCategory(name) {
    return String(name || '').replace(/\s+/g, '').toLowerCase();
}

function categoryFromSlug(slug) {
    const parts = String(slug || '').split('-');
    return parts.length >= 3 ? parts[1] : null;
}

async function larkJson(args, { as = 'user' } = {}) {
    const result = await spawnRun('lark-cli', [...args, '--as', as, '--format', 'json']);
    const parsed = JSON.parse(result.stdout);
    if (parsed.ok === false) {
        throw new Error(`lark-cli ${args[0]} ${args[1] || ''} failed: ${JSON.stringify(parsed.error)}`);
    }
    return parsed;
}

// Live facts: per-track tree walk (docs + category folders) and Bitable rows.
async function collectLiveFacts({ registry, language }) {
    const tracks = listLanguageTracks(registry, language);
    if (tracks.length === 0) throw new Error(`Language ${language} has no registered tracks`);
    const client = new (require('../.claude/skills/api-reference-sync/src/markdown-to-feishu'))({
        sourceType: 'drive', rootToken: null, baseToken: null,
    });

    const facts = { tracks: [], records: [], folderEntries: [], categoryFolders: {}, virtualNodes: {} };
    for (const track of tracks) {
        const version = track.version;
        const releaseRootToken = trackReleaseRootToken(track);
        if (!releaseRootToken) throw new Error(`Track ${version} has no release root`);

        const categoryFolders = {};
        const rootChildren = await client.listFolder({ folderToken: releaseRootToken, type: 'all' }) || [];
        for (const child of rootChildren) {
            const token = child?.token || child?.file_token || null;
            if (token && (child?.type || 'folder') === 'folder') {
                categoryFolders[normalizeCategory(child.name)] = token;
            }
        }
        facts.categoryFolders[version] = Object.entries(categoryFolders)
            .map(([key, token]) => ({ key, token, name: rootChildren.find((c) => (c.token || c.file_token) === token)?.name || key }));
        facts.tracks.push({ version, releaseRootToken });

        const visit = async (folderToken, parentToken, depth) => {
            if (depth > 6) return;
            const children = await client.listFolder({ folderToken, type: 'all' }) || [];
            for (const child of children) {
                const token = child?.token || child?.file_token || null;
                const type = child?.type || null;
                if (type === 'folder' && token && folderToken !== token) {
                    await visit(token, folderToken, depth + 1);
                } else if (token && (type === 'docx' || type === null)) {
                    facts.folderEntries.push({
                        token, name: child?.name || null, parentToken, roots: [releaseRootToken],
                    });
                }
            }
        };
        await visit(releaseRootToken, releaseRootToken, 0);

        const records = (await new BitableWriter({ baseToken: trackBaseToken(track), tableId: null })
            .listRecords({ pageSize: 500 }));
        const normalized = [];
        for (const raw of records) {
            const fields = raw?.fields || {};
            const docs = fields.Docs || {};
            const link = docs.link || docs.url || null;
            const docxMatch = link ? /\/docx\/([A-Za-z0-9]+)/.exec(link) : null;
            const folderMatch = link ? folderTokenFromLink(link) : null;
            normalized.push({
                recordId: raw?.record_id || null,
                slug: scalarText(fields.Slug),
                type: scalarText(fields.Type),
                documentToken: docxMatch ? docxMatch[1] : null,
                categoryFolderToken: folderMatch,
            });
            if (docxMatch) {
                facts.records.push({
                    recordId: normalized[normalized.length - 1].recordId,
                    slug: normalized[normalized.length - 1].slug,
                    documentToken: docxMatch[1],
                    track: version,
                });
            }
            if (normalized[normalized.length - 1].type === 'VirtualNode') {
                (facts.virtualNodes[version] = facts.virtualNodes[version] || []).push({
                    recordId: normalized[normalized.length - 1].recordId,
                    slug: normalized[normalized.length - 1].slug,
                    categoryFolderToken: folderMatch,
                });
            }
        }
    }
    return facts;
}

function buildPlanFromFacts({ language, facts }) {
    const trackRoots = facts.tracks.map((t) => ({ version: t.version, releaseRootToken: t.releaseRootToken }));
    const classification = classifySameNameSiblings({
        folderEntries: facts.folderEntries,
        records: facts.records,
        pageLinkTokens: [],
        trackRoots,
    });

    const misplaced = [];
    for (const group of classification.groups) {
        for (const token of group.misplacedTokens) {
            const copy = group.copies.find((entry) => entry.token === token);
            misplaced.push({ title: group.title, token, claiming: copy.claimingTracks });
        }
    }
    const slugByToken = new Map(facts.records.map((r) => [r.documentToken, r]));
    const categoryFolderByTrack = new Map();
    for (const track of facts.tracks) {
        const map = new Map();
        for (const folder of facts.categoryFolders[track.version]) {
            map.set(folder.key, folder.token);
        }
        categoryFolderByTrack.set(track.version, map);
    }

    const moves = [];
    const folderCreates = new Map();
    const problems = [];
    for (const item of misplaced) {
        const track = item.claiming[0];
        // A copy claimed by two tracks cannot be placed by lexicographic
        // accident (v2.10 sorts before v2.9): the ambiguity needs a human.
        if (item.claiming.length > 1) {
            problems.push({ code: 'MULTI_TRACK_CLAIM', token: item.token, title: item.title, tracks: item.claiming });
            continue;
        }
        const record = slugByToken.get(item.token);
        if (!record || !record.slug) { problems.push({ code: 'NO_SLUG', token: item.token }); continue; }
        const category = categoryFromSlug(record.slug);
        if (!category) { problems.push({ code: 'NO_CATEGORY', token: item.token, slug: record.slug }); continue; }
        const key = normalizeCategory(category);
        let targetFolder = categoryFolderByTrack.get(track).get(key);
        if (!targetFolder) {
            const existing = folderCreates.get(`${track}\u0000${key}`);
            if (existing) targetFolder = existing.ref;
        }
        if (!targetFolder) {
            const ref = `folder-create:${track}:${key}`;
            folderCreates.set(`${track}\u0000${key}`, {
                ref, track, category, key,
            });
            targetFolder = ref;
        }
        moves.push({
            kind: 'move-document',
            ref: `move:${item.token}`,
            documentToken: item.token,
            title: item.title,
            track,
            category,
            slug: record.slug,
            toFolderRef: targetFolder,
        });
    }

    // Resolve folder-create refs into concrete create actions; moves keep the
    // ref and the executor binds refs to created folder tokens.
    const actions = [];
    const folderRefByRef = new Map();
    for (const create of folderCreates.values()) {
        const parent = categoryFolderByTrack.get(create.track).get('__root__')
            || facts.tracks.find((t) => t.version === create.track)?.releaseRootToken;
        actions.push({
            kind: 'create-folder',
            ref: create.ref,
            track: create.track,
            category: create.category,
            name: create.category,
            parentFolderToken: parent,
        });
        folderRefByRef.set(create.ref, { parentFolderToken: parent, name: create.category });
    }
    for (const move of moves) {
        const resolved = folderRefByRef.get(move.toFolderRef);
        actions.push({
            ...move,
            toFolderToken: resolved ? null : move.toFolderRef,
            toFolderRef: resolved ? move.toFolderRef : undefined,
        });
    }

    // VirtualNode repoints, derived INDEPENDENTLY of the move list (2026-10-03
    // review wart): a track's category node pointing at an older tree is only
    // a defect when the track's own in-tree category folder is live — it
    // holds at least one document claimed by the track's records, or this
    // plan populates it (folder-create receiving moves). Without this
    // in-tree-presence discriminator, repointing would hide the track's
    // unchanged interfaces, which legitimately keep inherited navigation into
    // the older tree (e.g. the v2.5 table's rows on v2.4 shared documents).
    const claimedByTrack = new Map();
    for (const record of facts.records) {
        if (!claimedByTrack.has(record.track)) claimedByTrack.set(record.track, new Set());
        claimedByTrack.get(record.track).add(record.documentToken);
    }
    const docsByParentFolder = new Map();
    for (const entry of facts.folderEntries) {
        if (!entry.parentToken) continue;
        if (!docsByParentFolder.has(entry.parentToken)) docsByParentFolder.set(entry.parentToken, new Set());
        docsByParentFolder.get(entry.parentToken).add(entry.token);
    }
    const repointActions = [];
    for (const track of facts.tracks) {
        const version = track.version;
        const claimed = claimedByTrack.get(version) || new Set();
        const nodeByCategory = new Map();
        for (const node of facts.virtualNodes[version] || []) {
            const nodeCategory = (node.slug || '').replace(/^[^-]+-/, '').split('-')[0];
            if (node.slug && node.recordId && !nodeByCategory.has(normalizeCategory(nodeCategory))) {
                nodeByCategory.set(normalizeCategory(nodeCategory), node);
            }
        }
        if (nodeByCategory.size === 0) continue;

        const emitRepoint = (category, node, target) => {
            repointActions.push({
                kind: 'repoint-category-node',
                ref: `repoint:${node.recordId}`,
                track: version,
                category,
                recordId: node.recordId,
                slug: node.slug,
                fromFolderToken: node.categoryFolderToken,
                ...(target.toFolderToken ? { toFolderToken: target.toFolderToken } : { toFolderRef: target.toFolderRef }),
            });
        };

        // In-tree category folders live by claimed presence or planned moves.
        for (const folder of facts.categoryFolders[version] || []) {
            const folderDocs = docsByParentFolder.get(folder.token);
            const hasClaimedDoc = folderDocs ? [...folderDocs].some((token) => claimed.has(token)) : false;
            // Moves targeting a folder-create carry the ref, not a token, so
            // this match only sees moves into the in-tree folder itself.
            const populatedByMove = moves.some((m) => m.track === version && m.toFolderRef === folder.token);
            if (!hasClaimedDoc && !populatedByMove) continue;
            const node = nodeByCategory.get(folder.key);
            if (!node) continue;
            if (node.categoryFolderToken === folder.token) continue; // already correct
            emitRepoint(folder.name || folder.key, node, { toFolderToken: folder.token });
        }

        // Planned folder-creates count as live once moves populate them; a
        // create with no moves must never trigger a repoint.
        for (const create of folderCreates.values()) {
            if (create.track !== version) continue;
            const populated = moves.some((m) => m.track === version && m.toFolderRef === create.ref);
            if (!populated) continue;
            const node = nodeByCategory.get(create.key);
            if (!node) continue;
            emitRepoint(create.category, node, { toFolderRef: create.ref });
        }
    }

    // Nothing to do: no misplaced copies and no stale navigation.
    if (moves.length === 0 && repointActions.length === 0) {
        return {
            language,
            actions: [],
            summary: {
                misplacedCopies: misplaced.length,
                createFolder: 0,
                moveDocument: 0,
                repointCategoryNode: 0,
                problems: problems.length,
            },
            problems,
        };
    }
    actions.push(...repointActions);

    const order = { 'create-folder': 0, 'move-document': 1, 'repoint-category-node': 2 };
    actions.sort((left, right) => (order[left.kind] - order[right.kind])
        || String(left.track || '').localeCompare(String(right.track || ''))
        || String(left.category || '').localeCompare(String(right.category || ''))
        || String(left.ref).localeCompare(String(right.ref)));

    return {
        language,
        misplacedCopies: misplaced.length,
        actions,
        problems,
        summary: {
            createFolder: actions.filter((a) => a.kind === 'create-folder').length,
            moveDocument: actions.filter((a) => a.kind === 'move-document').length,
            repointCategoryNode: actions.filter((a) => a.kind === 'repoint-category-node').length,
            problems: problems.length,
        },
    };
}

function planDigest(plan) {
    return sha256Digest(Buffer.from(canonicalStringify({
        schemaVersion: 1,
        kind: 'same-name-placement-repair',
        language: plan.language,
        actions: plan.actions,
    }), 'utf8'));
}

// External-call surface, injectable for tests: callLark shells out to
// lark-cli, listFolder reads Drive, listRecords reads a Bitable base.
let LAZY_DRIVE_CLIENT = null;
function defaultListFolder(args) {
    if (!LAZY_DRIVE_CLIENT) {
        LAZY_DRIVE_CLIENT = new (require('../.claude/skills/api-reference-sync/src/markdown-to-feishu'))({
            sourceType: 'drive', rootToken: null, baseToken: null,
        });
    }
    return LAZY_DRIVE_CLIENT.listFolder(args);
}

function defaultListRecords(baseToken) {
    return new BitableWriter({ baseToken, tableId: null }).listRecords({ pageSize: 500 });
}

// Read-after-write lag protection (same eventual-consistency precedent as
// SyncExecutor._getRecordWithRetry): a placement check retries with backoff
// before it is allowed to conclude "not there".
async function verifyWithRetry(check, { attempts = 4 } = {}) {
    let last = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 800 * (attempt - 1)));
        last = await check();
        if (last.ok) return last;
    }
    return last;
}

async function executePlan({ plan, approvedDigest, journalPath, deps = {} }) {
    const callLark = deps.larkJson || larkJson;
    const listFolder = deps.listFolder || defaultListFolder;
    const listRecords = deps.listRecords || defaultListRecords;

    const digest = planDigest(plan);
    if (approvedDigest.trim() !== digest) {
        const error = new Error(
            `REFUSED: approved digest does not match the plan (plan ${digest}, approved ${approvedDigest.trim()}); the plan changed since review`,
        );
        error.code = 'REPAIR_PLAN_APPROVAL_MISMATCH';
        throw error;
    }

    const createdFolders = new Map(); // ref -> token
    const journal = [];
    const appendJournal = (entry) => {
        journal.push(entry);
        fs.mkdirSync(JOURNAL_DIR, { recursive: true });
        fs.writeFileSync(journalPath, `${JSON.stringify({ planDigest: digest, journal }, null, 1)}\n`);
    };

    const registry = loadReleaseTrackRegistry(REGISTRY_PATH);
    const tracks = listLanguageTracks(registry, plan.language);
    const baseByTrack = new Map(tracks.map((t) => [t.version, ({ baseToken: trackBaseToken(t) })]));

    let index = 0;
    for (const action of plan.actions) {
        index += 1;
        const entry = { index, action };
        try {
            if (action.kind === 'create-folder') {
                // Idempotency guard: an exact-name sibling means this plan was
                // (partially) executed before, or the folder appeared between
                // plan and execute. Refuse and force a replan instead of
                // creating a duplicate and repointing category nodes into it.
                const siblings = await listFolder({ folderToken: action.parentFolderToken, type: 'all' }) || [];
                const existing = siblings.find((c) => c.name === action.name
                    && (c.token || c.file_token)
                    && (c.type || 'folder') === 'folder');
                if (existing) {
                    throw new Error(`REFUSED: folder ${action.name} already exists under ${action.parentFolderToken} (${existing.token || existing.file_token}) — replan before executing`);
                }
                const created = await callLark([
                    'drive', '+create-folder',
                    '--folder-token', action.parentFolderToken,
                    '--name', action.name,
                ]);
                const token = created?.data?.token || created?.data?.folder?.token || created?.token || null;
                if (!token) throw new Error(`create-folder returned no token: ${JSON.stringify(created).slice(0, 200)}`);
                createdFolders.set(action.ref, token);
                entry.result = { folderToken: token };
            } else if (action.kind === 'move-document') {
                const toFolder = createdFolders.get(action.toFolderRef) || action.toFolderToken;
                if (!toFolder) throw new Error(`unresolved target folder for ${action.ref}`);
                // Replay-safe: a document already inside the target folder is a
                // completed prior attempt — verify it and skip the move call.
                const children = await listFolder({ folderToken: toFolder, type: 'all' }) || [];
                const alreadyPlaced = children.some((c) => (c.token || c.file_token) === action.documentToken);
                if (!alreadyPlaced) {
                    await callLark([
                        'drive', '+move',
                        '--file-token', action.documentToken,
                        '--folder-token', toFolder,
                        '--type', 'docx',
                    ]);
                }
                // Live placement verification with read-after-write backoff:
                // the moved token must be a child of the target folder.
                const placed = await verifyWithRetry(async () => {
                    const after = await listFolder({ folderToken: toFolder, type: 'all' }) || [];
                    return { ok: after.some((c) => (c.token || c.file_token) === action.documentToken) };
                });
                if (!placed.ok) throw new Error(`moved document ${action.documentToken} not found under ${toFolder}`);
                entry.result = { toFolderToken: toFolder, verified: true, ...(alreadyPlaced ? { alreadyPlaced: true } : {}) };
            } else if (action.kind === 'repoint-category-node') {
                const toFolder = createdFolders.get(action.toFolderRef) || action.toFolderToken;
                if (!toFolder) throw new Error(`unresolved target folder for ${action.ref}`);
                const base = baseByTrack.get(action.track);
                const records = await listRecords(base.baseToken);
                const record = records.find((r) => r.record_id === action.recordId);
                if (!record) throw new Error(`record ${action.recordId} not found for repoint`);
                const currentLink = String(record.fields?.Docs?.link || record.fields?.Docs?.url || '');
                if (currentLink.includes(toFolder)) {
                    // Replay-safe: the record already points at the target.
                    entry.result = { toFolderToken: toFolder, alreadyRepointed: true };
                } else {
                    // The Docs cell must be written as {text, link}: the Slug
                    // column is a formula over Docs.name, so a bare-URL string
                    // poisons every family page slug (2026-10-04 campaign
                    // defect class — TOPOLOGY_RECORD_SLUG_URL). Never reuse an
                    // existing URL-shaped display text.
                    const docs = record.fields?.Docs || {};
                    const candidates = [action.category, action.slug, scalarTextLocal(docs)]
                        .filter((value) => typeof value === 'string' && value.trim() !== '' && !value.includes('http'));
                    const text = candidates[0];
                    if (!text) {
                        throw new Error(`repoint ${action.recordId}: no clean section name for the Docs text (category/slug missing and current text is a URL) — replan with the folder name`);
                    }
                    const tableId = await resolveTableId(base.baseToken, callLark);
                    const link = `https://zilliverse.feishu.cn/drive/folder/${toFolder}`;
                    // record-batch-update rejects {text,link} URL cells — the
                    // raw records PUT accepts them.
                    await callLark([
                        'api', 'PUT',
                        `/open-apis/bitable/v1/apps/${base.baseToken}/tables/${tableId}/records/${action.recordId}`,
                        '--data', JSON.stringify({ fields: { Docs: { text, link } } }),
                    ]);
                    // Live verification with read-after-write backoff — the
                    // display text must equal the written name, not just the
                    // link (this is exactly the check the poisoned-slug class
                    // would have failed).
                    const check = await verifyWithRetry(async () => {
                        const after = await listRecords(base.baseToken);
                        const reread = after.find((r) => r.record_id === action.recordId);
                        const afterDocs = reread?.fields?.Docs || {};
                        const afterLink = String(afterDocs.link || afterDocs.url || '');
                        return { ok: afterLink.includes(toFolder) && String(afterDocs.text || '') === text, afterLink, text: afterDocs.text };
                    });
                    if (!check.ok) {
                        throw new Error(`repoint verification failed: record ${action.recordId} still points at ${check.afterLink || '(unreadable)'} or text is ${JSON.stringify(check.text)}`);
                    }
                    entry.result = { toFolderToken: toFolder, link: check.afterLink, text };
                }
            } else {
                throw new Error(`unknown action kind ${action.kind}`);
            }
            entry.ok = true;
        } catch (error) {
            entry.ok = false;
            entry.error = error.message;
            appendJournal(entry);
            const wrapped = new Error(`action ${index}/${plan.actions.length} (${action.kind} ${action.ref}) failed: ${error.message}`);
            wrapped.code = 'REPAIR_ACTION_FAILED';
            throw wrapped;
        }
        appendJournal(entry);
    }
    return { digest, journal };
}

function scalarTextLocal(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(scalarTextLocal).filter(Boolean).join('');
    return value.text || value.name || value.value || null;
}

// The inventory table id, resolved live once per base through the first
// table the base exposes (the inventory tables are single-table bases).
const TABLE_ID_CACHE = new Map();
async function resolveTableId(baseToken, callLark = larkJson) {
    if (TABLE_ID_CACHE.has(baseToken)) return TABLE_ID_CACHE.get(baseToken);
    const listing = await callLark(['base', '+table-list', '--base-token', baseToken]);
    const tables = listing?.data?.tables || listing?.data?.items || listing?.items || [];
    const tableId = tables[0]?.id || tables[0]?.table_id || tables[0]?.tableId || null;
    if (!tableId) throw new Error(`no table found for base ${baseToken}`);
    TABLE_ID_CACHE.set(baseToken, tableId);
    return tableId;
}

async function main(argv = process.argv) {
    const options = parseArgs(argv);
    const registry = loadReleaseTrackRegistry(REGISTRY_PATH);

    if (options.mode === 'plan') {
        const facts = await collectLiveFacts({ registry, language: options.language });
        const plan = buildPlanFromFacts({ language: options.language, facts });
        const digest = planDigest(plan);
        const outputPath = options.outputPath
            || path.join(JOURNAL_DIR, `repair-plan-${options.language}-${Date.now()}.json`);
        fs.mkdirSync(JOURNAL_DIR, { recursive: true });
        fs.writeFileSync(outputPath, `${JSON.stringify({ ...plan, planDigest: digest }, null, 1)}\n`);
        process.stdout.write(`plan written: ${outputPath}\n`);
        process.stdout.write(`batch digest: ${digest}\n`);
        process.stdout.write(`summary: ${JSON.stringify(plan.summary)}\n`);
        for (const action of plan.actions) {
            process.stdout.write(`  ${action.kind} ${action.ref}${action.title ? ` (${action.title})` : ''} -> ${action.toFolderToken || action.toFolderRef || ''}\n`);
        }
        for (const problem of plan.problems || []) {
            process.stdout.write(`  PROBLEM ${JSON.stringify(problem)}\n`);
        }
        return;
    }

    const plan = JSON.parse(fs.readFileSync(options.planPath, 'utf8'));
    const journalPath = path.join(JOURNAL_DIR, `repair-journal-${plan.language}-${Date.now()}.json`);
    const { digest, journal } = await executePlan({
        plan, approvedDigest: options.approvedDigest, journalPath,
    });
    process.stdout.write(`executed ${journal.length} action(s); plan digest ${digest}\n`);
    process.stdout.write(`journal: ${journalPath}\n`);
}

module.exports = { parseArgs, buildPlanFromFacts, planDigest, executePlan };

if (require.main === module) {
    main(process.argv).catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
