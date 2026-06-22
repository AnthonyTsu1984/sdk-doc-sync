const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig } = require('../src/config');

function validConfig() {
  return {
    feishu: { chatId: 'oc_chat', approverIds: ['ou_user'] },
    github: { owner: 'zilliztech', repo: 'feishu-markdown-bridge', ref: 'master' },
    approvalConsumer: {
      decisionLogPath: '.claude/agent-team/state/decisions.jsonl',
      larkCliCommand: 'lark-cli',
      eventKey: 'im.message.receive_v1',
    },
    surfaces: {
      localization: {
        enabled: true,
        owner: 'localization-owner',
        sourceBaseToken: 'src_base',
        sourceTableIds: ['src_table_a', 'src_table_b'],
        sourceRootToken: 'src_root',
        targetBaseToken: 'tgt_base',
        targetTableIds: ['tgt_table_a', 'tgt_table_b'],
        targetRootToken: 'tgt_root',
        linkCheck: { enabled: true, checkMentionDoc: true, checkExternalLinks: true },
        allowedLiveActions: ['NEW', 'UPDATE', 'META_ONLY'],
      },
      sdkReference: {
        enabled: false,
        owners: [{ id: 'java-sdk-doc-owner', repo: 'milvus-io/milvus-sdk-java', defaultBranch: 'master' }],
      },
      restReference: {
        enabled: false,
        owners: [{ id: 'rest-api-doc-owner', repo: 'zilliztech/cloud-v2', defaultBranch: 'master' }],
      },
      cliReference: {
        enabled: false,
        owners: [{ id: 'cli-doc-owner', repo: 'zilliztech/zilliz-cli', defaultBranch: 'main' }],
      },
      guideDocs: { enabled: false, owner: 'guide-doc-owner', docs: [] },
      verifiedDocs: { enabled: false, owner: 'verified-doc-owner', docs: [] },
    },
  };
}

test('validateConfig accepts complete MVP config', () => {
  assert.equal(validateConfig(validConfig()).github.repo, 'feishu-markdown-bridge');
});

test('validateConfig requires disabled SDK and REST surfaces to be explicit', () => {
  const config = validConfig();
  delete config.surfaces.restReference;
  assert.throws(() => validateConfig(config), /surfaces\.restReference\.enabled/);
});

test('validateConfig rejects mismatched localization table mappings', () => {
  const config = validConfig();
  config.surfaces.localization.targetTableIds = ['tgt_table_a'];
  assert.throws(() => validateConfig(config), /sourceTableIds and surfaces\.localization\.targetTableIds/);
});

test('validateConfig rejects missing approver allowlist', () => {
  const config = validConfig();
  config.feishu.approverIds = [];
  assert.throws(() => validateConfig(config), /feishu\.approverIds/);
});

module.exports = {
  validConfig,
};
