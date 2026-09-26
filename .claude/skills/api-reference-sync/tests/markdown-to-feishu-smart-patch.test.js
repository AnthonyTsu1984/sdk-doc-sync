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
    batchDigest: 'sha256:'.concat('a'.repeat(64)),
    actionCount: 1,
    targets: ['doc-1'],
    sideEffects: ['docx.patch'],
    approval: createApprovalEnvelope({
      skill: 'api-reference-sync',
      operation: 'execute',
      batchDigest: 'sha256:'.concat('a'.repeat(64)),
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

const draftText = (t) => ({ block_type: 2, text: { elements: [{ text_run: { content: t } }] } });
const pageBlock = (childIds) => ({ block_id: 'PAGE', block_type: 1, children: childIds });
const liveText = (id, t) => ({
  block_id: id,
  parent_id: 'PAGE',
  block_type: 2,
  text: { elements: [{ text_run: { content: t } }] },
});

// Minimal in-memory Feishu docx transport: GET serves the document blocks,
// POST /children creates, PATCH batch_update and DELETE batch_delete succeed.
function buildTransport(docBlocks, { getPaged = null } = {}) {
  const calls = [];
  let getCall = 0;
  const fetchImpl = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), method: options.method, body });
    const respond = (data) => ({ async json() { return data; } });
    if (options.method === 'GET') {
      const page = getPaged ? getPaged(getCall) : { items: docBlocks, has_more: false };
      getCall += 1;
      return respond({ code: 0, data: { items: page.items, has_more: !!page.has_more, page_token: page.page_token } });
    }
    if (options.method === 'POST') {
      const created = (body.children || []).map((b, k) => ({
        block_id: `NEW${calls.length}_${k}`,
        block_type: b.block_type,
      }));
      return respond({ code: 0, data: { children: created } });
    }
    return respond({ code: 0, data: {} });
  };
  return { calls, fetchImpl };
}

function makeWriter(fetchImpl) {
  const MarkdownToFeishu = loadMarkdownToFeishuWithFetch(fetchImpl);
  const writer = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: 'base-1', governance: boundGovernance() });
  writer.tokenFetcher = { token: async () => 'tenant-token' };
  return writer;
}

const createCalls = (calls) => calls.filter((c) => c.method === 'POST' && /\/children$/.test(c.url));
const deleteCalls = (calls) => calls.filter((c) => c.method === 'DELETE');

test('get_document_blocks paginates past the 500-block page ceiling', async () => {
  const firstPage = Array.from({ length: 500 }, (_, k) => liveText(`B${k}`, `block ${k}`));
  const secondPage = Array.from({ length: 120 }, (_, k) => liveText(`B${500 + k}`, `block ${500 + k}`));
  const { calls, fetchImpl } = buildTransport([], {
    getPaged: (n) => (n === 0
      ? { items: firstPage, has_more: true, page_token: 'tok-1' }
      : { items: secondPage, has_more: false }),
  });
  const writer = makeWriter(fetchImpl);

  const items = await writer.get_document_blocks('doc-1');

  assert.equal(items.length, 620);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /page_size=500$/);
  assert.match(calls[1].url, /page_token=tok-1$/);
});

test('smart patch inserts a middle paragraph at its draft position', async () => {
  const A = 'Paragraph A about collections';
  const B = 'Paragraph B about partitions';
  const doc = [pageBlock(['L0', 'L1']), liveText('L0', A), liveText('L1', B)];
  const { calls, fetchImpl } = buildTransport(doc);
  const writer = makeWriter(fetchImpl);

  const result = await writer.patch_document({
    document_id: 'doc-1',
    blocks: [draftText(A), draftText('Brand new middle paragraph'), draftText(B)],
  });

  assert.deepEqual(
    deleteCalls(calls).map((c) => c.body),
    [],
  );
  const creates = createCalls(calls);
  assert.equal(creates.length, 1);
  assert.equal(creates[0].body.index, 1);
  assert.equal(creates[0].body.children.length, 1);
  assert.equal(creates[0].body.children[0].text.elements[0].text_run.content, 'Brand new middle paragraph');
  assert.equal(result.created, 1);
  assert.equal(result.deleted, 0);
});

test('smart patch never deletes preserve-only blocks and asserts their survival', async () => {
  const live = 'some unique live paragraph text';
  const doc = [
    pageBlock(['L0', 'BRD']),
    liveText('L0', live),
    { block_id: 'BRD', parent_id: 'PAGE', block_type: 43, board: { token: 'BRDTOK' } },
  ];
  const { calls, fetchImpl } = buildTransport(doc);
  const writer = makeWriter(fetchImpl);

  const result = await writer.patch_document({
    document_id: 'doc-1',
    blocks: [draftText('some unique live paragraph text extended')],
  });

  assert.equal(deleteCalls(calls).length, 0);
  assert.equal(createCalls(calls).length, 0);
  assert.equal(result.updated, 1);
  assert.equal(result.preserved, 1);
  // Post-write survival assertion: the document is refetched a second time.
  const getCalls = calls.filter((c) => c.method === 'GET');
  assert.equal(getCalls.length, 2);
});

test('smart patch rebuilds an edited table at its own position', async () => {
  const A = 'Alpha paragraph before the table';
  const B = 'Omega paragraph after the table';
  const doc = [
    pageBlock(['L0', 'TBL', 'L1']),
    liveText('L0', A),
    { block_id: 'TBL', parent_id: 'PAGE', block_type: 31, table: { cells: ['CELL1'], property: {} } },
    { block_id: 'CELL1', parent_id: 'TBL', block_type: 2, text: { elements: [{ text_run: { content: 'unit cell value' } }] } },
    liveText('L1', B),
  ];
  const { calls, fetchImpl } = buildTransport(doc);
  const writer = makeWriter(fetchImpl);

  const editedTable = {
    block_type: 31,
    table: {
      property: { row_size: 1, column_size: 1, merge_info: [] },
      cells: [draftText('unit cell value changed')],
    },
  };
  const result = await writer.patch_document({
    document_id: 'doc-1',
    blocks: [draftText(A), editedTable, draftText(B)],
  });

  // The table is rebuilt (delete + insert at position 1), never updated in place.
  const deletes = deleteCalls(calls).flatMap((c) => c.body && [c.body]);
  assert.equal(deletes.length, 1);
  assert.deepEqual(deletes[0], { start_index: 1, end_index: 2 });
  const creates = createCalls(calls);
  assert.equal(creates.length, 1);
  assert.equal(creates[0].body.index, 1);
  assert.equal(creates[0].body.children[0].block_type, 31);
  const updates = calls.filter((c) => c.method === 'PATCH' && /batch_update/.test(c.url));
  assert.equal(updates.length, 0);
  assert.equal(result.rebuilt, 1);
  assert.equal(result.deleted, 1);
  assert.equal(result.created, 1);
});

test('smart patch keeps reordered boilerplate in draft order', async () => {
  const collection = 'Returns the status of the collection with all details';
  const load = 'Returns the status of the load operation progress';
  const doc = [pageBlock(['L0', 'L1']), liveText('L0', collection), liveText('L1', load)];
  const { calls, fetchImpl } = buildTransport(doc);
  const writer = makeWriter(fetchImpl);

  // Draft swaps the two lines: order-preserving matching must pair
  // collection↔L0 and rebuild the tail, not cross-pair and swap in place.
  const result = await writer.patch_document({
    document_id: 'doc-1',
    blocks: [draftText(load), draftText(collection)],
  });

  const deletes = deleteCalls(calls);
  assert.equal(deletes.length, 1);
  assert.deepEqual(deletes[0].body, { start_index: 1, end_index: 2 });
  const creates = createCalls(calls);
  assert.equal(creates.length, 1);
  assert.equal(creates[0].body.index, 0);
  assert.equal(creates[0].body.children[0].text.elements[0].text_run.content, load);
  assert.equal(result.deleted, 1);
  assert.equal(result.created, 1);
});

test('matcher unpaired boilerplate falls back to delete+create, not cross-pairing', () => {
  const MarkdownToFeishu = loadMarkdownToFeishuWithFetch(async () => ({ async json() { return { code: 0, data: {} }; } }));
  const writer = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: 'b', governance: boundGovernance() });

  const live = [liveText('L0', 'aaa bbb ccc ddd eee'), liveText('L1', 'xxx yyy zzz www vvv')];
  const plan = writer.__match_blocks_anchor(live, [draftText('yyy xxx zzz vvv www')]);

  // No containment either way — nothing may pair, both old blocks are
  // deleted and the new one created at the skeleton position.
  assert.equal(plan.matches.length, 0);
  assert.equal(plan.editedMatches.length, 0);
  assert.equal(plan.toDelete.length, 2);
  assert.equal(plan.toCreate.length, 1);
});

test('replace strategy appends surplus blocks after existing content', async () => {
  const A = 'Only existing paragraph';
  const doc = [pageBlock(['L0']), liveText('L0', A)];
  const { calls, fetchImpl } = buildTransport(doc);
  const writer = makeWriter(fetchImpl);

  await writer.patch_document({
    document_id: 'doc-1',
    blocks: [draftText(A), draftText('Tail block appended at the end')],
    strategy: 'replace',
  });

  const creates = createCalls(calls);
  assert.equal(creates.length, 1);
  assert.equal(creates[0].body.index, 1);
});
