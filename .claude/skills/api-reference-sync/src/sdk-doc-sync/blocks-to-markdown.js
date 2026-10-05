'use strict';

// Blocks → markdown reconstruction for the revision campaign. The semantic
// content map must run against an AUTHORED-form base: the raw_content
// serialization strips code fences and bullet prefixes, so a raw-derived
// base sees zero items and zero code blocks — the map would refuse the
// authored fixed content for "adding" code the live page already carries
// (CODE_BLOCK_ADDED) and stay blind to item drops. The live block tree
// carries the true structure; this reconstruction renders it back to the
// authored markdown shape the renderer round-trips (the v7 canonicalization
// absorbs presentation deltas, and this module only feeds the semantic map
// and the digest binding — the terminal comparison still runs against
// raw_content).
//
// Block types (Feishu docx): 1 page, 2 text, 3..11 heading 1..9, 12 bullet,
// 13 ordered, 14 code, 15 quote, 19 callout, 31 table. Unknown block types
// degrade to their text content so nothing structural disappears silently.

const HEADING_BASE = 2; // block_type 3..11 → heading level 1..9
const { languageName } = require('../document-ir/block-registry');
const T_TEXT = 2;
const T_BULLET = 12;
const T_ORDERED = 13;
const T_CODE = 14;
const T_QUOTE = 15;
const T_CALLOUT = 19;
const T_TABLE = 31;

function runText(block, field) {
    const holder = block[field] || {};
    return (holder.elements || [])
        .map((element) => {
            const run = element?.text_run;
            if (!run) return '';
            let text = run.content || '';
            const style = run.text_element_style || {};
            if (style.inline_code) text = `\`${text}\``;
            if (style.bold) text = `**${text}**`;
            if (style.italic) text = `*${text}*`;
            return text;
        })
        .join('');
}

function blockLines(block, field) {
    const holder = block[field] || {};
    return (holder.elements || [])
        .map((element) => {
            const run = element?.text_run;
            if (!run) return '';
            const style = run.text_element_style || {};
            const text = run.content || '';
            if (style.inline_code) return `\`${text}\``;
            if (style.bold) return `**${text}**`;
            if (style.italic) return `*${text}*`;
            return text;
        })
        .filter((text) => text !== '');
}

function renderRuns(block, field) {
    // Styled runs concatenate without separators; unstyled runs may already
    // carry their own spacing. The v7 canonicalization strips inline markup,
    // so markup boundaries need no extra padding.
    return blockLines(block, field).join('');
}

function renderTable(block) {
    const rows = (block.table?.cells || []).map((cell) => String(cell || ''));
    const columns = block.table?.property?.column_size || 0;
    if (!columns || rows.length < columns) return null;
    const lines = [];
    for (let index = 0; index < rows.length; index += columns) {
        lines.push(`| ${rows.slice(index, index + columns).map((cell) => cell.replace(/\n+$/, '')).join(' | ')} |`);
        if (index === 0) lines.push(`| ${Array.from({ length: columns }, () => '---').join(' | ')} |`);
    }
    return lines;
}

function convert(blocks, { indent = '' } = {}) {
    const out = [];
    for (const block of Array.isArray(blocks) ? blocks : []) {
        if (!block || typeof block !== 'object' || block.block_type === undefined) continue;
        const type = block.block_type;
        if (type === 1) {
            out.push(...convert(block.children, { indent }));
            continue;
        }
        if (type >= HEADING_BASE + 1 && type <= 11) {
            const level = type - HEADING_BASE;
            out.push(`${indent}${'#'.repeat(level)} ${renderRuns(block, `heading${level}`)}`.trimEnd(), '');
            continue;
        }
        if (type === T_TEXT) {
            const text = renderRuns(block, 'text').trimEnd();
            if (text !== '') out.push(`${indent}${text}`, '');
            continue;
        }
        if (type === T_BULLET || type === T_ORDERED) {
            const marker = type === T_BULLET ? '-' : '1.';
            const text = renderRuns(block, type === T_BULLET ? 'bullet' : 'ordered').trimEnd();
            out.push(`${indent}${marker} ${text}`.trimEnd());
            const children = convert(block.children, { indent: `${indent}    ` });
            if (children.length > 0) out.push(...children);
            continue;
        }
        if (type === T_CODE) {
            // Code text is the concatenated element content split on newlines
            // — element boundaries are serializer artifacts, not line breaks
            // (the renderer stores whole lines inside single runs). A single
            // trailing empty line from a final '\n' is dropped; interior
            // blanks are real authored content and stay.
            const rawCode = (block.code?.elements || [])
                .map((element) => element?.text_run?.content || '')
                .join('');
            const lines = rawCode.split('\n');
            if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
            const language = (languageName(block.code?.style?.language) || '').toLowerCase();
            out.push(`${indent}\`\`\`${language}`.trimEnd(), ...lines.map((line) => `${indent}${line}`), `${indent}\`\`\``.trimEnd(), '');
            continue;
        }
        if (type === T_QUOTE) {
            const text = renderRuns(block, 'quote').trimEnd();
            if (text !== '') out.push(`${indent}> ${text}`, '');
            continue;
        }
        if (type === T_CALLOUT) {
            out.push(...convert(block.children, { indent }));
            continue;
        }
        if (type === T_TABLE) {
            const table = renderTable(block);
            if (table) out.push(...table, '');
            continue;
        }
        // Unknown block type: degrade to every text-bearing field so no
        // structural content disappears silently from the map base.
        for (const field of ['text', 'bullet', 'ordered', 'quote', 'code', 'heading1']) {
            if (block[field]?.elements) {
                const text = renderRuns(block, field).trimEnd();
                if (text !== '') out.push(`${indent}${text}`, '');
            }
        }
        if (Array.isArray(block.children)) out.push(...convert(block.children, { indent }));
    }
    return out;
}

function blocksToMarkdown(blocks) {
    const lines = convert(blocks);
    const trimmed = [...lines];
    while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop();
    return trimmed.length > 0 ? `${trimmed.join('\n')}\n` : '';
}

module.exports = { blocksToMarkdown };
