'use strict';

const common = require('./common');

function toReferenceDocument(symbol, context = {}) {
  const kindMap = {
    method: 'method',
    function: 'function',
    struct: 'struct',
    class: 'class',
    enum: 'enum',
    interface: 'interface',
  };
  const kind = kindMap[String(symbol.kind || '').toLowerCase()];
  if (!kind) throw new TypeError(`Unsupported Go scanner kind: ${symbol.kind}`);
  const evidence = common.collectEvidence(symbol, context);
  if (kind === 'struct' || kind === 'class') {
    const signatures = symbol.signature
      ? [common.makeSignature(symbol.signature, [], evidence, { symbol, context })]
      : [];
    const requestVariants = Array.isArray(context.requestVariants)
      ? context.requestVariants.map((variant) => common.makeRequestVariant({
        ...variant,
        inputs: variant.inputs || symbol.params,
      }, evidence, { symbol, context }))
      : [];
    const callableMembers = Array.isArray(context.callableMembers)
      ? context.callableMembers.map((member) => common.makeCallableMember(
        member.kind || 'option',
        member,
        evidence,
        member.signature || member.fullSignature || '',
        member.inputs || [],
        { symbol, context },
      ))
      : [];
    // Reviewed upstream FIELDS: the web-content type pages carry curated
    // field descriptions; prefer the reviewed context result over the bare
    // scanner shape when one is supplied.
    const result = context.result
      ? common.makeResult(context.result, evidence, { symbol, context })
      : common.makeResult({
        type: symbol.name,
        description: symbol.docstring || '',
        fields: symbol.fields || [],
      }, evidence, { symbol, context });
    return common.buildReferenceDocument({
      symbol,
      context,
      language: 'go',
      kind,
      signatures,
      requestVariants,
      callableMembers,
      result,
    });
  }
  if (kind === 'enum') {
    const baseType = String(symbol.signature || '').match(/^type\s+\w+\s+(.+)$/)?.[1] || '';
    const fields = (symbol.values || []).map((value) => ({
      name: value.name,
      type: baseType,
      required: false,
      defaultValue: value.value,
      description: value.description || '',
    }));
    const result = context.result
      ? common.makeResult(context.result, evidence, { symbol, context })
      : common.makeResult({
        type: symbol.name,
        description: symbol.docstring || '',
        fields,
      }, evidence, { symbol, context });
    return common.buildReferenceDocument({
      symbol,
      context,
      language: 'go',
      kind,
      signatures: [],
      callableMembers: [],
      result,
    });
  }
  if (kind === 'interface') {
    const signatures = (symbol.methods || []).map((method) => {
      const methodEvidence = common.evidenceForNode(method, symbol, context, 'member', method.name);
      return common.makeSignature(method.fullSignature || '', [], methodEvidence);
    });
    const methodNotes = (symbol.methods || [])
      .filter((method) => method.description)
      .map((method) => `${method.fullSignature} — ${method.description}`);
    return common.buildReferenceDocument({
      symbol,
      context,
      language: 'go',
      kind,
      signatures,
      callableMembers: [],
      result: null,
      notes: [...(Array.isArray(context.notes) ? context.notes : []), ...methodNotes],
    });
  }
  // Reviewed upstream prose: the PARAMETERS section renders the canonical
  // signature inputs (scanner-derived — names, types, kind metadata, no
  // descriptions). The PR pages curate human descriptions per parameter;
  // merge them in so the section carries prose. Equal-length lists merge by
  // position: the PR PARAMETERS describe the builder's arguments in order,
  // which absorbs upstream naming drift (privileges vs privilegeNames).
  // Otherwise fall back to name matching. Scanner-side descriptions win.
  const reviewedInputs = (Array.isArray(context.requestVariants) ? context.requestVariants : [])
    .flatMap((variant) => (Array.isArray(variant?.inputs) ? variant.inputs : []))
    .filter((input) => input && String(input.name || '').trim() !== ''
      && String(input.description || '').trim() !== '');
  const withReviewedDescriptions = (params) => {
    if (!Array.isArray(params) || reviewedInputs.length === 0) return params;
    const described = (param) => param.description && String(param.description).trim() !== '';
    if (reviewedInputs.length === params.length) {
      return params.map((param, index) => (described(param) ? param : {
        ...param,
        description: String(reviewedInputs[index].description),
      }));
    }
    const byName = new Map(reviewedInputs.map((input) => [String(input.name), String(input.description)]));
    return params.map((param) => (!described(param) && byName.has(String(param.name)) ? {
      ...param,
      description: byName.get(String(param.name)),
    } : param));
  };
  const signatures = [common.makeSignature(symbol.signature || '', withReviewedDescriptions(symbol.params), evidence, { symbol, context })];
  let requestVariants = [];
  if (Array.isArray(context.requestVariants)) {
    requestVariants = context.requestVariants.map((variant) => common.makeRequestVariant({
      ...variant,
      inputs: variant.inputs || symbol.params,
    }, evidence, { symbol, context }));
  } else if (context.requestSyntax) {
    const request = typeof context.requestSyntax === 'object'
      ? context.requestSyntax
      : { signature: context.requestSyntax };
    requestVariants = [common.makeRequestVariant({
      id: request.id || 'primary',
      title: request.title || '',
      description: request.description || '',
      signature: request.signature || request.display || '',
      inputs: request.inputs || symbol.params,
    }, evidence, { symbol, context })];
  }
  // Reviewed upstream BUILDER METHODS: web-content method pages curate the
  // builder/option member descriptions; prefer the reviewed context members
  // over the scanner shape (Go doc comments are frequently empty) when a
  // non-empty list is supplied.
  const callableMembers = Array.isArray(context.callableMembers) && context.callableMembers.length > 0
    ? context.callableMembers.map((member) => common.makeCallableMember(
      member.kind || 'option',
      member,
      evidence,
      member.signature || member.fullSignature || '',
      member.inputs || [],
      { symbol, context },
    ))
    : (symbol.optionMethods || []).map((member) => common.makeCallableMember(
      'option',
      member,
      evidence,
      member.fullSignature || '',
      [],
      { symbol, context },
    ));
  const result = context.result || symbol.result || symbol.returnType
    ? common.makeResult(context.result || symbol.result || { type: symbol.returnType }, evidence, { symbol, context })
    : null;
  const errors = common.makeErrors(context.exceptions || symbol.exceptions, evidence);
  return common.buildReferenceDocument({
    symbol,
    context,
    language: 'go',
    kind,
    signatures,
    requestVariants,
    callableMembers,
    result,
    errors,
  });
}

module.exports = { toReferenceDocument };
