#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {inventoryOpenApi} = require('../src/rest-track/openapi-inventory');
const {buildRestReviewManifest} = require('../src/rest-track/review-manifest');
const {normalizeReleaseTrack} = require('../src/rest-track/release-track');
const FULL_SHA = /^[a-f0-9]{40}$/;

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value) throw new UsageError(`Missing value for ${flag}`);
  return value;
}

function parseTrackSpec(value) {
  const separator = value.indexOf('=');
  if (separator <= 0 || separator === value.length - 1) {
    throw new UsageError(`Invalid --track-spec: ${value}`);
  }
  const track = value.slice(0, separator);
  const file = value.slice(separator + 1);
  return {track: normalizeReleaseTrack(track), file};
}

function parseSourceRevision(value) {
  const separator = value.indexOf('=');
  if (separator <= 0 || separator === value.length - 1) {
    throw new UsageError(`Invalid --source-revision: ${value}`);
  }
  const track = normalizeReleaseTrack(value.slice(0, separator));
  const source = value.slice(separator + 1);
  const at = source.lastIndexOf('@');
  if (at <= 0 || at === source.length - 1) {
    throw new UsageError(`Invalid --source-revision source: ${value}`);
  }
  const revision = source.slice(at + 1);
  if (!FULL_SHA.test(revision)) throw new UsageError(`Source revision must be a full Git SHA: ${value}`);
  return {
    track,
    repository: source.slice(0, at),
    revision,
  };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const trackSpecs = new Map();
  const sourceRevisions = new Map();
  let managedFloor = '2.6.x';
  let output = null;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--track-spec') {
      const parsed = parseTrackSpec(requireValue(args, index, flag));
      index += 1;
      if (trackSpecs.has(parsed.track)) throw new UsageError(`Duplicate track: ${parsed.track}`);
      trackSpecs.set(parsed.track, parsed.file);
    } else if (flag === '--source-revision') {
      const parsed = parseSourceRevision(requireValue(args, index, flag));
      index += 1;
      if (sourceRevisions.has(parsed.track)) throw new UsageError(`Duplicate source revision: ${parsed.track}`);
      sourceRevisions.set(parsed.track, {
        repository: parsed.repository,
        revision: parsed.revision,
      });
    } else if (flag === '--managed-floor') {
      managedFloor = normalizeReleaseTrack(requireValue(args, index, flag));
      index += 1;
    } else if (flag === '--output') {
      output = requireValue(args, index, flag);
      index += 1;
    } else if (flag === '--json') {
      json = true;
    } else {
      throw new UsageError(`Unknown flag: ${flag}`);
    }
  }

  if (!output) throw new UsageError('Missing required --output');
  if (trackSpecs.size === 0) throw new UsageError('At least one --track-spec is required');
  const trackKeys = [...trackSpecs.keys()].sort();
  const sourceKeys = [...sourceRevisions.keys()].sort();
  if (trackKeys.length !== sourceKeys.length || trackKeys.some((key, index) => key !== sourceKeys[index])) {
    throw new UsageError('--track-spec and --source-revision must map one-to-one');
  }

  return {trackSpecs, sourceRevisions, managedFloor, output, json};
}

function inventoryFromSpec(track, file) {
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  return inventoryOpenApi(spec, {
    track,
    sourceFile: path.basename(file),
  });
}

function main(argv = process.argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`);
      return 64;
    }
    process.stderr.write(`${error.message}\n`);
    return 64;
  }

  try {
    const tracks = [...options.trackSpecs].map(([track, file]) => inventoryFromSpec(track, file));
    const manifest = buildRestReviewManifest({
      tracks,
      managedFloor: options.managedFloor,
      sourceEvidence: Object.fromEntries([...options.sourceRevisions]),
    });
    const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

    if (options.output) {
      const destination = path.resolve(options.output);
      const temporary = `${destination}.tmp`;
      fs.mkdirSync(path.dirname(destination), {recursive: true});
      fs.writeFileSync(temporary, serialized, 'utf8');
      fs.renameSync(temporary, destination);
    }

    if (options.json) {
      process.stdout.write(serialized);
    } else {
      process.stdout.write(`Wrote manifest: ${options.output}\nDigest: ${manifest.manifestDigest}\n`);
    }
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {main, parseArgs};
