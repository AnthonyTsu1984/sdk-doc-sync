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
  variantHeadings: true,
  variantFields: true,
  parametersLabel: 'PARAMETERS:',
  memberKind: 'implementation',
  membersLabel: 'IMPLEMENTATIONS:',
  returnsLabel: 'RETURNS:',
  errorsLabel: 'EXCEPTIONS:',
  exampleHeading: 'Example{#example}',
});
