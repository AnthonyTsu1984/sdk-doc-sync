'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { canonicalize, canonicalStringify } = require('./canonical-json');
const { digestSemantic } = require('./digest');

// Shared durable session store (phase-6 item 6.6): every skill's persisted
// session goes through the same durability contract —
//   1. an exclusive lock directory (`.lock`) brackets the whole save, so the
//      compare-and-set and the atomic replace below cannot interleave with
//      another writer's (a digest check outside a mutual-exclusion region is
//      check-then-act, not CAS — two writers could both pass the same stale
//      digest and the later rename would silently clobber the earlier one);
//   2. write to a unique temporary file in the SAME directory, fsync the
//      file, then rename (atomic replace — a crash never leaves a torn
//      state), and fsync the directory so the rename itself is durable;
//   3. lost-update detection: the caller passes the digest of the state it
//      loaded; `null` asserts a create (the file must not exist). The check
//      re-reads the on-disk state INSIDE the lock, so a concurrent writer's
//      change refuses the save instead of being silently overwritten;
//   4. every persisted state names its own semantic digest, so a consumer
//      can verify the file it loaded is the state that was written.

class SessionStoreError extends Error {
    constructor(code, message, details = {}) {
        super(`${code}: ${message}`);
        this.name = 'SessionStoreError';
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}

const LOCK_POLL_MS = 25;
const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
// Backstop for a writer killed hard while holding the lock: the pid check
// reclaims it immediately, the TTL covers pid reuse. The TTL MUST stay
// larger than the worst-case critical section — it fires on LIVE holders
// too (and it is the only reclaim path for a foreign-host holder, see
// lockIsStale), so stealing a lock whose critical section legitimately runs
// past it would break mutual exclusion. Saves here are small-JSON
// rename+fsync (milliseconds), orders of magnitude under the default.
const DEFAULT_LOCK_TTL_MS = 30_000;
// Grace for a lock directory whose owner file never materialized (crash
// between mkdir and the owner write).
const DEFAULT_LOCK_STALE_GRACE_MS = 5_000;

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

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === 'EPERM';
    }
}

function readLockOwner(lockPath) {
    try {
        return JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
    } catch {
        return null;
    }
}

function lockIsStale(lockPath, { lockTtlMs, lockStaleGraceMs }) {
    const owner = readLockOwner(lockPath);
    if (!owner) {
        try {
            return Date.now() - fs.statSync(lockPath).mtimeMs >= lockStaleGraceMs;
        } catch {
            return false;
        }
    }
    // pid liveness is a LOCAL process-table semantic: if the state file
    // ever lives on a shared volume, the recorded pid belongs to another
    // host's table and "dead here" proves nothing. A foreign-host lock is
    // therefore only reclaimable by TTL, never by the pid check.
    if (owner.host === os.hostname() && typeof owner.pid === 'number' && !pidAlive(owner.pid)) return true;
    return Date.now() - owner.acquiredAt >= lockTtlMs;
}

// Re-entrancy guard: saveState is synchronous, so a nested save of the same
// path in one process would deadlock until the TTL and then steal its own
// lock — refuse it immediately instead.
const heldLocks = new Set();

function withExclusiveLock(resolved, options, body) {
    const lockPath = `${resolved}.lock`;
    if (heldLocks.has(lockPath)) {
        throw new SessionStoreError(
            'SESSION_LOCK_REENTRANT',
            `this process already holds the save lock for ${resolved}; nested saves of one session are not supported`,
        );
    }
    const deadline = Date.now() + options.lockTimeoutMs;
    for (;;) {
        try {
            fs.mkdirSync(lockPath);
            break;
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            if (lockIsStale(lockPath, options)) {
                try {
                    fs.rmSync(lockPath, { recursive: true, force: true });
                } catch {
                    // A racing reclaimer removed it first; retry the mkdir.
                }
                continue;
            }
            if (Date.now() >= deadline) {
                throw new SessionStoreError(
                    'SESSION_LOCK_CONTENDED',
                    'another writer holds the session save lock; reload and retry instead of bypassing the compare-and-set',
                    { lockPath, owner: readLockOwner(lockPath) },
                );
            }
            sleepSync(LOCK_POLL_MS);
        }
    }
    heldLocks.add(lockPath);
    try {
        fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
            pid: process.pid,
            host: os.hostname(),
            acquiredAt: Date.now(),
        }));
        return body();
    } finally {
        heldLocks.delete(lockPath);
        try {
            fs.rmSync(lockPath, { recursive: true, force: true });
        } catch {
            // A stale-lock reclaimer in another process may have removed it;
            // our own critical section is done either way.
        }
    }
}

function fsyncDirectory(directory) {
    const descriptor = fs.openSync(directory, 'r');
    try {
        fs.fsyncSync(descriptor);
    } catch (error) {
        // Directory fsync is best-effort on filesystems that do not support
        // opening directories; the file-level fsync already happened.
        void error;
    } finally {
        fs.closeSync(descriptor);
    }
}

function saveState(filePath, state, {
    expectedPreviousDigest,
    serialize = defaultSerialize,
    deserialize = JSON.parse,
    mode = null,
    lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
    lockTtlMs = DEFAULT_LOCK_TTL_MS,
    lockStaleGraceMs = DEFAULT_LOCK_STALE_GRACE_MS,
} = {}) {
    if (!filePath) throw new SessionStoreError('SESSION_STORE_PATH_REQUIRED', 'filePath is required');
    if (state === null || typeof state !== 'object') {
        throw new SessionStoreError('SESSION_STORE_STATE_REQUIRED', 'state must be an object');
    }
    if (expectedPreviousDigest !== null && typeof expectedPreviousDigest !== 'string') {
        // The compare-and-set expectation is mandatory: `null` asserts a
        // create, a digest asserts the state last seen. An omitted expectation
        // used to skip the check entirely and overwrite whatever concurrency
        // had produced.
        throw new SessionStoreError(
            'SESSION_EXPECTED_DIGEST_REQUIRED',
            'expectedPreviousDigest is required: pass the digest returned by loadState, or null to assert the session does not exist yet',
        );
    }
    const resolved = path.resolve(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    return withExclusiveLock(resolved, { lockTimeoutMs, lockTtlMs, lockStaleGraceMs }, () => {
        // Inside the lock the on-disk check and the replace are one atomic
        // step: two writers can no longer both pass the same stale digest.
        const onDiskExists = fs.existsSync(resolved);
        const onDiskDigest = onDiskExists ? readOnDiskDigest(resolved, { deserialize }).stateDigest : null;
        if (expectedPreviousDigest === null) {
            if (onDiskExists) {
                throw new SessionStoreError(
                    'SESSION_STATE_EXISTS',
                    'the session already exists; reload it and save against its digest instead of recreating over it',
                    { onDiskDigest },
                );
            }
        } else if (!onDiskExists || onDiskDigest !== expectedPreviousDigest) {
            throw new SessionStoreError(
                'SESSION_STATE_DIGEST_MISMATCH',
                'the persisted session changed since it was loaded; reload and reapply instead of overwriting concurrent evidence',
                { expectedPreviousDigest, onDiskDigest },
            );
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
        fsyncDirectory(path.dirname(resolved));
        return { path: resolved, stateDigest: stateDigest(state) };
    });
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
