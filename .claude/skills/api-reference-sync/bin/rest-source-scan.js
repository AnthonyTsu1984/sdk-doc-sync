#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {scanMilvusRoutes} = require('../src/rest-source/milvus-adapter');
const {scanZillizCloudRoutes} = require('../src/rest-source/zilliz-cloud-adapter');
const {reconcileControlPlane} = require('../src/rest-control-plane/reconcile');
const {buildSourceControlPlaneReview} = require('../src/rest-control-plane/source-review');

function args(argv) {
  const values = {};
  for (let index = 2; index < argv.length; index += 2) values[argv[index].replace(/^--/, '')] = argv[index + 1];
  return values;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), {recursive: true});
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function loadControlPlaneBaseRevision(scanStatePath) {
  try {
    const scanState = JSON.parse(fs.readFileSync(scanStatePath, 'utf8'));
    return scanState['control-plane']?.lastScannedHeadRevision || null;
  } catch {
    return null;
  }
}

function main(argv = process.argv) {
  const options = args(argv);
  if (options.plane === 'data') {
    const routes = scanMilvusRoutes({repo: options.repo, revision: options.revision});
    writeJson(options.output, {schemaVersion: 1, repository: 'milvus-io/milvus', revision: options.revision, routes});
    return 0;
  }
  if (options.plane === 'control') {
    const config = JSON.parse(fs.readFileSync(options.config, 'utf8'));
    const inventory = scanZillizCloudRoutes({repo: options.repo, revision: options.revision, config});
    let baseRevision = options['base-revision'];
    if (!baseRevision) {
      const scanStatePath = path.resolve(__dirname, '..', 'scan-state.json');
      baseRevision = loadControlPlaneBaseRevision(scanStatePath);
      if (baseRevision) {
        process.stderr.write(`Using control-plane base revision from scan-state.json: ${baseRevision}\n`);
      }
    }
    if (baseRevision) {
      const baseInventory = scanZillizCloudRoutes({repo: options.repo, revision: baseRevision, config});
      writeJson(options.output, buildSourceControlPlaneReview({baseInventory, headInventory: inventory}));
      return 0;
    }
    const value = options['zdoc-fragments']
      ? reconcileControlPlane({inventory, config, zdocRoot: options['zdoc-fragments']}) : inventory;
    writeJson(options.output, value);
    return 0;
  }
  throw new Error('Expected --plane data or --plane control');
}

if (require.main === module) {
  try { process.exitCode = main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = {args, main};
