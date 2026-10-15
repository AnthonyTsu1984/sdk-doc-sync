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
//       [--route auto|verbatim|structured]
//       [--mirror-allowlist config/style-mirror-allowlist.json]
//
// Routing (campaign-control batch 15 §9): --route auto is the DEFAULT.
// go/python intake preflights failed their structured-route files because
// the verbatim default judged the nine STRUCTURED_ROUTE_KEYS unexpected.
// auto judges PER ENTRY: an entry carrying any structured-route key is
// validated as structured (the verbatim keys kind/pr/verbatimContent become
// optional), everything else as verbatim — entry-level, because the node
// campaign legitimately ships mixed files (139 structured + 20 verbatim
// fallback units). The report notes the routing: every finding carries its
// route, the JSON report maps each entry to its route, and the text report
// prints the aggregate counts. Explicit --route verbatim|structured is kept
// and overrides auto with the old whole-file behavior.
//
// Findings (severity error → --strict exits 1):
//   INTAKE_CONTEXT_KEYS_MISSING / INTAKE_CONTEXT_KEYS_UNEXPECTED
//   INTAKE_VERBATIM_EMPTY, INTAKE_VERBATIM_BARE_NOTES
//   INTAKE_NOTES_KEY_NONEMPTY, INTAKE_SUMMARY_REGISTER, CONTENT_CJK_MIXING
//   INTAKE_RELATIVE_LINK_URL (markdown link to a non-absolute URL anywhere in
//   the entry, fence-aware — intake-side parity with the writer's
//   RELATIVE_LINK_URL_REJECTED; go-v30 orphan-shell root cause)
//   INTAKE_PR_MISSING (warn — scan-only actions legitimately have no PR)
//   STYLE_MIRROR_ENTRY_INVALID / STYLE_MIRROR_SOURCE_NOT_ALLOWLISTED
//   (batch 3: styleMirrors must reference operator-designated exemplar
//   pages only; a malformed allowlist config aborts the whole run with
//   STYLE_MIRROR_ALLOWLIST_MALFORMED — fail closed)

const fs = require('node:fs');
const path = require('node:path');
const { CJK_PATTERN } = require('../src/sdk-doc-sync/layout-conformance');
const { collectRelativeLinkFindings } = require('../src/sdk-doc-sync/link-policy');
const {
    loadStyleMirrorAllowlist,
    checkStyleMirrors,
    defaultAllowlistPath,
} = require('../src/sdk-doc-sync/style-mirror-policy');
const sdkLayoutProfiles = require('../src/renderers/sdk-layout-profiles');

const CONTEXT_KEYS = [
    'category', 'documentationOwnership', 'examples', 'exceptions', 'kind',
    'notes', 'pr', 'reasons', 'repository', 'reviewedEvidence', 'revision',
    'sourceVariants', 'summary', 'symbolName', 'title', 'verbatimContent',
];
// Keys the pipeline itself consumes when present (adapter inputs for
// request/callable entries, reviewed type URLs) — expected on the entries
// that carry them, never flagged as UNEXPECTED.
const OPTIONAL_CONTEXT_KEYS = ['params', 'result', 'signature', 'typeUrls', 'requestSyntax', 'requiredFields', 'styleMirrors',
    'summaryCallouts', 'requestVariants', 'callableMembers', 'inheritanceReview', 'reviewedActionType', 'treeDelta',
    // build-reviewed-release-context attaches these to the entry whenever the
    // scope action carries a canonical stateful-class organization contract
    // (node-stateful-class, …); a stateful-class campaign can never pass
    // strict intake without them. validateOrganizationContract judges them
    // downstream — these keys only stop being "unexpected".
    'organization', 'organizationInventory'];
// Structured-route entries (go v3.0.0 campaign shape: the reviewed context
// carries the parsed upstream structure, not solidified verbatim bytes) and
// grouping-bound planning evidence that rides the reference context when the
// entry scope is the receipt-bound unfiltered scope. Under --route auto
// (the default) any of these keys flips the entry to the structured contract.
const STRUCTURED_ROUTE_KEYS = [
    'current', 'target', 'existingRecordLookup', 'copySource', 'dependencies',
    'placementWalk', 'inheritanceEvidence', 'sharedUpdateReviews',
    'tokenReferencedByOlderVersions',
];
// Keys required by the verbatim route only (merged-PR pages solidified as
// verbatimContent; kind/pr ride the entry): a structured-route entry replaces
// them with the adapter-consumed structure keys.
const VERBATIM_ROUTE_KEYS = ['kind', 'pr', 'verbatimContent'];

function parseArgs(argv = process.argv) {
    const options = { language: 'java', json: false, strict: false, route: 'auto' };
    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--contexts') options.contexts = path.resolve(argv[++index]);
        else if (arg === '--language') options.language = argv[++index];
        else if (arg === '--route') {
            options.route = argv[++index];
            if (!['auto', 'verbatim', 'structured'].includes(options.route)) throw new Error(`--route must be auto, verbatim, or structured (got ${options.route})`);
        }
        else if (arg === '--mirror-allowlist') options.mirrorAllowlist = path.resolve(argv[++index]);
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
    // 2026-10-04 adjudication (revised same day): registers are a declared
    // set (operation/getter pages "This operation …", class/type pages
    // "A Xxx instance is …"); a summary passes when it matches any declared
    // register.
    const contentQuality = profile?.layoutRules?.contentQuality || {};
    const registers = [
        ...(typeof contentQuality.firstSentencePattern === 'string' && contentQuality.firstSentencePattern ? [contentQuality.firstSentencePattern] : ['^This operation\\b']),
        ...(contentQuality.firstSentencePatterns || []).filter((pattern) => typeof pattern === 'string' && pattern),
    ];
    const document = JSON.parse(fs.readFileSync(options.contexts, 'utf8'));
    const entries = contextEntries(document);

    // The allowlist is load-bearing for the styleMirrors check: a malformed
    // config aborts before any entry is judged (fail closed — an unreadable
    // allowlist must not degrade into "everything allowed").
    let mirrorAllowlist = null;
    const allowlistPath = options.mirrorAllowlist || defaultAllowlistPath();
    if (entries.some(([, entry]) => entry && typeof entry === 'object' && 'styleMirrors' in entry)) {
        try {
            mirrorAllowlist = loadStyleMirrorAllowlist(allowlistPath);
        } catch (error) {
            process.stderr.write(`${error.code || 'STYLE_MIRROR_ALLOWLIST_MALFORMED'}: ${error.message}\n`);
            process.exit(1);
        }
    }

    const findings = [];
    const entryRoutes = {};
    const report = (severity, code, identity, detail, route = null) => findings.push(route
        ? { severity, code, identity, detail, route }
        : { severity, code, identity, detail });
    for (const [identity, entry] of entries) {
        if (!entry || typeof entry !== 'object') {
            report('error', 'INTAKE_CONTEXT_ENTRY_INVALID', identity, 'entry is not an object');
            continue;
        }
        // §9 route discovery, per entry: any structured-route key flips this
        // entry to the structured contract (verbatim keys optional); under an
        // explicit --route the whole file keeps the legacy whole-file verdict.
        const structuredRoute = options.route === 'structured'
            || (options.route === 'auto' && STRUCTURED_ROUTE_KEYS.some((key) => key in entry));
        const entryRoute = structuredRoute ? 'structured' : 'verbatim';
        entryRoutes[identity] = entryRoute;
        // Every finding an entry raises carries the route that judged it, so
        // a mixed-file report is readable per line without cross-referencing.
        const pushFinding = (severity, code, detail) => report(severity, code, identity, detail, entryRoute);
        const keys = Object.keys(entry).sort();
        const requiredKeys = CONTEXT_KEYS.filter((key) => !structuredRoute || !VERBATIM_ROUTE_KEYS.includes(key));
        const allowedKeys = [...CONTEXT_KEYS, ...OPTIONAL_CONTEXT_KEYS, ...(structuredRoute ? [...STRUCTURED_ROUTE_KEYS, ...VERBATIM_ROUTE_KEYS] : [])];
        const missing = requiredKeys.filter((key) => !(key in entry));
        const unexpected = keys.filter((key) => !allowedKeys.includes(key));
        if (missing.length > 0) pushFinding('error', 'INTAKE_CONTEXT_KEYS_MISSING', `missing ${missing.join(', ')}`);
        if (unexpected.length > 0) pushFinding('error', 'INTAKE_CONTEXT_KEYS_UNEXPECTED', `unexpected ${unexpected.join(', ')}`);

        if (typeof entry.verbatimContent !== 'string' || entry.verbatimContent.trim() === '') {
            // Structured-route entries carry the parsed upstream structure
            // instead of solidified bytes; verbatimContent stays optional.
            if (!options.allowMissingVerbatim && !structuredRoute) pushFinding('error', 'INTAKE_VERBATIM_EMPTY', 'verbatimContent is empty');
        } else {
            const bareNotes = entry.verbatimContent.split(/\r?\n/).find((line) => /^#{0,3}\s*notes:?$/i.test(line.trim()));
            if (bareNotes) pushFinding('error', 'INTAKE_VERBATIM_BARE_NOTES', `bare Notes line in verbatimContent: ${bareNotes.trim()}`);
        }

        if (entry.notes && String(entry.notes).trim() !== '') {
            pushFinding('error', 'INTAKE_NOTES_KEY_NONEMPTY', `notes key must stay empty (renderer would emit it as a page section): ${String(entry.notes).slice(0, 80)}`);
        }

        if (typeof entry.summary === 'string' && entry.summary.trim() !== ''
            && !registers.some((pattern) => new RegExp(pattern).test(entry.summary.trim()))) {
            pushFinding('error', 'INTAKE_SUMMARY_REGISTER', `summary first sentence does not match any declared register (${registers.map((pattern) => `/${pattern}/`).join(' ')}): ${entry.summary.slice(0, 80)}`);
        }

        const cjk = cjkOffendingTexts(entry);
        for (const detail of cjk) pushFinding('error', 'CONTENT_CJK_MIXING', detail);

        // Intake-side parity with the writer's RELATIVE_LINK_URL_REJECTED
        // (api.absolute-link-urls): a relative .md link anywhere in the entry
        // — verbatimContent, summary, or nested structured-route fields — is
        // refused here, before a plan exists, instead of mid-CREATE after the
        // drive shell has landed (go-v30 b19 ListFileResources orphan-shell
        // incident). Fenced code blocks are exempt: code that SHOWS markdown
        // link syntax converts to a code block, never a link object.
        for (const finding of collectRelativeLinkFindings(entry)) {
            pushFinding('error', 'INTAKE_RELATIVE_LINK_URL',
                `${finding.path} line ${finding.line}: ${finding.excerpt} → ${finding.url} — resolve to an absolute in-KB docx URL before planning (api.absolute-link-urls)`);
        }

        if ('styleMirrors' in entry) {
            const { violations } = checkStyleMirrors({
                language: options.language,
                styleMirrors: entry.styleMirrors,
                allowlist: mirrorAllowlist,
            });
            for (const violation of violations) pushFinding('error', violation.code, violation.detail);
        }

        if (!hasPrEvidence(entry)) pushFinding('warn', 'INTAKE_PR_MISSING', 'no PR evidence in reviewedEvidence (legitimate only for scan-only actions)');
    }

    const routeCounts = { structured: 0, verbatim: 0 };
    for (const route of Object.values(entryRoutes)) routeCounts[route] += 1;

    const summary = {
        entries: entries.length,
        errors: findings.filter((finding) => finding.severity === 'error').length,
        warnings: findings.filter((finding) => finding.severity === 'warn').length,
        byCode: {},
        routes: {
            mode: options.route,
            ...routeCounts,
        },
    };
    for (const finding of findings) {
        summary.byCode[finding.code] = (summary.byCode[finding.code] || 0) + 1;
    }

    if (options.json) {
        process.stdout.write(`${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), contexts: options.contexts, language: options.language, route: options.route, entryRoutes, findings, summary }, null, 2)}\n`);
    } else {
        for (const finding of findings) {
            process.stdout.write(`[${finding.severity}] ${finding.code} ${finding.identity} — ${finding.detail}\n`);
        }
        process.stdout.write(`${summary.entries} context entr(ies): ${summary.errors} error(s), ${summary.warnings} warning(s)\n`);
        process.stdout.write(`route (${summary.routes.mode}): ${summary.routes.structured} structured, ${summary.routes.verbatim} verbatim\n`);
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
