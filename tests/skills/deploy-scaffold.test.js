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

// ---------- 5c. 呈门卡片 v2：内容三件套 + 批准按钮 ----------

const hexFix = (char) => `sha256:${char.repeat(64)}`;

function v2IndexFixture(overrides = {}) {
  return {
    schema: 2,
    gate: 'APPROVE_WRITES',
    title: 'APPROVE_WRITES — 2 单元',
    sessionPath: 'tmp/api-reference-sync/campaign-plans/python-v30-sync/sync-session.json',
    digest: hexFix('a'),
    generatedAt: '2026-10-24T03:00:00.000Z',
    replyLines: [`APPROVE_WRITES ${hexFix('a')}`],
    source: { origin: 'pr-intake', prs: [
      { number: 1184, url: 'https://github.com/milvus-io/pymilvus/pull/1184', title: 'first' },
      { number: 1188, url: 'https://github.com/milvus-io/pymilvus/pull/1188', title: 'second' },
    ] },
    impact: {
      total: 12, create: 3, update: 9, other: 0,
      documents: Array.from({ length: 12 }, (_, i) => ({
        title: `文档${i}`, action: i < 3 ? 'CREATE' : 'UPDATE', unitId: `u${i}`,
      })),
    },
    ...overrides,
  };
}

test('buildGateCard: PR 链接数/截断（>5 条尾部"等 N 条"）', () => {
  const { buildGateCard } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  const bodyOf = (source) => buildGateCard({ index: v2IndexFixture({ source }), pod: 'python-worker', slot: '1', trackKey: 'python-v3', language: 'python', indexId: 'k/x.index.json' })
    .elements[0].text.content;
  // 2 条 → 两个可点链接，无"等"
  const small = bodyOf(v2IndexFixture().source);
  assert.equal((small.match(/\[#\d+\]\(https:\/\/github\.com\/[^)]+\)/g) || []).length, 2);
  assert.doesNotMatch(small, /等 \d+ 条/);
  // 7 条 → 5 个链接 + 尾部"等 7 条"
  const big = bodyOf({
    origin: 'pr-intake',
    prs: Array.from({ length: 7 }, (_, i) => ({ number: 1180 + i, url: `https://github.com/x/pull/${1180 + i}`, title: null })),
  });
  assert.equal((big.match(/\[#\d+\]\(/g) || []).length, 5);
  assert.match(big, /等 7 条/);
});

test('buildGateCard: 仓库扫描 → tag 迁移行；来源缺位不编造', () => {
  const { buildGateCard } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  const render = (index) => buildGateCard({ index, pod: 'p', slot: '1', trackKey: 'k', language: 'python', indexId: 'i' })
    .elements[0].text.content;
  assert.match(render(v2IndexFixture({ source: { origin: 'repo-scan', baselineTag: 'v2.6.17', targetTag: 'v2.6.18' } })),
    /来源 仓库扫描：v2\.6\.17 → v2\.6\.18/);
  assert.match(render(v2IndexFixture({ source: { origin: 'repo-scan', baselineTag: null, targetTag: null } })),
    /来源 仓库扫描：版本信息未登记/);
  assert.doesNotMatch(render(v2IndexFixture({ source: null })), /来源 /);
});

test('buildGateCard: 动作分解行 + 清单截断 + 无分类诚实降级', () => {
  const { buildGateCard } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  const render = (impact) => buildGateCard({ index: v2IndexFixture({ impact }), pod: 'p', slot: '1', trackKey: 'k', language: 'python', indexId: 'i' })
    .elements[0].text.content;
  // 动作面行：文档 12 篇 · CREATE 3 · UPDATE 9
  assert.match(render(v2IndexFixture().impact), /动作面：文档 12 篇 · CREATE 3 · UPDATE 9/);
  // 清单最多 10 条 + 尾行"… 等共 N 篇（全清单见工件）"
  const truncated = render(v2IndexFixture().impact);
  assert.equal((truncated.match(/ —— (CREATE|UPDATE|待分类)$/gm) || []).length, 10);
  assert.match(truncated, /… 等共 12 篇（全清单见工件）/);
  // impact null → "待 dry-run 细化"，绝不编数
  const degraded = render(null);
  assert.match(degraded, /动作面：待 dry-run 细化/);
  assert.doesNotMatch(degraded, /CREATE \d+/);
  // 部分未分类 → "其他 N"如实出现，未分类行标"待分类"
  const partial = render({ total: 3, create: 1, update: 1, other: 1, documents: [
    { title: 'a', action: 'CREATE', unitId: 'a' },
    { title: 'b', action: 'UPDATE', unitId: 'b' },
    { title: 'c', action: null, unitId: 'c' },
  ] });
  assert.match(partial, /CREATE 1 · UPDATE 1 · 其他 1/);
  assert.match(partial, /c —— 待分类/);
});

test('buildGateCard: pod 行、会话短名（固定位置）、digest 行', () => {
  const { buildGateCard, sessionShortName } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  const card = buildGateCard({ index: v2IndexFixture(), pod: 'python-worker', slot: '1', trackKey: 'python-v3', language: 'python', indexId: 'k/x.index.json' });
  const bodyLines = card.elements[0].text.content.split('\n');
  assert.match(card.header.title.content, /呈门 · 写入批准 · python slot 1（python-v3）/);
  // pod 归属行 + 紧随其后的会话短形态行（固定位置：pod 行的下一行）
  const podLineAt = bodyLines.findIndex((line) => line.startsWith('pod: python-worker ·'));
  assert.notEqual(podLineAt, -1, 'pod 归属行缺失');
  assert.match(bodyLines[podLineAt], /pod: python-worker · slot: 1 · 轨道: python-v3 · 语言: python · 门: APPROVE_WRITES/);
  assert.equal(bodyLines[podLineAt + 1], '会话: python-v30-sync · digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(sessionShortName('tmp/x/java-v26-sync/sync-session.json'), 'java-v26-sync');
  assert.equal(sessionShortName('a/b/sync-session.json'), 'b');
  assert.equal(sessionShortName('a/b/campaign'), 'campaign');
});

test('buildGateCard: 每 replyLine 一个 primary 按钮，value 载荷全字符串', () => {
  const { buildGateCard } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  const render = (replyLines) => buildGateCard({ index: v2IndexFixture({ replyLines }), pod: 'python-worker', slot: '2', trackKey: 'python', language: 'python', indexId: 'k/20261024-030000-APPROVE_WRITES.index.json' });
  // 单行 → 「批准」
  const single = render([`APPROVE_WRITES ${hexFix('a')}`]);
  const singleActions = single.elements.filter((element) => element.tag === 'action');
  assert.equal(singleActions.length, 1);
  assert.equal(singleActions[0].actions[0].tag, 'button');
  assert.equal(singleActions[0].actions[0].type, 'primary');
  assert.equal(singleActions[0].actions[0].text.content, '批准');
  // 多行 → 「批准 N」逐行一个
  const multi = render([`APPROVE_DOCUMENT u1 ${hexFix('1')}`, `APPROVE_DOCUMENT u2 ${hexFix('2')}`, `APPROVE_DOCUMENT u3 ${hexFix('3')}`]);
  const multiActions = multi.elements.filter((element) => element.tag === 'action');
  assert.equal(multiActions.length, 3);
  assert.deepEqual(multiActions.map((element) => element.actions[0].text.content), ['批准 1', '批准 2', '批准 3']);
  // value 载荷（card-approve.js 消费端按同一形状解析）
  const value = multiActions[1].actions[0].value;
  assert.equal(value.kind, 'pod-gate-approve');
  assert.equal(value.pod, 'python-worker');
  assert.equal(value.slot, '2');
  assert.equal(value.line, `APPROVE_DOCUMENT u2 ${hexFix('2')}`);
  assert.equal(value.indexId, 'k/20261024-030000-APPROVE_WRITES.index.json');
  assert.doesNotThrow(() => Date.parse(value.sentAt));
  for (const entry of Object.values(value)) assert.equal(typeof entry, 'string');
  // 尾注：打回指引保留
  const note = single.elements.find((element) => element.tag === 'note');
  assert.match(note.elements[0].content, /打回请回复本消息：打回 <原因>/);
});

test('六门中文映射：GATE_LABELS_ZH 全覆盖且卡片标题使用中文名', () => {
  const { GATE_LABELS_ZH, gateLabelZh } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  const { GATE_NAMES } = require(path.join(REPO_ROOT, '.claude/skills/api-reference-sync/src/sdk-doc-sync/gate-registry.js'));
  assert.deepEqual(Object.keys(GATE_LABELS_ZH).sort(), [...GATE_NAMES].sort());
  for (const label of Object.values(GATE_LABELS_ZH)) {
    assert.match(label, /批准$/);
  }
  assert.equal(gateLabelZh('APPROVE_WRITES'), '写入批准');
  assert.equal(gateLabelZh('NOT_A_GATE'), 'NOT_A_GATE'); // 未登记门名原样透传，不编
  const { buildGateCard } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  const card = buildGateCard({ index: v2IndexFixture({ gate: 'APPROVE_GROUPING' }), pod: 'p', slot: '1', trackKey: 'k', language: 'go', indexId: 'i' });
  assert.match(card.header.title.content, /呈门 · 分组批准 ·/);
});

test('sessionPath→track 反解表：真实 sessionKey 样本 + TRACKS 顺序固定回退 + unknown', () => {
  const { deriveGateAttribution } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  const pythonSlots = [
    { slot: 1, track: 'v3.0.x', trackKey: 'python-v3' },
    { slot: 2, track: 'v2.6.x', trackKey: 'python' },
  ];
  const keyOf = (sessionPath) => sessionPath.split('/').join('-').replace(/[^A-Za-z0-9._-]/g, '-');
  const artifact = (sessionPath) =>
    `tmp/api-reference-sync/gate-presentation/${keyOf(sessionPath)}/20261024-030000-APPROVE_WRITES.index.json`;
  // 真实 sessionKey 样本（sessionKeyOf 规则派生；go-v30 为既有测试同款路径）
  const cases = [
    ['tmp/api-reference-sync/campaign-plans/python-v30-sync/sync-session.json', pythonSlots, 1],
    ['tmp/api-reference-sync/campaign-plans/python-sync/sync-session.json', pythonSlots, 2],
    ['tmp/api-reference-sync/campaign-plans/go-v30-sync/sync-session.json', pythonSlots, 1],
  ];
  for (const [sessionPath, slots, expectedSlot] of cases) {
    assert.equal(deriveGateAttribution(artifact(sessionPath), slots).slot, expectedSlot, sessionPath);
  }
  // java 双槽：java-v26（裸 key 消歧由长 key 优先保证）
  const javaSlots = [
    { slot: 1, track: 'v3.0.x', trackKey: 'java-v30' },
    { slot: 2, track: 'v2.6.x', trackKey: 'java-v26' },
  ];
  assert.equal(deriveGateAttribution(artifact('tmp/api-reference-sync/campaign-plans/java-v26-sync/sync-session.json'), javaSlots).slot, 2);
  assert.equal(deriveGateAttribution(artifact('tmp/api-reference-sync/campaign-plans/java-v30-sync/sync-session.json'), javaSlots).slot, 1);
  // 长 key 优先：python-v30 路径绝不被裸 python 吞掉
  assert.equal(deriveGateAttribution(artifact('tmp/api-reference-sync/campaign-plans/python-v30-sync/sync-session.json'), pythonSlots).trackKey, 'python-v3');
  // SLOT_TRACKKEY 空（pod 重启清场）→ TRACKS 顺序固定映射（slot1=v3.0.x、slot2=v2.6.x）
  const noKeys = [{ slot: 1, track: 'v3.0.x', trackKey: '' }, { slot: 2, track: 'v2.6.x', trackKey: '' }];
  assert.equal(deriveGateAttribution('gate-presentation/wherever-v30/x.index.json', noKeys).slot, 1);
  assert.equal(deriveGateAttribution('gate-presentation/wherever-v26/x.index.json', noKeys).slot, 2);
  // 落空 → unknown（如实，绝不猜）
  const unknown = deriveGateAttribution('gate-presentation/no-version-here/x.index.json', noKeys);
  assert.deepEqual(unknown, { slot: 'unknown', trackKey: 'unknown' });
  // CLI 面：supervisor gate_watch 消费的同一入口
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath, [
    path.join(REPO_ROOT, 'deploy', 'lib.js'), 'gate-slot',
    '--artifact', artifact('tmp/api-reference-sync/campaign-plans/python-v30-sync/sync-session.json'),
    '--tracks', 'v3.0.x,v2.6.x', '--track-keys', 'python-v3,python',
  ], { encoding: 'utf8' });
  assert.equal(out.trim(), 'slot=1 trackKey=python-v3');
});

test('notifyGate: message_id 返回 + sent-cards.jsonl 按 replyLine 逐行入账', async () => {
  const { notifyGate } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'notify-gate-')));
  const indexFile = path.join(work, 'x.index.json');
  fs.writeFileSync(indexFile, JSON.stringify(v2IndexFixture({ replyLines: [`APPROVE_DOCUMENT u1 ${hexFix('1')}`, `APPROVE_DOCUMENT u2 ${hexFix('2')}`] })));
  const sentCards = path.join(work, 'sent-cards.jsonl');
  const seenBodies = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    if (String(url).includes('/tenant_access_token/')) {
      return { json: async () => ({ code: 0, tenant_access_token: 't' }) };
    }
    if (String(url).includes('/users/batch_get_id')) {
      return { json: async () => ({ code: 0, data: { user_list: [{ user_id: 'ou_operator' }] } }) };
    }
    seenBodies.push(body);
    return { json: async () => ({ code: 0, data: { message_id: 'om_card_1' } }) };
  };
  const envBackup = {
    FEISHU_HOST: process.env.FEISHU_HOST, BOT_APP_ID: process.env.BOT_APP_ID,
    BOT_APP_SECRET: process.env.BOT_APP_SECRET, OPERATOR_EMAIL: process.env.OPERATOR_EMAIL,
  };
  Object.assign(process.env, { FEISHU_HOST: 'https://feishu.example', BOT_APP_ID: 'a', BOT_APP_SECRET: 'b', OPERATOR_EMAIL: 'op@example' });
  try {
    const result = await notifyGate({
      indexFile, pod: 'python-worker', slot: '1', trackKey: 'python-v3', language: 'python',
      cachePath: path.join(work, 'openid'), indexId: 'k/x.index.json', sentCardsPath: sentCards, fetchImpl,
    });
    assert.equal(result.messageId, 'om_card_1');
    assert.equal(result.mode, 'interactive');
    // 首选 interactive 卡片（带按钮），一次发送成功不再降级文本
    assert.equal(seenBodies.length, 1);
    assert.equal(seenBodies[0].msg_type, 'interactive');
    const sentCard = JSON.parse(seenBodies[0].content);
    const buttons = sentCard.elements.filter((element) => element.tag === 'action');
    assert.equal(buttons.length, 2);
    // 入账：每条 replyLine 一行，共享 messageId/sentAt
    const records = fs.readFileSync(sentCards, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(records.length, 2);
    for (const [position, record] of records.entries()) {
      assert.deepEqual(Object.keys(record).sort(), ['digest', 'indexId', 'line', 'messageId', 'pod', 'sentAt', 'slot', 'track']);
      assert.equal(record.messageId, 'om_card_1');
      assert.equal(record.pod, 'python-worker');
      assert.equal(record.slot, '1');
      assert.equal(record.track, 'python-v3');
      assert.equal(record.indexId, 'k/x.index.json');
      assert.equal(record.line, `APPROVE_DOCUMENT u${position + 1} ${hexFix(String(position + 1))}`);
      assert.equal(record.digest, hexFix('a'));
      assert.doesNotThrow(() => Date.parse(record.sentAt));
    }
  } finally {
    Object.assign(process.env, envBackup);
  }
});

test('notifyGate: 卡片发送失败降级纯文本仍取到 message_id；响应缺 message_id 时 typed fail-loud', async () => {
  const { notifyGate } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'notify-gate-degrade-')));
  const indexFile = path.join(work, 'x.index.json');
  fs.writeFileSync(indexFile, JSON.stringify(v2IndexFixture()));
  const sentCards = path.join(work, 'sent-cards.jsonl');
  const mode = { next: 'text-no-id' };
  const fetchImpl = async (url, init) => {
    if (String(url).includes('/tenant_access_token/')) return { json: async () => ({ code: 0, tenant_access_token: 't' }) };
    if (String(url).includes('/users/batch_get_id')) return { json: async () => ({ code: 0, data: { user_list: [{ user_id: 'ou_operator' }] } }) };
    const msgType = JSON.parse(init.body).msg_type;
    if (mode.next === 'text-no-id') {
      // 卡片被拒（如版本不支持 interactive）→ 文本成功但不给 message_id
      return { json: async () => (msgType === 'interactive' ? { code: 99901, msg: 'no card' } : { code: 0, data: {} }) };
    }
    return { json: async () => (msgType === 'interactive' ? { code: 99901, msg: 'no card' } : { code: 0, data: { message_id: 'om_text_1' } }) };
  };
  const envBackup = {
    FEISHU_HOST: process.env.FEISHU_HOST, BOT_APP_ID: process.env.BOT_APP_ID,
    BOT_APP_SECRET: process.env.BOT_APP_SECRET, OPERATOR_EMAIL: process.env.OPERATOR_EMAIL,
  };
  Object.assign(process.env, { FEISHU_HOST: 'https://feishu.example', BOT_APP_ID: 'a', BOT_APP_SECRET: 'b', OPERATOR_EMAIL: 'op@example' });
  try {
    await assert.rejects(
      notifyGate({ indexFile, pod: 'p', slot: '1', trackKey: 'k', language: 'python', cachePath: null, sentCardsPath: sentCards, fetchImpl }),
      (error) => error.code === 'FEISHU_MESSAGE_ID_MISSING',
    );
    mode.next = 'text-with-id';
    const result = await notifyGate({ indexFile, pod: 'p', slot: '1', trackKey: 'k', language: 'python', cachePath: null, sentCardsPath: sentCards, fetchImpl });
    assert.equal(result.mode, 'text');
    assert.equal(result.messageId, 'om_text_1');
    assert.equal(fs.readFileSync(sentCards, 'utf8').split('\n').filter(Boolean).length, 1);
  } finally {
    Object.assign(process.env, envBackup);
  }
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
    // 部署镜像块：键行后跟 4 空格缩进内容（kubectl --from-file 的原生缩进——
    // 2026-10-24 实测；旧断言写 6 空格，与生成器输出一直对不上，提取恒为空）。
    // 提取后必须仍是可解析 bash（防手改 ConfigMap 漂移）。
    const keyLine = `  ${name}: |`;
    const start = yaml.indexOf(`\n${keyLine}\n`);
    assert.notEqual(start, -1, `configmap-scripts.yaml 缺 ${name} 块`);
    const blockLines = [];
    for (const line of yaml.slice(start + 1).split('\n').slice(1)) {
      if (line.trim() === '') { blockLines.push(''); continue; }
      if (!line.startsWith('    ')) break; // 下一个键
      blockLines.push(line.slice(4));
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

test('renderOpencodeConfig: headless permission block (bash/edit/read/external_directory allow)', () => {
  const { renderOpencodeConfig } = require('../../deploy/lib.js');
  const cfg = renderOpencodeConfig({ model: 'm1' });
  assert.deepEqual(cfg.permission, { bash: 'allow', edit: 'allow', read: 'allow', external_directory: 'allow' });
});
