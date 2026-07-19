#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

function usage() {
  console.error('Usage: node .claude/skills/sdk-doc-sync/scripts/render-grouping-inheritance-table.js <grouping-proposal.json>');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function escapeCell(value) {
  if (value === undefined || value === null || value === '') return '';
  return String(value).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function decisionLabel(decision) {
  switch (decision) {
    case 'update_existing_interface_record':
      return 'update existing';
    case 'create_missing_interface_record':
      return 'create missing';
    default:
      return decision || '';
  }
}

function docIdentityLabel(docIdentity = {}) {
  const category = docIdentity.category || '';
  const title = docIdentity.title || docIdentity.canonicalSlug || docIdentity.stableId || '';
  return category && title ? `${category}:${title}` : title || category;
}

function inheritanceLabel(inheritance) {
  if (!inheritance) return 'none';
  const status = inheritance.status || 'unknown';
  const decision = (inheritance.decision || 'unknown').replace(/_/g, ' ');
  return `${status} / ${decision}`;
}

function renderTable(proposals) {
  const lines = [
    '| Proposal ID | Action | Doc identity | v2.6.x decision | v3.0.x inheritance |',
    '|---|---:|---|---|---|',
  ];

  for (const proposal of proposals) {
    lines.push([
      `\`${escapeCell(proposal.id)}\``,
      escapeCell(proposal.actionIntent || proposal.action || ''),
      `\`${escapeCell(docIdentityLabel(proposal.docIdentity))}\``,
      escapeCell(decisionLabel(proposal.decision)),
      escapeCell(inheritanceLabel(proposal.inheritance)),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  return lines.join('\n');
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    usage();
    process.exit(2);
  }

  const artifact = readJson(inputPath);
  if (!Array.isArray(artifact.proposals)) {
    throw new Error(`Expected proposals[] in ${path.relative(process.cwd(), inputPath)}`);
  }

  process.stdout.write(`${renderTable(artifact.proposals)}\n`);
}

main();
