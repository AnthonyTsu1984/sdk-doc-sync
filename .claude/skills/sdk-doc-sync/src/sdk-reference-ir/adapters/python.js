'use strict';

const common = require('./common');

function normalizePythonParam(param) {
  if (!param || typeof param !== 'object') return param;
  if ((param.kind === 'kwargs' || param.kind === 'varargs') && !param.type) {
    return { ...param, type: 'Any' };
  }
  return param;
}

function normalizePythonSymbol(symbol) {
  if (!symbol || typeof symbol !== 'object' || !Array.isArray(symbol.params)) return symbol;
  return {
    ...symbol,
    params: symbol.params.map(normalizePythonParam),
  };
}

function toReferenceDocument(symbol, context = {}) {
  symbol = normalizePythonSymbol(symbol);
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
  const reviewedParams = Array.isArray(context.params)
    ? context.params.map(normalizePythonParam)
    : null;
  const params = reviewedParams || symbol.params;
  const signature = context.signature ?? symbol.signature ?? '';
  const callable = ['method', 'function'].includes(kind)
    || (['class'].includes(kind) && (reviewedParams !== null || context.signature !== undefined));
  const inputs = callable
    ? common.normalizeFields(params, evidence, { symbol, context })
    : [];
  const signatures = callable
    ? [common.makeSignature(signature, params, evidence, { symbol, context })]
    : [];
  const requestVariants = callable && inputs.length > 0 ? [common.makeRequestVariant({
    id: 'primary',
    title: `${symbol.name || ''} parameters`,
    description: '',
    signature,
    inputs: params,
  }, evidence, { symbol, context })] : [];
  const result = callable && (context.result || symbol.result || symbol.returnType)
    ? common.makeResult(context.result || symbol.result || { type: symbol.returnType }, evidence, { symbol, context })
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
