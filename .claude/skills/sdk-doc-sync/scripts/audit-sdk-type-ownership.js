#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_OPTIONS = ['records', 'ownership', 'ownerDocuments', 'output'];

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

function ownerStableId(owner) {
  return typeof owner === 'string' ? owner : owner?.stableId;
}

function ownerDocumentIndex(ownerDocuments) {
  const documents = listFrom(ownerDocuments, 'ownerDocuments');
  return new Map(documents.map((document) => [document.stableId, document]));
}

function stableOwners(entry) {
  const owners = entry.owners || entry.documentationOwnership?.owners || [];
  if (!Array.isArray(owners)) throw new TypeError(`Owners for ${entry.typeName || entry.title} must be an array`);
  return [...new Set(owners.map(ownerStableId).filter(Boolean))].sort();
}

function typeNameFor(entry) {
  return entry.typeName || entry.title || entry.name;
}

function compareRecords(left, right) {
  return [left.recordId, left.title, left.documentToken].join('\u0000')
    .localeCompare([right.recordId, right.title, right.documentToken].join('\u0000'));
}

function buildTypeOwnershipAudit({ records, ownership, ownerDocuments }) {
  const recordList = listFrom(records, 'records');
  const entries = ownershipEntries(ownership);
  const ownershipByTypeName = new Map(entries.map((entry) => [typeNameFor(entry), entry]));
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
  const audit = buildTypeOwnershipAudit({
    records: JSON.parse(fs.readFileSync(args.records, 'utf8')),
    ownership: JSON.parse(fs.readFileSync(args.ownership, 'utf8')),
    ownerDocuments: JSON.parse(fs.readFileSync(args.ownerDocuments, 'utf8')),
  });
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
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

module.exports = { buildTypeOwnershipAudit, main, parseArgs };
