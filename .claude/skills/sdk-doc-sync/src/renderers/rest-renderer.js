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

function authFields(auth) {
  return auth.map((item) => ({
    name: item.name,
    type: { display: item.type, references: [] },
    required: false,
    defaultValue: null,
    description: item.description,
    constraints: [
      ...(item.in ? [`in: ${item.in}`] : []),
      ...(item.parameterName ? [`name: ${item.parameterName}`] : []),
    ],
    children: [],
    appliesWhen: null,
  }));
}

function requestSection(blocks, label, fields) {
  if (!Array.isArray(fields) || fields.length === 0) return;
  blocks.push(heading(3, label), renderFields(fields, {}, `http-${label.toLowerCase()}`));
}

function render(document) {
  const http = document.http;
  const blocks = [
    heading(1, document.identity.title),
    paragraph(document.summary),
    ir.codeBlock(`${http.method} ${http.path}`, 'PlainText'),
  ];
  if (http.auth.length > 0) {
    blocks.push(heading(2, 'Authentication'));
    blocks.push(renderFields(authFields(http.auth), {}, 'http-auth'));
  }
  if (http.request) {
    blocks.push(heading(2, 'Request'));
    requestSection(blocks, 'Path', http.request.path);
    requestSection(blocks, 'Query', http.request.query);
    requestSection(blocks, 'Header', http.request.header);
    if (http.request.body.length > 0) {
      blocks.push(heading(3, 'Body'));
      if (http.request.contentType) {
        blocks.push(ir.paragraph([
          text('Content type: '),
          text(http.request.contentType, ['inlineCode']),
        ]));
      }
      blocks.push(renderFields(http.request.body, {}, 'http-body'));
    }
  }
  blocks.push(heading(2, 'Responses'));
  for (const response of http.responses) {
    blocks.push(heading(3, response.status));
    if (response.description) blocks.push(paragraph(response.description));
    if (response.fields.length > 0) {
      blocks.push(renderFields(response.fields, {}, 'http-response'));
    } else if (response.type?.display) {
      blocks.push(ir.paragraph([text('Type: '), text(response.type.display, ['inlineCode'])]));
    }
  }
  if (document.examples.length > 0) {
    blocks.push(heading(2, 'Examples'));
    for (const example of document.examples) {
      blocks.push(heading(3, example.title));
      if (example.description) blocks.push(paragraph(example.description));
      blocks.push(ir.codeBlock(example.code, example.fence || 'PlainText'));
    }
  }
  const result = ir.document(blocks, {
    metadata: { renderer: 'rest', title: document.identity.title },
  });
  const validation = validateDocumentIr(result);
  if (!validation.valid) {
    throw new Error(`REST renderer produced invalid Document IR: ${JSON.stringify(validation.errors)}`);
  }
  return result;
}

module.exports = Object.freeze({ render });
