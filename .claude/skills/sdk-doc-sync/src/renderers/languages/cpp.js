'use strict';

const { createSdkRenderer } = require('../sdk-renderer');
const profiles = require('../sdk-layout-profiles');

function requestSignature(document, variant) {
  const members = document.callableMembers.filter((member) => member.kind === 'request');
  if (members.length === 0) return variant.signature.display;
  return [
    `auto request = ${variant.signature.display}()`,
    ...members.map((member, index) => {
      const suffix = index === members.length - 1 ? ';' : '';
      const args = member.signature.inputs.map((input) => input.name).join(', ');
      return `    .${member.name}(${args})${suffix}`;
    }),
  ].join('\n');
}

module.exports = createSdkRenderer({
  id: 'cpp',
  profile: profiles.cpp,
  canonicalFence: 'C++',
  requestFence: 'C++',
  exampleFence: 'C++',
  requestHeading: 'Request Syntax{#request-syntax}',
  requestSignature,
  parametersLabel: 'PARAMETERS:',
  memberKind: 'request',
  membersLabel: 'REQUEST METHODS:',
  returnsLabel: 'RETURNS:',
  errorsLabel: 'ERROR HANDLING:',
  exampleHeading: 'Example{#example}',
});
