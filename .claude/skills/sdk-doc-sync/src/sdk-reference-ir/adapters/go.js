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
    const result = common.makeResult({
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
      callableMembers: [],
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
    const result = common.makeResult({
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
  const signatures = [common.makeSignature(symbol.signature || '', symbol.params, evidence, { symbol, context })];
  const callableMembers = (symbol.optionMethods || []).map((member) => common.makeCallableMember(
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
    callableMembers,
    result,
    errors,
  });
}

module.exports = { toReferenceDocument };
