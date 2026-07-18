'use strict';

const { languageId, languageName } = require('./block-registry');
const { validateDocumentIr } = require('./validate');

function escapeText(value) {
  return String(value).split('\n').map((line) => line
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([*_[\]])/g, '\\$1'))
    .join('\n');
}

function escapeBlockStarts(value) {
  return value.split('\n').map((line) => line
    .replace(/^( {0,3})\t/, '$1&#9;')
    .replace(/^ {4}/, '&#32;   ')
    .replace(/^(\s*)(?=(?:#{1,6}\s|[-+*]\s|\d+[.)]\s|&gt;\s|`{3,}|~{3,}|-(?:\s*-){2,}\s*$|={3,}\s*$))/, '$1\\'))
    .join('\n');
}

function safeUrl(value) {
  return encodeURI(String(value || '')).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function renderInline(node) {
  if (node.type === 'citation' || node.type === 'documentReference') {
    return `[${escapeText(node.title)}](${safeUrl(node.url)})`;
  }
  let value;
  if (node.marks.includes('inlineCode')) {
    const runs = String(node.value).match(/`+/g) || [];
    const delimiter = '`'.repeat(Math.max(1, ...runs.map((run) => run.length + 1)));
    value = `${delimiter}${String(node.value)}${delimiter}`;
  } else {
    value = escapeText(node.value);
  }
  if (node.marks.includes('bold')) value = `**${value}**`;
  if (node.marks.includes('italic')) value = `*${value}*`;
  if (node.marks.includes('strikethrough')) value = `~~${value}~~`;
  if (node.marks.includes('underline')) value = `<u>${value}</u>`;
  return value;
}

function renderInlines(children) {
  return escapeBlockStarts(children.map(renderInline).join(''));
}

function fenceName(language) {
  const canonical = languageName(languageId(language)) || language;
  if (canonical === 'C++') return 'c++';
  if (canonical === 'PlainText') return 'plaintext';
  return canonical.toLowerCase().replace(/\s+/g, '-');
}

function indentLines(value, spaces) {
  const indent = ' '.repeat(spaces);
  return value.split('\n').map((line) => `${indent}${line}`).join('\n');
}

function renderList(node) {
  return node.items.map((item, index) => {
    const prefix = node.type === 'orderedList' ? `${index + 1}. ` : '- ';
    const [first, ...rest] = item.children;
    const firstValue = first?.type === 'paragraph' ? renderInlines(first.children) : renderBlock(first, { lossy: true });
    const lines = [`${prefix}${firstValue}`];
    for (const child of rest) lines.push(indentLines(renderBlock(child, { lossy: true }), 2));
    return lines.join('\n');
  }).join('\n');
}

function renderTableCell(cell) {
  return cell.children.map((child) => renderBlock(child, { lossy: true })).join('<br>').replace(/\|/g, '\\|');
}

function renderMedia(node) {
  const fallback = `#feishu-${encodeURIComponent(node.kind)}-${encodeURIComponent(node.token || node.sourceId || 'unknown')}`;
  const url = safeUrl(node.url || fallback);
  if (node.kind === 'image') return `![${escapeText(node.alt || node.name || 'Image')}](${url})`;
  const label = node.name || ({ file: 'File', iframe: 'Embedded content', board: 'Board' })[node.kind] || node.kind;
  return `[${escapeText(label)}](${url})`;
}

function renderBlock(node, options) {
  switch (node.type) {
    case 'paragraph':
      return renderInlines(node.children);
    case 'heading':
      return `${'#'.repeat(node.level)} ${renderInlines(node.children)}`;
    case 'unorderedList':
    case 'orderedList':
      return renderList(node);
    case 'codeBlock':
      {
        const runs = node.value.match(/`+/g) || [];
        const fence = '`'.repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
        return `${fence}${fenceName(node.language)}\n${node.value}\n${fence}`;
      }
    case 'table': {
      if (node.rows.length === 0) return '';
      const rows = node.rows.map((row) => row.cells.map(renderTableCell));
      const width = Math.max(...rows.map((row) => row.length));
      const normalize = (row) => Array.from({ length: width }, (_, index) => row[index] || '');
      const lines = [normalize(rows[0]), Array(width).fill('---'), ...rows.slice(1).map(normalize)];
      return lines.map((row) => `| ${row.join(' | ')} |`).join('\n');
    }
    case 'callout': {
      const content = node.children.map((child) => renderBlock(child, options)).join('\n\n');
      return content.split('\n').map((line) => line ? `> ${line}` : '>').join('\n');
    }
    case 'audience': {
      const content = node.children.map((child) => renderBlock(child, options)).join('\n\n');
      return `<${node.mode} target="${String(node.target).replace(/"/g, '&quot;')}">\n${content}\n</${node.mode}>`;
    }
    case 'media':
      return renderMedia(node);
    case 'opaque': {
      if (!options.lossy) throw new Error('Cannot render opaque node without lossy mode');
      const blockType = node.raw?.block_type ?? node.metadata?.blockType ?? 'unknown';
      const commentValue = (value) => String(value)
        .replace(/--/g, '- -')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/[\r\n]+/g, ' ');
      return `<!-- Unsupported Docx block type ${commentValue(blockType)} (source: ${commentValue(node.sourceId || 'unknown')}) -->`;
    }
    default:
      throw new Error(`Cannot render unknown IR node type ${node.type}`);
  }
}

function renderMarkdown(ir, { lossy = false } = {}) {
  const validation = validateDocumentIr(ir, { lossless: !lossy });
  if (!validation.valid) {
    const detail = validation.errors.map((error) => `${error.path}: ${error.message}`).join('; ');
    throw new Error(`Invalid document IR: ${detail}`);
  }
  return `${ir.children.map((node) => renderBlock(node, { lossy })).join('\n\n')}\n`;
}

module.exports = { renderMarkdown, irToMarkdown: renderMarkdown };
