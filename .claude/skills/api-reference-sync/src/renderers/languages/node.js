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
  memberKind: 'implementation',
  membersLabel: 'IMPLEMENTATIONS:',
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
  errorsLabel: 'EXCEPTIONS:',
  exampleHeading: 'Example{#example}',
  showExampleTitles: (document) => (document.examples || []).length > 1,
});
