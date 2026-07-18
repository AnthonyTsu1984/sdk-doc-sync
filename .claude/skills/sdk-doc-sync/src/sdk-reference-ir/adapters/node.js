'use strict';

const common = require('./common');

function toReferenceDocument(symbol, context = {}) {
  const evidence = common.collectEvidence(symbol, context);
  const params = Array.isArray(symbol.params) ? symbol.params : [];
  const canonical = symbol.signature
    || `client.${symbol.name || ''}(${params.map((param) => param.name).join(', ')})`;
  const signatures = [common.makeSignature(canonical, params, evidence)];
  const requestVariants = Array.isArray(symbol.requestVariants)
    ? symbol.requestVariants.map((variant) => common.makeRequestVariant(variant, evidence))
    : [];
  const result = common.makeResult(symbol.result, evidence);
  return common.buildReferenceDocument({
    symbol,
    context,
    language: 'node',
    kind: 'function',
    signatures,
    requestVariants,
    callableMembers: [],
    result,
  });
}

module.exports = { toReferenceDocument };
