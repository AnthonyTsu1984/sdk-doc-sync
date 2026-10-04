#!/usr/bin/env node
'use strict';

// Campaign intake preflight (campaign-control hardening batch 1, §3.6):
// deterministic checks over the reviewed-context file BEFORE a campaign
// starts, so the five-gate CLI diagnostic chain ("verbatimContent 空→params
// 缺→planningContext 缺→继承证据缺→folderAncestry 缺", ≈6M tokens of live
// probing) and the three context-writing defects (Chinese summary, internal
// notes leaking into pages, verb-first first sentence) all die at intake
// time. The context file IS the input spec — this script reverse-engineers
// it field by field, every run.
//
// Plan-level fields (planningContext, folderAncestry, inheritance evidence)
// stay with the executor's own typed gates; they are added here when the
// next campaign's plan schema is known — never pre-written against a
// guessed shape.
//
// Usage:
//   node scripts/intake-preflight.js --contexts <reviewed-context.json>
//       [--language java] [--json] [--strict] [--allow-missing-verbatim]
//
// Findings (severity error → --strict exits 1):
//   INTAKE_CONTEXT_KEYS_MISSING / INTAKE_CONTEXT_KEYS_UNEXPECTED
//   INTAKE_VERBATIM_EMPTY, INTAKE_VERBATIM_BARE_NOTES
//   INTAKE_NOTES_KEY_NONEMPTY, INTAKE_SUMMARY_REGISTER, CONTENT_CJK_MIXING
//   INTAKE_PR_MISSING (warn — scan-only actions legitimately have no PR)

const fs = require('node:fs');
const path = require('node:path');
const { CJK_PATTERN } = require('../src/sdk-doc-sync/layout-conformance');
const sdkLayoutProfiles = require('../src/renderers/sdk-layout-profiles');

const CONTEXT_KEYS = [
    'category', 'documentationOwnership', 'examples', 'exceptions', 'kind',
    'notes', 'pr', 'reasons', 'repository', 'reviewedEvidence', 'revision',
    'sourceVariants', 'summary', 'symbolName', 'title', 'verbatimContent',
];

function parseArgs(argv) {
    const options = { language: 'java', json: false, strict: false };
    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--contexts') options.contexts = path.resolve(argv[++index]);
        else if (arg === '--language') options.language = argv[++index];
        else if (arg === '--json') options.json = true;
        else if (arg === '--strict') options.strict = true;
        else if (arg === '--allow-missing-verbatim') options.allowMissingVerbatim = true;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!options.contexts) throw new Error('--contexts is required');
    return options;
}

function contextEntries(document) {
    if (!document || typeof document !== 'object') throw new Error('contexts document must be an object');
    const contexts = document.contexts;
    if (Array.isArray(contexts)) return contexts.map((entry, index) => [entry?.title || `#${index}`, entry]);
    if (contexts && typeof contexts === 'object') return Object.entries(contexts);
    throw new Error('contexts document has no contexts array/object');
}

function cjkOffendingTexts(entry) {
    const fields = ['summary', 'verbatimContent', 'examples', 'exceptions'];
    const offending = [];
    for (const field of fields) {
        const value = entry?.[field];
        if (typeof value === 'string' && CJK_PATTERN.test(value)) offending.push(`${field}: ${value.slice(0, 80)}`);
    }
    return offending;
}

function hasPrEvidence(entry) {
    if (entry?.pr && (typeof entry.pr === 'string' || typeof entry.pr === 'number')) return true;
    return (entry?.reviewedEvidence || []).some((item) => item?.kind === 'pr');
}

function main(argv = process.argv) {
    const options = parseArgs(argv);
    const profile = sdkLayoutProfiles[options.language];
    // 2026-10-04 adjudication: registers are a declared set (operation pages
    // "This operation …", class/type pages "This class …"); a summary passes
    // when it matches any declared register.
    const contentQuality = profile?.layoutRules?.contentQuality || {};
    const registers = [
        ...(typeof contentQuality.firstSentencePattern === 'string' && contentQuality.firstSentencePattern ? [contentQuality.firstSentencePattern] : ['^This operation\\b']),
        ...(contentQuality.firstSentencePatterns || []).filter((pattern) => typeof pattern === 'string' && pattern),
    ];
    const document = JSON.parse(fs.readFileSync(options.contexts, 'utf8'));
    const entries = contextEntries(document);

    const findings = [];
    const report = (severity, code, identity, detail) => findings.push({ severity, code, identity, detail });
    for (const [identity, entry] of entries) {
        if (!entry || typeof entry !== 'object') {
            report('error', 'INTAKE_CONTEXT_ENTRY_INVALID', identity, 'entry is not an object');
            continue;
        }
        const keys = Object.keys(entry).sort();
        const missing = CONTEXT_KEYS.filter((key) => !(key in entry));
        const unexpected = keys.filter((key) => !CONTEXT_KEYS.includes(key));
        if (missing.length > 0) report('error', 'INTAKE_CONTEXT_KEYS_MISSING', identity, `missing ${missing.join(', ')}`);
        if (unexpected.length > 0) report('error', 'INTAKE_CONTEXT_KEYS_UNEXPECTED', identity, `unexpected ${unexpected.join(', ')}`);

        if (typeof entry.verbatimContent !== 'string' || entry.verbatimContent.trim() === '') {
            if (!options.allowMissingVerbatim) report('error', 'INTAKE_VERBATIM_EMPTY', identity, 'verbatimContent is empty');
        } else {
            const bareNotes = entry.verbatimContent.split(/\r?\n/).find((line) => /^#{0,3}\s*notes:?$/i.test(line.trim()));
            if (bareNotes) report('error', 'INTAKE_VERBATIM_BARE_NOTES', identity, `bare Notes line in verbatimContent: ${bareNotes.trim()}`);
        }

        if (entry.notes && String(entry.notes).trim() !== '') {
            report('error', 'INTAKE_NOTES_KEY_NONEMPTY', identity, `notes key must stay empty (renderer would emit it as a page section): ${String(entry.notes).slice(0, 80)}`);
        }

        if (typeof entry.summary === 'string' && entry.summary.trim() !== ''
            && !registers.some((pattern) => new RegExp(pattern).test(entry.summary.trim()))) {
            report('error', 'INTAKE_SUMMARY_REGISTER', identity, `summary first sentence does not match any declared register (${registers.map((pattern) => `/${pattern}/`).join(' ')}): ${entry.summary.slice(0, 80)}`);
        }

        const cjk = cjkOffendingTexts(entry);
        for (const detail of cjk) report('error', 'CONTENT_CJK_MIXING', identity, detail);

        if (!hasPrEvidence(entry)) report('warn', 'INTAKE_PR_MISSING', identity, 'no PR evidence in reviewedEvidence (legitimate only for scan-only actions)');
    }

    const summary = {
        entries: entries.length,
        errors: findings.filter((finding) => finding.severity === 'error').length,
        warnings: findings.filter((finding) => finding.severity === 'warn').length,
        byCode: {},
    };
    for (const finding of findings) {
        summary.byCode[finding.code] = (summary.byCode[finding.code] || 0) + 1;
    }

    if (options.json) {
        process.stdout.write(`${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), contexts: options.contexts, language: options.language, findings, summary }, null, 2)}\n`);
    } else {
        for (const finding of findings) {
            process.stdout.write(`[${finding.severity}] ${finding.code} ${finding.identity} — ${finding.detail}\n`);
        }
        process.stdout.write(`${summary.entries} context entr(ies): ${summary.errors} error(s), ${summary.warnings} warning(s)\n`);
    }
    if (summary.errors > 0) process.exitCode = 1;
    if (options.strict && findings.length > 0) process.exitCode = 1;
}

try {
    main(process.argv);
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
