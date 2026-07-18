'use strict';

const { createSdkRenderer } = require('../sdk-renderer');

module.exports = createSdkRenderer({
  id: 'go',
  canonicalFence: 'Go',
  requestFence: 'Go',
  exampleFence: 'Go',
  requestHeading: 'Request Syntax{#request-syntax}',
  parametersLabel: 'PARAMETERS:',
  primaryInputs: (document) => document.signatures[0]?.inputs || [],
  memberKind: 'option',
  membersLabel: 'OPTION METHODS:',
  resultTypeLabel: 'RETURN TYPE:',
  returnsLabel: 'RETURNS:',
  errorsLabel: 'ERROR HANDLING:',
  exampleHeading: 'Example{#example}',
});
