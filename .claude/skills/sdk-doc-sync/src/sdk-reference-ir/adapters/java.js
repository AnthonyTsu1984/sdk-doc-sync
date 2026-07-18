'use strict';

const common = require('./common');

function toReferenceDocument(symbol, context = {}) {
  const evidence = common.collectEvidence(symbol, context);
  const signatures = [common.makeSignature(symbol.signature || '', [], evidence)];
  const requestVariants = [];
  const callableMembers = [];
  if (symbol.requestClass) {
    requestVariants.push(common.makeRequestVariant({
      id: symbol.requestClass,
      title: symbol.requestClass,
      description: '',
      signature: `${symbol.requestClass}.builder()`,
      inputs: symbol.params,
    }, evidence));
    for (const param of symbol.params || []) {
      const methodName = param.method || param.name || '';
      const input = { ...param, name: param.name || methodName };
      const display = param.fullSignature
        || `${methodName}(${param.type || ''} ${param.name || methodName})`;
      callableMembers.push(common.makeCallableMember('builder', {
        ...param,
        name: methodName,
      }, evidence, display, [input]));
    }
  }
  const result = symbol.returnType && symbol.returnType !== 'void'
    ? common.makeResult({ type: symbol.returnType }, evidence)
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
