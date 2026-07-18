'use strict';

const crypto = require('node:crypto');
const common = require('./common');

function withSignatureOverload(symbol, context) {
  if (context.overloadKey !== undefined || symbol.overloadKey !== undefined) return context;
  const kind = String(symbol.kind || '').toLowerCase();
  if (!['method', 'function'].includes(kind) || !symbol.signature) return context;
  const normalized = String(symbol.signature).trim().replace(/\s+/g, ' ');
  const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 10);
  return { ...context, overloadKey: `sig-${hash}` };
}

function toReferenceDocument(symbol, context = {}) {
  const effectiveContext = withSignatureOverload(symbol, context);
  const evidence = common.collectEvidence(symbol, effectiveContext);
  const signatures = [common.makeSignature(symbol.signature || '', [], evidence, {
    symbol,
    context: effectiveContext,
  })];
  const requestVariants = [];
  const callableMembers = [];
  if (symbol.requestClass) {
    const params = (symbol.params || []).map((param) => ({
      ...param,
      required: typeof param.required === 'boolean'
        ? param.required
        : param.default !== null && param.default !== undefined
          ? false
          : param.defaultValue !== null && param.defaultValue !== undefined
            ? false
            : typeof effectiveContext.fieldMetadata?.[param.name]?.required === 'boolean'
              ? effectiveContext.fieldMetadata[param.name].required
              : Array.isArray(effectiveContext.requiredFields)
                && effectiveContext.requiredFields.includes(param.name),
    }));
    requestVariants.push(common.makeRequestVariant({
      id: symbol.requestClass,
      title: symbol.requestClass,
      description: '',
      signature: `${symbol.requestClass}.builder()`,
      inputs: params,
    }, evidence, { symbol, context: effectiveContext }));
    for (const param of params) {
      const methodName = param.method || param.name || '';
      const input = { ...param, name: param.name || methodName };
      const display = param.fullSignature
        || `${methodName}(${param.type || ''} ${param.name || methodName})`;
      callableMembers.push(common.makeCallableMember('builder', {
        ...param,
        name: methodName,
      }, evidence, display, [input], { symbol, context: effectiveContext }));
    }
  }
  const result = effectiveContext.result || symbol.result || (symbol.returnType && symbol.returnType !== 'void')
    ? common.makeResult(
      effectiveContext.result || symbol.result || { type: symbol.returnType },
      evidence,
      { symbol, context: effectiveContext },
    )
    : null;
  const errors = common.makeErrors(effectiveContext.exceptions || symbol.exceptions, evidence);
  return common.buildReferenceDocument({
    symbol,
    context: effectiveContext,
    language: 'java',
    signatures,
    requestVariants,
    callableMembers,
    result,
    errors,
  });
}

module.exports = { toReferenceDocument };
