'use strict';

const ir = require('../document-ir/schema');
const { isSafeUrl } = require('../document-ir/validate');

function text(value, marks = []) {
  return ir.text(String(value), marks);
}

function semantic(role, key = null, extra = {}) {
  return { metadata: { role, ...(key && { key }), ...extra } };
}

function proseInlines(value, baseMarks = []) {
  const source = String(value);
  const children = [];
  const pattern = /`([^`\n]+)`/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const before = match.index > 0 ? source[match.index - 1] : '';
    const after = pattern.lastIndex < source.length ? source[pattern.lastIndex] : '';
    if (before === '`' || after === '`') continue;
    if (match.index > cursor) children.push(text(source.slice(cursor, match.index), baseMarks));
    children.push(text(match[1], [...new Set([...baseMarks, 'inlineCode'])]));
    cursor = pattern.lastIndex;
  }
  if (cursor < source.length) children.push(text(source.slice(cursor), baseMarks));
  return children.length > 0 ? children : [text(source, baseMarks)];
}

function paragraph(value, marks = [], options = {}) {
  return ir.paragraph(proseInlines(value, marks), options);
}

function heading(level, value, options = {}) {
  return ir.heading(level, [text(value)], options);
}

function label(value, options = {}) {
  return paragraph(value, ['bold'], options);
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
  return ir.paragraph(children);
}

function fieldQualifier(field) {
  if (field.required === true) {
    return ir.paragraph([text('[REQUIRED]', ['bold'])], semantic('field-qualifier'));
  }
  if (field.defaultValue !== null && field.defaultValue !== undefined) {
    return ir.paragraph([
      text('Default: '),
      text(String(field.defaultValue), ['inlineCode']),
    ], semantic('field-qualifier'));
  }
  return null;
}

function fieldDetails(field) {
  const details = [];
  if (Array.isArray(field.constraints) && field.constraints.length > 0) {
    const constraints = field.constraints
      .map((value) => String(value).replace(/[.!?]+$/, ''))
      .filter((value) => !/^kind:\s*(?:positional|keyword|kwargs|varargs|separator)$/i.test(value));
    if (constraints.length > 0) details.push(`Constraints: ${constraints.join('; ')}`);
  }
  if (field.appliesWhen) details.push(`Applies when: ${field.appliesWhen}`);
  return details.join('. ');
}

function renderFields(fields, context, role = 'parameters-list', key = null) {
  const items = fields.map((field) => {
    const children = [fieldHeader(field, context)];
    const qualifier = fieldQualifier(field);
    if (qualifier) children.push(qualifier);
    const description = sentence(field.description);
    if (description) children.push(paragraph(description));
    const details = fieldDetails(field);
    if (details) children.push(paragraph(sentence(details)));
    if (Array.isArray(field.children) && field.children.length > 0) {
      children.push(renderFields(field.children, context, role, key));
    }
    return ir.listItem(children);
  });
  return ir.unorderedList(items, semantic(role, key));
}

function renderMembers(members) {
  return ir.unorderedList(members.map((member) => {
    const children = [ir.paragraph([text(member.signature.display || member.name, ['inlineCode'])])];
    const description = sentence(member.description);
    if (description) children.push(paragraph(description));
    return ir.listItem(children);
  }), semantic('members-list'));
}

function renderErrors(errors) {
  return ir.unorderedList(errors.map((item) => {
    const details = [sentence(item.condition), sentence(item.description)].filter(Boolean).join(' ');
    return ir.listItem([
      ir.paragraph([text(item.name, ['bold'])]),
      paragraph(details),
    ]);
  }), semantic('exceptions-list'));
}

function renderRelated(items) {
  const safe = items.filter((item) => item && isSafeUrl(item.url));
  if (safe.length === 0) return null;
  return ir.unorderedList(safe.map((item) => ir.listItem([
    ir.paragraph([ir.citation(item.title, item.url)]),
  ])), semantic('related-list'));
}

function requestEntries(document, policy) {
  if (typeof policy.requestEntries === 'function') return policy.requestEntries(document);
  return document.requestVariants || [];
}

function renderRequest(document, policy, context) {
  const entries = requestEntries(document, policy).filter((entry) => entry && entry.signature);
  if (entries.length === 0) return [];
  const blocks = [heading(2, policy.requestHeading, semantic('request-heading'))];
  for (const entry of entries) {
    const entryKey = entry.id || entry.title || null;
    if (policy.variantHeadings) {
      blocks.push(heading(3, entry.title || entry.id, semantic('request-variant-heading', entryKey)));
    }
    if (entry.description) {
      blocks.push(paragraph(entry.description, [], semantic('request-description', entryKey)));
    }
    const signature = typeof policy.requestSignature === 'function'
      ? policy.requestSignature(document, entry)
      : entry.signature.display;
    if (signature) blocks.push(ir.codeBlock(signature, policy.requestFence, semantic('request-signature', entryKey)));
    if (policy.variantFields && Array.isArray(entry.inputs) && entry.inputs.length > 0) {
      blocks.push(
        label(policy.parametersLabel, semantic('parameters-label', entryKey)),
        renderFields(entry.inputs, context, 'parameters-list', entryKey),
      );
    }
  }
  return blocks;
}

function renderResultType(document, policy, context) {
  const result = document.result;
  if (!result || !policy.resultTypeLabel) return [];
  return [
    label(policy.resultTypeLabel, semantic('result-type-label')),
    ir.paragraph(typeInlines(result.type, context), semantic('result-type-value')),
  ];
}

function renderReturns(document, policy, context) {
  const result = document.result;
  if (!result || !policy.returnsLabel) return [];
  const blocks = [label(policy.returnsLabel, semantic('returns-label'))];
  if (!policy.resultTypeLabel) {
    blocks.push(ir.paragraph(typeInlines(result.type, context), semantic('returns-type-value')));
  }
  blocks.push(paragraph(sentence(result.description), [], semantic('returns-description')));
  if (Array.isArray(result.fields) && result.fields.length > 0) {
    blocks.push(renderFields(result.fields, context, 'result-fields'));
  }
  return blocks;
}

function renderAudience(document) {
  return (document.audienceVariants || []).map((variant) => ir.audienceRegion(
    'include',
    variant.audience,
    [paragraph(variant.summary)],
    semantic('audience', variant.audience),
  ));
}

function renderCanonicalSignatures(document, policy) {
  if (policy.profile.canonicalSignature === 'omit') return [];
  const requestSignatures = new Set(requestEntries(document, policy)
    .map((entry) => entry?.signature?.display)
    .filter(Boolean)
    .map((value) => String(value).replace(/\s+/g, ' ').trim().replace(/;$/, '')));
  return (document.signatures || [])
    .filter((signature) => signature.display)
    .filter((signature) => policy.profile.canonicalSignature !== 'when-distinct'
      || !requestSignatures.has(String(signature.display).replace(/\s+/g, ' ').trim().replace(/;$/, '')))
    .map((signature, index) => ir.codeBlock(
      signature.display,
      policy.canonicalFence,
      semantic('canonical-signature', signature.id || String(index)),
    ));
}

function renderPrimaryInputs(document, policy, context) {
  const primaryInputs = typeof policy.primaryInputs === 'function'
    ? policy.primaryInputs(document)
    : [];
  if (primaryInputs.length === 0) return [];
  return [
    label(policy.parametersLabel, semantic('parameters-label')),
    renderFields(primaryInputs, context, 'parameters-list'),
  ];
}

function renderCallableMembers(document, policy) {
  if (!policy.memberKind) return [];
  const members = (document.callableMembers || []).filter((member) => member.kind === policy.memberKind);
  if (members.length === 0) return [];
  return [
    label(policy.membersLabel, semantic('members-label')),
    renderMembers(members),
  ];
}

function renderErrorsSection(document, policy) {
  const errors = typeof policy.errors === 'function'
    ? policy.errors(document)
    : document.errors || [];
  if (errors.length === 0) return [];
  return [
    label(policy.errorsLabel, semantic('exceptions-label')),
    renderErrors(errors),
  ];
}

function renderExamples(document, policy) {
  if (!Array.isArray(document.examples) || document.examples.length === 0) return [];
  const blocks = [heading(2, policy.exampleHeading, semantic('examples-heading'))];
  for (const [index, example] of document.examples.entries()) {
    const exampleKey = example.id || example.title || String(index);
    const baseHeading = policy.exampleHeading.replace(/\{#[^}]+\}$/, '').toLowerCase();
    const distinctTitle = example.title
      && ![baseHeading, baseHeading.replace(/s$/, '')].includes(example.title.toLowerCase());
    if (policy.showExampleTitles !== false && (document.examples.length > 1 || distinctTitle)) {
      blocks.push(heading(3, example.title, semantic('example-heading', exampleKey)));
    }
    if (example.description) {
      blocks.push(paragraph(example.description, [], semantic('example-description', exampleKey)));
    }
    blocks.push(ir.codeBlock(
      example.code,
      example.fence || policy.exampleFence,
      semantic('example-code', exampleKey),
    ));
  }
  return blocks;
}

function renderExtensions(document, policy, context) {
  return typeof policy.renderExtensions === 'function'
    ? policy.renderExtensions(document, context)
    : [];
}

function renderNotes(document) {
  if (!Array.isArray(document.notes) || document.notes.length === 0) return [];
  return [
    heading(2, 'Notes', semantic('notes-heading')),
    ir.unorderedList(document.notes.map((note) => ir.listItem([paragraph(note)])), semantic('notes-list')),
  ];
}

function renderRelatedSection(document) {
  const related = renderRelated(document.related || []);
  return related ? [heading(2, 'Related', semantic('related-section')), related] : [];
}

function createSdkRenderer(policy) {
  if (!policy?.profile) throw new TypeError('SDK renderer policy requires a layout profile');
  const frozenPolicy = Object.freeze({ ...policy });
  function render(document, context = {}) {
    const sections = {
      summary: [paragraph(document.summary, [], semantic('summary'))],
      audience: renderAudience(document),
      'canonical-signature': renderCanonicalSignatures(document, frozenPolicy),
      request: renderRequest(document, frozenPolicy, context),
      parameters: renderPrimaryInputs(document, frozenPolicy, context),
      members: renderCallableMembers(document, frozenPolicy),
      'result-type': renderResultType(document, frozenPolicy, context),
      returns: renderReturns(document, frozenPolicy, context),
      exceptions: renderErrorsSection(document, frozenPolicy),
      examples: renderExamples(document, frozenPolicy),
      extensions: renderExtensions(document, frozenPolicy, context),
      notes: renderNotes(document),
      related: renderRelatedSection(document),
    };
    const blocks = frozenPolicy.profile.order.flatMap((name) => sections[name] || []);
    return ir.document(blocks, {
      metadata: {
        title: document.identity.title,
        renderer: frozenPolicy.id,
        layoutProfile: frozenPolicy.profile.id,
        layoutProfileVersion: frozenPolicy.profile.version,
      },
    });
  }
  return Object.freeze({ profile: frozenPolicy.profile, policy: frozenPolicy, render });
}

module.exports = { createSdkRenderer, renderFields, typeInlines };
