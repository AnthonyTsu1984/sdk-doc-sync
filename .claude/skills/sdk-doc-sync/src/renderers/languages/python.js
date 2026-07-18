'use strict';

const { createSdkRenderer } = require('../sdk-renderer');

module.exports = createSdkRenderer({
  id: 'python',
  canonicalFence: 'Python',
  requestFence: 'Python',
  exampleFence: 'Python',
  requestHeading: 'Request Syntax{#request-syntax}',
  parametersLabel: 'PARAMETERS:',
  primaryInputs: (document) => document.signatures[0]?.inputs || [],
  resultTypeLabel: 'RETURN TYPE:',
  returnsLabel: 'RETURNS:',
  errorsLabel: 'EXCEPTIONS:',
  exampleHeading: 'Examples',
});
