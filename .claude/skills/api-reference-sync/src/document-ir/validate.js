'use strict';

const { languageId } = require('./block-registry');

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'unorderedList',
  'orderedList',
  'codeBlock',
  'table',
  'callout',
  'audience',
  'media',
  'opaque',
]);
const INLINE_TYPES = new Set(['text', 'citation', 'documentReference']);
const MARKS = new Set(['bold', 'italic', 'strikethrough', 'inlineCode', 'underline']);
const CALLOUT_KINDS = new Set(['note', 'info', 'tip', 'warning', 'danger']);
const AUDIENCE_TARGET = /^[A-Za-z0-9._-]+$/;

function isSafeUrl(value) {
  if (typeof value !== 'string' || value === '' || /[\u0000-\u001F<>]/.test(value)) return false;
  if (value.trim() !== value || value.startsWith('//')) return false;
  if (value.startsWith('#')) return value.length > 1;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  if (value.startsWith('./') || value.startsWith('../')) return true;
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return true;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      || (url.protocol === 'mailto:' && url.pathname.length > 0);
  } catch {
    return false;
  }
}

function structurallyEqual(left, right, seen = new WeakMap()) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (seen.get(left) === right) return true;
  seen.set(left, right);
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) return false;
  return leftKeys.every((key) => structurallyEqual(left[key], right[key], seen));
}

function validateDocumentIr(ir, { lossless = true } = {}) {
  const errors = [];
  const warnings = [];
  const sourceIds = new Map();
  const active = new WeakSet();

  function report(collection, path, message, code) {
    collection.push({ path, message, code });
  }

  function checkSourceId(node, path) {
    if (node.sourceId === undefined) return;
    if (typeof node.sourceId !== 'string' || node.sourceId === '') {
      report(errors, `${path}.sourceId`, 'sourceId must be a non-empty string', 'INVALID_SOURCE_ID');
      return;
    }
    const previous = sourceIds.get(node.sourceId);
    if (previous && !structurallyEqual(previous.node, node)) {
      report(
        errors,
        `${path}.sourceId`,
        `sourceId ${node.sourceId} identifies conflicting nodes (first seen at ${previous.path})`,
        'CONFLICTING_SOURCE_ID',
      );
    } else if (!previous) {
      sourceIds.set(node.sourceId, { node, path });
    }
  }

  function requireArray(node, field, path) {
    if (!Array.isArray(node[field])) {
      report(errors, `${path}.${field}`, `${field} must be an array`, 'INVALID_CHILDREN');
      return null;
    }
    return node[field];
  }

  function visitChildren(children, path, allowed) {
    children.forEach((child, index) => {
      const childPath = `${path}[${index}]`;
      if (!child || typeof child !== 'object' || !allowed.has(child.type)) {
        report(errors, childPath, `child type ${child?.type || typeof child} is not allowed here`, 'INVALID_CHILD_TYPE');
        return;
      }
      visit(child, childPath);
    });
  }

  function visit(node, path) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      report(errors, path, 'node must be an object', 'INVALID_NODE');
      return;
    }
    if (typeof node.type !== 'string') {
      report(errors, `${path}.type`, 'node type must be a string', 'INVALID_NODE_TYPE');
      return;
    }
    if (active.has(node)) {
      report(errors, path, 'IR node graph contains a cycle', 'IR_CYCLE');
      return;
    }
    active.add(node);
    checkSourceId(node, path);

    switch (node.type) {
      case 'document': {
        const children = requireArray(node, 'children', path);
        if (children) visitChildren(children, `${path}.children`, BLOCK_TYPES);
        break;
      }
      case 'paragraph':
      case 'heading': {
        if (node.type === 'heading' && (!Number.isInteger(node.level) || node.level < 1 || node.level > 6)) {
          report(errors, `${path}.level`, 'heading level must be an integer from 1 to 6', 'INVALID_HEADING_LEVEL');
        }
        const children = requireArray(node, 'children', path);
        if (children) visitChildren(children, `${path}.children`, INLINE_TYPES);
        break;
      }
      case 'text':
        if (typeof node.value !== 'string') report(errors, `${path}.value`, 'text value must be a string', 'INVALID_TEXT');
        if (!Array.isArray(node.marks)) {
          report(errors, `${path}.marks`, 'text marks must be an array', 'INVALID_MARKS');
        } else if (node.marks.some((mark) => typeof mark !== 'string' || !MARKS.has(mark)) || new Set(node.marks).size !== node.marks.length) {
          report(errors, `${path}.marks`, 'text marks must contain unique supported strings', 'INVALID_MARKS');
        }
        break;
      case 'citation':
      case 'documentReference':
        if (typeof node.title !== 'string' || node.title === '') report(errors, `${path}.title`, 'reference title must be a non-empty string', 'INVALID_REFERENCE');
        if (!isSafeUrl(node.url)) report(errors, `${path}.url`, 'reference URL must be a safe usable destination', 'INVALID_REFERENCE');
        break;
      case 'unorderedList':
      case 'orderedList': {
        const items = requireArray(node, 'items', path);
        if (items) visitChildren(items, `${path}.items`, new Set(['listItem']));
        break;
      }
      case 'listItem': {
        const children = requireArray(node, 'children', path);
        if (children) visitChildren(children, `${path}.children`, new Set(['paragraph', 'unorderedList', 'orderedList', 'audience']));
        break;
      }
      case 'codeBlock':
        if (typeof node.value !== 'string') report(errors, `${path}.value`, 'code value must be a string', 'INVALID_CODE');
        if (languageId(node.language) === null) {
          report(errors, `${path}.language`, `unknown code language ${node.language}`, 'UNKNOWN_CODE_LANGUAGE');
        }
        break;
      case 'table': {
        const rows = requireArray(node, 'rows', path);
        if (rows) {
          if (rows.length === 0) report(errors, `${path}.rows`, 'table must contain at least one row', 'INVALID_TABLE');
          const widths = rows.map((row) => Array.isArray(row?.cells) ? row.cells.length : null);
          if (widths.some((width) => width === 0) || (widths.length > 1 && widths.some((width) => width !== widths[0]))) {
            report(errors, `${path}.rows`, 'table rows must be non-empty and rectangular', 'INVALID_TABLE');
          }
          visitChildren(rows, `${path}.rows`, new Set(['tableRow']));
        }
        break;
      }
      case 'tableRow': {
        const cells = requireArray(node, 'cells', path);
        if (cells) visitChildren(cells, `${path}.cells`, new Set(['tableCell']));
        break;
      }
      case 'tableCell':
      case 'callout':
      case 'audience': {
        if (node.type === 'callout' && !CALLOUT_KINDS.has(node.kind)) {
          report(errors, `${path}.kind`, 'callout kind must be note, info, tip, warning, or danger', 'INVALID_CALLOUT');
        }
        if (node.type === 'audience') {
          if (!['include', 'exclude'].includes(node.mode)) report(errors, `${path}.mode`, 'audience mode must be include or exclude', 'INVALID_AUDIENCE');
          if (typeof node.target !== 'string' || !AUDIENCE_TARGET.test(node.target)) report(errors, `${path}.target`, 'audience target must use only letters, digits, dot, underscore, or hyphen', 'INVALID_AUDIENCE');
        }
        const children = requireArray(node, 'children', path);
        if (children) visitChildren(children, `${path}.children`, BLOCK_TYPES);
        break;
      }
      case 'media':
        if (typeof node.kind !== 'string' || node.kind === '') report(errors, `${path}.kind`, 'media kind must be non-empty', 'INVALID_MEDIA');
        if ((typeof node.token !== 'string' || node.token === '') && !isSafeUrl(node.url)) {
          report(errors, path, 'media must have a token or safe URL', 'INVALID_MEDIA');
        }
        break;
      case 'opaque':
        if (lossless) report(errors, path, 'opaque node is not allowed in lossless mode', 'OPAQUE_NODE');
        else report(warnings, path, 'opaque node will be rendered as an unsupported marker', 'OPAQUE_NODE');
        break;
      default:
        report(errors, `${path}.type`, `unknown node type ${node.type}`, 'UNKNOWN_NODE_TYPE');
    }
    active.delete(node);
  }

  if (!ir || ir.type !== 'document') {
    report(errors, '$.type', 'root node must be a document', 'INVALID_DOCUMENT');
  } else {
    visit(ir, '$');
  }

  return { valid: errors.length === 0, errors, warnings };
}

module.exports = { validateDocumentIr, isSafeUrl };
