'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { foldLedger } = require(path.join(
  __dirname, '..', '..', '.claude', 'skills', 'api-reference-sync', 'src', 'sdk-doc-sync', 'findings-ledger.js',
));
const { contentKey, mergeFindingsLedgers, stableStringify } = require('../../scripts/harvest/findings-ledger-merge.js');

const discovered = (seq, pr, languages, on) => ({ seq, type: 'discovered', prNumber: pr, languages, title: `PR ${pr}`, url: `https://example/${pr}`, mergedAt: on, discoveredOn: on });
const disposed = (seq, pr, note, at) => ({ seq, type: 'disposed', prNumber: pr, language: null, note, at });

test('stableStringify 键序无关；contentKey 剥 seq', () => {
  assert.strictEqual(stableStringify({ a: 1, b: 2 }), stableStringify({ b: 2, a: 1 }));
  assert.strictEqual(contentKey({ seq: 1, type: 'disposed', prNumber: 9 }), contentKey({ seq: 99, type: 'disposed', prNumber: 9 }));
  assert.notStrictEqual(contentKey({ seq: 1, type: 'disposed', prNumber: 9, note: 'x' }), contentKey({ seq: 1, type: 'disposed', prNumber: 9 }));
});

test('同种子 backlog 两边各记一遍 → 按内容去重折半；seq 重排连续', () => {
  const mac = [discovered(1, 100, ['python'], '2026-10-01'), discovered(2, 101, ['cpp'], '2026-10-02')];
  const pod = [discovered(1, 100, ['python'], '2026-10-01'), discovered(2, 101, ['cpp'], '2026-10-02'), disposed(3, 100, 'consumed by pod', '2026-10-20')];
  const { merged, stats } = mergeFindingsLedgers([{ source: 'canonical', entries: mac }, { source: 'pod-a', entries: pod }]);
  assert.strictEqual(stats.deduped, 2);
  assert.strictEqual(merged.length, 3);
  assert.deepStrictEqual(merged.map((e) => e.seq), [1, 2, 3]);
});

test('seq 撞号但内容不同 → 两条都留，按时间排序重排号', () => {
  const mac = [discovered(37, 200, ['go'], '2026-10-05'), disposed(38, 200, 'mac disposed', '2026-10-21')];
  const pod = [discovered(37, 201, ['java'], '2026-10-06'), disposed(38, 201, 'pod disposed', '2026-10-22')];
  const { merged } = mergeFindingsLedgers([{ source: 'canonical', entries: mac }, { source: 'pod-a', entries: pod }]);
  assert.strictEqual(merged.length, 4);
  assert.deepStrictEqual(merged.map((e) => e.seq), [1, 2, 3, 4]);
  // 时间主序：200 的 discovered(10-05) → 201 的 discovered(10-06) → 200 disposed(10-21) → 201 disposed(10-22)
  assert.deepStrictEqual(merged.map((e) => `${e.prNumber}:${e.type}`), ['200:discovered', '201:discovered', '200:disposed', '201:disposed']);
});

test('同 PR 双边各批一次 → 后写胜出（fold 语义），且两条历史都保留', () => {
  const mac = [discovered(1, 300, ['python'], '2026-10-01'), disposed(2, 300, 'mac first', '2026-10-20')];
  const pod = [discovered(1, 300, ['python'], '2026-10-01'), disposed(37, 300, 'pod later', '2026-10-25')];
  const { merged } = mergeFindingsLedgers([{ source: 'canonical', entries: mac }, { source: 'pod-a', entries: pod }]);
  const folded = new Map(foldLedger(merged).map((state) => [state.prNumber, state]));
  assert.strictEqual(folded.get(300).status, 'disposed');
  assert.strictEqual(folded.get(300).disposition.note, 'pod later');
});

test('discovered 多行并集语义跨账本保持（语言 union 不丢）', () => {
  const mac = [discovered(1, 400, ['python'], '2026-10-01')];
  const pod = [discovered(1, 400, ['python', 'cpp'], '2026-10-02')];
  const { merged } = mergeFindingsLedgers([{ source: 'canonical', entries: mac }, { source: 'pod-a', entries: pod }]);
  const folded = foldLedger(merged).find((state) => state.prNumber === 400);
  assert.deepStrictEqual(folded.languages, ['cpp', 'python']);
});

test('非法行（未知 type / 非正 prNumber / 缺 type）→ fail-closed', () => {
  assert.throws(() => mergeFindingsLedgers([{ source: 'x', entries: [{ seq: 1, type: 'bogus', prNumber: 1 }] }]), (e) => e.code === 'MERGE_ENTRY_INVALID');
  assert.throws(() => mergeFindingsLedgers([{ source: 'x', entries: [{ seq: 1, type: 'disposed', prNumber: 0 }] }]), (e) => e.code === 'MERGE_ENTRY_INVALID');
  assert.throws(() => mergeFindingsLedgers([{ source: 'x', entries: [{ seq: 1, prNumber: 5 }] }]), (e) => e.code === 'MERGE_ENTRY_INVALID');
});

test('跨账本孤儿处置（有 disposed 无 discovered）→ 警告不阻断，fold 照记', () => {
  const pod = [disposed(1, 500, 'pod saw it first', '2026-10-10')];
  const { merged, warnings } = mergeFindingsLedgers([{ source: 'canonical', entries: [] }, { source: 'pod-a', entries: pod }]);
  assert.ok(warnings.some((w) => w.includes('PR 500')));
  const folded = foldLedger(merged).find((state) => state.prNumber === 500);
  assert.strictEqual(folded.status, 'disposed');
});

test('排序全序确定：同时刻平局按 prNumber → 类型（discovered 前）→ 内容键', () => {
  const entries = [
    disposed(1, 7, 'same-time', '2026-10-10T00:00:00Z'),
    discovered(2, 6, ['cpp'], '2026-10-10T00:00:00Z'),
    discovered(3, 5, ['go'], '2026-10-10T00:00:00Z'),
  ];
  const { merged } = mergeFindingsLedgers([{ source: 'x', entries }]);
  assert.deepStrictEqual(merged.map((e) => e.prNumber), [5, 6, 7]);
});
