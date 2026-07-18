'use strict';

const { createSdkRenderer } = require('../sdk-renderer');

function requestEntries(document) {
  const signature = document.signatures[0];
  if (!signature || signature.inputs.length === 0) return [];
  return [{ id: 'primary', title: '', description: '', signature, inputs: [] }];
}

function requestSignature(document) {
  const exampleSetup = document.examples[0]?.code?.split('\n')[0];
  return exampleSetup || document.signatures[0].display;
}

module.exports = createSdkRenderer({
  id: 'go',
  canonicalFence: 'Go',
  requestFence: 'Go',
  exampleFence: 'Go',
  requestHeading: 'Request Syntax{#request-syntax}',
  requestEntries,
  requestSignature,
  parametersLabel: 'PARAMETERS:',
  primaryInputs: (document) => document.signatures[0]?.inputs || [],
  memberKind: 'option',
  membersLabel: 'OPTION METHODS:',
  resultTypeLabel: 'RETURN TYPE:',
  returnsLabel: 'RETURNS:',
  errorsLabel: 'EXCEPTIONS:',
  exampleHeading: 'Example{#example}',
});
