'use strict';

const common = require('./common');

// Go doc comments conventionally open with the member name ("Clone
// returns …"); house style is verb-first without the echo. Strip the
// prefix only when it is followed by a lowercase verb word — a noun
// phrase ("Name of the field") stays untouched.
const stripGoDocPrefix = (member) => {
  const raw = String(member.description || '');
  const echo = member.name ? `${member.name} ` : '';
  if (echo && raw.startsWith(echo)) {
    const rest = raw.slice(echo.length);
    const next = /^([a-z]+)/.exec(rest);
    const nounStarters = new Set(['is', 'are', 'was', 'of', 'the', 'a', 'an', 'to', 'for', 'field', 'fields']);
    if (next && !nounStarters.has(next[1])) {
      return { ...member, description: rest[0].toUpperCase() + rest.slice(1) };
    }
  }
  return member;
};

function toReferenceDocument(symbol, context = {}) {
  const kindMap = {
    method: 'method',
    function: 'function',
    struct: 'struct',
    class: 'class',
    enum: 'enum',
    interface: 'interface',
  };
  const kind = kindMap[String(symbol.kind || '').toLowerCase()];
  if (!kind) throw new TypeError(`Unsupported Go scanner kind: ${symbol.kind}`);
  const evidence = common.collectEvidence(symbol, context);
  if (kind === 'struct' || kind === 'class') {
    const signatures = symbol.signature
      ? [common.makeSignature(symbol.signature, [], evidence, { symbol, context })]
      : [];
    const requestVariants = Array.isArray(context.requestVariants)
      ? context.requestVariants.map((variant) => common.makeRequestVariant({
        ...variant,
        inputs: variant.inputs || symbol.params,
      }, evidence, { symbol, context }))
      : [];
    const callableMembers = Array.isArray(context.callableMembers)
      ? context.callableMembers.map((member) => {
        const resolvedKind = member.kind || 'option';
        return common.makeCallableMember(
          resolvedKind,
          resolvedKind === 'implementation' ? stripGoDocPrefix(member) : member,
          evidence,
          member.signature || member.fullSignature || '',
          member.inputs || [],
          { symbol, context },
        );
      })
      : [];
    // Struct pages carry real methods too (upstream **METHODS:** sections —
    // Field.GetDim): the scanner extracts them, and dropping them lost
    // content the shared page already had. They ride the same
    // callableMembers channel under the existing 'implementation' kind so
    // the renderer can label the two groups separately (BUILDER METHODS:
    // vs METHODS:) without extending the IR kind set. Scanner method
    // entries carry name/params/returnType rather than a full signature —
    // assemble the display in Go syntax, and skip methods the reviewed
    // context already provides under any kind.
    const methodSignatureDisplay = (method) => {
      if (method.fullSignature || method.signature) return method.fullSignature || method.signature;
      const params = String(method.params || '').trim();
      const returnType = String(method.returnType || '').trim();
      const returns = returnType
        ? (returnType.includes(',') ? ` (${returnType})` : ` ${returnType}`)
        : '';
      return `${method.name}(${params})${returns}`;
    };
    const structMethods = (Array.isArray(symbol.methods) ? symbol.methods : [])
      .filter((method) => method && String(method.name || '').trim() !== '')
      .filter((method) => !callableMembers.some((member) => member.name === method.name))
      .map((method) => common.makeCallableMember(
        'implementation',
        stripGoDocPrefix(method),
        evidence,
        methodSignatureDisplay(method),
        [],
        { symbol, context },
      ));
    // Struct fields without prose (Go field declarations carry no doc
    // comments) get the deterministic value-oriented sentence the result
    // channel already uses — the ⑨ content rule requires non-empty
    // descriptions on every rendered entry.
    const fieldSentence = (field) => ({
      ...field,
      description: field.description && String(field.description).trim() !== ''
        ? field.description
        : `The ${field.name} of the ${symbol.name}.`,
    });
    const resultFields = ((context.result ? context.result.fields : (symbol.fields || [])) || [])
      .map(fieldSentence);
    const result = (context.result
      ? common.makeResult({ ...context.result, fields: resultFields }, evidence, { symbol, context })
      : common.makeResult({
        type: symbol.name,
        description: symbol.docstring || '',
        fields: resultFields,
      }, evidence, { symbol, context }));
    return common.buildReferenceDocument({
      symbol,
      context,
      language: 'go',
      kind,
      signatures,
      requestVariants,
      callableMembers: [...callableMembers, ...structMethods],
      result,
    });
  }
  if (kind === 'enum') {
    const baseType = String(symbol.signature || '').match(/^type\s+\w+\s+(.+)$/)?.[1] || '';
    const signatures = symbol.signature
      ? [common.makeSignature(symbol.signature, [], evidence, { symbol, context })]
      : [];
    // Upstream enum member lines read "- **Name** = ValueExpression" with
    // the prose as a separate paragraph; the scanner (and the reviewed
    // context results built from those pages) either carry the constant in
    // value.value/defaultValue or glue "= expression prose" into the
    // description. An explicit constant wins; otherwise split the leading
    // "= expression " so the constant renders in the member header. An
    // empty constant must stay empty — a blank one previously rendered as
    // a literal `Default: `` ` qualifier on the page.
    const splitEnumConstant = (field) => {
      const constant = String(field.defaultValue ?? field.value ?? '').trim();
      const raw = String(field.description || '');
      const match = raw.match(/^\s*=\s*(\S+(?:\([^()]*\))?)\s+(.+)$/s);
      return {
        ...field,
        defaultValue: constant || (match ? match[1] : ''),
        description: match ? match[2] : raw,
      };
    };
    const reviewedResult = context.result
      ? { ...context.result, fields: (context.result.fields || []).map(splitEnumConstant) }
      : null;
    const fields = (symbol.values || []).map((value) => {
      const raw = String(value.description || '');
      const match = raw.match(/^\s*=\s*(\S+(?:\([^()]*\))?)\s+(.+)$/s);
      return {
        name: value.name,
        type: baseType,
        required: false,
        defaultValue: String(value.value ?? '').trim() || (match ? match[1] : ''),
        description: match ? match[2] : raw,
      };
    });
    const result = reviewedResult
      ? common.makeResult(reviewedResult, evidence, { symbol, context })
      : common.makeResult({
        type: symbol.name,
        description: symbol.docstring || '',
        fields,
      }, evidence, { symbol, context });
    return common.buildReferenceDocument({
      symbol,
      context,
      language: 'go',
      kind,
      signatures,
      callableMembers: [],
      result,
    });
  }
  if (kind === 'interface') {
    // The interface declaration fence (context.result.schemaCode, e.g.
    // "type Reranker interface { … }") is the page's type shape; scanner
    // method signatures are the fallback when no reviewed fence exists.
    const reviewedFence = context.result && String(context.result.schemaCode || '').trim();
    const signatures = reviewedFence
      ? [common.makeSignature(reviewedFence, [], evidence)]
      : (symbol.methods || []).map((method) => {
        const methodEvidence = common.evidenceForNode(method, symbol, context, 'member', method.name);
        return common.makeSignature(method.fullSignature || '', [], methodEvidence);
      });
    // Reviewed interface pages carry the full member set (constructors as
    // kind option, interface/implementation methods as kind implementation)
    // plus the interface fence in result.schemaCode — the type-page channel
    // renders both (2026-10-09 operator ruling: Reranker must present its
    // interface shape, constructors, and methods). Scanner methods absent
    // from the reviewed members still land in notes for traceability.
    const callableMembers = Array.isArray(context.callableMembers)
      ? context.callableMembers.map((member) => {
        const resolvedKind = member.kind || 'option';
        return common.makeCallableMember(
          resolvedKind,
          resolvedKind === 'implementation' ? stripGoDocPrefix(member) : member,
          evidence,
          member.signature || member.fullSignature || '',
          member.inputs || [],
          { symbol, context },
        );
      })
      : [];
    const reviewed = context.result ? common.makeResult(context.result, evidence, { symbol, context }) : null;
    const memberNames = new Set(callableMembers.map((member) => member.name));
    const methodNotes = (symbol.methods || [])
      .filter((method) => method.description && !memberNames.has(method.name))
      .map((method) => `${method.fullSignature} — ${method.description}`);
    return common.buildReferenceDocument({
      symbol,
      context,
      language: 'go',
      kind,
      signatures,
      callableMembers,
      result: reviewed,
      notes: [...(Array.isArray(context.notes) ? context.notes : []), ...methodNotes],
    });
  }
  // Reviewed upstream prose: the PARAMETERS section renders the canonical
  // signature inputs (scanner-derived — names, types, kind metadata, no
  // descriptions). The PR pages curate human descriptions per parameter;
  // merge them in so the section carries prose. Equal-length lists merge by
  // position: the PR PARAMETERS describe the builder's arguments in order,
  // which absorbs upstream naming drift (privileges vs privilegeNames).
  // Otherwise fall back to name matching. Scanner-side descriptions win.
  // Struct parameters (raw request structs — DumpMessages.req) carry their
  // member fields as a structured `children` array, not as field runs glued
  // into the description string: the renderer emits field.children as nested
  // bullets (upstream sub-list shape), so the merge must carry them through
  // or the sub-fields collapse into one text block (operator rejection
  // 2026-10-07, DumpMessages).
  const reviewedInputs = (Array.isArray(context.requestVariants) ? context.requestVariants : [])
    .flatMap((variant) => (Array.isArray(variant?.inputs) ? variant.inputs : []))
    .filter((input) => input && String(input.name || '').trim() !== ''
      && String(input.description || '').trim() !== '');
  const withReviewedDescriptions = (params) => {
    if (!Array.isArray(params) || reviewedInputs.length === 0) return params;
    const described = (param) => param.description && String(param.description).trim() !== '';
    const reviewedChildren = (input) => (Array.isArray(input.children) && input.children.length > 0
      ? { children: input.children }
      : {});
    if (reviewedInputs.length === params.length) {
      return params.map((param, index) => (described(param) ? param : {
        ...param,
        description: String(reviewedInputs[index].description),
        ...reviewedChildren(reviewedInputs[index]),
      }));
    }
    const byName = new Map(reviewedInputs.map((input) => [String(input.name), input]));
    return params.map((param) => (!described(param) && byName.has(String(param.name)) ? {
      ...param,
      description: String(byName.get(String(param.name)).description),
      ...reviewedChildren(byName.get(String(param.name))),
    } : param));
  };
  // Ruling 2026-10-07 (DropRole): chained builder RS forms
  // ("NewDropRoleOption(\"x\").WithForce(true)") yield NO scanner params, so
  // the canonical PARAMETERS section vanished while upstream documents the
  // option parameter. When the scanner extracted nothing, the reviewed
  // request-variant inputs ARE the parameter list (name/type/description
  // verbatim from the PR bullets).
  const canonicalInputs = (Array.isArray(symbol.params) && symbol.params.length > 0)
    ? withReviewedDescriptions(symbol.params)
    : reviewedInputs;
  const signatures = [common.makeSignature(symbol.signature || '', canonicalInputs, evidence, { symbol, context })];
  let requestVariants = [];
  if (Array.isArray(context.requestVariants)) {
    requestVariants = context.requestVariants.map((variant) => common.makeRequestVariant({
      ...variant,
      inputs: variant.inputs || symbol.params,
    }, evidence, { symbol, context }));
  } else if (context.requestSyntax) {
    const request = typeof context.requestSyntax === 'object'
      ? context.requestSyntax
      : { signature: context.requestSyntax };
    requestVariants = [common.makeRequestVariant({
      id: request.id || 'primary',
      title: request.title || '',
      description: request.description || '',
      signature: request.signature || request.display || '',
      inputs: request.inputs || symbol.params,
    }, evidence, { symbol, context })];
  }
  // Reviewed upstream BUILDER METHODS: web-content method pages curate the
  // builder/option member descriptions; prefer the reviewed context members
  // over the scanner shape (Go doc comments are frequently empty) when a
  // non-empty list is supplied.
  const callableMembers = Array.isArray(context.callableMembers) && context.callableMembers.length > 0
    ? context.callableMembers.map((member) => common.makeCallableMember(
      member.kind || 'option',
      member,
      evidence,
      member.signature || member.fullSignature || '',
      member.inputs || [],
      { symbol, context },
    ))
    : (symbol.optionMethods || []).map((member) => common.makeCallableMember(
      'option',
      member,
      evidence,
      member.fullSignature || '',
      [],
      { symbol, context },
    ));
  const result = context.result || symbol.result || symbol.returnType
    ? common.makeResult(context.result || symbol.result || { type: symbol.returnType }, evidence, { symbol, context })
    : null;
  const errors = common.makeErrors(context.exceptions || symbol.exceptions, evidence);
  return common.buildReferenceDocument({
    symbol,
    context,
    language: 'go',
    kind,
    signatures,
    requestVariants,
    callableMembers,
    result,
    errors,
  });
}

module.exports = { toReferenceDocument };
