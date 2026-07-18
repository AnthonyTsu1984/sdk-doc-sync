'use strict';

const common = require('./common');

function toReferenceDocument(symbol, context = {}) {
  const kindMap = {
    method: 'method',
    function: 'function',
    class: 'class',
    enum: 'enum',
  };
  const kind = kindMap[String(symbol.kind || '').toLowerCase()];
  if (!kind) throw new TypeError(`Unsupported Node scanner kind: ${symbol.kind}`);
  const evidence = common.collectEvidence(symbol, context);
  const params = Array.isArray(symbol.params) ? symbol.params : [];
  const callable = ['method', 'function'].includes(kind);
  const canonical = callable
    ? symbol.signature || `client.${symbol.name || ''}(${params.map((param) => param.name).join(', ')})`
    : '';
  const signatures = callable
    ? [common.makeSignature(canonical, params, evidence, { symbol, context })]
    : [];
  let requestVariants = [];
  if (callable && Array.isArray(symbol.requestVariants) && symbol.requestVariants.length > 0) {
    requestVariants = symbol.requestVariants.map((variant) => common.makeRequestVariant(
      variant,
      evidence,
      { symbol, context },
    ));
  } else if (callable && params.length > 0) {
    requestVariants = [common.makeRequestVariant({
      id: 'default',
      title: `${symbol.name || ''} request`,
      description: '',
      signature: canonical,
      inputs: params,
    }, evidence, { symbol, context })];
  }
  const result = callable ? common.makeResult(symbol.result, evidence, { symbol, context }) : null;
  const errors = callable ? common.makeErrors(context.exceptions || symbol.exceptions, evidence) : [];
  return common.buildReferenceDocument({
    symbol,
    context,
    language: 'node',
    kind,
    signatures,
    requestVariants,
    callableMembers: [],
    result,
    errors,
  });
}

module.exports = { toReferenceDocument };
