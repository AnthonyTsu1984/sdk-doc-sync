'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  ARTIFACT_SPEC,
  HARVEST_ROOT,
  computeDelta,
  landingFor,
  parseFingerprintOutput,
  resolveTail,
} = require('../../scripts/harvest/pod-evidence.js');

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

test('parseFingerprintOutput: TSV 三列解析 + latest.html 跳过 + 空行容忍', () => {
  const out = parseFingerprintOutput([
    `/workspace/logs/events.jsonl\t${A}\t1024`,
    `/workspace/feishu-markdown-bridge/tmp/api-reference-sync/gate-presentation/latest.html\t${B}\t5`,
    `/workspace/feishu-markdown-bridge/tmp/api-reference-sync/run-manifest-x.json\t${C}\t77`,
    '',
  ].join('\n'));
  assert.deepStrictEqual(out, [
    { podPath: '/workspace/logs/events.jsonl', sha256: A, size: 1024 },
    { podPath: '/workspace/feishu-markdown-bridge/tmp/api-reference-sync/run-manifest-x.json', sha256: C, size: 77 },
  ]);
});

test('parseFingerprintOutput: sha 非 64-hex 即 fail-closed', () => {
  assert.throws(() => parseFingerprintOutput(`/a/b\tdeadbeef\t1`), (error) => error.code === 'FINGERPRINT_OUTPUT_INVALID');
  assert.throws(() => parseFingerprintOutput(`/a/b\t${A}\tnan`), (error) => error.code === 'FINGERPRINT_OUTPUT_INVALID');
});

test('computeDelta: clean / neverHarvested / tailCandidates / rewritten / vanished 全类别', () => {
  const marker = [
    { podPath: '/same', sha256: A, size: 10 },
    { podPath: '/grown', sha256: A, size: 10 },
    { podPath: '/shrunk', sha256: A, size: 10 },
    { podPath: '/same-size-diff', sha256: A, size: 10 },
    { podPath: '/gone', sha256: A, size: 10 },
  ];
  const current = [
    { podPath: '/same', sha256: A, size: 10 },
    { podPath: '/grown', sha256: B, size: 25 },
    { podPath: '/shrunk', sha256: B, size: 5 },
    { podPath: '/same-size-diff', sha256: B, size: 10 },
    { podPath: '/fresh', sha256: C, size: 3 },
  ];
  const delta = computeDelta(marker, current);
  assert.deepStrictEqual(delta.clean.map((a) => a.podPath), ['/same']);
  assert.deepStrictEqual(delta.neverHarvested.map((a) => a.podPath), ['/fresh']);
  assert.deepStrictEqual(delta.tailCandidates.map((t) => t.current.podPath), ['/grown']);
  assert.deepStrictEqual(delta.rewritten.map((t) => t.current.podPath), ['/shrunk', '/same-size-diff']);
  assert.deepStrictEqual(delta.vanished.map((a) => a.podPath), ['/gone']);
});

test('resolveTail: 前缀 sha=marker 全量 sha → tailGrew；否则 rewritten', () => {
  const candidates = [
    { current: { podPath: '/events.jsonl', sha256: B, size: 25 }, marker: { podPath: '/events.jsonl', sha256: A, size: 10 } },
    { current: { podPath: '/other.jsonl', sha256: C, size: 30 }, marker: { podPath: '/other.jsonl', sha256: A, size: 10 } },
  ];
  const { tailGrew, rewritten } = resolveTail(candidates, new Map([['/events.jsonl', A], ['/other.jsonl', B]]));
  assert.deepStrictEqual(tailGrew.map((a) => a.podPath), ['/events.jsonl']);
  assert.deepStrictEqual(rewritten.map((a) => a.podPath), ['/other.jsonl']);
});

test('landingFor: canonical 规范位 / pod-private 快照 / 语义外=null', () => {
  const pod = 'python-v3-worker';
  const canonical = landingFor('/workspace/feishu-markdown-bridge/tmp/api-reference-sync/campaign-approvals/sha256:x.json', pod);
  assert.strictEqual(canonical.kind, 'canonical');
  assert.ok(canonical.abs.endsWith('tmp/api-reference-sync/campaign-approvals/sha256:x.json'));

  const manifest = landingFor('/workspace/feishu-markdown-bridge/tmp/api-reference-sync/run-manifest-a.json', pod);
  assert.strictEqual(manifest.kind, 'canonical');

  const backlog = landingFor('/workspace/feishu-markdown-bridge/tmp/api-reference-sync/daily-scan/backlog-import-1.jsonl', pod);
  assert.strictEqual(backlog.kind, 'canonical');

  const scanState = landingFor('/workspace/feishu-markdown-bridge/.claude/skills/api-reference-sync/scan-state.json', pod);
  assert.strictEqual(scanState.kind, 'pod-private');
  assert.strictEqual(path.basename(scanState.abs), 'scan-state.json');
  assert.ok(scanState.abs.startsWith(path.join(HARVEST_ROOT, pod)));

  const ledger = landingFor('/workspace/feishu-markdown-bridge/tmp/api-reference-sync/daily-scan/pr-findings.jsonl', pod);
  assert.strictEqual(ledger.kind, 'pod-private');
  assert.strictEqual(path.basename(ledger.abs), 'pr-findings.jsonl');

  for (const p of ['/workspace/logs/events.jsonl', '/workspace/logs/supervisor.log', '/workspace/runs/card-python-v3.json']) {
    const landing = landingFor(p, pod);
    assert.strictEqual(landing.kind, 'pod-private');
    assert.ok(landing.abs.startsWith(path.join(HARVEST_ROOT, pod)), p);
  }

  assert.strictEqual(landingFor('/workspace/feishu-markdown-bridge/src/index.js', pod), null);
  assert.strictEqual(landingFor('/etc/passwd', pod), null);
});

test('ARTIFACT_SPEC: 只指向 pod 规范位（tmp/api-reference-sync、scan-state、logs、runs），无杂散路径', () => {
  assert.ok(ARTIFACT_SPEC.length >= 10);
  for (const entry of ARTIFACT_SPEC) {
    assert.ok(
      entry.pod.startsWith('/workspace/feishu-markdown-bridge/tmp/api-reference-sync/')
        || entry.pod === '/workspace/feishu-markdown-bridge/.claude/skills/api-reference-sync/scan-state.json'
        || entry.pod.startsWith('/workspace/logs/')
        || entry.pod.startsWith('/workspace/runs/'),
      `spec 越界: ${entry.pod}`,
    );
  }
});
