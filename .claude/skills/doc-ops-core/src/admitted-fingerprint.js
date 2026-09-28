'use strict';

// 6.9 admitted-fingerprint binding: a production run must bind the EXACT
// source tree the admission gates executed against — "tested similar code"
// is not proof. The admission records the widened whole-tree fingerprint
// (productionInputFingerprint: tracked ∪ untracked contents — the same O1/O2
// definition the run manifests bind); a governed writer with
// DOC_OPS_REQUIRE_ADMITTED_FINGERPRINT=1 refuses any mutation whose bound
// fingerprint has no ADMITTED record. Dev/test runs (env unset) are not
// gated — the production discipline is to set the flag in the production
// shell, the mirror image of the DOC_OPS_ALLOW_LEGACY_LIVE ban (wave 3).

const fs = require('node:fs');
const path = require('node:path');

const LEDGER_RELATIVE_PATH = path.join('tmp', 'skill-feedback-rollout', 'admitted-fingerprints.jsonl');

function ledgerPath(repoRoot) {
    return path.resolve(repoRoot, LEDGER_RELATIVE_PATH);
}

// Called by the admission runner on ADMITTED completion. Append-only: a
// fingerprint admitted by an earlier phase stays admitted; each record names
// the phase, whether it was the deterministic subset, and the results
// artifact it came from.
function recordAdmittedFingerprint({ repoRoot, sourceFingerprint, phase, deterministicOnly = false, dirtyTree = false, resultsPath = null, generatedAt = null }) {
    if (!repoRoot) throw new TypeError('repoRoot is required');
    if (!/^sha256:[a-f0-9]{64}$/.test(sourceFingerprint || '')) {
        throw new TypeError(`sourceFingerprint must be a sha256:… digest, got ${sourceFingerprint}`);
    }
    if (!phase) throw new TypeError('phase is required');
    const record = {
        schemaVersion: 1,
        status: 'ADMITTED',
        sourceFingerprint,
        phase,
        deterministicOnly: deterministicOnly === true,
        dirtyTree: dirtyTree === true,
        resultsPath: resultsPath || null,
        generatedAt: generatedAt || new Date().toISOString(),
    };
    const target = ledgerPath(repoRoot);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${JSON.stringify(record)}\n`);
    return record;
}

function readAdmittedLedger(repoRoot, { ledgerPath: explicitPath = null } = {}) {
    const target = explicitPath ? path.resolve(explicitPath) : ledgerPath(repoRoot);
    if (!fs.existsSync(target)) return [];
    return fs.readFileSync(target, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line, index) => {
            try {
                return JSON.parse(line);
            } catch (error) {
                throw Object.assign(new Error(`admitted-fingerprint ledger line ${index + 1} is invalid JSON: ${error.message}`), {
                    code: 'ADMITTED_LEDGER_INVALID',
                });
            }
        });
}

function findAdmittedRecord({ repoRoot, sourceFingerprint, ledgerPath: explicitPath = null }) {
    if (!/^sha256:[a-f0-9]{64}$/.test(sourceFingerprint || '')) return null;
    const records = readAdmittedLedger(repoRoot, { ledgerPath: explicitPath });
    return records.find((record) => (
        record?.status === 'ADMITTED' && record.sourceFingerprint === sourceFingerprint
    )) || null;
}

// Writer-boundary gate. No-op unless DOC_OPS_REQUIRE_ADMITTED_FINGERPRINT=1:
// dev and test runs construct governed writers constantly and never carry
// production admission duties. When the flag is set (the production shell),
// every mutation refuses unless the bound fingerprint has an exact ADMITTED
// record — fail-closed, at the innermost writer layer (6.5 doctrine).
function assertFingerprintAdmitted({ repoRoot, sourceFingerprint, env = process.env, ledgerPath: explicitPath = null, method = null }) {
    if (env?.DOC_OPS_REQUIRE_ADMITTED_FINGERPRINT !== '1') return null;
    const record = findAdmittedRecord({ repoRoot, sourceFingerprint, ledgerPath: explicitPath });
    if (!record) {
        throw Object.assign(
            new Error('run source is not admitted: no ADMITTED record matches the bound source fingerprint'
                + ' — run the admission gates for this exact tree (or point the ledger at the CI evidence) before production writes'),
            { code: 'RUN_NOT_ADMITTED' },
        );
    }
    return record;
}

module.exports = {
    LEDGER_RELATIVE_PATH,
    assertFingerprintAdmitted,
    findAdmittedRecord,
    ledgerPath,
    readAdmittedLedger,
    recordAdmittedFingerprint,
};
