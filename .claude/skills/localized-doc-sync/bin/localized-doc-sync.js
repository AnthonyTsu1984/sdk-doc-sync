#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalStringify } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { profileTableSchema } = require('../src/schema-profiler');
const { mapTables } = require('../src/table-mapper');
const { buildTranslationPairs, resolveTableIdentities } = require('../src/identity-resolver');
const { buildScanManifest } = require('../src/issue-classifier');
const { buildReviewUnits } = require('../src/planner');
const { executeReviewUnit } = require('../src/executor');

function parseArgs(argv) {
  const args = { command: argv[2] || null };
  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith('--') && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      args[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[++index];
    } else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  return args;
}

function required(args, name) {
  if (!args[name]) throw new Error(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, canonicalStringify(value));
  return resolved;
}

function stableIssues(issues) {
  return (issues || []).map((entry) => {
    if (entry.issueId) return entry;
    const semantic = { ...entry };
    return { issueId: `issue:${digestSemantic(semantic).slice(7, 23)}`, ...semantic };
  });
}

function roleNames(profile) {
  return Object.fromEntries(Object.entries(profile.roles || {}).map(([role, field]) => [role, field.fieldName]));
}

function buildManifestFromSnapshots({ sourceBase, targetBase, tablePolicy, localePolicy, translationPairs = [], identityOverrides = [] }) {
  const sourceProfiles = (sourceBase.tables || []).map((table) => profileTableSchema({
    table,
    rolePolicy: localePolicy.rolePolicy || {},
    activeViewId: localePolicy.activeViewIds?.[table.tableId] || null,
  }));
  const targetProfiles = (targetBase.tables || []).map((table) => profileTableSchema({
    table,
    rolePolicy: localePolicy.rolePolicy || {},
    activeViewId: localePolicy.activeViewIds?.[table.tableId] || null,
  }));
  const mapping = mapTables({ sourceTables: sourceBase.tables, targetTables: targetBase.tables, policy: tablePolicy });
  const sourceIdentities = [];
  const targetIdentities = [];
  const identityIssues = [];
  for (const [base, profiles, locale] of [[sourceBase, sourceProfiles, 'en'], [targetBase, targetProfiles, 'zh']]) {
    for (const table of base.tables || []) {
      const profile = profiles.find((entry) => entry.tableId === table.tableId);
      const roles = roleNames(profile);
      const nonRefRecords = (table.records || []).filter((record) => (
        String(record?.fields?.[roles.placement] || '').toLowerCase() !== 'ref'
      ));
      const resolved = resolveTableIdentities({
        records: nonRefRecords,
        roles,
        locale,
        translationPairs,
      });
      const scoped = resolved.identities.map((entry) => ({ ...entry, locale, tableId: table.tableId }));
      if (locale === 'en') sourceIdentities.push(...scoped);
      else targetIdentities.push(...scoped);
      identityIssues.push(...resolved.issues.map((entry) => ({ ...entry, locale, tableId: table.tableId })));
    }
  }
  const paired = buildTranslationPairs({
    sourceIdentities,
    targetIdentities,
    tableMappings: mapping.mappings,
    identityOverrides,
  });
  const resolvedTranslationPairs = [...translationPairs, ...paired.translationPairs]
    .filter((entry, index, array) => array.findIndex((item) => item.translationPairId === entry.translationPairId) === index)
    .sort((a, b) => a.translationPairId.localeCompare(b.translationPairId));
  const refIdentities = [];
  for (const [base, profiles, locale] of [[sourceBase, sourceProfiles, 'en'], [targetBase, targetProfiles, 'zh']]) {
    for (const table of base.tables || []) {
      const profile = profiles.find((entry) => entry.tableId === table.tableId);
      const roles = roleNames(profile);
      const refs = (table.records || []).filter((record) => String(record?.fields?.[roles.placement] || '').toLowerCase() === 'ref');
      const resolved = resolveTableIdentities({ records: refs, roles, locale, translationPairs: resolvedTranslationPairs });
      refIdentities.push(...resolved.identities.map((entry) => ({ ...entry, locale, tableId: table.tableId })));
      identityIssues.push(...resolved.issues.map((entry) => ({ ...entry, locale, tableId: table.tableId })));
    }
  }
  const placementIdentities = [...sourceIdentities, ...targetIdentities, ...refIdentities];
  const issues = stableIssues([
    ...mapping.issues,
    ...paired.issues,
    ...sourceProfiles.flatMap((profile) => profile.issues.map((entry) => ({ ...entry, tableId: profile.tableId, locale: 'en' }))),
    ...targetProfiles.flatMap((profile) => profile.issues.map((entry) => ({ ...entry, tableId: profile.tableId, locale: 'zh' }))),
    ...identityIssues,
  ]);
  return buildScanManifest({
    sourceBase,
    targetBase,
    schemaProfiles: [...sourceProfiles, ...targetProfiles],
    tableMappings: mapping.mappings,
    placementIdentities,
    translationPairs: resolvedTranslationPairs,
    translationReceiptDigests: localePolicy.translationReceiptDigests || [],
    hierarchyPolicies: localePolicy.hierarchyPolicies || [],
    localePolicyDigest: digestSemantic(localePolicy),
    issues,
  });
}

async function runCli({ argv = process.argv, dependencies = {} } = {}) {
  const args = parseArgs(argv);
  const out = dependencies.onStdout || ((line) => console.log(line));
  if (args.command === 'scan') {
    for (const name of ['sourceSnapshot', 'targetSnapshot', 'tableMap', 'localePolicy', 'output']) required(args, name);
    const manifest = buildManifestFromSnapshots({
      sourceBase: readJson(args.sourceSnapshot),
      targetBase: readJson(args.targetSnapshot),
      tablePolicy: readJson(args.tableMap),
      localePolicy: readJson(args.localePolicy),
      translationPairs: args.translationPairs ? readJson(args.translationPairs) : [],
      identityOverrides: args.identityOverrides ? readJson(args.identityOverrides).overrides || [] : [],
    });
    writeJson(args.output, manifest);
    out(`Full scan manifest: ${manifest.semanticDigest}`);
    return manifest;
  }
  if (args.command === 'plan') {
    for (const name of ['scanManifest', 'output']) required(args, name);
    const manifest = readJson(args.scanManifest);
    if (manifest.completeInventory !== true || manifest.partialScanAuthoritative === true) throw new Error('Planning requires a complete full-Base scan manifest');
    const units = buildReviewUnits({ scanManifestDigest: manifest.semanticDigest, issues: manifest.issues || [] });
    writeJson(args.output, units);
    out(`Review units: ${units.length}`);
    return units;
  }
  if (args.command === 'execute') {
    for (const name of ['unit', 'batch', 'approval', 'adapterModule', 'journal', 'output']) required(args, name);
    const adapter = dependencies.adapter || require(path.resolve(args.adapterModule));
    const result = await executeReviewUnit({
      unit: readJson(args.unit),
      batch: readJson(args.batch),
      approval: readJson(args.approval),
      adapter,
      journalPath: path.resolve(args.journal),
    });
    writeJson(args.output, result);
    out(`Execution status: ${result.status}`);
    return result;
  }
  throw new Error('Command must be scan, plan, or execute');
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { buildManifestFromSnapshots, parseArgs, runCli };
