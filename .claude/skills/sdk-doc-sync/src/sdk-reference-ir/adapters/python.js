'use strict';

const common = require('./common');

function toReferenceDocument(symbol, context = {}) {
  const evidence = common.collectEvidence(symbol, context);
  const inputs = common.normalizeFields(symbol.params, evidence);
  const signature = common.makeSignature(symbol.signature || '', symbol.params, evidence);
  const requestVariants = inputs.length > 0 ? [common.makeRequestVariant({
    id: 'primary',
    title: `${symbol.name || ''} parameters`,
    description: '',
    signature: symbol.signature || '',
    inputs: symbol.params,
  }, evidence)] : [];
  const result = symbol.returnType ? common.makeResult({ type: symbol.returnType }, evidence) : null;
  const errors = common.makeErrors(context.exceptions || symbol.exceptions, evidence);
  return common.buildReferenceDocument({
    symbol,
    context,
    language: 'python',
    signatures: [signature],
    requestVariants,
    result,
    errors,
  });
}

module.exports = { toReferenceDocument };
