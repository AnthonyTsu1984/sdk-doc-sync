'use strict';

const common = require('./common');

function toReferenceDocument(symbol, context = {}) {
  const kindMap = {
    method: 'method',
    function: 'function',
    class: 'class',
    enum: 'enum',
    constant: 'enum',
  };
  const kind = kindMap[String(symbol.kind || '').toLowerCase()];
  if (!kind) throw new TypeError(`Unsupported Python scanner kind: ${symbol.kind}`);
  const evidence = common.collectEvidence(symbol, context);
  const callable = ['method', 'function'].includes(kind);
  const inputs = callable
    ? common.normalizeFields(symbol.params, evidence, { symbol, context })
    : [];
  const signatures = callable
    ? [common.makeSignature(symbol.signature || '', symbol.params, evidence, { symbol, context })]
    : [];
  const requestVariants = callable && inputs.length > 0 ? [common.makeRequestVariant({
    id: 'primary',
    title: `${symbol.name || ''} parameters`,
    description: '',
    signature: symbol.signature || '',
    inputs: symbol.params,
  }, evidence, { symbol, context })] : [];
  const result = callable && symbol.returnType
    ? common.makeResult({ type: symbol.returnType }, evidence, { symbol, context })
    : null;
  const errors = callable ? common.makeErrors(context.exceptions || symbol.exceptions, evidence) : [];
  const notes = [...(Array.isArray(context.notes) ? context.notes : [])];
  if (!callable && symbol.signature) notes.push(symbol.signature);
  return common.buildReferenceDocument({
    symbol,
    context,
    language: 'python',
    kind,
    signatures,
    requestVariants,
    result,
    errors,
    notes,
  });
}

module.exports = { toReferenceDocument };
