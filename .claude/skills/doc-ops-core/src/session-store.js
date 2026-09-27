'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalize, canonicalStringify } = require('./canonical-json');
const { digestSemantic } = require('./digest');

// Shared durable session store (phase-6 item 6.6): every skill's persisted
// session goes through the same durability contract —
//   1. write to a unique temporary file in the SAME directory, fsync the
//      file, then rename (atomic replace — a crash never leaves a torn
//      state), and fsync the directory so the rename itself is durable;
//   2. lost-update detection: the caller passes the digest of the state it
//      loaded; if the on-disk state has changed underneath, the save is
//      refused (SESSION_STATE_DIGEST_MISMATCH) instead of silently
//      overwriting a concurrent writer's evidence;
//   3. every persisted state names its own semantic digest, so a consumer
//      can verify the file it loaded is the state that was written.

class SessionStoreError extends Error {
    constructor(code, message, details = {}) {
        super(`${code}: ${message}`);
        this.name = 'SessionStoreError';
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}

function defaultSerialize(state) {
    return `${JSON.stringify(state, null, 2)}\n`;
}

function stateDigest(state) {
    return digestSemantic(canonicalize(state));
}

function readOnDiskDigest(filePath, { deserialize }) {
    const state = deserialize(fs.readFileSync(filePath, 'utf8'));
    return { state, stateDigest: stateDigest(state) };
}

function loadState(filePath, { deserialize = JSON.parse } = {}) {
    const resolved = path.resolve(filePath);
    const { state, stateDigest: digest } = readOnDiskDigest(resolved, { deserialize });
    return { state, stateDigest: digest };
}

function saveState(filePath, state, { expectedPreviousDigest = null, serialize = defaultSerialize, deserialize = JSON.parse, mode = null } = {}) {
    if (!filePath) throw new SessionStoreError('SESSION_STORE_PATH_REQUIRED', 'filePath is required');
    if (state === null || typeof state !== 'object') {
        throw new SessionStoreError('SESSION_STORE_STATE_REQUIRED', 'state must be an object');
    }
    const resolved = path.resolve(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    if (expectedPreviousDigest !== null && fs.existsSync(resolved)) {
        const { stateDigest: onDiskDigest } = readOnDiskDigest(resolved, { deserialize });
        if (onDiskDigest !== expectedPreviousDigest) {
            throw new SessionStoreError(
                'SESSION_STATE_DIGEST_MISMATCH',
                'the persisted session changed since it was loaded; reload and reapply instead of overwriting concurrent evidence',
                { expectedPreviousDigest, onDiskDigest },
            );
        }
    }
    const body = serialize(state);
    const temporary = `${resolved}.${process.pid}.${Date.now()}.tmp`;
    const descriptor = fs.openSync(temporary, 'wx', mode ?? 0o644);
    try {
        fs.writeFileSync(descriptor, body);
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, resolved);
    const directory = fs.openSync(path.dirname(resolved), 'r');
    try {
        fs.fsyncSync(directory);
    } catch (error) {
        // Directory fsync is best-effort on filesystems that do not support
        // opening directories; the file-level fsync already happened.
        void error;
    } finally {
        fs.closeSync(directory);
    }
    return { path: resolved, stateDigest: stateDigest(state) };
}

// Re-serialize with the exact bytes a consumer expects when the default
// pretty JSON does not match a store's established on-disk format.
function canonicalLineSerialize(state) {
    return canonicalStringify(state);
}

module.exports = {
    SessionStoreError,
    loadState,
    saveState,
    stateDigest,
    canonicalLineSerialize,
};
