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

function requestEntries(document) {
  const members = document.callableMembers.filter((member) => member.kind === 'request');
  if (members.length === 0) return [];
  return document.requestVariants || [];
}

function requestContractHeading(document) {
  const variants = document.requestVariants || [];
  return variants.length === 1 ? variants[0].title || variants[0].id : null;
}

module.exports = createSdkRenderer({
  id: 'cpp',
  profile: profiles.cpp,
  canonicalFence: 'C++',
  requestFence: 'C++',
  exampleFence: 'C++',
  requestHeading: 'Request Syntax{#request-syntax}',
  requestEntries,
  requestSignature,
  showRequestDescriptions: false,
  parametersLabel: 'PARAMETERS:',
  memberKind: 'request',
  membersLabel: 'REQUEST METHODS:',
  membersHeading: requestContractHeading,
  membersHeadingLevel: 3,
  returnsLabel: 'RETURNS:',
  errorsLabel: 'ERROR HANDLING:',
  exampleHeading: 'Example{#example}',
});
