'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MODULE_PATH = path.resolve(__dirname, '../src/translation-content.js');

test('translation content exposes only semantic units and restores protected bytes exactly', () => {
  assert.equal(fs.existsSync(MODULE_PATH), true, 'translation-content.js must implement the editable-byte boundary');
  const { prepareTranslationContent, applyTranslationResponse } = require(MODULE_PATH);
  const source = [
    '---',
    'title: "Configure Compaction"',
    'slug: /configure-compaction',
    'token: ABC123',
    'description: "Use Compaction safely."',
    '---',
    '',
    '# Configure Compaction {#configure-compaction}',
    '',
    'Use `compact()` with https://example.com/docs before deployment.',
    '',
    '```java',
    '// Create a collection',
    'client.compact();',
    '```',
    '',
    '<!-- feishu-block:board:blk123 -->',
    '<Supademo id="demo-1" title="Compaction demo" />',
    '<iframe src="https://figma.com/embed/1"></iframe>',
    '',
    '| Option | Meaning |',
    '| --- | --- |',
    '| `mode` | Compaction mode |',
    '',
  ].join('\n');

  const prepared = prepareTranslationContent(source, { idPrefix: 'doc' });
  assert.ok(prepared.units.some((unit) => unit.kind === 'heading'));
  assert.ok(prepared.units.some((unit) => unit.kind === 'frontmatter'));
  assert.ok(prepared.units.some((unit) => unit.kind === 'table-cell'));
  assert.ok(prepared.units.every((unit) => !unit.text.includes('// Create a collection')));
  assert.ok(prepared.units.every((unit) => !unit.text.includes('feishu-block:board')));
  assert.ok(prepared.units.every((unit) => !unit.text.includes('<Supademo')));
  assert.ok(prepared.units.every((unit) => !unit.text.includes('ABC123')));
  assert.ok(prepared.units.every((unit) => !unit.text.includes('/configure-compaction')));
  assert.ok(prepared.units.every((unit) => !unit.text.includes('figma.com/embed')));

  const translations = prepared.units.map((unit) => ({
    id: unit.id,
    text: unit.text
      .replace('Configure', '配置')
      .replace('Use', '使用')
      .replace('before deployment.', '后再部署。')
      .replace('Option', '选项')
      .replace('Meaning', '含义')
      .replace('Compaction mode', 'Compaction 模式'),
  }));
  const output = applyTranslationResponse(prepared, { translations });

  assert.match(output, /^# 配置 Compaction \{#configure-compaction\}/m);
  assert.match(output, /title: "配置 Compaction"/);
  assert.match(output, /slug: \/configure-compaction/);
  assert.match(output, /token: ABC123/);
  assert.match(output, /使用 `compact\(\)` with https:\/\/example\.com\/docs 后再部署。/);
  assert.match(output, /```java\n\/\/ Create a collection\nclient\.compact\(\);\n```/);
  assert.match(output, /<!-- feishu-block:board:blk123 -->/);
  assert.match(output, /<Supademo id="demo-1" title="Compaction demo" \/>/);
  assert.match(output, /<iframe src="https:\/\/figma\.com\/embed\/1"><\/iframe>/);

  assert.throws(
    () => applyTranslationResponse(prepared, { translations: translations.slice(1) }),
    /every semantic unit id exactly once/i,
  );
  assert.throws(
    () => applyTranslationResponse(prepared, {
      translations: translations.map((entry, index) => index === 0 ? { ...entry, text: `${entry.text} ⟦LDS:inline-code:9999:deadbeef⟧` } : entry),
    }),
    /protected marker/i,
  );
});
