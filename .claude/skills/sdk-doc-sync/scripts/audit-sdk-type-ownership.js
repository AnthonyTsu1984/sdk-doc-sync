#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_OPTIONS = ['records', 'ownership', 'ownerDocuments', 'output'];
const CLASSIFICATIONS = new Set(['standalone', 'method_owned', 'ambiguous']);

function parseArgs(argv = process.argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const option = key?.replace(/^--/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!REQUIRED_OPTIONS.includes(option)) throw new Error(`Unknown argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    args[option] = value;
    index += 1;
  }
  for (const option of REQUIRED_OPTIONS) {
    if (!args[option]) throw new Error(`Missing --${option.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  return args;
}

function listFrom(value, property) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.[property])) return value[property];
  throw new TypeError(`${property} must be an array`);
}

function ownershipEntries(ownership) {
  if (Array.isArray(ownership)) return ownership;
  if (Array.isArray(ownership?.entries)) return ownership.entries;
  if (ownership?.types && typeof ownership.types === 'object') {
    return Object.entries(ownership.types).map(([typeName, entry]) => ({ typeName, ...entry }));
  }
  throw new TypeError('ownership entries must be an array or types object');
}

function ownerStableId(owner, typeName) {
  return typeof owner === 'string' ? owner : owner?.stableId;
}

function ownerDocumentIndex(ownerDocuments) {
  const documents = listFrom(ownerDocuments, 'ownerDocuments');
  const index = new Map();
  for (const document of documents) {
    if (index.has(document.stableId)) {
      throw new TypeError(`Duplicate owner document stableId: ${document.stableId}`);
    }
    index.set(document.stableId, document);
  }
  return index;
}

function ownerLists(entry) {
  const lists = [
    entry.owners,
    entry.targets,
    entry.documentationOwnership?.owners,
    entry.documentationOwnership?.targets,
  ].filter((owners) => owners !== undefined);
  for (const owners of lists) {
    if (!Array.isArray(owners)) throw new TypeError(`Owners for ${entry.typeName || entry.title} must be an array`);
  }
  return lists;
}

function stableOwners(entry) {
  const typeName = typeNameFor(entry);
  return [...new Set(ownerLists(entry).flat().map((owner) => {
    const stableId = ownerStableId(owner, typeName);
    if (typeof stableId !== 'string' || stableId.trim().length === 0) {
      throw new TypeError(`Owner for ${typeName} requires a non-empty stableId`);
    }
    return stableId;
  }))].sort();
}

function typeNameFor(entry) {
  return entry.typeName || entry.title || entry.name;
}

function compareRecords(left, right) {
  const leftKey = [left.recordId, left.title, left.documentToken].join('\u0000');
  const rightKey = [right.recordId, right.title, right.documentToken].join('\u0000');
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function ownershipClassification(entry) {
  return entry.classification ?? entry.documentationOwnership?.classification;
}

function ownershipIndex(entries) {
  const index = new Map();
  for (const entry of entries) {
    const typeName = typeNameFor(entry);
    if (index.has(typeName)) throw new TypeError(`Duplicate ownership type name: ${typeName}`);
    const owners = stableOwners(entry);
    const declaredClassification = ownershipClassification(entry);
    const classification = declaredClassification ?? (ownerLists(entry).length > 0 ? 'method_owned' : undefined);
    if (classification === undefined) throw new TypeError(`Missing documentation ownership classification for ${typeName}`);
    if (!CLASSIFICATIONS.has(classification)) {
      throw new TypeError(`Unsupported documentation ownership classification: ${classification}`);
    }
    if (classification === 'ambiguous') throw new TypeError(`Ambiguous documentation ownership for ${typeName}`);
    if (classification === 'method_owned' && owners.length === 0) {
      throw new TypeError(`Method-owned type ${typeName} requires at least one owner`);
    }
    index.set(typeName, { ...entry, classification });
  }
  return index;
}

function canonicalPath(filePath) {
  const parts = [];
  let current = path.resolve(filePath);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(filePath);
    parts.unshift(path.basename(current));
    current = parent;
  }
  return path.join(fs.realpathSync(current), ...parts);
}

function assertDistinctOutput(args) {
  const outputPath = canonicalPath(args.output);
  for (const inputName of ['records', 'ownership', 'ownerDocuments']) {
    const inputPath = args[inputName];
    if (outputPath === canonicalPath(inputPath) || sameExistingFile(args.output, inputPath)) {
      throw new Error(`--output must not overwrite an input path: ${args[inputName]}`);
    }
  }
}

function sameExistingFile(leftPath, rightPath) {
  if (!fs.existsSync(leftPath) || !fs.existsSync(rightPath)) return false;
  const left = fs.statSync(leftPath);
  const right = fs.statSync(rightPath);
  return left.dev === right.dev && left.ino === right.ino;
}

function buildTypeOwnershipAudit({ records, ownership, ownerDocuments }) {
  const recordList = listFrom(records, 'records');
  const entries = ownershipEntries(ownership);
  const ownershipByTypeName = ownershipIndex(entries);
  const documentsByOwner = ownerDocumentIndex(ownerDocuments);
  const invalidSiblingRecords = recordList.flatMap((record) => {
    const typeName = record.typeName || record.title;
    const entry = ownershipByTypeName.get(typeName);
    const classification = entry?.classification || entry?.documentationOwnership?.classification;
    if (classification !== 'method_owned') return [];
    const owners = stableOwners(entry);
    return [{
      recordId: record.recordId,
      title: record.title,
      documentToken: record.documentToken,
      owners,
      embeddedInAllOwners: owners.every((stableId) => documentsByOwner.get(stableId)?.embeddedTypeNames?.includes(typeName)),
      proposedDisposition: 'REVIEW_CLEANUP_AFTER_EMBEDDING',
    }];
  }).sort(compareRecords);

  return {
    schemaVersion: 1,
    language: ownership.language,
    track: ownership.track,
    writesPerformed: false,
    invalidSiblingRecords,
  };
}

function main(argv = process.argv) {
  const args = parseArgs(argv);
  assertDistinctOutput(args);
  const audit = buildTypeOwnershipAudit({
    records: JSON.parse(fs.readFileSync(args.records, 'utf8')),
    ownership: JSON.parse(fs.readFileSync(args.ownership, 'utf8')),
    ownerDocuments: JSON.parse(fs.readFileSync(args.ownerDocuments, 'utf8')),
  });
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  assertDistinctOutput(args);
  fs.writeFileSync(args.output, `${JSON.stringify(audit, null, 2)}\n`);
  console.log(JSON.stringify({ output: args.output, invalidSiblingRecords: audit.invalidSiblingRecords.length }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { assertDistinctOutput, buildTypeOwnershipAudit, main, parseArgs };
