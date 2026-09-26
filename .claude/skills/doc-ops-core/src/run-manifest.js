'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { canonicalize } = require('./canonical-json');
const { digestSemantic } = require('./digest');
const { validateInvariantAttestations } = require('./writer-governance');

// Phase-6 6.5: the canonical run manifest bound at the WRITER boundary. The
// approval envelope (writer-governance.js) pins WHAT may be written; the run
// manifest pins WHO is writing and AGAINST WHAT SOURCE STATE — skill,
// skill version, session/lineage, policy attestations, and a source
// fingerprint computed with the 6.9 acceptance scope:
//   - O1: untracked file CONTENT is bound (the walk reads files from disk,
//     not git blobs; `git ls-files --others --exclude-standard` names them so
//     ignored build output stays out).
//   - O2: the scope is the whole working tree — tracked ∪ untracked — which
//     is a strict superset of the admission input set, so a run manifest
//     never claims a narrower source than the code the run loads.
// Mutating writer calls refuse without one (WRITER_RUN_MANIFEST_REQUIRED) and
// refuse again when the tree drifted since binding (RUN_MANIFEST_SOURCE_DRIFT).

const FINGERPRINT_SCOPE = 'working-tree(tracked+untracked-content)';

class RunManifestError extends Error {
    constructor(code, message, details = {}) {
        super(`${code}: ${message}`);
        this.name = 'RunManifestError';
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}

function requireDigestString(value, field) {
    return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

// The fingerprint's scope claim ("whole working tree") is only true when the
// enumeration runs from the real repository root: `git ls-files` from a
// subdirectory silently narrows to that subtree, so a caller passing
// `<repo>/.claude` would fingerprint a fraction of the tree while the
// manifest still claims full scope. Resolve the toplevel once and enumerate
// from there, so any in-repo caller root produces the same, whole-tree
// fingerprint (6.9 O2).
function resolveRepositoryRoot(repoRoot) {
    if (!repoRoot || typeof repoRoot !== 'string') {
        throw new RunManifestError('RUN_MANIFEST_FIELD_REQUIRED', 'repoRoot is required to compute the production input fingerprint');
    }
    const execution = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: repoRoot, encoding: 'utf8' });
    if (execution.error || execution.status !== 0) {
        throw new RunManifestError(
            'RUN_MANIFEST_SOURCE_UNAVAILABLE',
            `cannot resolve the repository root for the run manifest (repoRoot ${repoRoot}): ${execution.error ? execution.error.message : String(execution.stderr || 'git failed').trim()}`,
        );
    }
    return path.resolve(execution.stdout.trim());
}

function workingTreeFiles(repoRoot) {
    const root = resolveRepositoryRoot(repoRoot);
    const run = (args) => {
        const execution = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        if (execution.error || execution.status !== 0) {
            throw new RunManifestError(
                'RUN_MANIFEST_SOURCE_UNAVAILABLE',
                `cannot enumerate the working tree for the run manifest (${args.join(' ')}): ${execution.error ? execution.error.message : String(execution.stderr || 'git failed').trim()}`,
            );
        }
        return execution.stdout;
    };
    const tracked = run(['ls-files', '-z']).split('\0').filter(Boolean);
    const untracked = run(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
    return { root, files: [...new Set([...tracked, ...untracked])].sort() };
}

function productionInputFingerprint({ repoRoot }) {
    if (!repoRoot || typeof repoRoot !== 'string') {
        throw new RunManifestError('RUN_MANIFEST_FIELD_REQUIRED', 'repoRoot is required to compute the production input fingerprint');
    }
    const { root, files } = workingTreeFiles(repoRoot);
    const hash = crypto.createHash('sha256');
    for (const relativePath of files) {
        hash.update(relativePath);
        hash.update('\0');
        let content;
        try {
            content = fs.readFileSync(path.join(root, relativePath));
        } catch (error) {
            throw new RunManifestError('RUN_MANIFEST_SOURCE_UNAVAILABLE', `cannot read ${relativePath} while fingerprinting the working tree: ${error.message}`);
        }
        hash.update(content);
        hash.update('\0');
    }
    return `sha256:${hash.digest('hex')}`;
}

function runManifestDigest(manifest) {
    const { manifestDigest: ignored, ...semantic } = manifest;
    return digestSemantic(canonicalize(semantic));
}

// A run manifest may carry a caller-computed sourceFingerprint (canonical
// entrypoints that already verified the tree) or a repoRoot to compute one
// now. `sessionDigest` is optional lineage identity (authoring sessionId,
// agent-team taskId, …); `batchDigest` is required — a writer never mutates
// outside a digest-bound batch.
function createRunManifest({
    skill,
    skillVersion,
    sourceFingerprint = null,
    repoRoot = null,
    batchDigest,
    sessionDigest = null,
    policyAttestations = [],
}) {
    for (const [field, value] of [['skill', skill], ['skillVersion', skillVersion], ['batchDigest', batchDigest]]) {
        if (typeof value !== 'string' || !value.trim()) {
            throw new RunManifestError('RUN_MANIFEST_FIELD_REQUIRED', `${field} is required to create a run manifest`);
        }
    }
    let fingerprint = sourceFingerprint;
    if (fingerprint === null && repoRoot !== null) fingerprint = productionInputFingerprint({ repoRoot });
    if (!requireDigestString(fingerprint, 'sourceFingerprint')) {
        throw new RunManifestError('RUN_MANIFEST_FIELD_REQUIRED', 'sourceFingerprint must be a sha256:… digest (supply one or pass repoRoot)');
    }
    if (!requireDigestString(batchDigest, 'batchDigest')) {
        throw new RunManifestError('RUN_MANIFEST_FIELD_REQUIRED', 'batchDigest must be a sha256:… digest');
    }
    if (sessionDigest !== null && typeof sessionDigest !== 'string') {
        throw new RunManifestError('RUN_MANIFEST_FIELD_REQUIRED', 'sessionDigest must be a string when present');
    }
    const attestations = validateInvariantAttestations(policyAttestations);
    const manifest = canonicalize({
        schemaVersion: 1,
        skill,
        skillVersion,
        sourceFingerprint: fingerprint,
        fingerprintScope: FINGERPRINT_SCOPE,
        batchDigest,
        sessionDigest,
        policyAttestations: attestations,
    });
    return Object.freeze({ ...manifest, manifestDigest: runManifestDigest(manifest) });
}

// Test/binding helper: a manifest with a fixed fingerprint and no tree to
// verify against. Production paths must NOT use this — pass repoRoot or a
// fingerprint computed by the canonical entrypoint.
function stubRunManifest(overrides = {}) {
    return createRunManifest({
        skill: 'test-skill',
        skillVersion: 'test',
        sourceFingerprint: `sha256:${'0'.repeat(64)}`,
        batchDigest: `sha256:${'1'.repeat(64)}`,
        ...overrides,
    });
}

function assertRunManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') {
        throw new RunManifestError('RUN_MANIFEST_FIELD_REQUIRED', 'a run manifest object is required');
    }
    for (const field of ['skill', 'skillVersion', 'sourceFingerprint', 'fingerprintScope', 'batchDigest', 'manifestDigest']) {
        if (typeof manifest[field] !== 'string' || !manifest[field].trim()) {
            throw new RunManifestError('RUN_MANIFEST_FIELD_REQUIRED', `run manifest is missing ${field}`);
        }
    }
    if (!requireDigestString(manifest.sourceFingerprint) || !requireDigestString(manifest.batchDigest)) {
        throw new RunManifestError('RUN_MANIFEST_FIELD_REQUIRED', 'sourceFingerprint and batchDigest must be sha256:… digests');
    }
    if (manifest.fingerprintScope !== FINGERPRINT_SCOPE) {
        throw new RunManifestError('RUN_MANIFEST_FIELD_REQUIRED', `fingerprintScope must be "${FINGERPRINT_SCOPE}"`);
    }
    validateInvariantAttestations(manifest.policyAttestations ?? []);
    if (manifest.manifestDigest !== runManifestDigest(manifest)) {
        throw new RunManifestError('RUN_MANIFEST_DIGEST_MISMATCH', 'run manifest does not match its manifestDigest; the bound manifest was edited after creation');
    }
    return true;
}

// Recompute the working-tree fingerprint and compare against the bound
// manifest. Called at bind time and lazily before a governance's first
// mutation, so a tree that changed between binding and writing is refused.
function verifyRunManifestSource(manifest, { repoRoot }) {
    assertRunManifest(manifest);
    const observed = productionInputFingerprint({ repoRoot });
    if (observed !== manifest.sourceFingerprint) {
        throw new RunManifestError(
            'RUN_MANIFEST_SOURCE_DRIFT',
            'the working tree no longer matches the run manifest\'s source fingerprint; rebind a fresh manifest for the new source state',
            { expected: manifest.sourceFingerprint, observed },
        );
    }
    return true;
}

function writeRunManifestArtifact(runManifest, { filePath }) {
    assertRunManifest(runManifest);
    const resolved = path.resolve(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    const body = `${JSON.stringify(runManifest, null, 2)}\n`;
    fs.writeFileSync(resolved, body);
    return { path: resolved, bytes: Buffer.byteLength(body) };
}

module.exports = {
    FINGERPRINT_SCOPE,
    RunManifestError,
    assertRunManifest,
    createRunManifest,
    productionInputFingerprint,
    resolveRepositoryRoot,
    runManifestDigest,
    stubRunManifest,
    verifyRunManifestSource,
    writeRunManifestArtifact,
};
