'use strict';

const { createSdkRenderer } = require('../sdk-renderer');
const profiles = require('../sdk-layout-profiles');

module.exports = createSdkRenderer({
  id: 'python',
  profile: profiles.python,
  canonicalFence: 'Python',
  requestFence: 'Python',
  exampleFence: 'Python',
  codeVariantPolicy: { lineComment: '#' },
  requestHeading: 'Request Syntax{#request-syntax}',
  parametersLabel: 'PARAMETERS:',
  primaryInputs: (document) => document.signatures[0]?.inputs || [],
  resultTypeLabel: 'RETURN TYPE:',
  returnsLabel: 'RETURNS:',
  errorsLabel: 'EXCEPTIONS:',
  exampleHeading: 'Examples',
  showExampleTitles: false,
});
