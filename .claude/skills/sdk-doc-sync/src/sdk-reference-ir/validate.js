'use strict';

const {
  DOCUMENT_KINDS,
  LANGUAGES,
  MEMBER_KINDS,
  EVIDENCE_KINDS,
  CONFIDENCE_LEVELS,
} = require('./schema');

const MIN_EXAMPLE_CODE_LENGTH = 12;
const EXAMPLE_FENCE = /^[A-Za-z][A-Za-z0-9+.#_-]{0,31}$/;
const AUDIENCE_VALUE = /^[a-z0-9][a-z0-9.-]*$/;
const NAMED_PLACEHOLDER = /Brief description|Usage example|List relevant exceptions/i;
const TODO_WORKFLOW = /\btodo\s+(?:later|fix|pending|replace|add|update|review|implement|document|describe|example)\b/i;
const SDK_LANGUAGES = new Set(['python', 'java', 'node', 'go', 'cpp']);
const MEMBER_KIND_BY_LANGUAGE = new Map([
  ['java', 'builder'],
  ['go', 'option'],
  ['cpp', 'request'],
]);
const SIGNATURE_REQUIRED = new Set(['method', 'function', 'command', 'rest-operation']);
const EXAMPLE_REQUIRED = new Set(['method', 'function', 'class', 'command', 'rest-operation']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isSafeRelatedUrl(value) {
  if (!isNonEmptyString(value) || value !== value.trim() || /[\u0000-\u001F<>]/.test(value)) return false;
  if (value.startsWith('//')) return false;
  if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || value.startsWith('#')) return true;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'mailto:') {
      return value.slice(value.indexOf(':') + 1).split('?')[0].trim() !== '';
    }
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function containsPlaceholder(value) {
  const trimmed = value.trim();
  return /^(?:todo|tbd)$/i.test(trimmed)
    || /\bTBD\b/i.test(value)
    || /\bTODO\b/.test(value)
    || /\btodo\s*[-:]/i.test(value)
    || TODO_WORKFLOW.test(value)
    || /<!--[\s\S]*?\b(?:todo|tbd)\b[\s\S]*?-->/i.test(value)
    || NAMED_PLACEHOLDER.test(value);
}

function validateReferenceDocument(doc, { production = false, knownTypeIds = [] } = {}) {
  const errors = [];
  const warnings = [];
  const fieldActive = new WeakSet();
  const knownTypes = new Set(Array.isArray(knownTypeIds) ? knownTypeIds : []);
  if (isNonEmptyString(doc?.identity?.stableId)) knownTypes.add(doc.identity.stableId);

  function report(collection, path, message, code) {
    collection.push({ path, message, code });
  }

  function error(path, message, code) {
    report(errors, path, message, code);
  }

  function warning(path, message, code) {
    report(warnings, path, message, code);
  }

  function requireString(value, path, label, { nonEmpty = true } = {}) {
    if (typeof value !== 'string' || (nonEmpty && value.trim() === '')) {
      error(path, `${label} must be ${nonEmpty ? 'a non-empty' : 'a'} string`, 'INVALID_STRING');
      return false;
    }
    return true;
  }

  function requireArray(value, path, label) {
    if (!Array.isArray(value)) {
      error(path, `${label} must be an array`, 'INVALID_ARRAY');
      return null;
    }
    return value;
  }

  function validateEvidenceList(value, path) {
    const list = requireArray(value, path, 'evidence');
    if (!list) return;
    list.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      if (!isObject(item)) {
        error(itemPath, 'evidence must be an object', 'INVALID_EVIDENCE');
        return;
      }
      if (!EVIDENCE_KINDS.includes(item.kind)) {
        error(`${itemPath}.kind`, `unsupported evidence kind ${item.kind}`, 'INVALID_EVIDENCE_KIND');
      }
      requireString(item.locator, `${itemPath}.locator`, 'evidence locator');
      requireString(item.revision, `${itemPath}.revision`, 'evidence revision');
      if (!CONFIDENCE_LEVELS.includes(item.confidence)) {
        error(
          `${itemPath}.confidence`,
          `unsupported evidence confidence ${item.confidence}`,
          'INVALID_EVIDENCE_CONFIDENCE',
        );
      }
    });
  }

  function evidenceStatus(ownEvidence) {
    const isValid = (item) => isObject(item)
      && EVIDENCE_KINDS.includes(item.kind)
      && CONFIDENCE_LEVELS.includes(item.confidence)
      && isNonEmptyString(item.locator)
      && isNonEmptyString(item.revision);
    const hasOwnEvidence = Array.isArray(ownEvidence) && ownEvidence.length > 0;
    const own = Array.isArray(ownEvidence) ? ownEvidence.filter(isValid) : [];
    const documentEvidence = Array.isArray(doc?.evidence) ? doc.evidence.filter(isValid) : [];
    const candidates = hasOwnEvidence ? own : documentEvidence;
    const reviewed = candidates.some((item) => item.confidence === 'reviewed');
    const documentReviewed = documentEvidence.some((item) => item.confidence === 'reviewed');
    const derived = candidates.some((item) => item.confidence === 'derived');
    const direct = candidates.some((item) => item.confidence === 'direct'
      && ['source', 'openapi'].includes(item.kind));
    if (reviewed) return { valid: true, derived };
    if (direct) return { valid: true, derived };
    if (hasOwnEvidence && own.length > 0 && documentReviewed) return { valid: true, derived };
    if (derived) return { valid: false, derived: true };
    return { valid: direct, derived: false };
  }

  function requireProductionEvidence(node, path) {
    if (!production) return;
    const status = evidenceStatus(node?.evidence);
    if (status.valid) return;
    error(
      `${path}.evidence`,
      status.derived
        ? 'derived content requires reviewed evidence at this node or document level'
        : 'authored content requires direct source/OpenAPI evidence or reviewed evidence',
      status.derived ? 'MISSING_REVIEWED_EVIDENCE' : 'MISSING_EVIDENCE',
    );
  }

  function validateType(type, path) {
    if (!isObject(type)) {
      error(path, 'type must be an object', 'INVALID_TYPE');
      return;
    }
    requireString(type.display, `${path}.display`, 'type display');
    const references = requireArray(type.references, `${path}.references`, 'type references');
    if (!references) return;
    const ids = new Map();
    references.forEach((reference, index) => {
      const referencePath = `${path}.references[${index}]`;
      if (!isObject(reference)) {
        error(referencePath, 'type reference must be an object', 'INVALID_TYPE_REFERENCE');
        return;
      }
      const validId = requireString(reference.id, `${referencePath}.id`, 'type reference ID');
      let duplicateId = false;
      if (validId) {
        if (ids.has(reference.id)) {
          duplicateId = true;
          error(
            `${referencePath}.id`,
            `type reference ID ${reference.id} duplicates ${ids.get(reference.id)}`,
            'DUPLICATE_TYPE_REFERENCE_ID',
          );
        } else {
          ids.set(reference.id, `${referencePath}.id`);
        }
      }
      let validDisplay = true;
      if (reference.display !== undefined) {
        validDisplay = requireString(
          reference.display,
          `${referencePath}.display`,
          'type reference display',
          { nonEmpty: false },
        );
      }
      if (typeof reference.external !== 'boolean') {
        error(`${referencePath}.external`, 'external must be a boolean', 'INVALID_TYPE_REFERENCE');
      } else if (reference.external && validId && validDisplay && !duplicateId) {
        warning(
          referencePath,
          `external type reference ${reference.id || '(unknown)'} cannot be resolved locally`,
          'EXTERNAL_TYPE_REFERENCE',
        );
      } else if (production && validId && !knownTypes.has(reference.id)) {
        error(
          `${referencePath}.id`,
          `internal type reference ${reference.id} is not in knownTypeIds`,
          'UNRESOLVED_TYPE_REFERENCE',
        );
      }
    });
  }

  function validateFieldList(value, path) {
    const fields = requireArray(value, path, 'fields');
    if (!fields) return;
    const names = new Map();
    fields.forEach((field, index) => {
      const fieldPath = `${path}[${index}]`;
      if (isObject(field) && isNonEmptyString(field.name)) {
        if (names.has(field.name)) {
          error(
            `${fieldPath}.name`,
            `field name ${field.name} duplicates ${names.get(field.name)}`,
            'DUPLICATE_FIELD_NAME',
          );
        } else {
          names.set(field.name, `${path}[${index}].name`);
        }
      }
      validateField(field, fieldPath);
    });
  }

  function validateField(field, path) {
    if (!isObject(field)) {
      error(path, 'field must be an object', 'INVALID_FIELD');
      return;
    }
    if (fieldActive.has(field)) {
      error(path, 'recursive field graph contains a cycle', 'FIELD_CYCLE');
      return;
    }
    fieldActive.add(field);
    requireString(field.name, `${path}.name`, 'field name');
    validateType(field.type, `${path}.type`);
    if (typeof field.required !== 'boolean') {
      error(`${path}.required`, 'required must be a boolean', 'INVALID_FIELD');
    }
    if (field.allowRequiredDefault !== undefined && typeof field.allowRequiredDefault !== 'boolean') {
      error(`${path}.allowRequiredDefault`, 'allowRequiredDefault must be a boolean', 'INVALID_FIELD');
    }
    if (typeof field.description !== 'string') {
      error(`${path}.description`, 'field description must be a string', 'INVALID_FIELD');
    }
    const constraints = requireArray(field.constraints, `${path}.constraints`, 'field constraints');
    constraints?.forEach((constraint, index) => {
      requireString(constraint, `${path}.constraints[${index}]`, 'field constraint');
    });
    if (field.appliesWhen !== null && typeof field.appliesWhen !== 'string') {
      error(`${path}.appliesWhen`, 'appliesWhen must be null or a string', 'INVALID_FIELD');
    }
    validateEvidenceList(field.evidence, `${path}.evidence`);
    validateFieldList(field.children, `${path}.children`);
    if (production && field.required === true && field.defaultValue !== null
      && field.defaultValue !== undefined && field.allowRequiredDefault !== true) {
      error(
        `${path}.defaultValue`,
        'required fields cannot have a non-null default without allowRequiredDefault',
        'REQUIRED_FIELD_DEFAULT',
      );
    }
    requireProductionEvidence(field, path);
    fieldActive.delete(field);
  }

  function validateSignature(signature, path) {
    if (!isObject(signature)) {
      error(path, 'signature must be an object', 'INVALID_SIGNATURE');
      return;
    }
    requireString(signature.display, `${path}.display`, 'signature display');
    validateFieldList(signature.inputs, `${path}.inputs`);
    validateEvidenceList(signature.evidence, `${path}.evidence`);
    requireProductionEvidence(signature, path);
  }

  function validateRequestVariants(value, path) {
    const variants = requireArray(value, path, 'request variants');
    if (!variants) return;
    const ids = new Map();
    variants.forEach((variant, index) => {
      const variantPath = `${path}[${index}]`;
      if (!isObject(variant)) {
        error(variantPath, 'request variant must be an object', 'INVALID_REQUEST_VARIANT');
        return;
      }
      if (requireString(variant.id, `${variantPath}.id`, 'request variant ID')) {
        if (ids.has(variant.id)) {
          error(
            `${variantPath}.id`,
            `request variant ID ${variant.id} duplicates ${ids.get(variant.id)}`,
            'DUPLICATE_VARIANT_ID',
          );
        } else {
          ids.set(variant.id, `${variantPath}.id`);
        }
      }
      if (typeof variant.title !== 'string') {
        error(`${variantPath}.title`, 'request variant title must be a string', 'INVALID_REQUEST_VARIANT');
      }
      if (typeof variant.description !== 'string') {
        error(`${variantPath}.description`, 'request variant description must be a string', 'INVALID_REQUEST_VARIANT');
      }
      validateSignature(variant.signature, `${variantPath}.signature`);
      validateFieldList(variant.inputs, `${variantPath}.inputs`);
      validateEvidenceList(variant.evidence, `${variantPath}.evidence`);
      requireProductionEvidence(variant, variantPath);
    });
  }

  function validateCallableMembers(value, path) {
    const members = requireArray(value, path, 'callable members');
    if (!members) return;
    const keys = new Map();
    members.forEach((member, index) => {
      const memberPath = `${path}[${index}]`;
      if (!isObject(member)) {
        error(memberPath, 'callable member must be an object', 'INVALID_CALLABLE_MEMBER');
        return;
      }
      if (MEMBER_KINDS.includes(member.kind) && isNonEmptyString(member.name)) {
        const key = JSON.stringify([member.kind, member.name]);
        if (keys.has(key)) {
          error(
            memberPath,
            `callable member ${member.kind}:${member.name} duplicates ${keys.get(key)}`,
            'DUPLICATE_CALLABLE_MEMBER',
          );
        } else {
          keys.set(key, memberPath);
        }
      }
      if (!MEMBER_KINDS.includes(member.kind)) {
        error(`${memberPath}.kind`, `unsupported callable member kind ${member.kind}`, 'INVALID_MEMBER_KIND');
      }
      requireString(member.name, `${memberPath}.name`, 'callable member name');
      if (typeof member.description !== 'string') {
        error(`${memberPath}.description`, 'callable member description must be a string', 'INVALID_CALLABLE_MEMBER');
      }
      validateSignature(member.signature, `${memberPath}.signature`);
      validateEvidenceList(member.evidence, `${memberPath}.evidence`);
      requireProductionEvidence(member, memberPath);
    });
  }

  function validateResult(result, path) {
    if (result === null) return;
    if (!isObject(result)) {
      error(path, 'result must be null or an object', 'INVALID_RESULT');
      return;
    }
    validateType(result.type, `${path}.type`);
    if (typeof result.description !== 'string') {
      error(`${path}.description`, 'result description must be a string', 'INVALID_RESULT');
    }
    validateFieldList(result.fields, `${path}.fields`);
    validateEvidenceList(result.evidence, `${path}.evidence`);
    requireProductionEvidence(result, path);
  }

  function validateErrors(value, path) {
    const items = requireArray(value, path, 'errors');
    if (!items) return;
    items.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      if (!isObject(item)) {
        error(itemPath, 'error entry must be an object', 'INVALID_ERROR');
        return;
      }
      requireString(item.name, `${itemPath}.name`, 'error name');
      requireString(item.condition, `${itemPath}.condition`, 'error condition');
      requireString(item.description, `${itemPath}.description`, 'error description');
      validateEvidenceList(item.evidence, `${itemPath}.evidence`);
      requireProductionEvidence(item, itemPath);
    });
  }

  function validateExamples(value, path) {
    const items = requireArray(value, path, 'examples');
    if (!items) return;
    items.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      if (!isObject(item)) {
        error(itemPath, 'example must be an object', 'INVALID_EXAMPLE');
        return;
      }
      requireString(item.title, `${itemPath}.title`, 'example title');
      if (typeof item.description !== 'string') {
        error(`${itemPath}.description`, 'example description must be a string', 'INVALID_EXAMPLE');
      }
      if (!LANGUAGES.includes(item.language)) {
        error(`${itemPath}.language`, `unsupported example language ${item.language}`, 'INVALID_EXAMPLE_LANGUAGE');
      }
      if (typeof item.code !== 'string') {
        error(`${itemPath}.code`, 'example code must be a string', 'INVALID_EXAMPLE');
      } else {
        if (production && item.code.trim() === '') {
          error(`${itemPath}.code`, 'production examples must contain code', 'EMPTY_EXAMPLE_CODE');
        }
        if (item.code.trim() !== '' && item.code.trim().length < MIN_EXAMPLE_CODE_LENGTH) {
          warning(
            `${itemPath}.code`,
            `example code is shorter than ${MIN_EXAMPLE_CODE_LENGTH} characters`,
            'SHALLOW_EXAMPLE',
          );
        }
      }
      if (item.fence !== undefined
        && (typeof item.fence !== 'string' || !EXAMPLE_FENCE.test(item.fence))) {
        error(
          `${itemPath}.fence`,
          'example fence must be a conservative language identifier',
          'INVALID_EXAMPLE_FENCE',
        );
      }
      validateEvidenceList(item.evidence, `${itemPath}.evidence`);
      requireProductionEvidence(item, itemPath);
    });
  }

  function validateRelated(value, path) {
    const items = requireArray(value, path, 'related links');
    if (!items) return;
    if (items.length === 0) warning(path, 'reference document has no related links', 'MISSING_RELATED_LINKS');
    items.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      if (!isObject(item)) {
        error(itemPath, 'related link must be an object', 'INVALID_RELATED_LINK');
        return;
      }
      requireString(item.title, `${itemPath}.title`, 'related link title');
      if (!isSafeRelatedUrl(item.url)) {
        error(`${itemPath}.url`, 'related link URL must be a safe usable destination', 'INVALID_RELATED_LINK');
      }
    });
  }

  function validateAudienceVariants(value, path) {
    const variants = requireArray(value, path, 'audience variants');
    if (!variants) return;
    const audiences = new Map();
    variants.forEach((variant, index) => {
      const variantPath = `${path}[${index}]`;
      if (!isObject(variant)) {
        error(variantPath, 'audience variant must be an object', 'INVALID_AUDIENCE_VARIANT');
        return;
      }
      if (typeof variant.audience !== 'string' || !AUDIENCE_VALUE.test(variant.audience)) {
        error(
          `${variantPath}.audience`,
          'audience must be a lowercase identifier using letters, digits, dot, or hyphen',
          'INVALID_AUDIENCE',
        );
      } else if (audiences.has(variant.audience)) {
        error(
          `${variantPath}.audience`,
          `audience ${variant.audience} duplicates ${audiences.get(variant.audience)}`,
          'DUPLICATE_AUDIENCE',
        );
      } else {
        audiences.set(variant.audience, `${variantPath}.audience`);
      }
      if (typeof variant.summary !== 'string') {
        error(`${variantPath}.summary`, 'audience summary must be a string', 'INVALID_AUDIENCE_VARIANT');
      }
      if (variant.evidence !== undefined) validateEvidenceList(variant.evidence, `${variantPath}.evidence`);
      requireProductionEvidence(variant, variantPath);
    });
  }

  function scanPlaceholders(value, path, seen = new WeakSet(), skip = false) {
    if (!production) return;
    if (typeof value === 'string') {
      if (!skip && containsPlaceholder(value)) {
        error(path, 'production authored content contains placeholder text', 'PLACEHOLDER_CONTENT');
      }
      return;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, index) => scanPlaceholders(item, `${path}[${index}]`, seen, skip));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const childSkip = skip || ['evidence', 'identity', 'source', 'type'].includes(key);
      scanPlaceholders(child, `${path}.${key}`, seen, childSkip);
    }
  }

  if (!isObject(doc)) {
    error('$', 'reference document must be an object', 'INVALID_DOCUMENT');
    return { valid: false, errors, warnings };
  }

  if (doc.schemaVersion !== 1) {
    error('$.schemaVersion', 'schemaVersion must be 1', 'INVALID_SCHEMA_VERSION');
  }

  if (!isObject(doc.identity)) {
    error('$.identity', 'identity must be an object', 'INVALID_IDENTITY');
  } else {
    if (!DOCUMENT_KINDS.includes(doc.identity.kind)) {
      error('$.identity.kind', `unsupported document kind ${doc.identity.kind}`, 'INVALID_DOCUMENT_KIND');
    }
    if (!LANGUAGES.includes(doc.identity.language)) {
      error('$.identity.language', `unsupported language ${doc.identity.language}`, 'INVALID_LANGUAGE');
    }
    requireString(doc.identity.name, '$.identity.name', 'identity name');
    requireString(doc.identity.title, '$.identity.title', 'identity title');
    requireString(doc.identity.stableId, '$.identity.stableId', 'identity stableId');
  }

  if (!isObject(doc.source)) {
    error('$.source', 'source must be an object', 'INVALID_SOURCE');
  } else {
    requireString(doc.source.repository, '$.source.repository', 'source repository');
    requireString(doc.source.revision, '$.source.revision', 'source revision');
    requireString(doc.source.file, '$.source.file', 'source file');
    if (!Number.isInteger(doc.source.line) || doc.source.line < 1) {
      error('$.source.line', 'source line must be a positive integer', 'INVALID_SOURCE_LINE');
    }
  }

  if (typeof doc.summary !== 'string') error('$.summary', 'summary must be a string', 'INVALID_SUMMARY');
  if (doc.exampleOptional !== undefined && typeof doc.exampleOptional !== 'boolean') {
    error('$.exampleOptional', 'exampleOptional must be a boolean', 'INVALID_DOCUMENT');
  }
  const signatures = requireArray(doc.signatures, '$.signatures', 'signatures');
  signatures?.forEach((signature, index) => validateSignature(signature, `$.signatures[${index}]`));
  validateRequestVariants(doc.requestVariants, '$.requestVariants');
  validateCallableMembers(doc.callableMembers, '$.callableMembers');
  validateResult(doc.result, '$.result');
  validateErrors(doc.errors, '$.errors');
  validateExamples(doc.examples, '$.examples');

  const notes = requireArray(doc.notes, '$.notes', 'notes');
  notes?.forEach((note, index) => requireString(note, `$.notes[${index}]`, 'note'));
  validateRelated(doc.related, '$.related');
  validateAudienceVariants(doc.audienceVariants, '$.audienceVariants');
  validateEvidenceList(doc.evidence, '$.evidence');

  if (production) {
    scanPlaceholders(doc, '$');
    if (!isNonEmptyString(doc.summary)) {
      error('$.summary', 'production reference documents require a summary', 'MISSING_SUMMARY');
    } else {
      requireProductionEvidence(doc, '$');
    }
    const kind = doc.identity?.kind;
    const language = doc.identity?.language;
    const expectedLanguage = kind === 'command' ? 'zilliz-cli' : kind === 'rest-operation' ? 'rest' : null;
    const compatibleLanguage = expectedLanguage ? language === expectedLanguage : SDK_LANGUAGES.has(language);
    if (DOCUMENT_KINDS.includes(kind) && LANGUAGES.includes(language) && !compatibleLanguage) {
      error(
        '$.identity.language',
        `${kind} documents are not compatible with ${language}`,
        'INCOMPATIBLE_DOCUMENT_LANGUAGE',
      );
    }
    if (Array.isArray(doc.callableMembers)) {
      const allowedMemberKind = MEMBER_KIND_BY_LANGUAGE.get(language);
      doc.callableMembers.forEach((member, index) => {
        if (!isObject(member) || !MEMBER_KINDS.includes(member.kind)) return;
        if (member.kind !== allowedMemberKind) {
          error(
            `$.callableMembers[${index}].kind`,
            allowedMemberKind
              ? `${language} callable members must use kind ${allowedMemberKind}`
              : `${language} documents must not define callable members`,
            'INCOMPATIBLE_MEMBER_KIND',
          );
        }
      });
    }
    if (SIGNATURE_REQUIRED.has(kind) && (!Array.isArray(doc.signatures) || doc.signatures.length === 0)) {
      error('$.signatures', `${kind} documents require at least one signature`, 'MISSING_SIGNATURE');
    }
    if (EXAMPLE_REQUIRED.has(kind)
      && (!Array.isArray(doc.examples) || doc.examples.length === 0)
      && !(kind === 'class' && doc.exampleOptional === true)) {
      error('$.examples', `${kind} documents require at least one example`, 'MISSING_EXAMPLE');
    }
    if (kind === 'command') {
      if (doc.result !== null && doc.result !== undefined) {
        error('$.result', 'command documents must not define SDK result sections', 'COMMAND_FORBIDDEN_RESULT');
      }
      if (Array.isArray(doc.errors) && doc.errors.length > 0) {
        error('$.errors', 'command documents must not define SDK error sections', 'COMMAND_FORBIDDEN_ERRORS');
      }
    }
    if (kind === 'enum') {
      if (Array.isArray(doc.requestVariants) && doc.requestVariants.length > 0) {
        error('$.requestVariants', 'enum documents must not define request variants', 'ENUM_FORBIDDEN_VARIANTS');
      }
      if (Array.isArray(doc.callableMembers) && doc.callableMembers.length > 0) {
        error('$.callableMembers', 'enum documents must not define callable members', 'ENUM_FORBIDDEN_MEMBERS');
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

module.exports = { validateReferenceDocument, MIN_EXAMPLE_CODE_LENGTH };
