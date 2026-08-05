'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ZillizCliScanner = require('./zilliz-cli-scanner');

const FRAMEWORK_FLAGS = new Set(['--help', '--output', '--no-header', '--query', '--all', '--body']);

function parseHandwrittenOps(helpContent) {
  const match = helpContent.match(/const\s+HAND_WRITTEN_OPS:\s*&\[\(&str,\s*&str,\s*&str\)\]\s*=\s*&\[([\s\S]*?)\];/);
  if (!match) return [];
  const body = match[1]
    .replace(/\(\s*\n\s*"/g, '("')
    .replace(/",\s*\n\s*"/g, '","')
    .replace(/",\s*\n\s*\)/g, '")');
  const ops = [];
  const lineRegex = /\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\)/g;
  let item;
  while ((item = lineRegex.exec(body)) !== null) {
    ops.push({ resource: item[1], operation: item[2], description: item[3] });
  }
  return ops;
}

function flagsFromSource(content) {
  return [...new Set((content.match(/--[a-z0-9][a-z0-9-]*/gi) || [])
    .filter((flag) => !FRAMEWORK_FLAGS.has(flag))
    .sort())];
}

function metadataFlags(config) {
  if (!config) return [];
  if (Array.isArray(config)) return config.map((param) => param.name).filter((name) => name?.startsWith('--')).sort();
  const flags = [];
  for (const param of config.params || []) flags.push(param.name);
  for (const param of config.commonParams || []) flags.push(param.name);
  for (const param of config.installExtras || []) flags.push(param.name);
  return [...new Set(flags.filter((name) => name?.startsWith('--')))].sort();
}

function sourceFileFor({ rootDir, resource }) {
  return path.join(rootDir, 'src', 'cli', `${resource.replace(/-/g, '_')}.rs`);
}

function auditHandwrittenCommands({
  rootDir,
  metadata = ZillizCliScanner.RUST_HANDWRITTEN_OP_PARAMS,
  fsModule = fs,
} = {}) {
  const helpFile = path.join(rootDir, 'src', 'cli', 'help.rs');
  const helpContent = fsModule.readFileSync(helpFile, 'utf8');
  const ops = parseHandwrittenOps(helpContent);
  const diagnostics = [];
  const results = [];
  const seenKeys = new Set();

  for (const op of ops) {
    const key = `${op.resource}-${op.operation}`;
    const metadataKey = op.resource === 'milvus' && op.operation === 'standalone' ? 'milvus-standalone' : key;
    seenKeys.add(metadataKey);
    const config = metadata[metadataKey];
    const sourceFile = sourceFileFor({ rootDir, resource: op.resource });
    const sourceExists = fsModule.existsSync(sourceFile);
    const sourceFlags = sourceExists ? flagsFromSource(fsModule.readFileSync(sourceFile, 'utf8')) : [];
    const scannerFlags = metadataFlags(config);
    const missingFlags = sourceFlags.filter((flag) => !scannerFlags.includes(flag));
    const staleFlags = scannerFlags.filter((flag) => !sourceFlags.includes(flag));
    const item = {
      key: metadataKey,
      resource: op.resource,
      operation: op.operation,
      sourceFile: path.relative(rootDir, sourceFile).replace(/\\/g, '/'),
      sourceExists,
      sourceFlags,
      scannerFlags,
      missingFlags,
      staleFlags,
    };
    results.push(item);

    if (!config) {
      diagnostics.push({
        level: 'error',
        code: 'HANDWRITTEN_METADATA_MISSING',
        message: `${metadataKey} is registered in help.rs but missing from RUST_HANDWRITTEN_OP_PARAMS.`,
      });
    }
    for (const flag of missingFlags) {
      diagnostics.push({
        level: 'warn',
        code: 'HANDWRITTEN_FLAG_MISSING',
        message: `${metadataKey} source mentions ${flag}, but scanner metadata does not.`,
      });
    }
    for (const flag of staleFlags) {
      diagnostics.push({
        level: 'warn',
        code: 'HANDWRITTEN_FLAG_STALE',
        message: `${metadataKey} scanner metadata includes ${flag}, but source does not mention it.`,
      });
    }
  }

  for (const key of Object.keys(metadata).sort()) {
    if (!seenKeys.has(key)) {
      diagnostics.push({
        level: 'warn',
        code: 'HANDWRITTEN_METADATA_STALE',
        message: `${key} exists in RUST_HANDWRITTEN_OP_PARAMS but is not registered in help.rs.`,
      });
    }
  }

  return {
    schemaVersion: 1,
    kind: 'zilliz-cli-handwritten-audit',
    rootDir,
    checkedCount: results.length,
    results: results.sort((a, b) => a.key.localeCompare(b.key)),
    diagnostics: diagnostics.sort((a, b) => `${a.code}:${a.message}`.localeCompare(`${b.code}:${b.message}`)),
    ok: diagnostics.length === 0,
  };
}

module.exports = {
  auditHandwrittenCommands,
  parseHandwrittenOps,
  flagsFromSource,
};
