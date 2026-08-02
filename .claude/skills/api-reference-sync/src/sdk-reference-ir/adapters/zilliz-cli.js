'use strict';

const common = require('./common');

function toReferenceDocument(symbol, context = {}) {
  const evidence = common.collectEvidence(symbol, context);
  const signatures = [common.makeSignature(symbol.signature || '', symbol.params, evidence, { symbol, context })];
  return common.buildReferenceDocument({
    symbol,
    context,
    language: 'zilliz-cli',
    kind: 'command',
    signatures,
    requestVariants: [],
    callableMembers: [],
    result: null,
    errors: [],
  });
}

module.exports = { toReferenceDocument };
