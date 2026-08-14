'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {canonicalBytes} = require('../../../doc-ops-core/src/canonical-json');
const {
  assertDigest,
  buildCollectionManifest,
  fragmentFilename,
  operationCount,
  sha256Digest,
} = require('./collection-manifest');

function prettyBytes(value) {
  const canonical = JSON.parse(canonicalBytes(value).toString('utf8'));
  return Buffer.from(`${JSON.stringify(canonical, null, 2)}\n`, 'utf8');
}

function canonicalFragment(spec, options) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('REST_SPEC_INVALID');
  if (!spec.openapi || !spec.paths) throw new Error('REST_SPEC_INVALID: openapi and paths are required');
  return {
    ...structuredClone(spec),
    'x-zdoc-fragment': {
      schemaVersion: '1.0',
      apiSurface: options.apiSurface,
      service: options.serviceId,
    },
  };
}

function verifyReviewBinding(reviewManifest, options) {
  const manifestDigest = assertDigest(reviewManifest?.manifestDigest, 'review manifest digest');
  if (manifestDigest !== options.reviewManifestDigest) throw new Error('REST_REVIEW_DIGEST_MISMATCH');
  const sourceRevisions = new Set((reviewManifest.units || [])
    .map(unit => unit.sourceEvidence?.revision)
    .filter(Boolean));
  if (sourceRevisions.size > 0 && (sourceRevisions.size !== 1 || !sourceRevisions.has(options.source.revision))) {
    throw new Error('REST_REVIEW_SOURCE_MISMATCH');
  }
  if (options.releaseTrack && Array.isArray(reviewManifest.tracks) && !reviewManifest.tracks.includes(options.releaseTrack)) {
    throw new Error('REST_REVIEW_TRACK_MISMATCH');
  }
}

function prepareFragmentCollection(options) {
  verifyReviewBinding(options.reviewManifest, options);
  const serviceId = options.serviceId;
  const fragment = canonicalFragment(options.spec, {apiSurface: options.apiSurface, serviceId});
  const bytes = prettyBytes(fragment);
  const filename = fragmentFilename(serviceId);
  const service = {
    id: serviceId,
    fragment: filename,
    sha256: sha256Digest(bytes),
    operationCount: operationCount(fragment),
  };
  const manifest = buildCollectionManifest({
    apiSurface: options.apiSurface,
    releaseTrack: options.releaseTrack,
    source: options.source,
    generator: options.generator,
    review: {
      manifestDigest: options.reviewManifestDigest,
      approvalDigest: options.approvalDigest,
    },
    services: [service],
  });
  const manifestBytes = prettyBytes(manifest);
  return {
    manifest,
    files: [
      {filename, bytes, sha256: service.sha256},
      {filename: 'collection-manifest.json', bytes: manifestBytes, sha256: sha256Digest(manifestBytes)},
    ],
  };
}

function writeFragmentCollection(outputDirectory, prepared) {
  const parent = path.dirname(path.resolve(outputDirectory));
  fs.mkdirSync(parent, {recursive: true});
  const temporary = fs.mkdtempSync(path.join(parent, '.rest-fragments-'));
  try {
    for (const file of prepared.files) fs.writeFileSync(path.join(temporary, file.filename), file.bytes);
    if (fs.existsSync(outputDirectory)) throw new Error(`REST_OUTPUT_EXISTS: ${outputDirectory}`);
    fs.renameSync(temporary, outputDirectory);
  } catch (error) {
    fs.rmSync(temporary, {recursive: true, force: true});
    throw error;
  }
  return prepared.files.map(file => ({...file, path: path.join(outputDirectory, file.filename)}));
}

module.exports = {canonicalFragment, prepareFragmentCollection, prettyBytes, writeFragmentCollection};
