'use strict';

const { createSdkRenderer } = require('../sdk-renderer');
const profiles = require('../sdk-layout-profiles');

module.exports = createSdkRenderer({
  id: 'node',
  profile: profiles.node,
  canonicalFence: 'TypeScript',
  requestFence: 'TypeScript',
  exampleFence: 'JavaScript',
  requestHeading: 'Request Syntax',
  variantHeadings: (document) => (document.requestVariants || []).length > 1,
  variantFields: true,
  parametersLabel: 'PARAMETERS:',
  // 2026-10-13 BulkWriter/Formatter ruling: type-page member channels must
  // not overlap with the shared implementation channel — the member filter
  // stays disjoint from 'implementation' (the two formatter classes ride
  // their own sections below).
  memberKind: ['option', 'method', 'member'],
  membersLabel: 'MEMBERS:',
  returnsLabel: 'RETURNS:',
  // 2026-10-12 node v3.0.6 operator ruling (FileResources:addFileResource doc
  // review): align node with the java-family split return section — RETURN
  // TYPE carries the bare type token, RETURNS carries the prose. node
  // profile declares returnSections.split so layout-conformance guards the
  // shape from here on.
  resultTypeLabel: 'RETURN TYPE:',
  // 2026-10-12 node v3.0.6 getTelemetry ruling: result fields that are
  // methods of the returned instance take the METHODS label (shared
  // renderer policy; ClientTelemetryManager is an opaque manager handle —
  // its whole response surface is methods), matching the python/go
  // resultMethodsLabel data.
  resultMethodsLabel: 'METHODS:',
  // 2026-10-13 Formatter REJECT_WRITES ruling: the interface's
  // implementations render as per-implementation H2 sections — one intro
  // sentence above them, then JsonFormatter/ParquetFormatter each carrying
  // the reviewed class shape (fence) and the persist parameter list. The
  // earlier single **IMPLEMENTATIONS:** labelled list is retired; go keeps
  // that label path until its own ruling.
  implementationSections: true,
  errorsLabel: 'EXCEPTIONS:',
  exampleHeading: 'Example{#example}',
  showExampleTitles: (document) => (document.examples || []).length > 1,
});
