#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {prepareFragmentCollection, writeFragmentCollection} = require('../src/rest-fragments/fragment-producer');
const {assertDigest, assertFullSha} = require('../src/rest-fragments/collection-manifest');
const {normalizeReleaseTrack} = require('../src/rest-track/release-track');
const {buildControlPlaneReviewManifest} = require('../src/rest-control-plane/review-manifest');

class UsageError extends Error {}

function valueAfter(args, index, flag) {
  const value = args[index + 1];
  if (!value) throw new UsageError(`Missing value for ${flag}`);
  return value;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args.shift();
  if (!['produce-data-plane', 'review-control-plane', 'produce-control-plane'].includes(command)) {
    throw new UsageError('Expected command: produce-data-plane, review-control-plane, or produce-control-plane');
  }
  const options = {command, apiSurface: command.includes('control-plane') ? 'control-plane' : 'data-plane'};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag.startsWith('--')) throw new UsageError(`Unexpected argument: ${flag}`);
    const value = valueAfter(args, index, flag);
    index += 1;
    if (flag === '--spec') options.spec = value;
    else if (flag === '--base-spec') options.baseSpec = value;
    else if (flag === '--head-spec') options.headSpec = value;
    else if (flag === '--service-id') options.serviceId = value;
    else if (flag === '--source-repository') options.sourceRepository = value;
    else if (flag === '--source-revision') options.sourceRevision = value;
    else if (flag === '--base-revision') options.baseRevision = value;
    else if (flag === '--generator-repository') options.generatorRepository = value;
    else if (flag === '--generator-revision') options.generatorRevision = value;
    else if (flag === '--config-digest') options.configDigest = value;
    else if (flag === '--review-manifest') options.reviewManifest = value;
    else if (flag === '--approval-digest') options.approvalDigest = value;
    else if (flag === '--release-track') options.releaseTrack = value;
    else if (flag === '--output') options.output = value;
    else throw new UsageError(`Unknown flag: ${flag}`);
  }
  const requiredFields = command === 'review-control-plane'
    ? ['baseSpec', 'headSpec', 'serviceId', 'sourceRepository', 'baseRevision', 'sourceRevision', 'output']
    : ['spec', 'serviceId', 'sourceRepository', 'sourceRevision', 'generatorRepository',
      'generatorRevision', 'configDigest', 'reviewManifest', 'approvalDigest', 'output'];
  for (const required of requiredFields) {
    if (!options[required]) throw new UsageError(`Missing required --${required.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`);
  }
  options.sourceRevision = assertFullSha(options.sourceRevision, 'source revision');
  if (options.baseRevision) options.baseRevision = assertFullSha(options.baseRevision, 'base revision');
  if (command === 'review-control-plane') return options;
  options.generatorRevision = assertFullSha(options.generatorRevision, 'generator revision');
  options.configDigest = assertDigest(options.configDigest, 'config digest');
  options.approvalDigest = assertDigest(options.approvalDigest, 'approval digest');
  if (options.releaseTrack) options.releaseTrack = normalizeReleaseTrack(options.releaseTrack);
  return options;
}

function main(argv = process.argv) {
  try {
    const options = parseArgs(argv);
    if (options.command === 'review-control-plane') {
      const manifest = buildControlPlaneReviewManifest({
        serviceId: options.serviceId,
        repository: options.sourceRepository,
        baseRevision: options.baseRevision,
        headRevision: options.sourceRevision,
        baseSpec: JSON.parse(fs.readFileSync(options.baseSpec, 'utf8')),
        headSpec: JSON.parse(fs.readFileSync(options.headSpec, 'utf8')),
      });
      const destination = path.resolve(options.output);
      fs.mkdirSync(path.dirname(destination), {recursive: true});
      const temporary = `${destination}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
      fs.renameSync(temporary, destination);
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
      return 0;
    }
    const spec = JSON.parse(fs.readFileSync(options.spec, 'utf8'));
    const reviewManifest = JSON.parse(fs.readFileSync(options.reviewManifest, 'utf8'));
    const prepared = prepareFragmentCollection({
      apiSurface: options.apiSurface,
      releaseTrack: options.releaseTrack,
      serviceId: options.serviceId,
      spec,
      source: {repository: options.sourceRepository, revision: options.sourceRevision},
      generator: {
        repository: options.generatorRepository,
        revision: options.generatorRevision,
        configDigest: options.configDigest,
      },
      reviewManifest,
      reviewManifestDigest: reviewManifest.manifestDigest,
      approvalDigest: options.approvalDigest,
    });
    const written = writeFragmentCollection(path.resolve(options.output), prepared);
    process.stdout.write(`${JSON.stringify({manifest: prepared.manifest, files: written.map(file => ({filename: file.filename, sha256: file.sha256}))}, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return error instanceof UsageError || /_INVALID|Missing required|Expected command/.test(error.message) ? 64 : 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {main, parseArgs};
