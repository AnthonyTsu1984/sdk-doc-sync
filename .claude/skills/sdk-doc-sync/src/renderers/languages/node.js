'use strict';

const { createSdkRenderer } = require('../sdk-renderer');

module.exports = createSdkRenderer({
  id: 'node',
  canonicalFence: 'TypeScript',
  requestFence: 'TypeScript',
  exampleFence: 'JavaScript',
  requestHeading: 'Request Syntax',
  variantHeadings: true,
  variantFields: true,
  parametersLabel: 'PARAMETERS:',
  returnsLabel: 'RETURNS:',
  errorsLabel: 'EXCEPTIONS:',
  exampleHeading: 'Example{#example}',
});
