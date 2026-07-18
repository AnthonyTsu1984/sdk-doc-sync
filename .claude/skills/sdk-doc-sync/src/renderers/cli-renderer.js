'use strict';

const ir = require('../document-ir/schema');
const { validateDocumentIr } = require('../document-ir/validate');
const { renderFields } = require('./sdk-renderer');

function text(value, marks = []) {
  return ir.text(String(value), marks);
}

function paragraph(value) {
  return ir.paragraph([text(value)]);
}

function heading(level, value) {
  return ir.heading(level, [text(value)]);
}

function render(document) {
  const signature = document.signatures?.[0];
  const blocks = [
    heading(1, document.identity.title),
    heading(2, 'Description'),
    paragraph(document.summary),
    heading(2, 'Synopsis'),
    ir.codeBlock(signature?.display || '', 'Bash'),
  ];
  const options = signature?.inputs || [];
  if (options.length > 0) blocks.push(heading(2, 'Options'), renderFields(options, {}, 'option'));
  if (Array.isArray(document.notes) && document.notes.length > 0) {
    blocks.push(heading(2, 'Notes'));
    blocks.push(ir.unorderedList(document.notes.map((note) => ir.listItem([paragraph(note)]))));
  }
  if (Array.isArray(document.examples) && document.examples.length > 0) {
    blocks.push(heading(2, 'Example'));
    for (const example of document.examples) {
      if (document.examples.length > 1) blocks.push(heading(3, example.title));
      if (example.description) blocks.push(paragraph(example.description));
      blocks.push(ir.codeBlock(example.code, example.fence || 'Bash'));
    }
  }
  const result = ir.document(blocks, {
    metadata: { renderer: 'zilliz-cli', title: document.identity.title },
  });
  const validation = validateDocumentIr(result);
  if (!validation.valid) {
    throw new Error(`CLI renderer produced invalid Document IR: ${JSON.stringify(validation.errors)}`);
  }
  return result;
}

module.exports = Object.freeze({ render });
