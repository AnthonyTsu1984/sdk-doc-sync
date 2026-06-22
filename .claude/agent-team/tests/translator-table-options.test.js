const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DOTENV_CONFIG_QUIET = 'true';
const FeishuDocTranslator = require('../../skills/sdk-doc-sync/src/feishu-doc-translator');
const { parseArgs } = require('../../skills/sdk-doc-sync/bin/feishu-doc-translator');

test('FeishuDocTranslator passes table ids into bitable readers and writer', () => {
  const translator = new FeishuDocTranslator({
    sourceBitable: 'src_base',
    targetBitable: 'tgt_base',
    sourceTableId: 'src_table',
    targetTableId: 'tgt_table',
    sourceRoot: 'src_root',
    targetRoot: 'tgt_root',
    translatorType: 'feishu',
    dryRun: true,
  });
  assert.equal(translator.sourceTableId, 'src_table');
  assert.equal(translator.targetTableId, 'tgt_table');
  assert.equal(translator.sourceReader.tableId, 'src_table');
  assert.equal(translator.targetReader.tableId, 'tgt_table');
  assert.equal(translator.targetWriter.tableId, 'tgt_table');
});

test('parseArgs reads source and target table options', () => {
  const args = parseArgs([
    'node',
    'feishu-doc-translator',
    '--source-bitable',
    'src_base',
    '--target-bitable',
    'tgt_base',
    '--source-table',
    'src_table',
    '--target-table',
    'tgt_table',
  ]);
  assert.equal(args.sourceTableId, 'src_table');
  assert.equal(args.targetTableId, 'tgt_table');
});
