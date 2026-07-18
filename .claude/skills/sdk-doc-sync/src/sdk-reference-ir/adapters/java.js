'use strict';

const common = require('./common');

function toReferenceDocument(symbol, context = {}) {
  const evidence = common.collectEvidence(symbol, context);
  const signatures = [common.makeSignature(symbol.signature || '', [], evidence, { symbol, context })];
  const requestVariants = [];
  const callableMembers = [];
  if (symbol.requestClass) {
    const params = (symbol.params || []).map((param) => ({
      ...param,
      required: typeof param.required === 'boolean'
        ? param.required
        : (param.default === null || param.default === undefined)
          && (param.defaultValue === null || param.defaultValue === undefined),
    }));
    requestVariants.push(common.makeRequestVariant({
      id: symbol.requestClass,
      title: symbol.requestClass,
      description: '',
      signature: `${symbol.requestClass}.builder()`,
      inputs: params,
    }, evidence, { symbol, context }));
    for (const param of params) {
      const methodName = param.method || param.name || '';
      const input = { ...param, name: param.name || methodName };
      const display = param.fullSignature
        || `${methodName}(${param.type || ''} ${param.name || methodName})`;
      callableMembers.push(common.makeCallableMember('builder', {
        ...param,
        name: methodName,
      }, evidence, display, [input], { symbol, context }));
    }
  }
  const result = symbol.returnType && symbol.returnType !== 'void'
    ? common.makeResult({ type: symbol.returnType }, evidence, { symbol, context })
    : null;
  return common.buildReferenceDocument({
    symbol,
    context,
    language: 'java',
    signatures,
    requestVariants,
    callableMembers,
    result,
  });
}

module.exports = { toReferenceDocument };
