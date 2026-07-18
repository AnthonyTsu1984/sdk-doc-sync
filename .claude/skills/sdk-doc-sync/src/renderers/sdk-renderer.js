'use strict';

const ir = require('../document-ir/schema');
const { isSafeUrl } = require('../document-ir/validate');

function text(value, marks = []) {
  return ir.text(String(value), marks);
}

function paragraph(value, marks = []) {
  return ir.paragraph([text(value, marks)]);
}

function heading(level, value) {
  return ir.heading(level, [text(value)]);
}

function label(value) {
  return paragraph(value, ['bold']);
}

function sentence(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function typeUrl(type, context) {
  const typeUrls = context?.typeUrls && typeof context.typeUrls === 'object' ? context.typeUrls : {};
  const referenceUrls = context?.referenceUrls && typeof context.referenceUrls === 'object'
    ? context.referenceUrls
    : {};
  const candidates = [];
  if (type && Array.isArray(type.references)) {
    for (const reference of type.references) {
      candidates.push(referenceUrls[reference.id], typeUrls[reference.id], typeUrls[reference.display]);
    }
  }
  candidates.push(typeUrls[type?.display]);
  return candidates.find((value) => isSafeUrl(value)) || null;
}

function typeInlines(type, context, { italic = true } = {}) {
  const display = String(type?.display || '');
  if (!display) return [];
  const url = typeUrl(type, context);
  if (url) return [ir.citation(display, url)];
  return [text(display, italic ? ['italic'] : [])];
}

function fieldHeader(field, context) {
  const children = [text(field.name, ['bold'])];
  const renderedType = typeInlines(field.type, context);
  if (renderedType.length > 0) children.push(text(' ('), ...renderedType, text(')'));
  children.push(text(' -'));
  if (field.required === true) children.push(text(' '), text('[REQUIRED]', ['bold']));
  if (field.defaultValue !== null && field.defaultValue !== undefined) {
    children.push(text(' Default: '), text(String(field.defaultValue), ['inlineCode']));
  }
  return ir.paragraph(children);
}

function fieldDetails(field) {
  const details = [];
  if (Array.isArray(field.constraints) && field.constraints.length > 0) {
    const constraints = field.constraints.map((value) => String(value).replace(/[.!?]+$/, ''));
    details.push(`Constraints: ${constraints.join('; ')}`);
  }
  if (field.appliesWhen) details.push(`Applies when: ${field.appliesWhen}`);
  return details.join('. ');
}

function renderFields(fields, context, role = 'field') {
  const items = fields.map((field) => {
    const children = [fieldHeader(field, context)];
    const description = sentence(field.description);
    if (description) children.push(paragraph(description));
    const details = fieldDetails(field);
    if (details) children.push(paragraph(sentence(details)));
    if (Array.isArray(field.children) && field.children.length > 0) {
      children.push(renderFields(field.children, context, role));
    }
    return ir.listItem(children);
  });
  return ir.unorderedList(items, { metadata: { role } });
}

function renderMembers(members, context) {
  return ir.unorderedList(members.map((member) => {
    const children = [ir.paragraph([text(member.signature.display || member.name, ['inlineCode'])])];
    const description = sentence(member.description);
    if (description) children.push(paragraph(description));
    return ir.listItem(children);
  }), { metadata: { role: 'member' } });
}

function renderErrors(errors) {
  return ir.unorderedList(errors.map((item) => {
    const details = [sentence(item.condition), sentence(item.description)].filter(Boolean).join(' ');
    return ir.listItem([
      ir.paragraph([text(item.name, ['bold'])]),
      paragraph(details),
    ]);
  }), { metadata: { role: 'error' } });
}

function renderRelated(items) {
  const safe = items.filter((item) => item && isSafeUrl(item.url));
  if (safe.length === 0) return null;
  return ir.unorderedList(safe.map((item) => ir.listItem([
    ir.paragraph([ir.citation(item.title, item.url)]),
  ])), { metadata: { role: 'related' } });
}

function requestEntries(document, policy) {
  if (typeof policy.requestEntries === 'function') return policy.requestEntries(document);
  return document.requestVariants || [];
}

function renderRequest(document, policy, context) {
  const entries = requestEntries(document, policy).filter((entry) => entry && entry.signature);
  if (entries.length === 0) return [];
  const blocks = [heading(2, policy.requestHeading)];
  for (const entry of entries) {
    if (policy.variantHeadings) blocks.push(heading(3, entry.title || entry.id));
    if (entry.description) blocks.push(paragraph(entry.description));
    const signature = typeof policy.requestSignature === 'function'
      ? policy.requestSignature(document, entry)
      : entry.signature.display;
    if (signature) blocks.push(ir.codeBlock(signature, policy.requestFence));
    if (policy.variantFields && Array.isArray(entry.inputs) && entry.inputs.length > 0) {
      blocks.push(label(policy.parametersLabel), renderFields(entry.inputs, context));
    }
  }
  return blocks;
}

function renderResult(document, policy, context) {
  const result = document.result;
  if (!result) return [];
  const blocks = [];
  if (policy.resultTypeLabel) {
    blocks.push(label(policy.resultTypeLabel));
    blocks.push(ir.paragraph(typeInlines(result.type, context)));
  }
  if (policy.returnsLabel) {
    blocks.push(label(policy.returnsLabel));
    if (!policy.resultTypeLabel) blocks.push(ir.paragraph(typeInlines(result.type, context)));
    blocks.push(paragraph(sentence(result.description)));
    if (Array.isArray(result.fields) && result.fields.length > 0) {
      blocks.push(renderFields(result.fields, context, 'result'));
    }
  }
  return blocks;
}

function createSdkRenderer(policy) {
  const frozenPolicy = Object.freeze({ ...policy });
  function render(document, context = {}) {
    const blocks = [
      heading(1, document.identity.title),
      paragraph(document.summary),
    ];

    for (const variant of document.audienceVariants || []) {
      blocks.push(ir.audienceRegion('include', variant.audience, [paragraph(variant.summary)]));
    }

    for (const signature of document.signatures || []) {
      if (signature.display) blocks.push(ir.codeBlock(signature.display, frozenPolicy.canonicalFence));
    }

    blocks.push(...renderRequest(document, frozenPolicy, context));

    const primaryInputs = typeof frozenPolicy.primaryInputs === 'function'
      ? frozenPolicy.primaryInputs(document)
      : [];
    if (primaryInputs.length > 0) {
      blocks.push(label(frozenPolicy.parametersLabel), renderFields(primaryInputs, context));
    }

    if (frozenPolicy.memberKind) {
      const members = (document.callableMembers || []).filter((member) => member.kind === frozenPolicy.memberKind);
      if (members.length > 0) blocks.push(label(frozenPolicy.membersLabel), renderMembers(members, context));
    }

    blocks.push(...renderResult(document, frozenPolicy, context));

    const errors = typeof frozenPolicy.errors === 'function'
      ? frozenPolicy.errors(document)
      : document.errors || [];
    if (errors.length > 0) blocks.push(label(frozenPolicy.errorsLabel), renderErrors(errors));

    if (Array.isArray(document.examples) && document.examples.length > 0) {
      blocks.push(heading(2, frozenPolicy.exampleHeading));
      for (const example of document.examples) {
        const baseHeading = frozenPolicy.exampleHeading.replace(/\{#[^}]+\}$/, '').toLowerCase();
        const distinctTitle = example.title
          && ![baseHeading, baseHeading.replace(/s$/, '')].includes(example.title.toLowerCase());
        if (document.examples.length > 1 || distinctTitle) blocks.push(heading(3, example.title));
        if (example.description) blocks.push(paragraph(example.description));
        blocks.push(ir.codeBlock(example.code, example.fence || frozenPolicy.exampleFence));
      }
    }

    if (Array.isArray(document.notes) && document.notes.length > 0) {
      blocks.push(heading(2, 'Notes'));
      blocks.push(ir.unorderedList(document.notes.map((note) => ir.listItem([paragraph(note)]))));
    }

    const related = renderRelated(document.related || []);
    if (related) blocks.push(heading(2, 'Related'), related);

    return ir.document(blocks, { metadata: { title: document.identity.title, renderer: frozenPolicy.id } });
  }
  return Object.freeze({ policy: frozenPolicy, render });
}

module.exports = { createSdkRenderer, renderFields, typeInlines };
