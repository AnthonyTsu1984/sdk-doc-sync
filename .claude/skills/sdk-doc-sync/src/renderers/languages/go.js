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
  resultTypeLabel: 'RETURN TYPE:',
  returnsLabel: 'RETURNS:',
  errorsLabel: 'ERROR HANDLING:',
  exampleHeading: 'Example{#example}',
});
