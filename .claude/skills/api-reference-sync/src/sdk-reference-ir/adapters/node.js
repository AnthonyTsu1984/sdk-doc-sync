'use strict';

const common = require('./common');

function toReferenceDocument(symbol, context = {}) {
  const kindMap = {
    method: 'method',
    function: 'function',
    class: 'class',
    interface: 'interface',
    enum: 'enum',
  };
  const kind = kindMap[String(context.kind || symbol.kind || '').toLowerCase()];
  if (!kind) throw new TypeError(`Unsupported Node scanner kind: ${symbol.kind}`);
  const evidence = common.collectEvidence(symbol, context);
  const params = Array.isArray(context.params)
    ? context.params
    : Array.isArray(symbol.params) ? symbol.params : [];
  const callable = ['method', 'function'].includes(kind);
  const canonical = callable
    ? context.signature || symbol.signature || `client.${symbol.name || ''}(${params.map((param) => param.name).join(', ')})`
    : '';
  const signatures = callable || context.signature
    ? [common.makeSignature(canonical || context.signature, params, evidence, { symbol, context })]
    : [];
  let requestVariants = [];
  const reviewedVariants = Array.isArray(context.requestVariants)
    ? context.requestVariants
    : symbol.requestVariants;
  if (callable && Array.isArray(reviewedVariants) && reviewedVariants.length > 0) {
    requestVariants = reviewedVariants.map((variant) => common.makeRequestVariant(
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
  const callableMembers = Array.isArray(context.callableMembers)
    ? context.callableMembers.map((member) => common.makeCallableMember(
      member.kind || 'implementation',
      member,
      evidence,
      member.signature || member.name || '',
      member.signatureInputs || member.params || [],
      { symbol, context },
    ))
    : [];
  const result = callable
    ? common.makeResult(context.result || symbol.result, evidence, { symbol, context })
    : null;
  const errors = callable ? common.makeErrors(context.exceptions || symbol.exceptions, evidence) : [];
  return common.buildReferenceDocument({
    symbol,
    context,
    language: 'node',
    kind,
    signatures,
    requestVariants,
    callableMembers,
    result,
    errors,
  });
}

module.exports = { toReferenceDocument };
