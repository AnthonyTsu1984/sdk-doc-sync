'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { formatScanState, mergeScanStates } = require('../../scripts/harvest/scan-state-merge.js');

const BASE = {
  python: { lastScannedTag: 'v2.6.17', lastScanDate: '2026-07-22' },
  'python-v3': { lastScannedTag: 'v3.0.1', lastScanDate: '2026-10-20' },
  cpp: { lastScannedTag: 'origin/master', lastScanDate: '2026-06-17' },
};

test('overlay 本轨较新 → 采纳；较旧 → 跳过；内容一致 → noop', () => {
  const overlay = {
    'python-v3': { lastScannedTag: 'v3.0.2', lastScanDate: '2026-10-24' },
  };
  const { merged, decisions } = mergeScanStates(BASE, [{ pod: 'python-v3-worker', trackKey: 'python-v3', state: overlay }]);
  assert.strictEqual(merged['python-v3'].lastScannedTag, 'v3.0.2');
  assert.strictEqual(decisions.find((d) => d.trackKey === 'python-v3').action, 'applied');
  assert.strictEqual(merged.python.lastScannedTag, 'v2.6.17');

  const stale = mergeScanStates(BASE, [{
    pod: 'p', trackKey: 'python-v3',
    state: { 'python-v3': { lastScannedTag: 'v3.0.0', lastScanDate: '2026-10-01' } },
  }]);
  assert.strictEqual(stale.merged['python-v3'].lastScannedTag, 'v3.0.1');
  assert.strictEqual(stale.decisions.find((d) => d.trackKey === 'python-v3').action, 'skipped-stale');

  const same = mergeScanStates(BASE, [{
    pod: 'p', trackKey: 'python-v3',
    state: { 'python-v3': { lastScannedTag: 'v3.0.1', lastScanDate: '2026-10-20' } },
  }]);
  assert.strictEqual(same.decisions.find((d) => d.trackKey === 'python-v3').action, 'noop');
});

test('同日不同内容 → 采纳并告警（pod 拥有该轨）', () => {
  const { merged, decisions } = mergeScanStates(BASE, [{
    pod: 'p', trackKey: 'python-v3',
    state: { 'python-v3': { lastScannedTag: 'v3.0.2', lastScanDate: '2026-10-20' } },
  }]);
  assert.strictEqual(merged['python-v3'].lastScannedTag, 'v3.0.2');
  assert.strictEqual(decisions.find((d) => d.trackKey === 'python-v3').action, 'applied-warn');
});

test('overlay 本轨外的键差异 → 只记录 foreign-drift，绝不采纳', () => {
  const overlay = {
    'python-v3': { lastScannedTag: 'v3.0.2', lastScanDate: '2026-10-24' },
    cpp: { lastScannedTag: 'v9.9.9', lastScanDate: '2026-10-25' },
  };
  const { merged, decisions } = mergeScanStates(BASE, [{ pod: 'p', trackKey: 'python-v3', state: overlay }]);
  assert.strictEqual(merged.cpp.lastScannedTag, 'origin/master');
  assert.ok(decisions.some((d) => d.action === 'foreign-drift' && d.trackKey === 'cpp'));
});

test('主树缺该轨键 → 新增；pod 副本没有本轨键 → noop', () => {
  const added = mergeScanStates(BASE, [{
    pod: 'go-v3-worker', trackKey: 'go-v3',
    state: { 'go-v3': { lastScannedTag: 'client/v3.0.1', lastScanDate: '2026-10-25' } },
  }]);
  assert.strictEqual(added.merged['go-v3'].lastScannedTag, 'client/v3.0.1');
  assert.strictEqual(added.decisions.find((d) => d.trackKey === 'go-v3').action, 'applied');

  const empty = mergeScanStates(BASE, [{
    pod: 'p', trackKey: 'go-v3',
    state: { python: { lastScannedTag: 'v2.6.99', lastScanDate: '2026-07-22' } },
  }]);
  assert.strictEqual(empty.decisions.find((d) => d.trackKey === 'go-v3').action, 'noop');
  assert.ok(empty.decisions.some((d) => d.action === 'foreign-drift' && d.trackKey === 'python'));
  assert.ok(!('go-v3' in empty.merged));
});

test('trackKey 缺失/非法/overlay 非对象 → 整份跳过，不吞其它键', () => {
  for (const bad of [{ pod: 'p', trackKey: null, state: BASE }, { pod: 'p', trackKey: 'Python_V3', state: BASE }, { pod: 'p', trackKey: 'python-v3', state: null }]) {
    const { merged } = mergeScanStates(BASE, [bad]);
    assert.deepStrictEqual(merged, BASE);
  }
});

test('merged 保持 base 键序、新键追加在尾；formatScanState 2 空格缩进+尾换行', () => {
  const { merged } = mergeScanStates(BASE, [{
    pod: 'p', trackKey: 'go-v3',
    state: { 'go-v3': { lastScannedTag: 'client/v3.0.1', lastScanDate: '2026-10-25' } },
  }]);
  assert.deepStrictEqual(Object.keys(merged), ['python', 'python-v3', 'cpp', 'go-v3']);

  const text = formatScanState(merged);
  assert.ok(text.endsWith('\n'));
  assert.ok(text.includes('  "python": {'));
  assert.deepStrictEqual(JSON.parse(text), merged); // roundtrip 保真
});
