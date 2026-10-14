#!/usr/bin/env node
'use strict';

// Pre-presentation check for the canonical gate-presentation index
// (tmp/api-reference-sync/gate-presentation/latest.html), 2026-10-14 user
// ruling: the presentation page has a FIXED structure, the key points are
// checked by script BEFORE the gate is presented, and a failing page is
// regenerated from its source until the check passes — a presentation that
// cannot pass is never shown to the operator.
//
// Background (the incident that produced this): the canonical generator's
// --from-dryrun path emitted a page WITHOUT the `session:` binding line
// (the dry-run JSON carries no session path), while the board parser treats
// session as mandatory — the page silently failed to attach, the gate card
// lost its digest prefill, and the operator was sent into a "copy it from
// the materials" dead loop. Structure drift between producer and consumer
// was unenforced in both directions; this script is the producer-side teeth.
//
// The fixed structure (every point is checked; html that fails ANY point is
// not a presentation):
//   P1 GATE_BANNER      exactly one <h1>{GATE} — gate materials</h1>,
//                       GATE ∈ the five reply-line gate names
//   P2 BOUND_DIGEST     exactly one `bound digest: <code>sha256:<64 hex></code>`
//   P3 SESSION_BINDING  exactly one `session: <code><path></code>`; the path
//                       (repo-root relative or absolute) must exist on disk —
//                       a presentation that cannot name its campaign binds
//                       nothing
//   P4 GENERATED_STAMP  exactly one `generated: <ISO8601>`; no far-future
//                       stamps (5 min clock-skew allowance)
//   P5 MATERIAL_LINKS   ≥1 numbered `<li><a href="(https?|file)://…">` inside
//                       an <ol> — the operator must have something to open
//   P6 TAG_BALANCE      balanced <code>/<pre> pairs, exactly one <body>
//   P7 SOURCE_BINDING   when the source (--manifest, or --from-dryrun +
//                       --session) is given: html digest/gate/session equal
//                       the source's — the page presents THIS gate, not a
//                       stale or hand-edited one
//
// Usage:
//   node scripts/gate-presentation-check.js [--file <html>] \
//     [--manifest <manifest.json> | --from-dryrun <dry-run.json> --session <path>] \
//     [--repo-root <dir>] [--index-dir <dir>] [--ensure] [--attempts N] [--json]
//
//   --file        default <index-dir>/latest.html
//   --ensure      on failure, regenerate the page via scripts/gate-presentation.js
//                 from the given source and re-check, until it passes or the
//                 attempt budget (default 3) is exhausted. Without a source the
//                 check fails outright — there is nothing to regenerate from.
//   --json        machine-readable report
//
// Exit 0 = the page passes (with --ensure: passes after ≤N regenerations);
// exit 1 = it does not (itemized PRESENTATION_* failure codes). A non-zero
// exit means: DO NOT present this gate — fix the source and re-run.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GATE_NAMES = Object.freeze([
    'APPROVE_GROUPING',
    'APPROVE_WRITES',
    'APPROVE_DOCUMENT',
    'APPROVE_ROLLBACK',
    'APPROVE_ACCEPTANCE',
]);

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

function failure(point, code, detail) {
    return { point, code, detail };
}

function countMatches(haystack, pattern) {
    const matches = haystack.match(pattern);
    return matches ? matches.length : 0;
}

// P1..P6 operate on the html alone; P7 needs the resolved source binding.
function validatePresentationHtml(html, options = {}) {
    const failures = [];
    if (typeof html !== 'string' || html.trim() === '') {
        return { ok: false, failures: [failure('P1', 'PRESENTATION_PAGE_EMPTY', 'presentation html is empty or missing')] };
    }

    // P1 — gate banner
    const banners = [...html.matchAll(/<h1>\s*(APPROVE_[A-Z_]+)\s*—[^<]*<\/h1>/g)].map((m) => m[1]);
    if (banners.length === 0) {
        failures.push(failure('P1', 'PRESENTATION_GATE_BANNER_MISSING', 'no <h1>{GATE} — gate materials</h1> banner found'));
    } else if (banners.length > 1) {
        failures.push(failure('P1', 'PRESENTATION_GATE_BANNER_DUPLICATE', `${banners.length} gate banners found, exactly one required`));
    } else if (!GATE_NAMES.includes(banners[0])) {
        failures.push(failure('P1', 'PRESENTATION_GATE_NAME_UNKNOWN', `gate "${banners[0]}" is not a reply-line gate name (${GATE_NAMES.join(', ')})`));
    }
    const gate = banners.length === 1 ? banners[0] : null;

    // P2 — bound digest
    const digests = [...html.matchAll(/bound digest:\s*<code>([^<]+)<\/code>/g)].map((m) => m[1].trim());
    if (digests.length === 0) {
        failures.push(failure('P2', 'PRESENTATION_DIGEST_MISSING', 'no "bound digest: <code>sha256:…</code>" line — the approval reply binds nothing'));
    } else if (digests.length > 1) {
        failures.push(failure('P2', 'PRESENTATION_DIGEST_DUPLICATE', `${digests.length} bound-digest lines, exactly one required`));
    } else if (!DIGEST_PATTERN.test(digests[0])) {
        failures.push(failure('P2', 'PRESENTATION_DIGEST_MALFORMED', `digest ${JSON.stringify(digests[0])} does not match sha256:<64 hex>`));
    }
    const digest = digests.length === 1 && DIGEST_PATTERN.test(digests[0]) ? digests[0] : null;

    // P3 — session binding (path must exist)
    const sessions = [...html.matchAll(/session:\s*<code>([^<]+)<\/code>/g)].map((m) => m[1].trim());
    let sessionPath = null;
    if (sessions.length === 0) {
        failures.push(failure('P3', 'PRESENTATION_SESSION_MISSING', 'no "session: <code>…</code>" line — the board cannot attach a session-less presentation (2026-10-14 incident)'));
    } else if (sessions.length > 1) {
        failures.push(failure('P3', 'PRESENTATION_SESSION_DUPLICATE', `${sessions.length} session lines, exactly one required`));
    } else {
        sessionPath = sessions[0];
        // The on-disk existence sub-check is a runtime concern (the campaign
        // session file exists when a worker presents); the structure check
        // only asserts the LINE is present unless the caller wants the full
        // runtime check (the pre-presentation CLI always does).
        if (!options.skipSessionFileExistence) {
            const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : process.cwd();
            const resolved = path.isAbsolute(sessionPath) ? sessionPath : path.join(repoRoot, sessionPath);
            try {
                const stat = fs.statSync(resolved);
                if (!stat.isFile()) {
                    failures.push(failure('P3', 'PRESENTATION_SESSION_FILE_NOT_FOUND', `session path resolves to a non-file: ${resolved}`));
                }
            } catch {
                failures.push(failure('P3', 'PRESENTATION_SESSION_FILE_NOT_FOUND', `session path does not exist on disk: ${resolved}`));
            }
        }
    }

    // P4 — generated stamp
    const stamps = [...html.matchAll(/generated:\s*([0-9T:.\-Z]+)/g)].map((m) => m[1]);
    let generatedAt = null;
    if (stamps.length === 0) {
        failures.push(failure('P4', 'PRESENTATION_GENERATED_MISSING', 'no "generated: <ISO8601>" line'));
    } else if (stamps.length > 1) {
        failures.push(failure('P4', 'PRESENTATION_GENERATED_DUPLICATE', `${stamps.length} generated lines, exactly one required`));
    } else {
        const parsed = Date.parse(stamps[0]);
        if (Number.isNaN(parsed)) {
            failures.push(failure('P4', 'PRESENTATION_GENERATED_MALFORMED', `generated stamp ${JSON.stringify(stamps[0])} is not ISO8601`));
        } else if (parsed - Date.now() > FUTURE_SKEW_MS) {
            failures.push(failure('P4', 'PRESENTATION_GENERATED_IN_FUTURE', `generated stamp ${stamps[0]} is in the future beyond the 5 min skew allowance`));
        } else {
            generatedAt = stamps[0];
        }
    }

    // P5 — material links
    const links = [...html.matchAll(/<li><a href="((?:https?|file):\/\/[^"]+)">/g)];
    if (links.length === 0) {
        failures.push(failure('P5', 'PRESENTATION_LINKS_MISSING', 'no numbered <li><a href="(https?|file)://…"> material links — the operator has nothing to open'));
    }

    // P6 — tag balance
    for (const tag of ['code', 'pre', 'h1', 'h2']) {
        const opened = countMatches(html, new RegExp(`<${tag}(\\s[^>]*)?>`, 'g'));
        const closed = countMatches(html, new RegExp(`</${tag}>`, 'g'));
        if (opened !== closed) {
            failures.push(failure('P6', 'PRESENTATION_TAGS_UNBALANCED', `<${tag}> opened ${opened}x but closed ${closed}x`));
        }
    }
    if (countMatches(html, /<body>/g) !== 1 || countMatches(html, /<\/body>/g) !== 1) {
        failures.push(failure('P6', 'PRESENTATION_BODY_UNBALANCED', 'exactly one <body>…</body> pair required'));
    }

    // P7 — source binding
    const binding = options.binding;
    if (binding) {
        if (digest && binding.digest && digest !== binding.digest) {
            failures.push(failure('P7', 'PRESENTATION_BINDING_MISMATCH', `page digest ${digest} ≠ source digest ${binding.digest}`));
        }
        if (gate && binding.gate && gate !== binding.gate) {
            failures.push(failure('P7', 'PRESENTATION_BINDING_MISMATCH', `page gate ${gate} ≠ source gate ${binding.gate}`));
        }
        if (sessionPath && binding.session) {
            const root = options.repoRoot ? path.resolve(options.repoRoot) : process.cwd();
            const pageSession = path.isAbsolute(sessionPath) ? sessionPath : path.join(root, sessionPath);
            const sourceSession = path.isAbsolute(binding.session) ? binding.session : path.join(root, binding.session);
            if (pageSession !== sourceSession) {
                failures.push(failure('P7', 'PRESENTATION_BINDING_MISMATCH', `page session ${pageSession} ≠ source session ${sourceSession}`));
            }
        }
    }

    return {
        ok: failures.length === 0,
        failures,
        gate,
        digest,
        sessionPath,
        generatedAt,
        linkCount: links.length,
    };
}

// Resolve the P7 binding from a generator-source invocation (same shapes
// scripts/gate-presentation.js consumes). Returns null when no source is
// given — P7 is conditional on evidence, never invented.
function resolveBinding(options) {
    if (options.manifest) {
        let document;
        try {
            document = JSON.parse(fs.readFileSync(options.manifest, 'utf8'));
        } catch (error) {
            throw new Error(`--manifest unreadable at ${options.manifest}: ${error.message}`);
        }
        let digest = typeof document.digest === 'string' && document.digest.trim() !== '' ? document.digest.trim() : null;
        if (!digest && typeof document.replyLine === 'string') {
            const match = /sha256:[0-9a-f]{64}/.exec(document.replyLine);
            if (match) digest = match[0];
        }
        return {
            gate: typeof document.gate === 'string' && document.gate.trim() !== '' ? document.gate.trim() : null,
            digest,
            session: typeof document.session === 'string' && document.session.trim() !== '' ? document.session.trim() : null,
            kind: 'manifest',
        };
    }
    if (options.fromDryrun) {
        if (!options.session) {
            throw new Error('--from-dryrun requires --session <path> (the dry-run JSON carries no session path)');
        }
        let document;
        try {
            document = JSON.parse(fs.readFileSync(options.fromDryrun, 'utf8'));
        } catch (error) {
            throw new Error(`--from-dryrun unreadable at ${options.fromDryrun}: ${error.message}`);
        }
        const batchDigest = document?.proposedExecutionBatch?.batchDigest;
        if (typeof batchDigest !== 'string' || !DIGEST_PATTERN.test(batchDigest)) {
            throw new Error('dry-run proposedExecutionBatch.batchDigest is missing or malformed — regenerate the dry-run first');
        }
        return { gate: 'APPROVE_WRITES', digest: batchDigest, session: path.resolve(options.session), kind: 'dryrun' };
    }
    return null;
}

function parseArgs(argv) {
    const options = { json: false, ensure: false, attempts: 3 };
    options.indexDir = path.resolve('tmp', 'api-reference-sync', 'gate-presentation');
    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--file') options.file = path.resolve(argv[++index]);
        else if (arg === '--manifest') options.manifest = path.resolve(argv[++index]);
        else if (arg === '--from-dryrun') options.fromDryrun = path.resolve(argv[++index]);
        else if (arg === '--session') options.session = path.resolve(argv[++index]);
        else if (arg === '--repo-root') options.repoRoot = path.resolve(argv[++index]);
        else if (arg === '--index-dir') options.indexDir = path.resolve(argv[++index]);
        else if (arg === '--ensure') options.ensure = true;
        else if (arg === '--attempts') options.attempts = Number.parseInt(argv[++index], 10);
        else if (arg === '--json') options.json = true;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (Boolean(options.manifest) === Boolean(options.fromDryrun) && options.ensure) {
        throw new Error('--ensure needs exactly one of --manifest or --from-dryrun (--session) to regenerate from');
    }
    if (Boolean(options.manifest) === Boolean(options.fromDryrun) && Boolean(options.manifest) === true) {
        throw new Error('give exactly one of --manifest or --from-dryrun, not both');
    }
    if (options.session && !options.fromDryrun) {
        throw new Error('--session only pairs with --from-dryrun');
    }
    if (!options.file) options.file = path.join(options.indexDir, 'latest.html');
    if (!Number.isInteger(options.attempts) || options.attempts < 1) {
        throw new Error('--attempts must be an integer ≥ 1');
    }
    // --ensure regenerates through the generator's --index-dir; when --file
    // points elsewhere, re-target regeneration to the file's own directory so
    // the loop re-checks exactly what it rewrote (a divergence would let the
    // check bless a fresh page while the operator-facing file stays broken).
    if (options.ensure && options.file !== path.join(options.indexDir, 'latest.html')) {
        options.indexDir = path.dirname(options.file);
    }
    return options;
}

function readPresentation(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

// One ensure round: regenerate the page from the source via the canonical
// generator (its own self-check already refuses to write an invalid page —
// a regeneration failure leaves the previous file untouched).
function regenerateFromSource(options) {
    const generator = path.join(__dirname, 'gate-presentation.js');
    const args = [generator, '--no-open', '--no-clipboard', '--index-dir', options.indexDir];
    if (options.manifest) args.push('--manifest', options.manifest);
    else args.push('--from-dryrun', options.fromDryrun, '--session', options.session);
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 60000 });
    return {
        ok: result.status === 0,
        stdout: String(result.stdout || ''),
        stderr: String(result.stderr || ''),
    };
}

function main(argv = process.argv) {
    const options = parseArgs(argv);
    const binding = resolveBinding(options); // throws on an unreadable source
    let attemptsUsed = 0;
    let regenerated = false;

    let report = validatePresentationHtml(readPresentation(options.file), {
        repoRoot: options.repoRoot,
        binding,
    });

    while (!report.ok && options.ensure && attemptsUsed < options.attempts) {
        attemptsUsed += 1;
        regenerated = true;
        const attempt = regenerateFromSource(options);
        if (!attempt.ok) {
            report = {
                ...report,
                failures: [...report.failures, {
                    point: 'ENSURE',
                    code: 'PRESENTATION_REGENERATION_FAILED',
                    detail: `gate-presentation.js exited ${attempt.status || 'signal'}: ${(attempt.stderr || attempt.stdout).trim().slice(0, 400)}`,
                }],
            };
            break;
        }
        report = validatePresentationHtml(readPresentation(options.file), {
            repoRoot: options.repoRoot,
            binding,
        });
    }

    const payload = {
        ok: report.ok,
        file: options.file,
        gate: report.gate ?? null,
        digest: report.digest ?? null,
        sessionPath: report.sessionPath ?? null,
        generatedAt: report.generatedAt ?? null,
        linkCount: report.linkCount ?? 0,
        regenerated,
        attemptsUsed,
        failures: report.ok ? [] : report.failures,
    };
    if (options.json) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else if (report.ok) {
        const suffix = regenerated ? ` (regenerated, ${attemptsUsed} attempt${attemptsUsed === 1 ? '' : 's'})` : '';
        process.stdout.write(`PRESENTATION_OK ${payload.gate} ${payload.digest}${suffix}\n`);
    } else {
        process.stdout.write(`PRESENTATION_FAILED ${options.file}\n`);
        for (const item of report.failures) {
            process.stdout.write(`  [${item.point}] ${item.code}: ${item.detail}\n`);
        }
        process.stdout.write('This gate must NOT be presented — fix the source and re-run until PRESENTATION_OK.\n');
    }
    process.exit(report.ok ? 0 : 1);
}

if (require.main === module) {
    try {
        main(process.argv);
    } catch (error) {
        console.error(`GATE_PRESENTATION_CHECK_INVALID: ${error.message}`);
        process.exit(1);
    }
}

module.exports = {
    GATE_NAMES,
    validatePresentationHtml,
    resolveBinding,
};
