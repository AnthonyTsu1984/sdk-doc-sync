#!/usr/bin/env node
'use strict';

// Read-only Bitable snapshot producer (campaign-control batch 15, §5.1).
// Canonical home of tmp/sdk-release-scout/dump-bitable-snapshot.js: same row
// shape the four 2026-10-15 intake campaigns consumed
// (recordId/slug/type/title/docLink/parent/targets/progress), hardened with
//  - --table-id for multi-table bases (the "expected exactly 1 table" throw
//    stays the default when the flag is absent), and
//  - registry reverse lookup: with --language the track's base/table come
//    from config/release-tracks.json, so routine runs pass neither token.
// GET-only pagination; the artifact self-certifies with writesPerformed:false.

const fs = require('node:fs');
const path = require('node:path');
const {
    loadReleaseTrackRegistry,
    requireTrack,
    trackBaseToken,
    trackTableId,
} = require('../src/sdk-doc-sync/release-track-registry');

class SnapshotDumpError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'SnapshotDumpError';
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}

// Cell -> flat text, shared semantics with the tmp producer this script
// replaces: joined text parts, first object key of text/title/name/value,
// first link URL.
function textFromCell(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(textFromCell).filter(Boolean).join('');
    if (typeof value === 'object') {
        for (const key of ['text', 'title', 'name', 'value']) {
            if (Object.hasOwn(value, key)) return textFromCell(value[key]);
        }
    }
    return '';
}

function linkFromCell(value) {
    if (Array.isArray(value)) {
        for (const item of value) {
            const link = linkFromCell(item);
            if (link) return link;
        }
        return '';
    }
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'link')) return '';
    return textFromCell(value.link).trim();
}

function rowsFromRecords(records) {
    return (records || []).map((record) => {
        const fields = record.fields || {};
        const docs = fields.Docs;
        return {
            recordId: record.record_id,
            slug: textFromCell(fields.Slug),
            type: textFromCell(fields.Type),
            title: textFromCell(docs),
            docLink: linkFromCell(docs),
            parent: JSON.stringify(fields['父记录'] ?? fields.Parent ?? null),
            targets: textFromCell(fields.Targets),
            progress: textFromCell(fields.Progress),
        };
    });
}

function buildSnapshot({ track, language = null, baseToken, tableId = null, records, fetchedAt }) {
    const rows = rowsFromRecords(records);
    return {
        track,
        ...(language ? { language } : {}),
        baseToken,
        tableId: tableId || null,
        fetchedAt: fetchedAt || new Date().toISOString(),
        count: rows.length,
        writesPerformed: false,
        rows,
    };
}

async function dumpSnapshot({ client, track, language = null, baseToken, tableId = null, fetchedAt = null }) {
    if (typeof client?.paginate !== 'function') {
        throw new SnapshotDumpError('SNAPSHOT_CLIENT_INVALID', 'client must expose paginate()');
    }
    const tables = await client.paginate({
        path: `/open-apis/bitable/v1/apps/${encodeURIComponent(baseToken)}/tables`,
    });
    process.stderr.write(`tables: ${tables.map((t) => `${t.table_id}:${t.name}`).join(', ')}\n`);
    let resolvedTableId = tableId || null;
    if (!resolvedTableId) {
        // Uniqueness check inherited from the tmp producer: an untargeted dump
        // against a multi-table base is refused, never "first table guessed".
        if (tables.length !== 1) {
            throw new SnapshotDumpError(
                'BITABLE_TABLE_AMBIGUOUS',
                `expected exactly 1 table, got ${tables.length}; pass an explicit --table-id`,
                { baseToken, tableCount: tables.length },
            );
        }
        resolvedTableId = tables[0].table_id;
    }
    const records = await client.paginate({
        path: `/open-apis/bitable/v1/apps/${encodeURIComponent(baseToken)}/tables/${encodeURIComponent(resolvedTableId)}/records?page_size=500`,
    });
    return buildSnapshot({
        track,
        language,
        baseToken,
        tableId: resolvedTableId,
        records,
        fetchedAt: fetchedAt || new Date().toISOString(),
    });
}

const USAGE = 'usage: dump-bitable-snapshot.js --track <version> (--base-token <token> | --language <language> [--registry <path>]) [--table-id <id>] --output <file>';

function parseArgs(argv = process.argv) {
    const args = { track: null, language: null, baseToken: null, tableId: null, registry: null, output: null };
    const options = new Set(['--track', '--language', '--base-token', '--table-id', '--registry', '--output']);
    for (let index = 2; index < argv.length; index += 1) {
        const key = argv[index];
        if (!options.has(key)) throw new SnapshotDumpError('SNAPSHOT_ARGS_INVALID', `Unknown argument: ${key}\n${USAGE}`);
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) throw new SnapshotDumpError('SNAPSHOT_ARGS_INVALID', `Missing value for ${key}\n${USAGE}`);
        args[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
        index += 1;
    }
    for (const key of ['track', 'output']) {
        if (!args[key]) throw new SnapshotDumpError('SNAPSHOT_ARGS_INVALID', `Missing --${key}\n${USAGE}`);
    }
    if (!args.baseToken && !args.language) {
        throw new SnapshotDumpError('SNAPSHOT_ARGS_INVALID', 'Missing --base-token (or --language for registry resolution)\n' + USAGE);
    }
    if (args.baseToken && args.language) {
        // Explicit tokens win, but the redundant pair hides which base the
        // snapshot certifies — refuse the ambiguity instead.
        throw new SnapshotDumpError('SNAPSHOT_ARGS_INVALID', 'Pass either --base-token or --language, not both\n' + USAGE);
    }
    return args;
}

// Explicit --base-token wins; otherwise the release-track registry supplies
// base/table for --language + --track (env-referenced identities resolve the
// same way everywhere else in the skill).
function resolveBaseTable({ args, env = process.env }) {
    if (args.baseToken) return { baseToken: args.baseToken, tableId: args.tableId, source: 'explicit' };
    const registry = loadReleaseTrackRegistry(args.registry ? path.resolve(args.registry) : undefined, { env });
    const track = requireTrack(registry, args.language, args.track);
    const baseToken = trackBaseToken(track, env);
    if (!baseToken) {
        throw new SnapshotDumpError(
            'TRACK_BASE_TOKEN_UNRESOLVED',
            `Track ${args.language}/${args.track} has no resolvable bitable.baseToken in the registry`,
            { language: args.language, track: args.track },
        );
    }
    return { baseToken, tableId: args.tableId || trackTableId(track, env) || null, source: 'registry' };
}

async function main(argv = process.argv) {
    const args = parseArgs(argv);
    const { baseToken, tableId } = resolveBaseTable({ args });
    // Live-face requires stay inside main so offline tests of the pure face
    // never construct a Feishu client.
    const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');
    const FeishuClient = require('../src/feishu/feishu-client');
    const fetch = require('node-fetch');
    const client = new FeishuClient({
        host: process.env.FEISHU_HOST || 'https://open.feishu.cn',
        tokenProvider: () => new larkTokenFetcher().token(),
        transport: ({ url, method, headers, body }) => fetch(url, { method, headers, body }),
    });
    const snapshot = await dumpSnapshot({
        client,
        track: args.track,
        language: args.language,
        baseToken,
        tableId,
    });
    const output = path.resolve(args.output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`);
    process.stderr.write(`wrote ${snapshot.count} rows -> ${args.output} (writesPerformed: false)\n`);
}

if (require.main === module) {
    main().catch((error) => {
        process.stderr.write(`${error.code ? `[${error.code}] ` : ''}${error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    SnapshotDumpError,
    buildSnapshot,
    dumpSnapshot,
    linkFromCell,
    parseArgs,
    resolveBaseTable,
    rowsFromRecords,
    textFromCell,
};
