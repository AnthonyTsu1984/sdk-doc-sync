'use strict';

const common = require('./common');

function toReferenceDocument(symbol, context = {}) {
  const evidence = common.collectEvidence(symbol, context);
  const signatures = [common.makeSignature(symbol.signature || '', symbol.params, evidence, { symbol, context })];
  const callableMembers = (symbol.optionMethods || []).map((member) => common.makeCallableMember(
    'option',
    member,
    evidence,
    member.fullSignature || '',
    [],
    { symbol, context },
  ));
  const result = symbol.returnType
    ? common.makeResult({ type: symbol.returnType }, evidence, { symbol, context })
    : null;
  return common.buildReferenceDocument({
    symbol,
    context,
    language: 'go',
    signatures,
    callableMembers,
    result,
  });
}

module.exports = { toReferenceDocument };
