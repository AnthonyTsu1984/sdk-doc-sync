'use strict';

const common = require('./common');

function toReferenceDocument(symbol, context = {}) {
  const evidence = common.collectEvidence(symbol, context);
  const signatures = [common.makeSignature(symbol.signature || '', symbol.directParams || [], evidence)];
  const requestFields = (symbol.params || []).map((param) => ({
    ...param,
    name: param.argName || param.name,
  }));
  const requestVariants = symbol.requestClass ? [common.makeRequestVariant({
    id: symbol.requestClass,
    title: symbol.requestClass,
    description: '',
    signature: symbol.requestClass,
    inputs: requestFields,
  }, evidence)] : [];
  const callableMembers = (symbol.params || []).map((member) => common.makeCallableMember(
    'request',
    member,
    evidence,
    member.fullSignature || `${member.name || ''}(${member.fullArgStr || ''})`,
    member.argName ? [{ ...member, name: member.argName }] : [],
  ));
  const inferredStatus = typeof symbol.signature === 'string'
    ? symbol.signature.trim().split(/\s+/)[0]
    : '';
  const resultInput = context.result || symbol.result || (inferredStatus ? { type: inferredStatus } : null);
  const result = common.makeResult(resultInput, evidence);
  return common.buildReferenceDocument({
    symbol,
    context,
    language: 'cpp',
    signatures,
    requestVariants,
    callableMembers,
    result,
  });
}

module.exports = { toReferenceDocument };
