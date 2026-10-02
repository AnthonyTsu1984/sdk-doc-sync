'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApprovalEnvelope } = require('../../doc-ops-core/src/approval-guard');
const { WriterGovernance } = require('../../doc-ops-core/src/writer-governance');
const { stubRunManifest } = require('../../doc-ops-core/src/run-manifest');

function loadMarkdownToFeishuWithFetch(mockFetch) {
  const modulePath = require.resolve('../src/markdown-to-feishu');
  const fetchPath = require.resolve('node-fetch');
  const originalFetch = require.cache[fetchPath];
  delete require.cache[modulePath];
  require.cache[fetchPath] = { id: fetchPath, filename: fetchPath, loaded: true, exports: mockFetch };
  const MarkdownToFeishu = require('../src/markdown-to-feishu');
  delete require.cache[modulePath];
  if (originalFetch) require.cache[fetchPath] = originalFetch;
  else delete require.cache[fetchPath];
  return MarkdownToFeishu;
}

function boundGovernance() {
  const governance = new WriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
  governance.bindApproval({
    batchDigest: 'sha256:'.concat('b'.repeat(64)),
    actionCount: 1,
    targets: ['doc-1'],
    sideEffects: ['docx.patch'],
    approval: createApprovalEnvelope({
      skill: 'api-reference-sync',
      operation: 'execute',
      batchDigest: 'sha256:'.concat('b'.repeat(64)),
      actionCount: 1,
      targets: ['doc-1'],
      sideEffects: ['docx.patch'],
      decision: 'approved',
    }),
    invariantAttestations: [],
  });
  governance.bindRunManifest(stubRunManifest({ skill: governance.skill, batchDigest: governance.bound.batchDigest }));
  return governance;
}

function textBlock(content) {
  return {
    block_type: 2,
    text: { elements: [{ text_run: { content } }], style: {} },
  };
}

function tableBlock(rowSize, columnSize) {
  const cells = [];
  for (let i = 0; i < rowSize * columnSize; i++) {
    cells.push(textBlock(`c${i}`));
  }
  return {
    block_type: 31,
    table: {
      property: { row_size: rowSize, column_size: columnSize },
      cells,
    },
  };
}

function writerWithRoutedFetch(routes) {
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url: String(url), options, body: options && options.body ? JSON.parse(options.body) : null });
    for (const route of routes) {
      const match = route.match && route.match(url, options);
      if (match) return { async json() { return match; } };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  const MarkdownToFeishu = loadMarkdownToFeishuWithFetch(mockFetch);
  const writer = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: null,
    baseToken: 'base-1',
    governance: boundGovernance(),
  });
  writer.tokenFetcher = { token: async () => 'tenant-token' };
  return { writer, calls };
}

function respondWith(handler) {
  return { match: (url, options) => handler(url, options) };
}

function blocksListing(documentId) {
  return respondWith((url) => {
    if (url.includes(`/documents/${documentId}/blocks?`) && !url.includes('/children')) {
      return { code: 0, data: { items: [{ block_id: 'page-1', block_type: 1 }], has_more: false } };
    }
    return null;
  });
}

test('oversized tables route through the descendant API with populated cells', async () => {
  const doc = 'doc-desc';
  const { writer, calls } = writerWithRoutedFetch([
    blocksListing(doc),
    respondWith((url) => {
      if (url.endsWith(`/documents/${doc}/blocks/page-1/children`)) {
        return { code: 0, data: { children: [{ block_id: 'created-text' }] } };
      }
      if (url.endsWith(`/documents/${doc}/blocks/page-1/descendant`)) {
        return { code: 0, data: { children: [{ block_id: 'created-table', block_type: 31 }], block_id_relations: [] } };
      }
      return null;
    }),
  ]);

  await writer.create_blocks({
    document_id: doc,
    blocks: [textBlock('lead'), tableBlock(21, 3)],
    startIndex: 0,
  });

  const descendantCalls = calls.filter((call) => call.url.includes('/descendant'));
  assert.equal(descendantCalls.length, 1, 'the oversized table must be created through the descendant API');
  const payload = descendantCalls[0].body;
  assert.deepEqual(payload.children_id, ['tmp_tbl_1']);
  assert.equal(payload.index, 1, 'the table keeps its position after the preceding text block');
  // 1 table + 21*3 cells + 21*3 cell text blocks
  assert.equal(payload.descendants.length, 1 + 63 + 63);
  const tableNode = payload.descendants[0];
  assert.equal(tableNode.block_type, 31);
  assert.deepEqual(tableNode.table.property, { row_size: 21, column_size: 3 });
  assert.equal(tableNode.children.length, 63);
  const cellNodes = payload.descendants.filter((node) => node.block_type === 32);
  assert.equal(cellNodes.length, 63);
  const textNodes = payload.descendants.filter((node) => node.block_type === 2);
  assert.equal(textNodes.length, 63);
  assert.equal(textNodes[0].text.elements[0].text_run.content, 'c0');
  assert.equal(textNodes[62].text.elements[0].text_run.content, 'c62');
  // every cell references exactly its own text block
  for (let i = 0; i < 63; i++) {
    const cellNode = payload.descendants.find((node) => node.block_id === `tmp_cell_1_${i}`);
    assert.deepEqual(cellNode.children, [`tmp_celltxt_1_${i}`]);
  }

  // the pre-table text block still goes through the plain children API
  const childrenCalls = calls.filter((call) => call.url.includes('/blocks/page-1/children'));
  assert.equal(childrenCalls.length, 1);
  // no post-create populate pass for the descendant table
  const populateCalls = calls.filter((call) => /blocks\/[^/]+\/children$/.test(call.url) && call.url.includes('created-'));
  assert.deepEqual(populateCalls, []);
});

test('small tables keep the children-API creation path with stripped cells', async () => {
  const doc = 'doc-small';
  const { writer, calls } = writerWithRoutedFetch([
    blocksListing(doc),
    respondWith((url) => {
      if (url.endsWith(`/documents/${doc}/blocks/page-1/children`)) {
        return {
          code: 0,
          data: { children: [{ block_id: 'created-tbl', block_type: 31, table: { cells: ['cell-0', 'cell-1', 'cell-2', 'cell-3'] } }] },
        };
      }
      if (/\/blocks\/cell-\d\/children$/.test(url)) {
        return { code: 0, data: { children: [{ block_id: 'populated' }] } };
      }
      return null;
    }),
  ]);

  await writer.create_blocks({ document_id: doc, blocks: [tableBlock(2, 2)], startIndex: 0 });

  assert.equal(calls.filter((call) => call.url.includes('/descendant')).length, 0, 'small tables must not use the descendant API');
  const createCalls = calls.filter((call) => call.url.endsWith('/blocks/page-1/children'));
  assert.equal(createCalls.length, 1);
  const payload = createCalls[0].body;
  assert.equal(payload.children.length, 1);
  assert.equal(payload.children[0].block_type, 31);
  assert.equal(payload.children[0].table.cells, undefined, 'cells are stripped — the API auto-creates them');
  assert.equal(payload.children[0].table.property.merge_info, undefined);
  const populateCalls = calls.filter((call) => /\/blocks\/cell-\d\/children$/.test(call.url));
  assert.equal(populateCalls.length, 4, 'every auto-created cell is populated afterwards');
});
