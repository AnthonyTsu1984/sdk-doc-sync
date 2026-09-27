'use strict';

// One session/finalization state machine for all five skills (phase-6 item
// 6.6), extracted from api-reference-sync's hardened review session (PR #22's
// five review rounds). Every skill's store expresses its lifecycle through
// this declarative mechanism instead of hand-rolled status checks:
//   - a transition is only legal from the states its table names
//     (INVALID_TRANSITION_SOURCE);
//   - the terminal state is immutable: no transition runs against a terminal
//     session (SESSION_TERMINAL) — finalization flips the status LAST and
//     nothing revives it;
//   - every apply returns a frozen successor carrying the transition's status
//     and a fresh `updatedAt` stamp, so a persisted session always names when
//     it last moved.
// Evidence validation (journals, manifests, receipts, derived flags) stays in
// the owning skill's store — the machine owns the LIFECYCLE, not the proof.

class SessionStateMachineError extends Error {
    constructor(code, message, details = {}) {
        super(`${code}: ${message}`);
        this.name = 'SessionStateMachineError';
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}

// Sentinel `to` for transitions that append evidence without changing the
// status (e.g. api's record-document-acceptance, doc-code-verify's observe).
const SAME_STATE = '@self';

function defineSessionMachine({ name, initial, terminal, transitions }) {
    if (!name) throw new TypeError('machine name is required');
    if (!initial) throw new TypeError('initial state is required');
    if (!terminal) throw new TypeError('terminal state is required');
    const table = Object.freeze(Object.fromEntries(Object.entries(transitions || {}).map(([transitionName, spec]) => {
        if (!spec || !Array.isArray(spec.from) || spec.from.length === 0) {
            throw new TypeError(`transition ${transitionName} needs a non-empty from[]`);
        }
        if (!spec.to) throw new TypeError(`transition ${transitionName} needs a to state (or '${SAME_STATE}')`);
        if (spec.from.includes(terminal)) {
            throw new TypeError(`transition ${transitionName} cannot originate in the terminal state ${terminal}`);
        }
        return [transitionName, Object.freeze({ from: Object.freeze([...spec.from]), to: spec.to })];
    })));
    if (!Object.values(table).some((spec) => spec.from.includes(initial))) {
        throw new TypeError(`the initial state ${initial} must be a source of at least one transition`);
    }
    const isTerminal = (status) => status === terminal;

    function assertTransition(transitionName, session) {
        const spec = table[transitionName];
        if (!spec) {
            throw new SessionStateMachineError(
                'UNKNOWN_TRANSITION',
                `machine ${name} has no transition ${transitionName}`,
                { machine: name, transition: transitionName },
            );
        }
        const status = session?.status;
        if (isTerminal(status)) {
            throw new SessionStateMachineError(
                'SESSION_TERMINAL',
                `session ${session.sessionId || '(unknown)'} is terminal (${terminal}); its evidence is immutable`,
                { machine: name, terminal, sessionId: session.sessionId || null },
            );
        }
        if (!spec.from.includes(status)) {
            throw new SessionStateMachineError(
                'INVALID_TRANSITION_SOURCE',
                `transition ${transitionName} is not legal from status ${status} (expects ${spec.from.join(', ')})`,
                { machine: name, transition: transitionName, from: status, expected: [...spec.from] },
            );
        }
        return spec;
    }

    function apply(transitionName, session, patch = {}, { timestamp = null } = {}) {
        const spec = assertTransition(transitionName, session);
        const at = timestamp || new Date().toISOString();
        // The session is cloned (its frozen shape must not leak into the
        // successor by reference); the patch is applied as-is — its values
        // are caller-constructed for this transition.
        return Object.freeze({
            ...structuredClone(session),
            ...patch,
            status: spec.to === SAME_STATE ? session.status : spec.to,
            updatedAt: at,
        });
    }

    return Object.freeze({
        name,
        initial,
        terminal,
        transitions: table,
        isTerminal,
        assertTransition,
        apply,
    });
}

module.exports = {
    SAME_STATE,
    SessionStateMachineError,
    defineSessionMachine,
};
