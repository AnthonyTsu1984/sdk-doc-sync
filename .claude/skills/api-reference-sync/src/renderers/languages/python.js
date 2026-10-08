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
  // 2026-10-06 Volume ruling: enums expose values, classes expose methods —
  // both through the members channel (context.members).
  memberKind: ['method', 'member'],
  membersLabel: (document) => (document.callableMembers || []).some((m) => m.kind === 'method')
    ? 'METHODS:'
    : 'VALUES:',
  // 2026-10-06 Volume ruling: result fields that are methods of the returned
  // instance take the METHODS label (upstream LocalBulkWriter/ template).
  resultMethodsLabel: 'METHODS:',
  returnsLabel: 'RETURNS:',
  errorsLabel: 'EXCEPTIONS:',
  exampleHeading: 'Examples',
  showExampleTitles: false,
});
