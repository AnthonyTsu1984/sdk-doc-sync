'use strict';

const { createSdkRenderer } = require('../sdk-renderer');
const profiles = require('../sdk-layout-profiles');

function requestSignature(document, variant) {
  const inputs = Array.isArray(variant.inputs) ? variant.inputs : [];
  if (inputs.length === 0) return variant.signature.display;
  return [
    variant.signature.display,
    ...inputs.map((input) => `    .${input.name}(${input.name})`),
    '    .build();',
  ].join('\n');
}

module.exports = createSdkRenderer({
  id: 'java',
  profile: profiles.java,
  canonicalFence: 'Java',
  requestFence: 'Java',
  exampleFence: 'Java',
  codeVariantPolicy: { lineComment: '//' },
  audienceVariantDetails: true,
  audienceDirective: (audience) => audience === 'milvus'
    ? { mode: 'exclude', target: 'zilliz' }
    : { mode: 'include', target: audience },
  requestHeading: 'Request Syntax{#request-syntax}',
  requestSignature,
  variantHeadings: (document) => (document.requestVariants || []).length > 1,
  variantFields: (document) => (document.requestVariants || []).length > 1,
  parametersLabel: 'PARAMETERS:',
  memberKind: 'builder',
  membersLabel: 'BUILDER METHODS:',
  returnsLabel: 'RETURNS:',
  errorsLabel: 'EXCEPTIONS:',
  exampleHeading: 'Example{#example}',
  showExampleTitles: false,
});
