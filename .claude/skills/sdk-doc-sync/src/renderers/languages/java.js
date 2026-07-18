'use strict';

const { createSdkRenderer } = require('../sdk-renderer');

function requestSignature(document, variant) {
  const members = document.callableMembers.filter((member) => member.kind === 'builder');
  if (members.length === 0) return variant.signature.display;
  return [
    variant.signature.display,
    ...members.map((member) => `    .${member.name}(${member.signature.inputs[0]?.name || member.name})`),
    '    .build();',
  ].join('\n');
}

module.exports = createSdkRenderer({
  id: 'java',
  canonicalFence: 'Java',
  requestFence: 'Java',
  exampleFence: 'Java',
  requestHeading: 'Request Syntax{#request-syntax}',
  requestSignature,
  parametersLabel: 'PARAMETERS:',
  memberKind: 'builder',
  membersLabel: 'BUILDER METHODS:',
  returnsLabel: 'RETURNS:',
  errorsLabel: 'EXCEPTIONS:',
  exampleHeading: 'Example{#example}',
});
