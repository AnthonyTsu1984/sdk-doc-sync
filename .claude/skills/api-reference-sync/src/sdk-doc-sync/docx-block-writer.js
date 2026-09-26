'use strict';

const { assertWriterMutation } = require('../../../doc-ops-core/src/writer-governance');

// Governed docx block mutation writer (phase-6 wave 2). The Golden Rule 4
// post-action scripts historically issued raw `PATCH .../blocks/batch_update`
// fetches with no writer boundary — the one live legacy path outside the run
// manifest. This class puts that endpoint behind the same envelope as every
// other writer: a mutation is refused unless the governance has a bound
// approval AND an immutable run manifest, and the first call re-verifies the
// working-tree fingerprint — all through assertWriterMutation. `transport` is
// the caller's authenticated fetch helper, so the writer owns the boundary
// while the script keeps its token handling.
class DocxBlockWriter {
    constructor({ governance, transport }) {
        if (typeof transport !== 'function') {
            throw new TypeError('DocxBlockWriter requires a transport(method, endpoint, body) function');
        }
        this.governance = governance || null;
        this.transport = transport;
    }

    async batchUpdate(documentId, requests) {
        assertWriterMutation(this.governance, 'DocxBlockWriter.batchUpdate', documentId);
        return this.transport('PATCH', `/open-apis/docx/v1/documents/${documentId}/blocks/batch_update`, { requests });
    }
}

module.exports = DocxBlockWriter;
