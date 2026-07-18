'use strict';

function withSource(type, fields, options = {}) {
  const node = { type, ...fields };
  if (options.sourceId !== undefined) node.sourceId = options.sourceId;
  if (options.metadata !== undefined) node.metadata = { ...options.metadata };
  return node;
}

function document(children = [], options = {}) {
  return withSource('document', { children }, options);
}

function paragraph(children = [], options = {}) {
  return withSource('paragraph', { children }, options);
}

function text(value, marks = [], options = {}) {
  return withSource('text', { value, marks: Array.from(marks) }, options);
}

function heading(level, children = [], options = {}) {
  return withSource('heading', { level, children }, options);
}

function unorderedList(items = [], options = {}) {
  return withSource('unorderedList', { items }, options);
}

function orderedList(items = [], options = {}) {
  return withSource('orderedList', { items }, options);
}

function listItem(children = [], options = {}) {
  return withSource('listItem', { children }, options);
}

function codeBlock(value, language = 'PlainText', options = {}) {
  return withSource('codeBlock', { value, language }, options);
}

function table(rows = [], options = {}) {
  return withSource('table', { rows }, options);
}

function tableRow(cells = [], options = {}) {
  return withSource('tableRow', { cells }, options);
}

function tableCell(children = [], options = {}) {
  return withSource('tableCell', { children }, options);
}

function callout(children = [], options = {}) {
  const { kind = 'note', emoji, sourceId, metadata } = options;
  return withSource('callout', { kind, ...(emoji !== undefined && { emoji }), children }, {
    sourceId,
    metadata,
  });
}

function audienceRegion(mode, target, children = [], options = {}) {
  return withSource('audience', { mode, target, children }, options);
}

function citation(title, url, options = {}) {
  return withSource('citation', { title, url }, options);
}

function documentReference(title, url, options = {}) {
  return withSource('documentReference', { title, url }, options);
}

function media(kind, details = {}, options = {}) {
  const { sourceId, metadata, ...fields } = { ...details, ...options };
  return withSource('media', { kind, ...fields }, { sourceId, metadata });
}

function opaque(raw, options = {}) {
  return withSource('opaque', { raw }, options);
}

module.exports = {
  document,
  paragraph,
  text,
  heading,
  unorderedList,
  orderedList,
  listItem,
  codeBlock,
  table,
  tableRow,
  tableCell,
  row: tableRow,
  cell: tableCell,
  callout,
  audienceRegion,
  citation,
  documentReference,
  media,
  opaque,
};
