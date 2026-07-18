'use strict';

const common = require('./common');

const LEADING_QUALIFIERS = /^(?:(?:static|virtual|inline|constexpr|friend|explicit)\s+)+/;

function scanCppExpression(value, { splitCommas = false, findDefault = false } = {}) {
  const parts = [];
  let start = 0;
  let quote = null;
  let escaped = false;
  const depth = { '<': 0, '(': 0, '[': 0, '{': 0 };
  const opening = new Set(Object.keys(depth));
  const closing = { '>': '<', ')': '(', ']': '[', '}': '{' };
  const atTopLevel = () => Object.values(depth).every((valueAtDepth) => valueAtDepth === 0);

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (findDefault && character === '=' && atTopLevel()) return index;
    if (splitCommas && character === ',' && atTopLevel()) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
      continue;
    }
    if (opening.has(character)) {
      depth[character] += 1;
      continue;
    }
    const opener = closing[character];
    if (opener) {
      if (depth[opener] === 0) throw new TypeError(`unbalanced ${character}`);
      depth[opener] -= 1;
    }
  }
  if (quote || !atTopLevel()) throw new TypeError('unterminated nested expression');
  if (splitCommas) {
    parts.push(value.slice(start).trim());
    return parts;
  }
  return -1;
}

function parseRequestMemberInputs(member) {
  const fullArgStr = String(member.fullArgStr || '').trim();
  if (!fullArgStr || fullArgStr === 'void') return [];
  let argumentsList;
  try {
    argumentsList = scanCppExpression(fullArgStr, { splitCommas: true });
  } catch (error) {
    throw new TypeError(
      `Cannot parse C++ request member ${member.name || '(unknown)'} argument list "${fullArgStr}": ${error.message}`,
    );
  }
  return argumentsList.map((argument) => {
    let declaration = argument;
    try {
      const defaultIndex = scanCppExpression(argument, { findDefault: true });
      if (defaultIndex >= 0) declaration = argument.slice(0, defaultIndex).trim();
    } catch (error) {
      throw new TypeError(
        `Cannot parse C++ request member ${member.name || '(unknown)'} argument "${argument}": ${error.message}`,
      );
    }
    const match = declaration.match(/([A-Za-z_]\w*)\s*((?:\[[^\]]*\]\s*)*)$/);
    const name = match?.[1];
    const arraySuffix = match?.[2]?.trim() || '';
    let type = match ? declaration.slice(0, match.index).trim() : '';
    if (arraySuffix) type = `${type}${arraySuffix}`;
    if (!name || !type) {
      throw new TypeError(
        `Cannot parse C++ request member ${member.name || '(unknown)'} argument "${argument}"`,
      );
    }
    return { name, type, description: '' };
  });
}

function parseReturnType(symbol) {
  if (symbol.returnType) return String(symbol.returnType).trim();
  if (typeof symbol.signature !== 'string' || !symbol.name) return '';
  const escapedName = String(symbol.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = symbol.signature.trim().match(new RegExp(`^(.*?)\\b${escapedName}\\s*\\(`));
  return match ? match[1].trim().replace(LEADING_QUALIFIERS, '').trim() : '';
}

function toReferenceDocument(symbol, context = {}) {
  const kindMap = {
    method: 'method',
    function: 'function',
    class: 'class',
    struct: 'struct',
    interface: 'interface',
    enum: 'enum',
  };
  const kind = kindMap[String(symbol.kind || '').toLowerCase()];
  if (!kind) throw new TypeError(`Unsupported C++ scanner kind: ${symbol.kind}`);
  const evidence = common.collectEvidence(symbol, context);
  if (kind === 'enum') {
    const valueNotes = (symbol.params || []).map((value) => {
      const comment = value.comment ? ` — ${value.comment}` : '';
      return `${value.name} = ${value.value}${comment}`;
    });
    return common.buildReferenceDocument({
      symbol,
      context,
      language: 'cpp',
      kind,
      signatures: [],
      requestVariants: [],
      callableMembers: [],
      result: null,
      notes: [...(Array.isArray(context.notes) ? context.notes : []), ...valueNotes],
    });
  }
  const callable = ['method', 'function'].includes(kind);
  const directParams = callable && !symbol.requestClass ? symbol.params || [] : [];
  const signatures = callable
    ? [common.makeSignature(symbol.signature || '', directParams, evidence, { symbol, context })]
    : [];
  const requestFields = (symbol.params || []).map((param) => ({
    ...param,
    name: param.argName || param.name,
  }));
  let requestVariants = symbol.requestClass ? [common.makeRequestVariant({
    id: symbol.requestClass,
    title: symbol.requestClass,
    description: '',
    signature: symbol.requestClass,
    inputs: requestFields,
  }, evidence, { symbol, context })] : [];
  if (callable && !symbol.requestClass && directParams.length > 0) {
    requestVariants = [common.makeRequestVariant({
      id: 'default',
      title: `${symbol.name || ''} parameters`,
      description: '',
      signature: symbol.signature || '',
      inputs: directParams,
    }, evidence, { symbol, context })];
  }
  const callableMembers = symbol.requestClass ? (symbol.params || []).map((member) => {
    const contextualInputs = context.memberInputs?.[member.name];
    const signatureInputs = Array.isArray(contextualInputs)
      ? contextualInputs
      : Array.isArray(member.inputs)
        ? member.inputs
        : member.fullArgStr
          ? parseRequestMemberInputs(member)
          : member.argName ? [{ ...member, name: member.argName }] : [];
    return common.makeCallableMember(
      'request',
      member,
      evidence,
      member.fullSignature || `${member.name || ''}(${member.fullArgStr || ''})`,
      signatureInputs,
      { symbol, context },
    );
  }) : [];
  const inferredStatus = parseReturnType(symbol);
  const resultInput = callable
    ? context.result || symbol.result || (inferredStatus ? { type: inferredStatus } : null)
    : null;
  const result = common.makeResult(resultInput, evidence, { symbol, context });
  const errors = common.makeErrors(context.exceptions || symbol.exceptions, evidence);
  return common.buildReferenceDocument({
    symbol,
    context,
    language: 'cpp',
    kind,
    signatures,
    requestVariants,
    callableMembers,
    result,
    errors,
  });
}

module.exports = { toReferenceDocument };
