#!/usr/bin/env node
'use strict';

// Read-only identity-coverage reconciliation for one track.
//
//   node bin/identity-reconcile.js \
//     --snapshot tmp/sdk-release-scout/bitable-snapshot-cpp-v30.json \
//     --identity-map references/identity/cpp-v30.json \
//     [--emit-draft tmp/sdk-release-scout/identity-draft.json] [--strict]
//
// Reports every governed record slug in the snapshot that resolves to no
// canonical identity in the map (IDENTITY_MAP_INCOMPLETE), plus map keys that
// no record represents. --emit-draft writes evidence-backed entry drafts
// derived from the same records; merging a draft into the identity map stays
// a manual, master-compared edit. --strict exits non-zero when drift exists.

const fs = require('node:fs');
const path = require('node:path');
const { reconcileIdentityCoverage, identityEntryDrafts } = require('../src/sdk-doc-sync/identity-reconciliation');

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--snapshot') args.snapshot = argv[++i];
        else if (arg === '--identity-map') args.identityMap = argv[++i];
        else if (arg === '--emit-draft') args.emitDraft = argv[++i];
        else if (arg === '--strict') args.strict = true;
        else if (arg === '--help' || arg === '-h') args.help = true;
    }
    return args;
}

function runCli({ argv = process.argv } = {}) {
    const args = parseArgs(argv);
    if (args.help || !args.snapshot || !args.identityMap) {
        console.log('Usage: identity-reconcile --snapshot <bitable-snapshot.json> --identity-map <map.json> [--emit-draft <file>] [--strict]');
        return args.strict ? 1 : 0;
    }
    const snapshot = JSON.parse(fs.readFileSync(path.resolve(args.snapshot), 'utf8'));
    const identityMap = JSON.parse(fs.readFileSync(path.resolve(args.identityMap), 'utf8'));
    const records = Array.isArray(snapshot) ? snapshot : (snapshot.rows || []);

    const report = reconcileIdentityCoverage({ records, identityMap });

    if (args.emitDraft && report.missing.length > 0) {
        const { entries, evidence } = identityEntryDrafts({ records, missing: report.missing });
        const draft = {
            schemaVersion: 1,
            note: 'Evidence-backed identity-map entry drafts derived from governed records. Merge manually after comparing against the map on master.',
            missingSlugs: [...report.missing],
            entries,
            evidence,
        };
        fs.mkdirSync(path.dirname(path.resolve(args.emitDraft)), { recursive: true });
        fs.writeFileSync(path.resolve(args.emitDraft), `${JSON.stringify(draft, null, 2)}\n`);
        console.log(`Draft written to ${path.resolve(args.emitDraft)} (${entries.length} entr(ies))`);
    }

    console.log(JSON.stringify({
        checked: report.checked,
        missing: report.missing,
        extras: report.extras,
        diagnostics: report.diagnostics,
    }, null, 2));

    return args.strict && report.missing.length > 0 ? 1 : 0;
}

if (require.main === module) {
    process.exit(runCli() || 0);
}

module.exports = { parseArgs, runCli };
