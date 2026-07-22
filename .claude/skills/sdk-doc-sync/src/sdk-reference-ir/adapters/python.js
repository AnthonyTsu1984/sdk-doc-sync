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

function docstringParamDescriptions(docstring) {
  const descriptions = new Map();
  let inParameters = false;
  let currentName = null;
  for (const line of String(docstring || '').split(/\r?\n/)) {
    if (/^\s*(?:Args|Arguments|Parameters):\s*$/.test(line)) {
      inParameters = true;
      currentName = null;
      continue;
    }
    if (!inParameters) continue;
    if (/^\s*(?:Returns?|Raises?|Examples?|Notes?|Yields?):\s*$/.test(line)) break;
    const entry = line.match(/^\s*(\*{0,2}[A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*:\s*(.*)$/);
    if (entry) {
      currentName = entry[1].replace(/^\*+/, '');
      descriptions.set(currentName, entry[2].trim());
      continue;
    }
    const continuation = line.trim();
    if (currentName && continuation) {
      descriptions.set(currentName, `${descriptions.get(currentName)} ${continuation}`.trim());
    }
  }
  return descriptions;
}

function applyDocstringParamDescriptions(params, docstring) {
  const descriptions = docstringParamDescriptions(docstring);
  return (params || []).map((param) => {
    if (!param || param.description || param.descriptions || !descriptions.has(param.name)) return param;
    return { ...param, description: descriptions.get(param.name) };
  });
}

function requestVariantInputs(params, names) {
  if (!Array.isArray(names) || names.length === 0) return params;
  const byName = new Map(params.map((param) => [param.name, param]));
  return names.map((name) => byName.get(name) || {
    name,
    type: '',
    description: '',
  });
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
  const params = applyDocstringParamDescriptions(reviewedParams || symbol.params, symbol.docstring);
  const signature = context.signature ?? symbol.signature ?? '';
  const callable = ['method', 'function'].includes(kind)
    || (['class'].includes(kind) && (reviewedParams !== null || context.signature !== undefined));
  const inputs = callable
    ? common.normalizeFields(params, evidence, { symbol, context })
    : [];
  const signatures = callable
    ? [common.makeSignature(signature, params, evidence, { symbol, context })]
    : [];
  let requestVariants = [];
  if (callable && Array.isArray(context.requestVariants) && context.requestVariants.length > 0) {
    requestVariants = context.requestVariants.map((variant) => {
      const variantInputs = requestVariantInputs(params, variant.parameters);
      return common.makeRequestVariant({
        ...variant,
        inputs: variantInputs,
        signatureInputs: variantInputs,
      }, evidence, { symbol, context });
    });
  } else if (callable && inputs.length > 0) {
    requestVariants = [common.makeRequestVariant({
      id: 'primary',
      title: `${symbol.name || ''} parameters`,
      description: '',
      signature,
      inputs: params,
    }, evidence, { symbol, context })];
  }
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
