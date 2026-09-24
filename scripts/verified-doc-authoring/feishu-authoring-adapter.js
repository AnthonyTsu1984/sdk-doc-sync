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
const { WriterGovernance } = require(path.join(DOC_OPS, 'src/writer-governance'));

const DRAFT_PATH = process.env.VERIFIED_DOC_DRAFT
  ? path.resolve(process.env.VERIFIED_DOC_DRAFT)
  : path.join(__dirname, 'draft.md');

// The canonical executor verifies the approval against the plan before calling
// patch(); the writer boundary independently re-checks the same envelope, so a
// mutation cannot run under facts the executor never verified.
function bindGovernanceFromEnv() {
  const planPath = process.env.VERIFIED_DOC_PLAN;
  const approvalPath = process.env.VERIFIED_DOC_APPROVAL;
  if (!planPath || !approvalPath) {
    throw new Error('live writes require $VERIFIED_DOC_PLAN and $VERIFIED_DOC_APPROVAL (Phase 4 writer governance)');
  }
  const plan = JSON.parse(fs.readFileSync(path.resolve(planPath), 'utf8'));
  const approval = JSON.parse(fs.readFileSync(path.resolve(approvalPath), 'utf8'));
  const governance = new WriterGovernance({ skill: plan.actionBatch.skill, operation: plan.actionBatch.operation });
  governance.bindApproval({
    batchDigest: plan.actionBatch.batchDigest,
    actionCount: plan.actionBatch.actions.length,
    targets: plan.actionBatch.targets,
    sideEffects: plan.actionBatch.sideEffects,
    approval,
  });
  return governance;
}

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
// Foreign rich blocks that the write path cannot recreate (boards, sheets,
// iframes, synced blocks) render as placeholder links; the draft excludes
// them and the adapter structurally asserts their survival, so their
// rendered placeholders are stripped from the comparison markdown too.
const FOREIGN_PLACEHOLDER = /^\[[^\]]*\]\(#feishu-(?:board|sheet|iframe|source_synced|synced)-[^)]+\)$/;

function normalizeRefetchMarkdown(markdown) {
  const lines = markdown
    .replace(/import .* from .*/g, '')
    .split('\n')
    .filter((line) => !FOREIGN_PLACEHOLDER.test(line.trim()))
    .map((line) => (line.startsWith('|') ? line.replace(/<br>\s*\|/g, ' |') : line));
  const collapsed = [];
  for (const line of lines) {
    if (line === '' && collapsed[collapsed.length - 1] === '') continue;
    collapsed.push(line);
  }
  return collapsed.join('\n');
}

function blockText(block) {
  const sections = [block.code, block.text, block.heading1, block.heading2, block.heading3];
  for (const section of sections) {
    if (section && Array.isArray(section.elements)) {
      return section.elements.map((e) => (e.text_run && e.text_run.content) || '').join('');
    }
  }
  return '';
}

// Surgical mode: replace only the live blocks whose text contains an anchor
// substring with the draft blocks containing the same anchor. Everything
// else — including foreign rich blocks such as boards — is untouched, which
// whole-page strategies cannot guarantee (smart matching deletes unmatched
// preserve-only blocks). Foreign blocks are snapshot before and asserted
// present after the mutation.
const PRESERVE_ONLY_TYPES = [43, 26, 30, 49]; // board, iframe, sheet, source_synced

async function patchSurgical(m2f, documentId, anchors) {
  const existing = await m2f.get_document_blocks(documentId);
  const page = existing.find((b) => b.block_type === 1);
  if (!page) throw new Error('Page block not found');
  const children = existing.filter((b) => b.parent_id === page.block_id && b.block_id !== page.block_id);
  const foreignBefore = children.filter((b) => PRESERVE_ONLY_TYPES.includes(b.block_type)).map((b) => b.block_id);

  const markdown = markdownPipeTablesToHtml(fs.readFileSync(DRAFT_PATH, 'utf8'));
  const { tokens } = await m2f.parse_markdown(markdown);
  const draftBlocks = await m2f.markdown_to_blocks(tokens);

  const liveTargets = [];
  const newTargets = [];
  for (const anchor of anchors) {
    const liveMatches = children.filter((b) => blockText(b).includes(anchor));
    const newMatches = draftBlocks.filter((b) => blockText(b).includes(anchor));
    if (liveMatches.length !== 1 || newMatches.length !== 1) {
      throw new Error(`surgical anchor "${anchor}" must match exactly one live and one draft block (live=${liveMatches.length}, draft=${newMatches.length})`);
    }
    liveTargets.push(liveMatches[0]);
    newTargets.push(newMatches[0]);
  }
  for (const [live, next] of liveTargets.map((b, i) => [b, newTargets[i]])) {
    if (live.block_type !== next.block_type) {
      throw new Error(`surgical anchor pairs block_type ${live.block_type} with ${next.block_type}; delete+insert cannot change structure context`);
    }
  }
  const childIds = children.map((b) => b.block_id);
  const firstIndex = Math.min(...liveTargets.map((b) => childIds.indexOf(b.block_id)));
  if (firstIndex < 0) throw new Error('surgical targets are not direct page children');

  // r8 incident guard: every refusal must happen BEFORE any deletion.
  // update_document deletes all children first and creates after, so a
  // create-side refusal (e.g. the absolute-link invariant on foreign-block
  // placeholder links) wipes the page. Validate the new blocks with the same
  // checks create_blocks applies, up front.
  m2f.__assert_absolute_block_links(newTargets, 'adapter.surgical.precheck');

  await m2f.__delete_child_blocks_by_id({ document_id: documentId, parentBlock: page, childBlockIds: liveTargets.map((b) => b.block_id) });
  await m2f.create_blocks({ document_id: documentId, blocks: newTargets, startIndex: firstIndex });

  const after = await m2f.get_document_blocks(documentId);
  const afterIds = new Set(after.map((b) => b.block_id));
  const missing = foreignBefore.filter((id) => !afterIds.has(id));
  if (missing.length > 0) throw new Error(`foreign blocks lost during surgical patch: ${missing.join(', ')}`);
  return { documentId, revision: null, created: false };
}

async function patch(payload) {
  const documentId = (payload && payload.target && payload.target.documentId) || (payload && payload.documentId);
  if (!documentId) throw new Error('patch payload missing documentId');
  const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null, governance: bindGovernanceFromEnv() });
  const anchors = (process.env.VERIFIED_DOC_SURGICAL || '').split('|').map((a) => a.trim()).filter(Boolean);
  if (anchors.length > 0) return patchSurgical(m2f, documentId, anchors);

  const markdown = markdownPipeTablesToHtml(fs.readFileSync(DRAFT_PATH, 'utf8'));
  const { tokens } = await m2f.parse_markdown(markdown);
  const blocks = await m2f.markdown_to_blocks(tokens);
  // r8 incident guard: refuse before update_document deletes anything.
  m2f.__assert_absolute_block_links(blocks, 'adapter.full.precheck');
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
