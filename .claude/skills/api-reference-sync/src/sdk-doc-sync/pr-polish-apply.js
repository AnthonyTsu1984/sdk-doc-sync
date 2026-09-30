'use strict';

// Governed application of a validated post-verbatim polish manifest
// (api.pr-polish-governed, application step). pr-polish.js validates the
// manifest against the verbatim-proven bytes and emits the exact polished
// content; this module plans the live-block edits for that content — one
// anchored text replacement per manifest edit, prose text blocks only, each
// anchor matching exactly one block — and the bin applies them under writer
// governance with a terminal raw_content verification.

class PolishApplyError extends Error {
    constructor(code, message, details = {}) {
        super(`${code}: ${message}`);
        this.name = 'PolishApplyError';
        this.code = code;
        this.details = Object.freeze(structuredClone(details));
    }
}

function blockText(block) {
    const elements = block && block.text && Array.isArray(block.text.elements)
        ? block.text.elements
        : [];
    return elements.map((element) => {
        const run = element && element.text_run;
        if (!run) return '';
        return typeof run.content === 'string' ? run.content : '';
    }).join('');
}

// Plans one in-place text replacement per manifest edit. Every anchor must
// match exactly one prose text block (type 2); an anchor spanning blocks or
// matching several is a typed failure — polish anchors are unique substrings
// of the verified content and the converter renders one paragraph per block.
function planPolishBlockEdits(blocks, edits) {
    if (!Array.isArray(blocks)) throw new TypeError('blocks must be an array');
    if (!Array.isArray(edits) || edits.length === 0) {
        throw new PolishApplyError('PR_POLISH_MANIFEST_INVALID', 'edits must be a non-empty array');
    }
    const textBlocks = blocks.filter((block) => block && block.block_type === 2 && block.block_id);
    const planned = [];
    for (const edit of edits) {
        if (!edit || typeof edit.anchor !== 'string' || edit.anchor.length === 0
            || typeof edit.replacement !== 'string') {
            throw new PolishApplyError('PR_POLISH_MANIFEST_INVALID', 'every edit needs non-empty anchor and string replacement');
        }
        const matches = textBlocks.filter((block) => blockText(block).includes(edit.anchor));
        if (matches.length === 0) {
            throw new PolishApplyError('PR_POLISH_ANCHOR_NOT_FOUND', `anchor not found in any prose block: ${edit.anchor.slice(0, 60)}`);
        }
        if (matches.length > 1) {
            throw new PolishApplyError('PR_POLISH_ANCHOR_NOT_UNIQUE', `anchor matches ${matches.length} prose blocks: ${edit.anchor.slice(0, 60)}`);
        }
        const block = matches[0];
        const before = blockText(block);
        if (before.indexOf(edit.anchor, before.indexOf(edit.anchor) + 1) !== -1) {
            throw new PolishApplyError('PR_POLISH_ANCHOR_NOT_UNIQUE', `anchor matches more than once inside its block: ${edit.anchor.slice(0, 60)}`);
        }
        planned.push({
            blockId: block.block_id,
            anchor: edit.anchor,
            replacement: edit.replacement,
            contentBefore: before,
            contentAfter: before.replace(edit.anchor, edit.replacement),
        });
    }
    const touchedIds = new Set(planned.map((edit) => edit.blockId));
    if (touchedIds.size !== planned.length) {
        throw new PolishApplyError('PR_POLISH_EDITS_COLLIDE', 'two edits target the same prose block; split them into one edit per block');
    }
    return planned;
}

module.exports = { PolishApplyError, blockText, planPolishBlockEdits };
