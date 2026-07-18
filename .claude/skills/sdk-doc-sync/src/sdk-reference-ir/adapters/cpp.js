'use strict';

const common = require('./common');

function toReferenceDocument(symbol, context = {}) {
  const kindMap = {
    method: 'method',
    function: 'function',
    class: 'class',
    struct: 'struct',
    interface: 'interface',
    enum: 'enum',
  };
  const kind = kindMap[String(symbol.kind || '').toLowerCase()];
  if (!kind) throw new TypeError(`Unsupported C++ scanner kind: ${symbol.kind}`);
  const evidence = common.collectEvidence(symbol, context);
  if (kind === 'enum') {
    const valueNotes = (symbol.params || []).map((value) => {
      const comment = value.comment ? ` — ${value.comment}` : '';
      return `${value.name} = ${value.value}${comment}`;
    });
    return common.buildReferenceDocument({
      symbol,
      context,
      language: 'cpp',
      kind,
      signatures: [],
      requestVariants: [],
      callableMembers: [],
      result: null,
      notes: [...(Array.isArray(context.notes) ? context.notes : []), ...valueNotes],
    });
  }
  const callable = ['method', 'function'].includes(kind);
  const directParams = callable && !symbol.requestClass ? symbol.params || [] : [];
  const signatures = callable
    ? [common.makeSignature(symbol.signature || '', directParams, evidence, { symbol, context })]
    : [];
  const requestFields = (symbol.params || []).map((param) => ({
    ...param,
    name: param.argName || param.name,
  }));
  let requestVariants = symbol.requestClass ? [common.makeRequestVariant({
    id: symbol.requestClass,
    title: symbol.requestClass,
    description: '',
    signature: symbol.requestClass,
    inputs: requestFields,
  }, evidence, { symbol, context })] : [];
  if (callable && !symbol.requestClass && directParams.length > 0) {
    requestVariants = [common.makeRequestVariant({
      id: 'default',
      title: `${symbol.name || ''} parameters`,
      description: '',
      signature: symbol.signature || '',
      inputs: directParams,
    }, evidence, { symbol, context })];
  }
  const callableMembers = symbol.requestClass ? (symbol.params || []).map((member) => common.makeCallableMember(
    'request',
    member,
    evidence,
    member.fullSignature || `${member.name || ''}(${member.fullArgStr || ''})`,
    member.argName ? [{ ...member, name: member.argName }] : [],
    { symbol, context },
  )) : [];
  const inferredStatus = typeof symbol.signature === 'string'
    ? symbol.signature.trim().split(/\s+/)[0]
    : '';
  const resultInput = callable
    ? context.result || symbol.result || (inferredStatus ? { type: inferredStatus } : null)
    : null;
  const result = common.makeResult(resultInput, evidence, { symbol, context });
  return common.buildReferenceDocument({
    symbol,
    context,
    language: 'cpp',
    kind,
    signatures,
    requestVariants,
    callableMembers,
    result,
  });
}

module.exports = { toReferenceDocument };
