#!/usr/bin/env node
'use strict';

// Journaled Feishu adapter for the verified-doc-authoring canonical CLI.
//
// Usage: passed to `verified-doc-authoring.js execute --adapter-module <this file>`.
// The draft markdown is read from $VERIFIED_DOC_DRAFT (fallback: draft.md next
// to this file). Writes pipe tables as native Feishu tables; see README.md for
// the table contract and refetch normalization rules.

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const API_SYNC = path.join(PROJECT_ROOT, '.claude/skills/api-reference-sync');
const DOC_OPS = path.join(PROJECT_ROOT, '.claude/skills/doc-ops-core');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';
require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });

const fetch = require(path.join(PROJECT_ROOT, 'node_modules/node-fetch'));
const larkTokenFetcher = require(path.join(API_SYNC, 'lib/lark-docs/larkTokenFetcher'));
const MarkdownToFeishu = require(path.join(API_SYNC, 'src/markdown-to-feishu'));
const DocxReader = require(path.join(API_SYNC, 'src/feishu/docx-reader'));
const FeishuClient = require(path.join(API_SYNC, 'src/feishu/feishu-client'));
const { docxToIr } = require(path.join(API_SYNC, 'src/document-ir/docx-to-ir'));
const { renderMarkdown } = require(path.join(API_SYNC, 'src/document-ir/ir-to-markdown'));
const { canonicalBytes } = require(path.join(DOC_OPS, 'src/canonical-json'));
const { sha256Digest } = require(path.join(DOC_OPS, 'src/digest'));

const DRAFT_PATH = process.env.VERIFIED_DOC_DRAFT
  ? path.resolve(process.env.VERIFIED_DOC_DRAFT)
  : path.join(__dirname, 'draft.md');

function pageTitleText(page) {
  if (typeof page.title === 'string') return page.title;
  return (page.elements || [])
    .map((element) => (element.text_run && element.text_run.content) || '')
    .join('')
    .trim();
}

function protectedBlocksFromBlocks(blocks) {
  const page = blocks.find((b) => b.block_type === 1);
  if (!page) throw new Error('Page block not found');
  const text = pageTitleText(page.page || page);
  return [{ blockId: 'title', childIndex: 0, type: 'heading', text }];
}

async function readDocumentBlocks(client, documentId) {
  const reader = new DocxReader({ client, sourceType: 'drive' });
  return reader.expandReferences(await reader.readBlocks(documentId));
}

async function getRevision(client, documentId) {
  const envelope = await client.request({ path: '/open-apis/docx/v1/documents/' + documentId });
  const rev = envelope && envelope.data && envelope.data.document && envelope.data.document.revision_id;
  if (!Number.isInteger(rev)) throw new Error('Document revision_id not available');
  return rev;
}

function createFeishuClient() {
  const tokenFetcher = new larkTokenFetcher();
  return new FeishuClient({
    host: process.env.FEISHU_HOST || 'https://open.feishu.cn',
    tokenProvider: () => tokenFetcher.token(),
    transport: ({ url, method, headers, body }) => fetch(url, { method, headers, body }),
  });
}

async function snapshot(target) {
  const client = createFeishuClient();
  const blocks = await readDocumentBlocks(client, target.documentId);
  const protectedBlocks = protectedBlocksFromBlocks(blocks);
  const protectedBlocksDigest = sha256Digest(canonicalBytes(protectedBlocks));
  const revision = await getRevision(client, target.documentId);
  return { documentId: target.documentId, revision, protectedBlocksDigest, protectedBlocks, kind: 'existing' };
}

function escapeCellHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The markdown-to-feishu converter drops markdown-it table tokens, but its
// HTML path builds native Feishu table blocks. renderMarkdown later renders
// table blocks back to standard pipe rows with a | --- | separator, so the
// draft keeps pipe tables and only the write side goes through HTML.
// Cell rules: plain text only; write `_` as `\_` (stable fixed point);
// never put `|`, `<`, or `>` in cell text.
function markdownPipeTablesToHtml(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  const isRow = (line) => /^\|.*\|$/.test(line);
  const isSeparator = (line) => /^\|(\s*-{3,}\s*\|)+$/.test(line);
  let index = 0;
  while (index < lines.length) {
    if (isRow(lines[index]) && index + 1 < lines.length && isSeparator(lines[index + 1])) {
      const rows = [lines[index]];
      index += 2;
      while (index < lines.length && isRow(lines[index])) {
        rows.push(lines[index]);
        index += 1;
      }
      out.push('<table>');
      for (const row of rows) {
        const cells = row.slice(1, -1).split(' | ').map((cell) => escapeCellHtml(cell.trim()));
        out.push('<tr>' + cells.map((cell) => `<td>${cell}</td>`).join('') + '</tr>');
      }
      out.push('</table>');
      continue;
    }
    out.push(lines[index]);
    index += 1;
  }
  return out.join('\n');
}

// The Feishu cell model stores each single-line cell text with a trailing
// line break, which renderMarkdown surfaces as "<br>" before the cell
// separator. The canonical draft form has single-line cells, so refetch
// normalization strips end-of-cell breaks only; in-cell line breaks stay.
function normalizeRefetchMarkdown(markdown) {
  return markdown
    .replace(/import .* from .*/g, '')
    .split('\n')
    .map((line) => (line.startsWith('|') ? line.replace(/<br>\s*\|/g, ' |') : line))
    .join('\n');
}

async function patch(payload) {
  const markdown = markdownPipeTablesToHtml(fs.readFileSync(DRAFT_PATH, 'utf8'));
  const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
  const { tokens } = await m2f.parse_markdown(markdown);
  const blocks = await m2f.markdown_to_blocks(tokens);
  const documentId = (payload && payload.target && payload.target.documentId) || (payload && payload.documentId);
  if (!documentId) throw new Error('patch payload missing documentId');
  await m2f.update_document({ document_id: documentId, blocks });
  return { documentId, revision: null, created: false };
}

async function refetch(documentId) {
  const client = createFeishuClient();
  const blocks = await readDocumentBlocks(client, documentId);
  const protectedBlocks = protectedBlocksFromBlocks(blocks);
  const protectedBlocksDigest = sha256Digest(canonicalBytes(protectedBlocks));
  const ir = docxToIr(blocks, { metadata: { token: documentId } });
  const markdown = normalizeRefetchMarkdown(renderMarkdown(ir, { lossy: true }));
  const contentDigest = sha256Digest(canonicalBytes({ markdown }));
  const revision = await getRevision(client, documentId);
  return { documentId, revision, protectedBlocksDigest, contentDigest, visibleUnresolvedClaimIds: [] };
}

module.exports = { snapshot, patch, refetch, markdownPipeTablesToHtml, normalizeRefetchMarkdown };
