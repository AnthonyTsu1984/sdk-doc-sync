#!/usr/bin/env node
'use strict';

// Pre-write roundtrip gate for verified-doc-authoring drafts.
//
// Mirrors the adapter write path exactly: pipe tables -> HTML -> Feishu
// blocks -> (synthetic block graph) -> IR -> renderMarkdown -> refetch
// normalization, then compares the result byte-exactly against the RAW
// draft file. Run this on every draft before planning a live write; the
// executor applies the same comparison after the real mutation.
//
// Usage: node roundtrip-sim.js <draft.md> [adapter.js]

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const adapterPath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(__dirname, 'feishu-authoring-adapter.js');
const { canonicalBytes } = require(path.join(ROOT, '.claude/skills/doc-ops-core/src/canonical-json'));
const MarkdownToFeishu = require(path.join(ROOT, '.claude/skills/api-reference-sync/src/markdown-to-feishu'));
const { docxToIr } = require(path.join(ROOT, '.claude/skills/api-reference-sync/src/document-ir/docx-to-ir'));
const { renderMarkdown } = require(path.join(ROOT, '.claude/skills/api-reference-sync/src/document-ir/ir-to-markdown'));
const { markdownPipeTablesToHtml, normalizeRefetchMarkdown } = require(adapterPath);

function sha256(s) { return 'sha256:' + crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex'); }

function buildGraph(blocks, pageId) {
  const nodes = [];
  let n = 0;
  const next = () => 'b' + (n++);
  const add = (node) => { nodes.push(node); return node.block_id; };
  const childOrder = [];
  for (const block of blocks) {
    const { children: sub, table, ...rest } = block;
    const id = next();
    const rec = { block_id: id, parent_id: pageId, ...rest };
    if (table && Array.isArray(table.cells)) {
      const cellIds = table.cells.map((cell) => {
        const cellId = next();
        const textId = next();
        add({ block_id: cellId, parent_id: id, block_type: 32, children: [textId] });
        add({ block_id: textId, parent_id: cellId, block_type: 2, ...cell });
        return cellId;
      });
      rec.table = { ...table, cells: cellIds };
    }
    if (sub && sub.length) {
      rec.children = sub.map((child) => {
        const cid = next();
        add({ block_id: cid, parent_id: id, ...child });
        return cid;
      });
    }
    add(rec);
    childOrder.push(id);
  }
  return [{ block_id: pageId, block_type: 1, children: childOrder }, ...nodes];
}

async function main() {
  const mdPath = process.argv[2];
  if (!mdPath) throw new Error('usage: roundtrip-sim.js <draft.md> [adapter.js]');
  const draft = fs.readFileSync(mdPath, 'utf8');
  const tableCount = (draft.match(/^\| --- /gm) || []).length;
  const transformed = markdownPipeTablesToHtml(draft);
  if (transformed.includes('| --- ')) throw new Error('unconverted pipe table remains');

  const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
  const { tokens } = await m2f.parse_markdown(transformed);
  const blocks = await m2f.markdown_to_blocks(tokens);
  const tableBlocks = blocks.filter((b) => b.block_type === 31).length;
  const graph = buildGraph(blocks, 'page-1');
  const out = normalizeRefetchMarkdown(renderMarkdown(docxToIr(graph, { metadata: { token: 'test' } }), { lossy: true }));

  const inDigest = sha256(canonicalBytes({ markdown: draft }));
  const outDigest = sha256(canonicalBytes({ markdown: out }));
  console.log('pipe tables in draft:', tableCount, '| native table blocks produced:', tableBlocks);
  console.log('INPUT  DIGEST:', inDigest);
  console.log('REFETCH DIGEST:', outDigest);
  console.log('MATCH:', outDigest === inDigest);
  if (out !== draft) {
    const a = draft.split('\n'); const b = out.split('\n');
    let diffs = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.log('diff@' + i + '\n  draft:   ' + JSON.stringify((a[i] || '').slice(0, 120)) + '\n  refetch: ' + JSON.stringify((b[i] || '').slice(0, 120)));
        if (++diffs > 20) break;
      }
    }
    console.log('DIFFS:', diffs);
    process.exitCode = 1;
  } else {
    console.log('NO DIFFS - EXACT BYTE ROUNDTRIP');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
