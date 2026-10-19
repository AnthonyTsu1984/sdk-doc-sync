'use strict';

// Include injection (batch 18 W-E; form ruling extended batch 16 slice 5 P2).
// Conditional product wrapping is authored in one of THREE canonical forms,
// chosen by WHERE the wrapped content sits:
//
//   * Two or more blocks use the BLOCK form — the open and close tags each
//     own their own line/block, and a RUN of consecutive blocks sharing one
//     target is tagged ONCE (open before the first block, close after the
//     last), never per block:
//         <include target="zilliz">
//         …wrapped blocks…
//         </include>
//   * A single block — or a fragment INSIDE a block — uses the INLINE form.
//     inline = 「块内分叉」 (2026-10-16 ruling): the fragment is tagged IN
//     PLACE inside its own block, tags and context sharing the block; the
//     tags never move to a line of their own:
//         …前文 <include target="zilliz">片段</include> 后文…
//   * INSIDE a code fence the literal <include> tag cannot survive the
//     markdown→blocks converter (2026-10-08 magic-tag ruling), so the
//     canonical form is the comment magic tag:
//         // include-start zilliz       // include-nextline zilliz
//         …wrapped code lines…          …one line…
//         // include-end zilliz
//
// List items are tagged OUTSIDE the item: the tags sit one indent level less
// than the list item itself, each on its own line; a run of consecutive items
// sharing one target merges first-front last-back. Table rows fork by tagging
// EVERY cell's content; a single cell forks by tagging that cell's content.
// Callouts follow the prose rule, inside their wrapper.
//
// This module is the deterministic chooser: it counts the real lines/blocks
// and emits the right form, so no author (human or model) has to pick. It
// never touches Feishu — it produces the markdown the surgical patch writer
// lands. A caller forcing a form the content cannot honor (inline over
// multiple lines, block over a single line, tags on a too-deep list item) is
// refused typed, never silently reshaped.

const INCLUDE_TARGETS = Object.freeze(['milvus', 'zilliz']);
const INCLUDE_FORM_AMBIGUOUS = 'INCLUDE_FORM_AMBIGUOUS';
const INCLUDE_TARGET_INVALID = 'INCLUDE_TARGET_INVALID';
const INCLUDE_CONTENT_EMPTY = 'INCLUDE_CONTENT_EMPTY';
const INCLUDE_FORM_INVALID = 'INCLUDE_FORM_INVALID';
const INCLUDE_FRAGMENT_NOT_FOUND = 'INCLUDE_FRAGMENT_NOT_FOUND';
const INCLUDE_FRAGMENT_INDENT_UNSUPPORTED = 'INCLUDE_FRAGMENT_INDENT_UNSUPPORTED';

const FORMS = Object.freeze(['inline', 'block']);
// The three-state form ruling (batch 16 slice 5, design §5.6 P2): the
// emitter's decision is exactly one of these. 'inline' means the fragment-
// level in-place tag (wrapFragment); 'code-fence' keeps the 2026-10-08
// magic-tag mechanism unchanged (line count still picks include-nextline vs
// include-start/end inside the fence).
const FORM_STATES = Object.freeze(['block', 'inline', 'code-fence']);

// List placement geometry (P2 block type 1): one indent level is two spaces;
// an item indented 4+ spaces is a deep nest whose outside tag would ride
// inline into the parent item's paragraph instead of producing a marker pair.
const LIST_INDENT_UNIT = 2;
const LIST_INDENT_UNSUPPORTED_AT = 4;

class IncludeInjectionError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IncludeInjectionError';
    this.code = code;
    this.details = details;
  }
}

// The content's own bytes are preserved; only the marker lines this module adds
// are canonical. Blank lines do not count toward the block/inline decision.
function contentLines(content) {
  return String(content).split('\n').map((line) => line.replace(/\s+$/, ''));
}

function nonEmptyLines(content) {
  return contentLines(content).filter((line) => line.trim() !== '');
}

function assertValidTarget(target) {
  if (!INCLUDE_TARGETS.includes(target)) {
    throw new IncludeInjectionError(
      INCLUDE_TARGET_INVALID,
      `include target must be one of ${INCLUDE_TARGETS.join(', ')} (got ${JSON.stringify(target)})`,
      { target },
    );
  }
}

function assertNonEmpty(value, label, target) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new IncludeInjectionError(INCLUDE_CONTENT_EMPTY, `include ${label} must be non-empty`, { target });
  }
}

// The mandated form: two or more non-empty lines is a multi-block region
// (block form); a single line (or none) is the inline form.
function includeFormForContent(content) {
  return nonEmptyLines(content).length <= 1 ? 'inline' : 'block';
}

// The three-state ruling as a pure decision: code fence wins first (mechanism
// unchanged), then the block/inline line count. 'inline' here means the
// fragment-level in-place tag — the wrapFragment entry, or the degenerate
// buildIncludeWrapping inline form when the fragment is the whole block.
function includeFormDecision({ content, inCodeFence = false } = {}) {
  if (inCodeFence) return 'code-fence';
  return includeFormForContent(content);
}

function buildIncludeWrapping({ content, target, inCodeFence = false, lineComment = '//', form = null } = {}) {
  assertValidTarget(target);
  assertNonEmpty(content, 'content', target);
  if (form !== null && !FORMS.includes(form)) {
    throw new IncludeInjectionError(INCLUDE_FORM_INVALID, `form must be one of ${FORMS.join(', ')} (got ${JSON.stringify(form)})`, { form });
  }
  const decided = includeFormForContent(content);
  if (form !== null && form !== decided) {
    throw new IncludeInjectionError(
      INCLUDE_FORM_AMBIGUOUS,
      `the content mandates the ${decided} form but ${form} was requested — reshape the content rather than force the wrong wrapper`,
      { requested: form, decided, nonEmptyLines: nonEmptyLines(content).length },
    );
  }

  if (inCodeFence) {
    if (decided === 'block') {
      return { form: 'block', target, markdown: [`${lineComment} include-start ${target}`, String(content), `${lineComment} include-end ${target}`].join('\n') };
    }
    return { form: 'inline', target, markdown: [`${lineComment} include-nextline ${target}`, nonEmptyLines(content)[0] ?? ''].join('\n') };
  }
  if (decided === 'block') {
    // The block form carries the content BETWEEN the tags byte-for-byte (a
    // verbatim page's content digest must survive the wrap).
    return { form: 'block', target, markdown: [`<include target="${target}">`, String(content), '</include>'].join('\n') };
  }
  return { form: 'inline', target, markdown: `<include target="${target}">${nonEmptyLines(content)[0] ?? ''}</include>` };
}

// Fragment-level (inline) entry — 块内分叉: tag the fragment IN PLACE inside
// its block, tags and surrounding context sharing the block:
//     wrapFragment('see the quick start first', 'quick start', 'zilliz')
//   → 'see the <include target="zilliz">quick start</include> first'
// Every exact occurrence of the fragment is tagged (deterministic, never
// positional). The block text's own bytes are otherwise untouched.
function wrapFragment(blockText, fragment, target) {
  assertValidTarget(target);
  assertNonEmpty(fragment, 'fragment', target);
  assertNonEmpty(blockText, 'block text', target);
  const block = String(blockText);
  const needle = String(fragment);
  if (!block.includes(needle)) {
    throw new IncludeInjectionError(
      INCLUDE_FRAGMENT_NOT_FOUND,
      'the fragment does not occur in the block text — wrapFragment tags in place and never invents or relocates content',
      { target, fragment: needle },
    );
  }
  const tagged = `<include target="${target}">${needle}</include>`;
  return { form: 'inline', target, markdown: block.split(needle).join(tagged) };
}

// Run merge (P2 rule 3, 正文与列表通用): consecutive blocks carrying ONE
// target are tagged once — the open tag goes before the FIRST block, the
// close tag after the LAST — so a run never accumulates per-block markers.
// Callout content follows the same rule (pass the blocks inside the callout
// wrapper); the tags ride between the wrapper's content blocks.
function wrapBlockRun(blocks, target) {
  assertValidTarget(target);
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new IncludeInjectionError(INCLUDE_CONTENT_EMPTY, 'a block run must contain at least one block', { target });
  }
  const chunks = blocks.map((block) => String(block ?? ''));
  if (chunks.some((chunk) => chunk.trim() === '')) {
    throw new IncludeInjectionError(INCLUDE_CONTENT_EMPTY, 'block run entries must be non-empty', { target });
  }
  return {
    form: 'block',
    target,
    // Blocks are separated by a blank line so each entry stays its own
    // markdown block after the writer re-lexes the region body.
    markdown: [`<include target="${target}">`, ...chunks.join('\n\n').split('\n'), '</include>'].join('\n'),
  };
}

// Leading spaces of the item's first line — the item's own indent level.
function listItemIndent(item) {
  const firstLine = String(item ?? '').split('\n')[0] ?? '';
  return firstLine.length - firstLine.replace(/^ +/, '').length;
}

// List-item placement (P2 block type 1): the tags sit OUTSIDE the item — one
// indent level LESS than the list item, each on its own line; a run of
// consecutive items sharing one target merges first-front last-back.
// Fail-closed geometry: an item indented 4+ spaces is a deep nest — its
// outside tag (one level less = 3+ spaces) tokenizes as inline html inside
// the PARENT item's paragraph instead of a marker pair — so refuse typed and
// tell the caller to lift the item one level or use wrapFragment. All items
// of one run must sit at the run's first item's level: one tag pair cannot be
// "one level less" for two different levels at once.
function wrapListItems(items, target) {
  assertValidTarget(target);
  if (!Array.isArray(items) || items.length === 0) {
    throw new IncludeInjectionError(INCLUDE_CONTENT_EMPTY, 'a list-item run must contain at least one item', { target });
  }
  const chunks = items.map((item) => String(item ?? ''));
  if (chunks.some((chunk) => chunk.trim() === '')) {
    throw new IncludeInjectionError(INCLUDE_CONTENT_EMPTY, 'list-item run entries must be non-empty', { target });
  }
  const anchor = listItemIndent(chunks[0]);
  for (let index = 0; index < chunks.length; index += 1) {
    const indent = listItemIndent(chunks[index]);
    if (indent >= LIST_INDENT_UNSUPPORTED_AT) {
      throw new IncludeInjectionError(
        INCLUDE_FRAGMENT_INDENT_UNSUPPORTED,
        `list item ${index} is indented ${indent} spaces (>= ${LIST_INDENT_UNSUPPORTED_AT}): a tag outside an item nested this deep rides inline into the parent item's paragraph instead of producing a marker pair — lift the item one indent level or use wrapFragment instead`,
        { target, itemIndex: index, indent },
      );
    }
    if (indent !== anchor) {
      throw new IncludeInjectionError(
        INCLUDE_FRAGMENT_INDENT_UNSUPPORTED,
        `list item ${index} is indented ${indent} spaces but the run's first item sits at ${anchor}: one tag pair cannot sit one level outside two different levels — split the run per level or use wrapFragment`,
        { target, itemIndex: index, indent, anchor },
      );
    }
  }
  const pad = ' '.repeat(Math.max(anchor - LIST_INDENT_UNIT, 0));
  return {
    form: 'block',
    target,
    markdown: [`${pad}<include target="${target}">`, ...chunks, `${pad}</include>`].join('\n'),
  };
}

// Table placement (P2 block type 2): a ROW fork tags EVERY cell's content
// (front and back) with the same tag; a CELL fork is wrapFragment on that one
// cell's content. Cell containers are placement-insensitive (inline or a
// standalone tag line both tokenize), so this emits the literal inline form.
function wrapTableRow(cells, target) {
  assertValidTarget(target);
  if (!Array.isArray(cells) || cells.length === 0) {
    throw new IncludeInjectionError(INCLUDE_CONTENT_EMPTY, 'a table row must contain at least one cell', { target });
  }
  const tagged = cells.map((cell) => {
    const text = String(cell ?? '');
    assertNonEmpty(text, 'table cell', target);
    return `<include target="${target}">${text}</include>`;
  });
  return { form: 'inline', target, markdown: `| ${tagged.join(' | ')} |` };
}

module.exports = {
  FORMS,
  FORM_STATES,
  INCLUDE_CONTENT_EMPTY,
  INCLUDE_FORM_AMBIGUOUS,
  INCLUDE_FORM_INVALID,
  INCLUDE_FRAGMENT_INDENT_UNSUPPORTED,
  INCLUDE_FRAGMENT_NOT_FOUND,
  INCLUDE_TARGET_INVALID,
  INCLUDE_TARGETS,
  IncludeInjectionError,
  buildIncludeWrapping,
  includeFormDecision,
  includeFormForContent,
  wrapBlockRun,
  wrapFragment,
  wrapListItems,
  wrapTableRow,
};
