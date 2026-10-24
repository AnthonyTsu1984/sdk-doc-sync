'use strict';
// S2 部署脚手架（deploy/）的单元测试：opencode.json 渲染器、approve 行正则、
// backlog 提取器幂等、configmap-backlog 与提取口径一致、track-env 键派生、
// 会话 ID 捕获、三脚本 bash -n、pod-approve --help。零网络、零集群依赖。

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const {
  APPROVE_LINE_RE,
  extractBacklogEntries,
  extractSessionId,
  registryTrackKey,
  renderOpencodeConfig,
  trackEnvLine,
  validateApproveLine,
} = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));

const GOOD_64HEX = 'a'.repeat(64);

function tmpdir(name) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `deploy-scaffold-${name}-`)));
}

// ---------- 1. opencode.json 渲染器 ----------

test('renderOpencodeConfig: custom openai-compatible provider with {env:} interpolation and literal model key', () => {
  const config = renderOpencodeConfig({ model: 'deepseek-v4.1-flash' });
  assert.equal(config.$schema, 'https://opencode.ai/config.json');
  const provider = config.provider.custom;
  assert.equal(provider.npm, '@ai-sdk/openai-compatible');
  // 真值不落盘：baseURL/apiKey 必须是 {env:VAR} 字面插值，由 opencode 运行时解析。
  assert.equal(provider.options.baseURL, '{env:LLM_BASE_URL}');
  assert.equal(provider.options.apiKey, '{env:LLM_API_KEY}');
  // models 键无法插值——bootstrap 用当时 env 的 LLM_MODEL 值渲染写死。
  assert.deepEqual(Object.keys(provider.models), ['deepseek-v4.1-flash']);
  assert.equal(provider.models['deepseek-v4.1-flash'].name, 'deepseek-v4.1-flash');
});

test('renderOpencodeConfig: fail-loud without LLM_MODEL (empty model never renders)', () => {
  for (const bad of [undefined, '', '   ']) {
    assert.throws(() => renderOpencodeConfig({ model: bad }), (error) => error.code === 'OPENCODE_MODEL_MISSING');
  }
});

test('deploy/lib.js CLI render-opencode-json --model works and is stable JSON', () => {
  const out = execFileSync(process.execPath, [
    path.join(REPO_ROOT, 'deploy', 'lib.js'), 'render-opencode-json', '--model', 'm1',
  ], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), renderOpencodeConfig({ model: 'm1' }));
});

// ---------- 2. approve 行正则（两端同一正则） ----------

test('validateApproveLine: accepts the four gate reply-line shapes', () => {
  const cases = [
    `APPROVE_WRITES sha256:${GOOD_64HEX}`,
    `APPROVE_GROUPING sha256:${GOOD_64HEX}`,
    `APPROVE_DOCUMENT unit-42 sha256:${'0123456789abcdef'.repeat(4)}`,
    `APPROVE_ROLLBACK rb-7 sha256:${'f'.repeat(64)}`,
    `APPROVE_ACCEPTANCE sha256:${'9a'.repeat(32)}`,
  ];
  for (const line of cases) {
    assert.deepEqual(validateApproveLine(line), { ok: true, line }, line);
  }
});

test('validateApproveLine: rejects malformed / injection lines', () => {
  const cases = [
    '',
    'APPROVE_WRITES',
    `APPROVE_WRITES sha256:${'g'.repeat(64)}`,           // 非 hex
    `APPROVE_WRITES sha256:${'a'.repeat(63)}`,            // 63 位
    `APPROVE_WRITES sha256:${'A'.repeat(64)}`,            // 大写
    `APPROVE_WRITES sha256:${GOOD_64HEX} extra`,          // 尾随内容
    `APPROVE_WRITES sha256:${GOOD_64HEX}\nrm -rf /tmp`,   // 换行注入
    'approve_writes sha256:…',                            // 小写门名 + 非法摘要
    'APPROVE_WRITES sha256:<digest>',                     // 占位符原文
    'APPROVE_ sha256:…',                                  // 空门名
  ];
  for (const line of cases) {
    assert.equal(validateApproveLine(line).ok, false, JSON.stringify(line));
  }
});

test('APPROVE_LINE_RE has no shell metacharacters (safe as grep -E argument in pod)', () => {
  assert.equal(APPROVE_LINE_RE.source, '^APPROVE_[A-Z]+( \\S+)? sha256:[0-9a-f]{64}$');
});

test('deploy/lib.js CLI validate-approve-line exit codes match the pure function', () => {
  const lib = path.join(REPO_ROOT, 'deploy', 'lib.js');
  const good = spawnSync(process.execPath, [lib, 'validate-approve-line', '--line', `APPROVE_WRITES sha256:${GOOD_64HEX}`], { encoding: 'utf8' });
  assert.equal(good.status, 0);
  const bad = spawnSync(process.execPath, [lib, 'validate-approve-line', '--line', 'APPROVE_WRITES sha256:nope'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /APPROVE_LINE_INVALID/);
});

// ---------- 3. backlog 提取器（configmap-backlog.yaml 的生成口径） ----------

function fixtureEvents() {
  // 形态照真实账本 tmp/api-reference-sync/daily-scan/pr-findings.jsonl（discovered
  // 事件 + disposed 事件流；同 prNumber 多条 discovered 时 languages 需并集）。
  return [
    { seq: 1, type: 'discovered', prNumber: 1173, languages: ['python'], title: 'disposed-one', url: null, mergedAt: '2026-10-10T00:00:00Z' },
    { seq: 2, type: 'disposed', prNumber: 1173 },                              // 已处置 → 排除
    { seq: 3, type: 'discovered', prNumber: 1198, languages: ['go'], title: 'multi-lang', url: 'u1198', mergedAt: '2026-10-22T04:12:48Z' },
    { seq: 4, type: 'discovered', prNumber: 1198, languages: ['java'], title: 'multi-lang', url: 'u1198', mergedAt: '2026-10-22T04:12:48Z' },
    { seq: 5, type: 'discovered', prNumber: 1198, languages: ['python', 'node'], title: 'multi-lang', url: 'u1198', mergedAt: '2026-10-22T04:12:48Z' },
    { seq: 6, type: 'discovered', prNumber: 1184, languages: ['python'], title: 'p1184', url: 'u1184', mergedAt: '2026-10-19T03:33:42Z' },
    { seq: 7, type: 'discovered', prNumber: 1200, languages: ['java'], title: 'j1200', url: 'u1200', mergedAt: '2026-10-22T07:54:28Z' },
    { seq: 8, type: 'discovered', prNumber: 1177, languages: ['cpp'], title: 'other-lang', url: 'u1177', mergedAt: '2026-10-14T00:00:00Z' },
  ];
}

test('extractBacklogEntries: language filter, disposed exclusion, per-pr languages union, sorted output', () => {
  const events = fixtureEvents();
  const python = extractBacklogEntries(events, 'python', { discoveredOn: '2026-10-24' });
  assert.deepEqual(python.map((entry) => entry.prNumber), [1184, 1198]); // 1173 已处置、1177 非 python
  assert.deepEqual(python.find((entry) => entry.prNumber === 1198).languages, ['go', 'java', 'python', 'node']);
  const java = extractBacklogEntries(events, 'java', { discoveredOn: '2026-10-24' });
  assert.deepEqual(java.map((entry) => entry.prNumber), [1198, 1200]);
  assert.equal(java.find((entry) => entry.prNumber === 1200).title, 'j1200');
  // 字段形状 = import-backlog 消费形状。
  for (const entry of [...python, ...java]) {
    assert.deepEqual(Object.keys(entry).sort(), ['discoveredOn', 'languages', 'mergedAt', 'prNumber', 'title', 'url']);
    assert.equal(entry.discoveredOn, '2026-10-24');
  }
});

test('extractBacklogEntries: idempotent — extract(extract(x)) === extract(x)', () => {
  const events = fixtureEvents();
  const once = extractBacklogEntries(events, 'python', { discoveredOn: '2026-10-24' });
  // 把输出当回输入再提一遍（模拟“账本里全是已折叠视图”的再提取）：
  const asEvents = once.map((entry) => ({ type: 'discovered', ...entry }));
  const twice = extractBacklogEntries(asEvents, 'python', { discoveredOn: '2026-10-24' });
  assert.deepEqual(twice, once);
});

test('extractBacklogEntries: input validation', () => {
  assert.throws(() => extractBacklogEntries('nope', 'python'), TypeError);
  assert.throws(() => extractBacklogEntries([], ''), TypeError);
});

// ---------- 4. configmap-backlog.yaml 与提取口径一致 ----------

function readConfigMapBlock(file, key) {
  const lines = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8').split('\n');
  const start = lines.findIndex((line) => line === `  ${key}: |`);
  assert.notEqual(start, -1, `${file} 缺 data 键 ${key}`);
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') { block.push(''); continue; }
    if (!line.startsWith('    ')) break; // 下一个键/文档结束
    block.push(line.slice(4));
  }
  while (block.length && block[block.length - 1] === '') block.pop();
  return block.join('\n');
}

test('configmap-backlog.yaml: python 6 entries / java 8 entries, all discoveredOn 2026-10-24, extractor-idempotent', () => {
  const pythonText = readConfigMapBlock('deploy/configmap-backlog.yaml', 'python.jsonl');
  const javaText = readConfigMapBlock('deploy/configmap-backlog.yaml', 'java.jsonl');
  const parse = (text) => text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  const python = parse(pythonText);
  const java = parse(javaText);
  assert.equal(python.length, 6, 'python backlog 条数');
  assert.equal(java.length, 8, 'java backlog 条数');
  assert.deepEqual(python.map((entry) => entry.prNumber), [1184, 1188, 1191, 1198, 1199, 1207]);
  assert.deepEqual(java.map((entry) => entry.prNumber), [1174, 1175, 1178, 1186, 1190, 1198, 1200, 1204]);
  for (const entry of [...python, ...java]) {
    assert.equal(entry.discoveredOn, '2026-10-24');
    assert.ok(Array.isArray(entry.languages) && entry.languages.length > 0);
  }
  // 快照数据本身满足提取器幂等（再提一遍形状不变）。
  const repython = extractBacklogEntries(python.map((entry) => ({ type: 'discovered', ...entry })), 'python', { discoveredOn: '2026-10-24' });
  assert.deepEqual(repython, python);
  // #1198 四语联合条目在两份 backlog 中一致。
  assert.deepEqual(
    python.find((entry) => entry.prNumber === 1198).languages.sort(),
    java.find((entry) => entry.prNumber === 1198).languages.sort(),
  );
});

// ---------- 5. sessionID 捕获（opencode --format json 实测形态） ----------

test('extractSessionId: picks ses_… from the verified NDJSON event shape', () => {
  const sample = [
    '{"type":"step_start","timestamp":1792817483096,"sessionID":"ses_e93c05116ffeo9X4eixLF89vfd","part":{}}',
    '{"type":"text","timestamp":1792817483719,"sessionID":"ses_e93c05116ffeo9X4eixLF89vfd","part":{"type":"text","text":"OK"}}',
  ].join('\n');
  assert.equal(extractSessionId(sample), 'ses_e93c05116ffeo9X4eixLF89vfd');
  assert.equal(extractSessionId(''), null);
  assert.equal(extractSessionId('no json here'), null);
});

// ---------- 5b. 门铃卡片文案契约（操作员看到的内容） ----------

test('buildGateCardText: carries pod/slot/track, exact reply lines and the Mac-side tail note', () => {
  const { buildGateCardText } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  const text = buildGateCardText({
    index: {
      title: 'APPROVE_WRITES — 3 单元',
      gate: 'APPROVE_WRITES',
      sessionPath: 'tmp/sdk-doc-sync-runs/python-v3/review-session.json',
      digest: 'deadbeef',
      generatedAt: '2026-10-24T00:00:00.000Z',
      replyLines: [`APPROVE_WRITES sha256:${GOOD_64HEX}`],
    },
    pod: 'python-worker', slot: 1, trackKey: 'python-v3', language: 'python',
  });
  assert.match(text, /python-worker/);
  assert.match(text, /slot 1/);
  assert.match(text, /python-v3/);
  assert.match(text, new RegExp(`APPROVE_WRITES sha256:${GOOD_64HEX}`)); // 精确回现行逐字出现
  assert.match(text, /pod-approve\.js/);
  assert.match(text, /或看板处理/);
});

// ---------- 6. track-env：registryTrackKey 派生 + fail-loud ----------

const fixtureRegistry = {
  languages: {
    python: {
      tracks: [
        { version: 'v2.6.x', scanStateKey: 'python', bitable: { baseToken: 'J3Qzbv7AWazzivsv7vqcqlGCnFc' } },
        { version: 'v3.0.x', scanStateKey: 'python-v3', bitable: { baseToken: 'Hk05b5eI6aXXSSsd6j9cqwwMn5a' } },
      ],
    },
    java: {
      tracks: [
        { version: 'v2.6.x', bitable: { baseToken: 'Sbtcbm660abngWsXryKct5nOn2e' } },
        { version: 'v3.0.x', bitable: {} },
      ],
    },
  },
};

test('registryTrackKey: scanStateKey override wins; derived <lang>-v<maj><min> otherwise', () => {
  assert.equal(registryTrackKey('python', fixtureRegistry.languages.python.tracks[0]), 'python');
  assert.equal(registryTrackKey('python', fixtureRegistry.languages.python.tracks[1]), 'python-v3');
  assert.equal(registryTrackKey('java', fixtureRegistry.languages.java.tracks[0]), 'java-v26');
  assert.equal(registryTrackKey('java', { version: 'v3.0.x' }), 'java-v30');
});

test('trackEnvLine: emits BASE_TOKEN line; missing token is typed fail-loud', () => {
  const ok = trackEnvLine(fixtureRegistry, 'python', 'v3.0.x');
  assert.equal(ok.line, 'BASE_TOKEN=Hk05b5eI6aXXSSsd6j9cqwwMn5a');
  assert.equal(ok.trackKey, 'python-v3');
  assert.throws(() => trackEnvLine(fixtureRegistry, 'java', 'v3.0.x'), (error) => error.code === 'BASE_TOKEN_UNAVAILABLE');
  assert.throws(() => trackEnvLine(fixtureRegistry, 'go', 'v3.0.x'), (error) => error.code === 'TRACK_NOT_REGISTERED');
});

test('deploy/lib.js CLI track-env works against the REAL in-repo release-tracks.json (readability conclusion)', () => {
  // 结论落测试：注册表机器可读，python/java 四轨全部能导出 BASE_TOKEN——
  // 操作员无需补 env（BASE_TOKEN 教训的回归防线）。
  for (const [language, track] of [['python', 'v3.0.x'], ['python', 'v2.6.x'], ['java', 'v3.0.x'], ['java', 'v2.6.x']]) {
    const result = spawnSync(process.execPath, [
      path.join(REPO_ROOT, 'deploy', 'lib.js'), 'track-env', '--language', language, '--track', track,
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${language}/${track}: ${result.stderr}`);
    assert.match(result.stdout, /^BASE_TOKEN=[A-Za-z0-9]+\n$/);
    assert.match(result.stderr, /^trackKey=\S+$/m);
  }
});

// ---------- 7. 三脚本 bash -n ＋ ConfigMap 镜像块 bash -n ----------

function bashLint(label, script) {
  const file = path.join(tmpdir('lint'), label.replace(/[^\w.-]/g, '_'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, script);
  const result = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${label} bash -n failed: ${result.stderr}`);
}

test('deploy/*..sh pass bash -n', () => {
  for (const name of ['bootstrap.sh', 'supervisor.sh', 'seed-backlog.sh']) {
    bashLint(name, fs.readFileSync(path.join(REPO_ROOT, 'deploy', name), 'utf8'));
  }
});

test('configmap-scripts.yaml embedded blocks are present and pass bash -n', () => {
  const yaml = fs.readFileSync(path.join(REPO_ROOT, 'deploy', 'configmap-scripts.yaml'), 'utf8');
  for (const name of ['bootstrap.sh', 'supervisor.sh', 'seed-backlog.sh']) {
    // 部署镜像块：键行后跟 6 空格缩进内容；提取后必须仍是可解析 bash（防手改 ConfigMap 漂移）。
    const keyLine = `  ${name}: |`;
    const start = yaml.indexOf(`\n${keyLine}\n`);
    assert.notEqual(start, -1, `configmap-scripts.yaml 缺 ${name} 块`);
    const blockLines = [];
    for (const line of yaml.slice(start + 1).split('\n').slice(1)) {
      if (line.trim() === '') { blockLines.push(''); continue; }
      if (!line.startsWith('      ')) break; // 下一个键
      blockLines.push(line.slice(6));
    }
    while (blockLines.length && blockLines[blockLines.length - 1] === '') blockLines.pop();
    const block = blockLines.join('\n');
    assert.ok(block.length > 500, `${name} 块内容过短`);
    bashLint(`configmap-${name}`, block);
  }
});

// ---------- 8. pod-approve.js --help / 参数校验 ----------

test('pod-approve.js --help prints usage and exits 0', () => {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'dashboard', 'pod-approve.js'), '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /--line/);
  assert.match(result.stdout, /--list/);
});

test('pod-approve.js rejects a malformed line locally without touching kubectl', () => {
  const result = spawnSync(process.execPath, [
    path.join(REPO_ROOT, 'scripts', 'dashboard', 'pod-approve.js'),
    '--pod', 'python-worker', '--slot', '1', '--line', 'APPROVE_WRITES sha256:nope',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /APPROVE_LINE_INVALID/);
  assert.match(result.stderr, /重新走门/);
});

test('pod-approve.js rejects non-integer slot and bad pod name before spawn', () => {
  for (const args of [
    ['--pod', 'python-worker', '--slot', '0', '--line', `APPROVE_WRITES sha256:${GOOD_64HEX}`],
    ['--pod', '../evil', '--slot', '1', '--line', `APPROVE_WRITES sha256:${GOOD_64HEX}`],
    ['--pod', 'python-worker; rm -rf /', '--slot', '1', '--line', `APPROVE_WRITES sha256:${GOOD_64HEX}`],
  ]) {
    const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'dashboard', 'pod-approve.js'), ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1, args.join(' '));
    assert.doesNotMatch(result.stderr, /kubectl exited/);
  }
});

test('normalizeLlmBaseUrl: bare gateway gains /v1, versioned URL untouched', () => {
  const { normalizeLlmBaseUrl } = require('../../deploy/lib.js');
  assert.equal(normalizeLlmBaseUrl('https://token.zasdas.com'), 'https://token.zasdas.com/v1');
  assert.equal(normalizeLlmBaseUrl('https://token.zasdas.com/'), 'https://token.zasdas.com/v1');
  assert.equal(normalizeLlmBaseUrl('https://open.bigmodel.cn/api/paas/v4'), 'https://open.bigmodel.cn/api/paas/v4');
  assert.equal(normalizeLlmBaseUrl('https://open.bigmodel.cn/api/paas/v4/'), 'https://open.bigmodel.cn/api/paas/v4');
  assert.equal(normalizeLlmBaseUrl(''), '');
  assert.equal(normalizeLlmBaseUrl(undefined), undefined);
});
