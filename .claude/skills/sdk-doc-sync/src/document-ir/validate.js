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

function validateDocumentIr(ir, { lossless = true } = {}) {
  const errors = [];
  const warnings = [];
  const sourceIds = new Map();

  function report(collection, path, message, code) {
    collection.push({ path, message, code });
  }

  function checkSourceId(node, path) {
    if (node.sourceId === undefined) return;
    if (typeof node.sourceId !== 'string' || node.sourceId === '') {
      report(errors, `${path}.sourceId`, 'sourceId must be a non-empty string', 'INVALID_SOURCE_ID');
      return;
    }
    const fingerprint = JSON.stringify(node);
    const previous = sourceIds.get(node.sourceId);
    if (previous && previous.fingerprint !== fingerprint) {
      report(
        errors,
        `${path}.sourceId`,
        `sourceId ${node.sourceId} identifies conflicting nodes (first seen at ${previous.path})`,
        'CONFLICTING_SOURCE_ID',
      );
    } else if (!previous) {
      sourceIds.set(node.sourceId, { fingerprint, path });
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
    checkSourceId(node, path);

    switch (node.type) {
      case 'document': {
        const children = requireArray(node, 'children', path);
        if (children) visitChildren(children, `${path}.children`, BLOCK_TYPES);
        break;
      }
      case 'paragraph':
      case 'heading': {
        if (node.type === 'heading' && (!Number.isInteger(node.level) || node.level < 1 || node.level > 9)) {
          report(errors, `${path}.level`, 'heading level must be an integer from 1 to 9', 'INVALID_HEADING_LEVEL');
        }
        const children = requireArray(node, 'children', path);
        if (children) visitChildren(children, `${path}.children`, INLINE_TYPES);
        break;
      }
      case 'text':
        if (typeof node.value !== 'string') report(errors, `${path}.value`, 'text value must be a string', 'INVALID_TEXT');
        if (!Array.isArray(node.marks)) report(errors, `${path}.marks`, 'text marks must be an array', 'INVALID_MARKS');
        break;
      case 'citation':
      case 'documentReference':
        if (typeof node.title !== 'string') report(errors, `${path}.title`, 'reference title must be a string', 'INVALID_REFERENCE');
        if (typeof node.url !== 'string') report(errors, `${path}.url`, 'reference URL must be a string', 'INVALID_REFERENCE');
        break;
      case 'unorderedList':
      case 'orderedList': {
        const items = requireArray(node, 'items', path);
        if (items) visitChildren(items, `${path}.items`, new Set(['listItem']));
        break;
      }
      case 'listItem': {
        const children = requireArray(node, 'children', path);
        if (children) visitChildren(children, `${path}.children`, new Set(['paragraph', 'unorderedList', 'orderedList']));
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
        if (rows) visitChildren(rows, `${path}.rows`, new Set(['tableRow']));
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
        if (node.type === 'audience') {
          if (!['include', 'exclude'].includes(node.mode)) report(errors, `${path}.mode`, 'audience mode must be include or exclude', 'INVALID_AUDIENCE');
          if (typeof node.target !== 'string' || node.target === '') report(errors, `${path}.target`, 'audience target must be non-empty', 'INVALID_AUDIENCE');
        }
        const children = requireArray(node, 'children', path);
        if (children) visitChildren(children, `${path}.children`, BLOCK_TYPES);
        break;
      }
      case 'media':
        if (typeof node.kind !== 'string' || node.kind === '') report(errors, `${path}.kind`, 'media kind must be non-empty', 'INVALID_MEDIA');
        break;
      case 'opaque':
        if (lossless) report(errors, path, 'opaque node is not allowed in lossless mode', 'OPAQUE_NODE');
        else report(warnings, path, 'opaque node will be rendered as an unsupported marker', 'OPAQUE_NODE');
        break;
      default:
        report(errors, `${path}.type`, `unknown node type ${node.type}`, 'UNKNOWN_NODE_TYPE');
    }
  }

  if (!ir || ir.type !== 'document') {
    report(errors, '$.type', 'root node must be a document', 'INVALID_DOCUMENT');
  } else {
    visit(ir, '$');
  }

  return { valid: errors.length === 0, errors, warnings };
}

module.exports = { validateDocumentIr };
