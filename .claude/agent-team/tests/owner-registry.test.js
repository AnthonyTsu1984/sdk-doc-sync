const test = require('node:test');
const assert = require('node:assert/strict');
const { enabledOwnerRoutes, listOwnerRoutes, routeTask } = require('../src/owner-registry');

function config() {
  return {
    surfaces: {
      localization: { enabled: true, owner: 'localization-owner' },
      sdkReference: {
        enabled: false,
        owners: [{ id: 'java-sdk-doc-owner', repo: 'milvus-io/milvus-sdk-java' }],
      },
      restReference: {
        enabled: false,
        owners: [{ id: 'rest-api-doc-owner', repo: 'zilliztech/cloud-v2' }],
      },
      cliReference: {
        enabled: false,
        owners: [{ id: 'cli-doc-owner', repo: 'zilliztech/zilliz-cli' }],
      },
      guideDocs: { enabled: false, owner: 'guide-doc-owner' },
      verifiedDocs: { enabled: false, owner: 'verified-doc-owner' },
    },
  };
}

test('listOwnerRoutes includes localization, SDK, REST, CLI, guide, and verified domains', () => {
  const routes = listOwnerRoutes(config());
  assert.deepEqual(routes.map(route => route.owner), [
    'localization-owner',
    'java-sdk-doc-owner',
    'rest-api-doc-owner',
    'cli-doc-owner',
    'guide-doc-owner',
    'verified-doc-owner',
  ]);
});

test('enabledOwnerRoutes only enables localization in MVP config', () => {
  assert.deepEqual(enabledOwnerRoutes(config()).map(route => route.owner), ['localization-owner']);
});

test('routeTask rejects disabled SDK reference owner during MVP', () => {
  assert.throws(
    () => routeTask(config(), { workType: 'sdkReference', owner: 'java-sdk-doc-owner' }),
    /disabled/
  );
});
