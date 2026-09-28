#!/usr/bin/env node
'use strict';

// Post-verbatim polish CLI (api.pr-polish-governed). Deterministic gateway
// between the polish subagent's manifest and any live mutation: validates the
// journaled verbatim proof, applies the manifest to the verified content,
// emits the exact polished bytes + provenance digests the write batch and
// acceptance bind, and (with --verify-raw-content) proves the refetched page
// compares line-for-line against the recomputed polished content. This tool
// never talks to Feishu — the governed writer applies the emitted edits.

const fs = require('node:fs');
const path = require('node:path');
const {
    assertPolishPreconditions,
    applyPolishManifest,
    comparePolishedContent,
} = require('../src/sdk-doc-sync/pr-polish');

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
    const options = {};
    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--base-content') options.baseContent = path.resolve(argv[++index]);
        else if (arg === '--fidelity-outcome') options.fidelityOutcome = path.resolve(argv[++index]);
        else if (arg === '--manifest') options.manifest = path.resolve(argv[++index]);
        else if (arg === '--polished-output') options.polishedOutput = path.resolve(argv[++index]);
        else if (arg === '--provenance-output') options.provenanceOutput = path.resolve(argv[++index]);
        else if (arg === '--verify-raw-content') options.verifyRawContent = path.resolve(argv[++index]);
        else throw new Error(`Unknown argument: ${arg}`);
    }
    const missing = ['baseContent', 'fidelityOutcome', 'manifest', 'polishedOutput', 'provenanceOutput']
        .filter((key) => !options[key]);
    if (missing.length > 0) {
        throw new Error(`Missing required arguments: ${missing.map((key) => `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`).join(' ')}`);
    }
    return options;
}

function main(argv = process.argv) {
    const options = parseArgs(argv);
    const baseContent = fs.readFileSync(options.baseContent, 'utf8');

    // Fail-closed sequencing: no verified verbatim landing for THESE bytes,
    // no polish. The journal outcome carries the digest of the content the
    // verbatim phase compared, so a passing proof cannot be replayed against
    // different content.
    assertPolishPreconditions({ contentFidelity: readJson(options.fidelityOutcome), baseContent });

    const manifest = readJson(options.manifest);
    const { polishedContent, provenance } = applyPolishManifest({ manifest, baseContent });

    // Terminal proof BEFORE any artifact lands on disk: a divergent refetch
    // leaves no polished/provenance outputs behind, only the typed failure.
    let verified = false;
    if (options.verifyRawContent) {
        const rawContent = fs.readFileSync(options.verifyRawContent, 'utf8');
        const comparison = comparePolishedContent({ polishedContent, rawContent });
        if (!comparison.ok) {
            process.stderr.write(`PR_POLISH_CONTENT_VERIFICATION_FAILED: refetched raw_content diverges from the polished terminal content at ${comparison.diffs.length} line(s)\n`);
            process.stderr.write(`${JSON.stringify(comparison.diffs, null, 2)}\n`);
            process.exit(1);
        }
        verified = true;
    }

    fs.writeFileSync(options.polishedOutput, polishedContent);
    fs.writeFileSync(options.provenanceOutput, `${JSON.stringify(provenance, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ok: true, ...provenance, verified })}\n`);
}

if (require.main === module) {
    try {
        main(process.argv);
    } catch (error) {
        process.stderr.write(`${error.code || 'PR_POLISH_FAILED'}: ${error.message}\n`);
        process.exit(1);
    }
}

module.exports = { main };
