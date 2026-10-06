'use strict';

const common = require('./common');

// 2026-10-06 python style ruling: parameter types render italic via the
// renderer's (*type*) wrap — reviewed contexts must not carry literal
// emphasis markers, or the wrap double-nests them into (*\*type\**).
function stripEmphasisMarkers(type) {
  if (typeof type !== 'string') return type;
  return type.replace(/^\*+|\*+$/g, '').trim();
}

function normalizePythonParam(param) {
  if (!param || typeof param !== 'object') return param;
  if ((param.kind === 'kwargs' || param.kind === 'varargs') && !param.type) {
    return { ...param, type: 'Any' };
  }
  return { ...param, type: stripEmphasisMarkers(param.type) };
}

function normalizePythonSymbol(symbol) {
  if (!symbol || typeof symbol !== 'object' || !Array.isArray(symbol.params)) return symbol;
  return {
    ...symbol,
    params: symbol.params.map(normalizePythonParam),
  };
}

function docstringParamDescriptions(docstring) {
  const descriptions = new Map();
  let inParameters = false;
  let currentName = null;
  for (const line of String(docstring || '').split(/\r?\n/)) {
    if (/^\s*(?:Args|Arguments|Parameters):\s*$/.test(line)) {
      inParameters = true;
      currentName = null;
      continue;
    }
    if (!inParameters) continue;
    if (/^\s*(?:Returns?|Raises?|Examples?|Notes?|Yields?):\s*$/.test(line)) break;
    const entry = line.match(/^\s*(\*{0,2}[A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*:\s*(.*)$/);
    if (entry) {
      currentName = entry[1].replace(/^\*+/, '');
      descriptions.set(currentName, entry[2].trim());
      continue;
    }
    const continuation = line.trim();
    if (currentName && continuation) {
      descriptions.set(currentName, `${descriptions.get(currentName)} ${continuation}`.trim());
    }
  }
  return descriptions;
}

function applyDocstringParamDescriptions(params, docstring) {
  const descriptions = docstringParamDescriptions(docstring);
  return (params || []).map((param) => {
    if (!param || param.description || param.descriptions || !descriptions.has(param.name)) return param;
    return { ...param, description: descriptions.get(param.name) };
  });
}

function requestVariantInputs(params, names) {
  if (!Array.isArray(names) || names.length === 0) return params;
  const byName = new Map(params.map((param) => [param.name, param]));
  return names.map((name) => byName.get(name) || {
    name,
    type: '',
    description: '',
  });
}

// 2026-10-06 python style ruling: the request payload renders one parameter
// per line in the bare call form (upstream mirror baseline, e.g. alter_role /
// create_role): no `async def`/`def` prefix, no `self`/`cls` input. Scanner
// signatures arrive flattened to one line; anything already multiline or not
// signature-shaped passes through unchanged.
function splitTopLevelParams(payload) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (const character of payload) {
    if (quote) {
      current += character;
      if (character === quote && !current.endsWith(`\\${quote}`)) quote = null;
      continue;
    }
    if (character === '\'' || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === '(' || character === '[' || character === '{') depth += 1;
    if (character === ')' || character === ']' || character === '}') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim() !== '') parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

function rebuildBareCallSignature(name, payload, returnType) {
  const params = splitTopLevelParams(payload)
    .filter((param) => !/^(self|cls)(\s*:\s*[A-Za-z_][\w.[\]]*)?$/.test(param));
  if (params.length === 0) {
    return returnType ? `${name}() -> ${returnType}` : `${name}()`;
  }
  const suffix = returnType ? `) -> ${returnType}` : ')';
  return `${name}(\n${params.map((param) => `    ${param}`).join(',\n')}\n${suffix}`;
}

function formatPythonSignatureDisplay(display) {
  if (typeof display !== 'string' || display.includes('\n')) return display;
  const match = display
    .match(/^(?:(?:async\s+)?def\s+)?([A-Za-z_]\w*)\s*\((.*)\)(?:\s*->\s*([^:]*))?:?$/);
  if (!match) return display;
  return rebuildBareCallSignature(match[1], match[2], match[3] ? match[3].trim() : null);
}

function toReferenceDocument(symbol, context = {}) {
  symbol = normalizePythonSymbol(symbol);
  const kindMap = {
    method: 'method',
    function: 'function',
    class: 'class',
    enum: 'enum',
    constant: 'enum',
  };
  const kind = kindMap[String(symbol.kind || '').toLowerCase()];
  if (!kind) throw new TypeError(`Unsupported Python scanner kind: ${symbol.kind}`);
  const evidence = common.collectEvidence(symbol, context);
  const reviewedParams = Array.isArray(context.params)
    ? context.params.map(normalizePythonParam)
    : null;
  const params = applyDocstringParamDescriptions(reviewedParams || symbol.params, symbol.docstring);
  const signature = formatPythonSignatureDisplay(context.signature ?? symbol.signature ?? '');
  const callable = ['method', 'function'].includes(kind)
    || (['class'].includes(kind) && (reviewedParams !== null || context.signature !== undefined));
  const inputs = callable
    ? common.normalizeFields(params, evidence, { symbol, context })
    : [];
  const signatures = callable
    ? [common.makeSignature(signature, params, evidence, { symbol, context })]
    : [];
  let requestVariants = [];
  if (callable && Array.isArray(context.requestVariants) && context.requestVariants.length > 0) {
    requestVariants = context.requestVariants.map((variant) => {
      const variantInputs = requestVariantInputs(params, variant.parameters);
      return common.makeRequestVariant({
        ...variant,
        inputs: variantInputs,
        signatureInputs: variantInputs,
      }, evidence, { symbol, context });
    });
  } else if (callable && inputs.length > 0) {
    requestVariants = [common.makeRequestVariant({
      id: 'primary',
      title: `${symbol.name || ''} parameters`,
      description: '',
      signature,
      inputs: params,
    }, evidence, { symbol, context })];
  }
  // House baseline (java 'void 无段' + 2026-10-03 five rules): a void return
  // renders no result section at all — folded result-class __init__ symbols
  // carry '-> None' annotations that would otherwise draw a RETURNS label
  // and trip RETURNS_MIN_DEPTH (response fields are for real payloads).
  const voidOnlyReturn = typeof symbol.returnType === 'string'
    && /^(none|void|nonetype)$/i.test(symbol.returnType.trim());
  const resultSource = context.result
    || symbol.result
    || (symbol.returnType && !voidOnlyReturn ? { type: symbol.returnType } : null);
  const result = callable && resultSource
    ? common.makeResult(resultSource, evidence, { symbol, context })
    : null;
  const errors = callable ? common.makeErrors(context.exceptions || symbol.exceptions, evidence) : [];
  const notes = [...(Array.isArray(context.notes) ? context.notes : [])];
  // Signature lines render as a note for top-level functions and for
  // constants (assignment form, e.g. 'DEFAULT_TIMEOUT = 30' — pinned
  // behavior). Class-form kinds (enum/class) expose their members through
  // the members channel instead; a 'class X(IntEnum):' note line would only
  // leak a bare Notes section.
  if (!callable && (kind === 'function' || symbol.kind === 'constant') && symbol.signature) {
    notes.push(symbol.signature);
  }
  // 2026-10-06 Volume ruling: enums expose their values and classes their
  // methods through reviewed context.members (kind 'member' | 'method').
  const callableMembers = Array.isArray(context.members)
    ? context.members.map((member) => common.makeCallableMember(
      member.kind === 'method' ? 'method' : 'member',
      member,
      evidence,
      member.signature || member.name,
      [],
      { symbol, context },
    ))
    : [];
  return common.buildReferenceDocument({
    symbol,
    context,
    language: 'python',
    kind,
    signatures,
    requestVariants,
    callableMembers,
    result,
    errors,
    notes,
  });
}

module.exports = { toReferenceDocument };
