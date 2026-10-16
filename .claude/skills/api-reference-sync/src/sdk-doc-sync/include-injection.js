'use strict';

// Include injection (batch 18 W-E). Conditional product wrapping is authored in
// one of two canonical shapes, chosen by WHERE the wrapped content sits:
//
//   * A region of two or more lines uses the BLOCK form — the open and close
//     tags each own their own line/block:
//         <include target="zilliz">
//         …wrapped blocks…
//         </include>
//   * Content that fits on a single line uses the INLINE form:
//         <include target="zilliz">…one line…</include>
//
//   * INSIDE a code fence the literal <include> tag cannot survive the
//     markdown→blocks converter (2026-10-08 magic-tag ruling), so the canonical
//     form is the comment magic tag:
//         // include-start zilliz       // include-nextline zilliz
//         …wrapped code lines…          …one line…
//         // include-end zilliz
//
// This module is the deterministic chooser: it counts the real lines and emits
// the right form, so no author (human or model) has to pick. It never touches
// Feishu — it produces the markdown the surgical patch writer lands. A caller
// forcing a form the content cannot honor (inline over multiple lines, block
// over a single line) is refused typed, never silently reshaped.

const INCLUDE_TARGETS = Object.freeze(['milvus', 'zilliz']);
const INCLUDE_FORM_AMBIGUOUS = 'INCLUDE_FORM_AMBIGUOUS';
const INCLUDE_TARGET_INVALID = 'INCLUDE_TARGET_INVALID';
const INCLUDE_CONTENT_EMPTY = 'INCLUDE_CONTENT_EMPTY';
const INCLUDE_FORM_INVALID = 'INCLUDE_FORM_INVALID';

const FORMS = Object.freeze(['inline', 'block']);

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

// The mandated form: two or more non-empty lines is a multi-block region
// (block form); a single line (or none) is the inline form.
function includeFormForContent(content) {
  return nonEmptyLines(content).length <= 1 ? 'inline' : 'block';
}

function buildIncludeWrapping({ content, target, inCodeFence = false, lineComment = '//', form = null } = {}) {
  if (!INCLUDE_TARGETS.includes(target)) {
    throw new IncludeInjectionError(
      INCLUDE_TARGET_INVALID,
      `include target must be one of ${INCLUDE_TARGETS.join(', ')} (got ${JSON.stringify(target)})`,
      { target },
    );
  }
  if (content === undefined || content === null || String(content).trim() === '') {
    throw new IncludeInjectionError(INCLUDE_CONTENT_EMPTY, 'include content must be non-empty', { target });
  }
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

module.exports = {
  FORMS,
  INCLUDE_CONTENT_EMPTY,
  INCLUDE_FORM_AMBIGUOUS,
  INCLUDE_FORM_INVALID,
  INCLUDE_TARGET_INVALID,
  INCLUDE_TARGETS,
  IncludeInjectionError,
  buildIncludeWrapping,
  includeFormForContent,
};
