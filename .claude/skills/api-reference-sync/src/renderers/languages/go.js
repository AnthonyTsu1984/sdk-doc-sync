'use strict';

const { createSdkRenderer } = require('../sdk-renderer');
const profiles = require('../sdk-layout-profiles');

module.exports = createSdkRenderer({
  id: 'go',
  profile: profiles.go,
  canonicalFence: 'Go',
  requestFence: 'Go',
  exampleFence: 'Go',
  requestHeading: 'Request Syntax{#request-syntax}',
  parametersLabel: 'PARAMETERS:',
  primaryInputs: (document) => document.signatures[0]?.inputs || [],
  memberKind: 'option',
  membersLabel: (document) => ['struct', 'class'].includes(document.identity.kind)
    ? 'METHODS:'
    : 'BUILDER METHODS:',
  // Type-page channel (2026-10-08): struct pages list their fields under
  // FIELDS:, enum pages list members with their constants under VALUES: —
  // the shapes the upstream PR pages and the live KB already use.
  typeFieldsLabel: 'FIELDS:',
  typeValuesLabel: 'VALUES:',
  resultTypeLabel: 'RETURN TYPE:',
  returnsLabel: 'RETURNS:',
  resultMethodsLabel: 'METHODS:',
  errorsLabel: 'ERROR HANDLING:',
  exampleHeading: 'Example{#example}',
});
