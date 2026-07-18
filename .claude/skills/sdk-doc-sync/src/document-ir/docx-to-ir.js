'use strict';

const schema = require('./schema');
const { blockName, languageName } = require('./block-registry');

class DocxToIrError extends Error {
  constructor(code, path, message) {
    super(`${path}: ${message}`);
    this.name = 'DocxToIrError';
    this.code = code;
    this.path = path;
  }
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
}

function decodeUrl(url) {
  if (typeof url !== 'string') return '';
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

function docxToIr(input, { metadata } = {}) {
  const blocks = Array.isArray(input) ? input : input?.items;
  if (!Array.isArray(blocks)) throw new TypeError('docxToIr requires a raw Docx block array');

  const byId = new Map();
  const indexById = new Map();
  for (let index = 0; index < blocks.length; index += 1) {
    const id = blocks[index]?.block_id;
    const path = `$[${index}].block_id`;
    if (typeof id !== 'string' || id === '') throw new DocxToIrError('DOCX_GRAPH_INVALID_ID', path, 'block_id must be a non-empty string');
    if (byId.has(id)) throw new DocxToIrError('DOCX_GRAPH_DUPLICATE_ID', path, `duplicate block_id ${id}`);
    byId.set(id, blocks[index]);
    indexById.set(id, index);
  }

  const pages = blocks.filter((block) => block.block_type === 1);
  if (pages.length > 1) {
    const duplicatePage = pages[1];
    throw new DocxToIrError(
      'DOCX_GRAPH_MULTIPLE_PAGES',
      `$[${indexById.get(duplicatePage.block_id)}]`,
      'Docx graph must contain at most one page block',
    );
  }

  const edges = new Map();
  const incoming = new Map();
  for (const block of blocks) {
    const index = indexById.get(block.block_id);
    const childGroups = [];
    if (block.children !== undefined) childGroups.push(['children', block.children]);
    if (block.block_type === 31 && block.table?.cells !== undefined) childGroups.push(['table.cells', block.table.cells]);
    const ids = [];
    for (const [field, children] of childGroups) {
      const path = `$[${index}].${field}`;
      if (!Array.isArray(children)) throw new DocxToIrError('DOCX_GRAPH_INVALID_CHILDREN', path, `${field} must be an array`);
      const local = new Set();
      children.forEach((childId, childIndex) => {
        const childPath = `${path}[${childIndex}]`;
        if (!byId.has(childId)) throw new DocxToIrError('DOCX_GRAPH_MISSING_CHILD', childPath, `referenced child ${childId} does not exist`);
        const childBlock = byId.get(childId);
        if (childBlock.parent_id !== undefined && childBlock.parent_id !== block.block_id) {
          throw new DocxToIrError('DOCX_GRAPH_PARENT_MISMATCH', childPath, `child ${childId} declares parent ${childBlock.parent_id}, expected ${block.block_id}`);
        }
        if (field === 'table.cells' && childBlock.block_type !== 32) {
          throw new DocxToIrError('DOCX_TABLE_CELL_TYPE', childPath, `table cell ${childId} must have block_type 32`);
        }
        if (local.has(childId)) throw new DocxToIrError('DOCX_GRAPH_REPEATED_EDGE', childPath, `child ${childId} is referenced more than once by ${block.block_id}`);
        local.add(childId);
        const previous = incoming.get(childId);
        if (previous && previous.parent !== block.block_id) {
          throw new DocxToIrError('DOCX_GRAPH_MULTIPLE_PARENT', childPath, `child ${childId} is reused by ${previous.parent} and ${block.block_id}`);
        }
        incoming.set(childId, { parent: block.block_id, path: childPath });
        ids.push(childId);
      });
    }
    edges.set(block.block_id, ids);
  }

  const active = new Set();
  const complete = new Set();
  function checkCycle(id, path) {
    if (active.has(id)) throw new DocxToIrError('DOCX_GRAPH_CYCLE', path, `cycle reaches ${id}`);
    if (complete.has(id)) return;
    active.add(id);
    for (const childId of edges.get(id) || []) checkCycle(childId, `${path}.children`);
    active.delete(id);
    complete.add(id);
  }
  for (const id of byId.keys()) checkCycle(id, `$[${indexById.get(id)}]`);

  const visited = new Set();
  const page = pages[0];
  if (page) {
    const reachable = new Set();
    const mark = (id) => {
      if (reachable.has(id)) return;
      reachable.add(id);
      for (const child of edges.get(id) || []) mark(child);
    };
    mark(page.block_id);
    const unreachable = blocks.find((block) => block.block_type !== 1 && !reachable.has(block.block_id));
    if (unreachable) {
      throw new DocxToIrError(
        'DOCX_GRAPH_UNREACHABLE',
        `$[${indexById.get(unreachable.block_id)}]`,
        `block ${unreachable.block_id} is unreachable from page ${page.block_id}`,
      );
    }
  }

  function elementsFor(block, name = blockName(block.block_type)) {
    return block?.[name]?.elements || [];
  }

  function convertElements(elements) {
    const result = [];
    for (const element of elements || []) {
      if (element.text_run) {
        const run = element.text_run;
        const content = String(run.content ?? '');
        const style = run.text_element_style || {};
        if (style.link?.url) {
          result.push(schema.citation(content, decodeUrl(style.link.url)));
          continue;
        }
        const marks = [];
        if (style.bold) marks.push('bold');
        if (style.italic) marks.push('italic');
        if (style.strikethrough) marks.push('strikethrough');
        if (style.underline) marks.push('underline');
        if (style.inline_code) marks.push('inlineCode');
        result.push(schema.text(content, marks));
      } else if (element.mention_doc) {
        result.push(schema.citation(
          String(element.mention_doc.title || element.mention_doc.url || 'Document'),
          decodeUrl(element.mention_doc.url),
          { metadata: { token: element.mention_doc.token } },
        ));
      } else if (element.mention_url) {
        result.push(schema.citation(
          String(element.mention_url.title || element.mention_url.url || 'Link'),
          decodeUrl(element.mention_url.url),
        ));
      } else if (element.equation) {
        result.push(schema.text(String(element.equation.content || ''), ['inlineCode']));
      }
    }
    return result;
  }

  function rawText(elements) {
    return (elements || []).map((element) => element.text_run?.content || '').join('');
  }

  function paragraphFrom(block, name = blockName(block.block_type)) {
    const elements = elementsFor(block, name);
    const plain = rawText(elements);
    const audience = plain.match(/^<(include|exclude) target="([^"]+)">([\s\S]*)<\/\1>$/i);
    if (audience && elements.every((element) => element.text_run)) {
      return schema.audienceRegion(
        audience[1].toLowerCase(),
        audience[2],
        [schema.paragraph([schema.text(audience[3])])],
        { sourceId: block.block_id },
      );
    }
    return schema.paragraph(convertElements(elements), { sourceId: block.block_id });
  }

  function convertCell(cellId) {
    const cellBlock = byId.get(cellId);
    if (!cellBlock) return schema.tableCell([], { sourceId: cellId });
    visited.add(cellId);
    return schema.tableCell(convertSequence(cellBlock.children || []), { sourceId: cellId });
  }

  function convertListItem(block) {
    visited.add(block.block_id);
    const children = [schema.paragraph(convertElements(elementsFor(block)), {
      metadata: { sourceBlockId: block.block_id },
    })];
    children.push(...convertSequence(block.children || []));
    return schema.listItem(children, { sourceId: block.block_id });
  }

  function convertList(ids, start, type) {
    const items = [];
    const sourceIds = [];
    let index = start;
    while (index < ids.length) {
      const block = byId.get(ids[index]);
      if (!block || block.block_type !== type || visited.has(block.block_id)) break;
      sourceIds.push(block.block_id);
      items.push(convertListItem(block));
      index += 1;
    }
    const create = type === 13 ? schema.orderedList : schema.unorderedList;
    return {
      node: create(items, { metadata: { sourceIds } }),
      nextIndex: index,
    };
  }

  function convertBlock(block) {
    if (!block || visited.has(block.block_id)) return null;
    visited.add(block.block_id);
    const name = blockName(block.block_type);

    if (block.block_type === 2) return paragraphFrom(block, 'text');
    if (block.block_type >= 3 && block.block_type <= 11) {
      return schema.heading(
        block.block_type - 2,
        convertElements(elementsFor(block, name)),
        { sourceId: block.block_id },
      );
    }
    if (block.block_type === 14) {
      const language = languageName(block.code?.style?.language || 1) || 'PlainText';
      return schema.codeBlock(rawText(block.code?.elements), language, { sourceId: block.block_id });
    }
    if (block.block_type === 15) {
      return schema.callout([schema.paragraph(convertElements(elementsFor(block, 'quote')), {
        metadata: { sourceBlockId: block.block_id },
      })], {
        kind: 'note',
        sourceId: block.block_id,
      });
    }
    if (block.block_type === 19 || block.block_type === 34) {
      const kind = block.callout?.emoji_id === 'bulb' ? 'tip' : 'note';
      const children = convertSequence(block.children || []);
      if (children.length === 0 && elementsFor(block, name).length > 0) {
        children.push(schema.paragraph(convertElements(elementsFor(block, name)), {
          metadata: { sourceBlockId: block.block_id },
        }));
      }
      return schema.callout(children, {
        kind,
        emoji: block.callout?.emoji_id,
        sourceId: block.block_id,
      });
    }
    if (block.block_type === 31) {
      const property = block.table?.property;
      const hasPropertyColumn = property && Object.hasOwn(property, 'column_size');
      const hasPropertyRow = property && Object.hasOwn(property, 'row_size');
      const columnCount = hasPropertyColumn ? property.column_size : block.table?.column_size;
      const rowCount = hasPropertyRow ? property.row_size : block.table?.row_size;
      const basePath = `$[${indexById.get(block.block_id)}].table`;
      if (!Number.isInteger(columnCount) || columnCount <= 0) {
        throw new DocxToIrError('DOCX_TABLE_DIMENSION_INVALID', `${basePath}.${hasPropertyColumn ? 'property.' : ''}column_size`, 'column_size must be a positive integer');
      }
      if (rowCount !== undefined && (!Number.isInteger(rowCount) || rowCount <= 0)) {
        throw new DocxToIrError('DOCX_TABLE_DIMENSION_INVALID', `${basePath}.${hasPropertyRow ? 'property.' : ''}row_size`, 'row_size must be a positive integer');
      }
      const cells = block.table?.cells || [];
      const inferredRows = rowCount === undefined ? cells.length / columnCount : rowCount;
      if (!Number.isInteger(inferredRows) || inferredRows <= 0 || cells.length !== inferredRows * columnCount) {
        throw new DocxToIrError('DOCX_TABLE_CELL_COUNT', `${basePath}.cells`, `expected ${rowCount === undefined ? 'a whole number of' : rowCount} rows of ${columnCount} cells, found ${cells.length}`);
      }
      const rows = [];
      for (let offset = 0; offset < cells.length; offset += columnCount) {
        rows.push(schema.tableRow(cells.slice(offset, offset + columnCount).map(convertCell)));
      }
      return schema.table(rows, { sourceId: block.block_id });
    }
    if ([23, 26, 27, 43].includes(block.block_type)) {
      const kind = ({ 23: 'file', 26: 'iframe', 27: 'image', 43: 'board' })[block.block_type];
      const payload = block[kind] || {};
      const url = payload.url || payload.component?.url;
      return schema.media(kind, {
        ...(url && { url }),
        ...(payload.token && { token: payload.token }),
        ...(payload.file_token && { token: payload.file_token }),
        ...(payload.name && { name: payload.name }),
      }, { sourceId: block.block_id });
    }

    return schema.opaque(clone(block), {
      sourceId: block.block_id,
      metadata: { blockType: block.block_type, blockName: name },
    });
  }

  function convertSequence(ids) {
    const result = [];
    for (let index = 0; index < ids.length;) {
      const block = byId.get(ids[index]);
      if (!block || visited.has(ids[index])) {
        index += 1;
        continue;
      }
      if (block.block_type === 12 || block.block_type === 13) {
        const converted = convertList(ids, index, block.block_type);
        result.push(converted.node);
        index = converted.nextIndex;
        continue;
      }
      const node = convertBlock(block);
      if (node) result.push(node);
      index += 1;
    }
    return result;
  }

  let rootIds;
  if (page) {
    rootIds = page.children || [];
  } else {
    const roots = blocks.filter((block) => !incoming.has(block.block_id));
    if (roots.length !== 1) {
      throw new DocxToIrError(
        'DOCX_GRAPH_AMBIGUOUS_ROOT',
        '$',
        `Docx graph without a page must have exactly one incoming-edge root; found ${roots.length}`,
      );
    }
    rootIds = [roots[0].block_id];
  }
  if (page) visited.add(page.block_id);

  return schema.document(convertSequence(rootIds), {
    ...(page?.block_id && { sourceId: page.block_id }),
    ...(metadata && { metadata }),
  });
}

module.exports = { docxToIr, DocxToIrError };
