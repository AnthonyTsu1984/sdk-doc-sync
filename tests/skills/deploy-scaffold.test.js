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

test('validateApproveLine: accepts the campaign/rollback reply-line shapes', () => {
  const cases = [
    `APPROVE_CAMPAIGN sha256:${GOOD_64HEX}`,
    `APPROVE_ROLLBACK rb-7 sha256:${'f'.repeat(64)}`,
    `APPROVE_ROLLBACK review:python:Collections:create_collection sha256:${'0123456789abcdef'.repeat(4)}`,
  ];
  for (const line of cases) {
    assert.deepEqual(validateApproveLine(line), { ok: true, line }, line);
  }
});

test('validateApproveLine: rejects malformed / injection lines', () => {
  const cases = [
    '',
    'APPROVE_CAMPAIGN',
    `APPROVE_CAMPAIGN sha256:${'g'.repeat(64)}`,           // 非 hex
    `APPROVE_CAMPAIGN sha256:${'a'.repeat(63)}`,           // 63 位
    `APPROVE_CAMPAIGN sha256:${'A'.repeat(64)}`,           // 大写
    `APPROVE_CAMPAIGN sha256:${GOOD_64HEX} extra`,         // 尾随内容
    `APPROVE_CAMPAIGN sha256:${GOOD_64HEX}\nrm -rf /tmp`,  // 换行注入
    'approve_campaign sha256:…',                           // 小写门名 + 非法摘要
    'APPROVE_CAMPAIGN sha256:<digest>',                    // 占位符原文
    'APPROVE_ sha256:…',                                   // 空门名
    `APPROVE_GROUPING sha256:${GOOD_64HEX}`,               // 旧多门词汇一律拒绝
    `APPROVE_WRITES sha256:${GOOD_64HEX}`,                 // 旧多门词汇一律拒绝
    `APPROVE_DOCUMENT u1 sha256:${GOOD_64HEX}`,            // 旧多门词汇一律拒绝
    `APPROVE_ACCEPTANCE sha256:${GOOD_64HEX}`,             // 旧多门词汇一律拒绝
  ];
  for (const line of cases) {
    assert.equal(validateApproveLine(line).ok, false, JSON.stringify(line));
  }
});

test('APPROVE_LINE_RE has no shell metacharacters (safe as grep -E argument in pod)', () => {
  assert.equal(APPROVE_LINE_RE.source, '^APPROVE_(CAMPAIGN|ROLLBACK)(?: \\S+)? sha256:[0-9a-f]{64}$');
});

test('deploy/lib.js CLI validate-approve-line exit codes match the pure function', () => {
  const lib = path.join(REPO_ROOT, 'deploy', 'lib.js');
  const good = spawnSync(process.execPath, [lib, 'validate-approve-line', '--line', `APPROVE_CAMPAIGN sha256:${GOOD_64HEX}`], { encoding: 'utf8' });
  assert.equal(good.status, 0);
  const bad = spawnSync(process.execPath, [lib, 'validate-approve-line', '--line', 'APPROVE_CAMPAIGN sha256:nope'], { encoding: 'utf8' });
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

test('configmap-backlog.yaml: python 6 / java 8 / go 4 entries, all discoveredOn 2026-10-24, extractor-idempotent', () => {
  const pythonText = readConfigMapBlock('deploy/configmap-backlog.yaml', 'python.jsonl');
  const javaText = readConfigMapBlock('deploy/configmap-backlog.yaml', 'java.jsonl');
  const goText = readConfigMapBlock('deploy/configmap-backlog.yaml', 'go.jsonl');
  const parse = (text) => text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  const python = parse(pythonText);
  const java = parse(javaText);
  const go = parse(goText);
  assert.equal(python.length, 6, 'python backlog 条数');
  assert.equal(java.length, 8, 'java backlog 条数');
  assert.equal(go.length, 4, 'go backlog 条数');
  assert.deepEqual(python.map((entry) => entry.prNumber), [1184, 1188, 1191, 1198, 1199, 1207]);
  assert.deepEqual(java.map((entry) => entry.prNumber), [1174, 1175, 1178, 1186, 1190, 1198, 1200, 1204]);
  assert.deepEqual(go.map((entry) => entry.prNumber), [1179, 1195, 1196, 1198]);
  for (const entry of [...python, ...java, ...go]) {
    assert.equal(entry.discoveredOn, '2026-10-24');
    assert.ok(Array.isArray(entry.languages) && entry.languages.length > 0);
  }
  // 快照数据本身满足提取器幂等（再提一遍形状不变）。
  const repython = extractBacklogEntries(python.map((entry) => ({ type: 'discovered', ...entry })), 'python', { discoveredOn: '2026-10-24' });
  assert.deepEqual(repython, python);
  // #1198 四语联合条目在各语言 backlog 中一致。
  assert.deepEqual(
    python.find((entry) => entry.prNumber === 1198).languages.sort(),
    java.find((entry) => entry.prNumber === 1198).languages.sort(),
  );
  assert.deepEqual(
    go.find((entry) => entry.prNumber === 1198).languages.sort(),
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

test('buildGateCardText: carries pod/track, exact reply lines and the Mac-side tail note', () => {
  const { buildGateCardText } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  const text = buildGateCardText({
    index: {
      title: 'APPROVE_CAMPAIGN — 3 单元',
      gate: 'APPROVE_CAMPAIGN',
      sessionPath: 'tmp/sdk-doc-sync-runs/python-v3/review-session.json',
      digest: 'deadbeef',
      generatedAt: '2026-10-24T00:00:00.000Z',
      replyLines: [`APPROVE_CAMPAIGN sha256:${GOOD_64HEX}`],
    },
    pod: 'python-v3-worker', trackKey: 'python-v3', language: 'python',
  });
  assert.match(text, /python-v3-worker/);
  assert.match(text, /python-v3/);
  assert.match(text, new RegExp(`APPROVE_CAMPAIGN sha256:${GOOD_64HEX}`)); // 精确回现行逐字出现
  assert.match(text, /pod-approve\.js/);
  assert.match(text, /或看板处理/);
});

// ---------- 5c. 呈门卡片 v2：内容三件套 + 批准按钮 ----------

const hexFix = (char) => `sha256:${char.repeat(64)}`;

function v2IndexFixture(overrides = {}) {
  return {
    schema: 2,
    gate: 'APPROVE_CAMPAIGN',
    title: 'APPROVE_CAMPAIGN — 2 单元',
    sessionPath: 'tmp/api-reference-sync/campaign-plans/python-v30-sync/sync-session.json',
    digest: hexFix('a'),
    generatedAt: '2026-10-24T03:00:00.000Z',
    replyLines: [`APPROVE_CAMPAIGN ${hexFix('a')}`],
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
  const bodyOf = (source) => buildGateCard({ index: v2IndexFixture({ source }), pod: 'python-v3-worker', trackKey: 'python-v3', language: 'python', indexId: 'k/x.index.json' })
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
  const render = (index) => buildGateCard({ index, pod: 'p', trackKey: 'k', language: 'python', indexId: 'i' })
    .elements[0].text.content;
  assert.match(render(v2IndexFixture({ source: { origin: 'repo-scan', baselineTag: 'v2.6.17', targetTag: 'v2.6.18' } })),
    /来源 仓库扫描：v2\.6\.17 → v2\.6\.18/);
  assert.match(render(v2IndexFixture({ source: { origin: 'repo-scan', baselineTag: null, targetTag: null } })),
    /来源 仓库扫描：版本信息未登记/);
  assert.doesNotMatch(render(v2IndexFixture({ source: null })), /来源 /);
});

test('buildGateCard: 动作分解行 + 清单截断 + 无分类诚实降级', () => {
  const { buildGateCard } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  const render = (impact) => buildGateCard({ index: v2IndexFixture({ impact }), pod: 'p', trackKey: 'k', language: 'python', indexId: 'i' })
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
  const card = buildGateCard({ index: v2IndexFixture(), pod: 'python-v3-worker', trackKey: 'python-v3', language: 'python', indexId: 'k/x.index.json' });
  const bodyLines = card.elements[0].text.content.split('\n');
  assert.match(card.header.title.content, /呈门 · 战役批准 · python（python-v3）/);
  // pod 归属行 + 紧随其后的会话短形态行（固定位置：pod 行的下一行）
  const podLineAt = bodyLines.findIndex((line) => line.startsWith('pod: python-v3-worker ·'));
  assert.notEqual(podLineAt, -1, 'pod 归属行缺失');
  assert.match(bodyLines[podLineAt], /pod: python-v3-worker · 轨道: python-v3 · 语言: python · 门: APPROVE_CAMPAIGN/);
  assert.equal(bodyLines[podLineAt + 1], '会话: python-v30-sync · digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(sessionShortName('tmp/x/java-v26-sync/sync-session.json'), 'java-v26-sync');
  assert.equal(sessionShortName('a/b/sync-session.json'), 'b');
  assert.equal(sessionShortName('a/b/campaign'), 'campaign');
});

test('buildGateCard: 每 replyLine 一个 primary 按钮，value 载荷全字符串', () => {
  const { buildGateCard } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  const render = (replyLines) => buildGateCard({ index: v2IndexFixture({ replyLines }), pod: 'python-v26-worker', trackKey: 'python', language: 'python', indexId: 'k/20261024-030000-APPROVE_CAMPAIGN.index.json' });
  // 单行 → 「批准」
  const single = render([`APPROVE_CAMPAIGN ${hexFix('a')}`]);
  const singleActions = single.elements.filter((element) => element.tag === 'action');
  assert.equal(singleActions.length, 1);
  assert.equal(singleActions[0].actions[0].tag, 'button');
  assert.equal(singleActions[0].actions[0].type, 'primary');
  assert.equal(singleActions[0].actions[0].text.content, '批准');
  // 多行 → 「批准 N」逐行一个
  const multi = render([`APPROVE_ROLLBACK u1 ${hexFix('1')}`, `APPROVE_ROLLBACK u2 ${hexFix('2')}`, `APPROVE_ROLLBACK u3 ${hexFix('3')}`]);
  const multiActions = multi.elements.filter((element) => element.tag === 'action');
  assert.equal(multiActions.length, 3);
  assert.deepEqual(multiActions.map((element) => element.actions[0].text.content), ['批准 1', '批准 2', '批准 3']);
  // value 载荷（card-approve.js 消费端按同一形状解析）
  const value = multiActions[1].actions[0].value;
  assert.equal(value.kind, 'pod-gate-approve');
  assert.equal(value.pod, 'python-v26-worker');
    assert.equal(value.line, `APPROVE_ROLLBACK u2 ${hexFix('2')}`);
  assert.equal(value.indexId, 'k/20261024-030000-APPROVE_CAMPAIGN.index.json');
  assert.doesNotThrow(() => Date.parse(value.sentAt));
  for (const entry of Object.values(value)) assert.equal(typeof entry, 'string');
  // 尾注：打回指引保留
  const note = single.elements.find((element) => element.tag === 'note');
  assert.match(note.elements[0].content, /打回请回复本消息：打回 <原因>/);
});

test('门中文映射：单门词汇（APPROVE_CAMPAIGN/APPROVE_ROLLBACK）且卡片标题使用中文名', () => {
  const { GATE_LABELS_ZH, gateLabelZh } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  assert.deepEqual(Object.keys(GATE_LABELS_ZH).sort(), ['APPROVE_CAMPAIGN', 'APPROVE_ROLLBACK']);
  for (const label of Object.values(GATE_LABELS_ZH)) {
    assert.match(label, /批准$/);
  }
  assert.equal(gateLabelZh('APPROVE_CAMPAIGN'), '战役批准');
  assert.equal(gateLabelZh('NOT_A_GATE'), 'NOT_A_GATE'); // 未登记门名原样透传，不编
  const { buildGateCard } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  const card = buildGateCard({ index: v2IndexFixture({ gate: 'APPROVE_CAMPAIGN' }), pod: 'p', trackKey: 'k', language: 'go', indexId: 'i' });
  assert.match(card.header.title.content, /呈门 · 战役批准 ·/);
});

test('notifyGate: message_id 返回 + sent-cards.jsonl 按 replyLine 逐行入账', async () => {
  const { notifyGate } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'notify-gate-')));
  const indexFile = path.join(work, 'x.index.json');
  fs.writeFileSync(indexFile, JSON.stringify(v2IndexFixture({ replyLines: [`APPROVE_ROLLBACK u1 ${hexFix('1')}`, `APPROVE_ROLLBACK u2 ${hexFix('2')}`] })));
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
      indexFile, pod: 'python-v3-worker', trackKey: 'python-v3', language: 'python',
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
      assert.deepEqual(Object.keys(record).sort(), ['digest', 'indexId', 'line', 'messageId', 'pod', 'sentAt', 'track']);
      assert.equal(record.messageId, 'om_card_1');
      assert.equal(record.pod, 'python-v3-worker');
            assert.equal(record.track, 'python-v3');
      assert.equal(record.indexId, 'k/x.index.json');
      assert.equal(record.line, `APPROVE_ROLLBACK u${position + 1} ${hexFix(String(position + 1))}`);
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
      notifyGate({ indexFile, pod: 'p', trackKey: 'k', language: 'python', cachePath: null, sentCardsPath: sentCards, fetchImpl }),
      (error) => error.code === 'FEISHU_MESSAGE_ID_MISSING',
    );
    mode.next = 'text-with-id';
    const result = await notifyGate({ indexFile, pod: 'p', trackKey: 'k', language: 'python', cachePath: null, sentCardsPath: sentCards, fetchImpl });
    assert.equal(result.mode, 'text');
    assert.equal(result.messageId, 'om_text_1');
    assert.equal(fs.readFileSync(sentCards, 'utf8').split('\n').filter(Boolean).length, 1);
  } finally {
    Object.assign(process.env, envBackup);
  }
});

// ---------- 5d. 战役常驻卡：buildCampaignCard 形状 + campaign-card 状态机 ----------
//
// 2026-10-24 操作员裁定：一场战役一张卡（per track），时间轴展示流转，当前门
// 按钮长在卡上，事件驱动 PATCH 更新卡面（不发新卡）。旧 notify-gate 单发退役。

const campaignCardModule = () => require(path.join(REPO_ROOT, 'deploy', 'lib.js'));

function campaignCardFixture() {
  return {
    language: 'python',
    trackKey: 'python-v3',
    pod: 'python-v3-worker',
    status: 'active',
    timeline: [
      { ts: '2026-10-24T03:07:00.000Z', icon: '▶️', text: '派单 python-v3（PR intake 6 条）' },
    ],
    currentGate: null,
  };
}

test('buildCampaignCard: header 三态（等待批准/进行中/已完成）+ config.update_multi（PATCH 前提）', () => {
  const { buildCampaignCard, CAMPAIGN_CARD_STATUS } = campaignCardModule();
  const base = campaignCardFixture();
  // 无门进行中
  const active = buildCampaignCard(base);
  assert.equal(active.header.title.content, '【进行中】python · python-v3');
  assert.equal(active.header.template, 'blue');
  assert.equal(active.config.wide_screen_mode, true);
  // d.ts patch 注意事项：共享卡须显式 update_multi:true 才可全员更新——PATCH 链路的前提
  assert.equal(active.config.update_multi, true);
  // 有等待批准的门 → 门名 + 等待批准
  const waiting = buildCampaignCard({ ...base, currentGate: { pod: 'p', indexId: 'i', sentAt: '2026-10-24T04:00:00.000Z', index: v2IndexFixture({ gate: 'APPROVE_CAMPAIGN' }) } });
  assert.equal(waiting.header.title.content, '【战役批准 · 等待批准】python · python-v3');
  assert.equal(waiting.header.template, 'orange');
  // 终态
  const done = buildCampaignCard({ ...base, status: CAMPAIGN_CARD_STATUS.COMPLETED, currentGate: { pod: 'p', indexId: 'i', sentAt: 'x', index: v2IndexFixture() } });
  assert.equal(done.header.title.content, '【已完成】python · python-v3');
  assert.equal(done.header.template, 'green');
  // 输入校验：language/trackKey 缺失 typed 抛错
  assert.throws(() => buildCampaignCard({ language: '', trackKey: 'k', pod: 'p' }), (error) => error.code === 'CAMPAIGN_CARD_INPUT_INVALID');
  assert.throws(() => buildCampaignCard({ language: 'python', trackKey: 'k', pod: '' }), (error) => error.code === 'CAMPAIGN_CARD_INPUT_INVALID');
});

test('buildCampaignCard: 时间轴截断（最近 10 条 + …更早 k 条）+ stamp 形态 + 尾注', () => {
  const { buildCampaignCard, TIMELINE_VISIBLE } = campaignCardModule();
  const base = campaignCardFixture();
  const bodyOf = (timeline) => buildCampaignCard({ ...base, timeline })
    .elements[1].text.content;   // div 序：0=战役概况（持久）、1=时间轴
  // 少于 10 条：无合并行；icon 时间 短文本
  const small = bodyOf(base.timeline);
  assert.match(small, /^\*\*时间轴\*\*$/m);
  assert.match(small, /▶️ 10-24 03:07 派单 python-v3（PR intake 6 条）/);
  assert.doesNotMatch(small, /更早/);
  // 恰好 10 条：无合并行，十条全显
  const exactly = bodyOf(Array.from({ length: TIMELINE_VISIBLE }, (_, i) => ({ ts: `2026-10-24T04:${String(i).padStart(2, '0')}:00.000Z`, icon: '✅', text: `e${i}` })));
  assert.doesNotMatch(exactly, /更早/);
  assert.match(exactly, /✅ 10-24 04:09 e9/);
  assert.match(exactly, /✅ 10-24 04:00 e0/);
  // 13 条：…更早 3 条 + 最近 10 条
  const overflow = bodyOf(Array.from({ length: 13 }, (_, i) => ({ ts: `2026-10-24T05:${String(i).padStart(2, '0')}:00.000Z`, icon: '', text: `n${i}` })));
  assert.match(overflow, /…更早 3 条/);
  assert.match(overflow, /05:12 n12/);
  assert.doesNotMatch(overflow, /05:00 n0/);
  // 无图标条目：icon 段缺位不产生双空格
  assert.match(overflow, /^10-24 05:03 n3$/m);
  // 尾注（每张卡都有）
  const card = buildCampaignCard(base);
  const note = card.elements.find((element) => element.tag === 'note');
  assert.match(note.elements[0].content, /打回请回复本消息：打回 <原因>/);
});

test('buildCampaignCard: 概况持久区块 + 当前门区块——按钮数=replyLines、value 无 slot、digest 短版', () => {
  const { buildCampaignCard } = campaignCardModule();
  const index = v2IndexFixture({
    replyLines: [`APPROVE_ROLLBACK u1 ${hexFix('1')}`, `APPROVE_ROLLBACK u2 ${hexFix('2')}`, `APPROVE_ROLLBACK u3 ${hexFix('3')}`],
  });
  const currentGate = { pod: 'python-v3-worker', indexId: 'k/20261024-030000-APPROVE_ROLLBACK.index.json', sentAt: '2026-10-24T04:00:00.000Z', index };
  const card = buildCampaignCard({ ...campaignCardFixture(), summary: { source: index.source, impact: index.impact }, currentGate });
  const divs = card.elements.filter((element) => element.tag === 'div');
  // div 序：0=战役概况（持久） 1=时间轴 2=当前门
  assert.equal(divs.length, 3);
  const summary = divs[0].text.content;
  assert.match(summary, /^\*\*战役概况\*\*$/m);
  assert.match(summary, /来源 PR intake：\[#1184\]\(/);                       // 来源三件套之一
  assert.match(summary, /动作面：文档 12 篇 · CREATE 3 · UPDATE 9/);           // 动作面
  assert.match(summary, /… 等共 12 篇（全清单见工件）/);                        // 清单截断 10
  assert.match(summary, /pod: python-v3-worker · 轨道: python-v3 · 语言: python/); // pod 归属（一轨一 pod，无 slot）
  const gateDiv = divs[2].text.content;
  assert.match(gateDiv, /\*\*当前门 · 战役批准 — APPROVE_CAMPAIGN — 2 单元\*\*/);
  assert.doesNotMatch(gateDiv, /来源 PR intake/);                              // 概况不重复进当前门
  assert.match(gateDiv, /digest: sha256:aaaaaaaaaaaa…/);                       // digest 短版
  assert.match(gateDiv, new RegExp(`APPROVE_ROLLBACK u2 ${hexFix('2')}`));      // 完整批准行
  const actions = card.elements.filter((element) => element.tag === 'action');
  assert.equal(actions.length, 3);
  assert.deepEqual(actions.map((element) => element.actions[0].text.content), ['批准 1', '批准 2', '批准 3']);
  const value = actions[1].actions[0].value;
  assert.equal(value.kind, 'pod-gate-approve');
  assert.equal(value.pod, 'python-v3-worker');
  assert.equal(value.line, `APPROVE_ROLLBACK u2 ${hexFix('2')}`);
  assert.equal(value.indexId, currentGate.indexId);
  assert.equal(value.sentAt, currentGate.sentAt);   // 按钮值用呈门时刻，PATCH 重挂不漂移
  assert.ok(!('slot' in value));                    // 一轨一 pod：value 无 slot 字段
  for (const entry of Object.values(value)) assert.equal(typeof entry, 'string');
  // currentGate=null → 无门区块、无按钮（点过的按钮应不能再点 = 清门即消失）；
  // 概况区块仍在（持久）
  const cleared = buildCampaignCard(campaignCardFixture());
  assert.equal(cleared.elements.filter((element) => element.tag === 'action').length, 0);
  assert.equal(cleared.elements.filter((element) => element.tag === 'div').length, 2);
  assert.match(cleared.elements[0].text.content, /\*\*战役概况\*\*/);
  assert.match(cleared.elements[0].text.content, /来源：待呈门登记/);          // 无 summary 时如实占位
});

test('splitEventIcon/shortDigest/timelineStamp: 事件拆分与短版工具函数契约', () => {
  const { splitEventIcon, shortDigest, timelineStamp } = campaignCardModule();
  // 双码点 emoji（U+FE0F 变体选择符结尾）整段吃进 icon
  assert.deepEqual(splitEventIcon('▶️ 派单 python-v3（PR intake 6 条）'), { icon: '▶️', text: '派单 python-v3（PR intake 6 条）' });
  assert.deepEqual(splitEventIcon('⏱️ 宽限过期，轨道让出'), { icon: '⏱️', text: '宽限过期，轨道让出' });
  assert.deepEqual(splitEventIcon('✔ 战役终态，轨道释放'), { icon: '✔', text: '战役终态，轨道释放' });
  assert.deepEqual(splitEventIcon('no icon here'), { icon: '', text: 'no icon here' });
  assert.deepEqual(splitEventIcon(''), { icon: '', text: '' });
  // digest 短版：sha256 前 12 hex；非法/超长截 24
  assert.equal(shortDigest(`sha256:${'a'.repeat(64)}`), `sha256:${'a'.repeat(12)}…`);
  assert.equal(shortDigest('short'), 'short');
  assert.equal(shortDigest('x'.repeat(30)), `${'x'.repeat(24)}…`);
  assert.equal(shortDigest(null), '');
  // stamp：ISO → MM-DD HH:mm；非 ISO 原样
  assert.equal(timelineStamp('2026-10-24T03:07:00.000Z'), '10-24 03:07');
  assert.equal(timelineStamp('not-iso'), 'not-iso');
});

// campaign-card CLI 的 fetch 桩：token/open_id 固定，im 端点记账。构造即自注册
// （latestCampaignCardFetch）——withCampaignCardEnv 在测试窗口内把它挂到
// globalThis.fetch（CLI 路径的 fetch 无法参数注入；绝不真连 feishu.example）。
let latestCampaignCardFetch = null;
function campaignCardFetchStub({ nextMessageId = 'om_card_1', patchCode = 0 } = {}) {
  const calls = [];
  const state = { nextMessageId, patchCode, patchHtml: null };
  const fetchImpl = async (url, init) => {
    const urlText = String(url);
    if (urlText.includes('/tenant_access_token/')) return { json: async () => ({ code: 0, tenant_access_token: 't' }) };
    if (urlText.includes('/users/batch_get_id')) return { json: async () => ({ code: 0, data: { user_list: [{ user_id: 'ou_operator' }] } }) };
    const entry = { url: urlText, method: init.method, body: JSON.parse(init.body) };
    calls.push(entry);
    if (init.method === 'PATCH') {
      // 响应形状=生产契约：text 可读 + json 可解析（lib 端 text→JSON.parse，
      // HTML 错误页走非 JSON 分支降级——2026-10-25 小写 patch 事故的钉子）。
      const payload = state.patchHtml ? null : (state.patchCode === 0 ? { code: 0, data: {} } : { code: state.patchCode, msg: 'card gone' });
      const text = state.patchHtml ?? JSON.stringify(payload);
      return { status: state.patchHtml ? 400 : 200, text: async () => text, json: async () => JSON.parse(text) };
    }
    return { json: async () => ({ code: 0, data: { message_id: state.nextMessageId } }) };
  };
  latestCampaignCardFetch = fetchImpl;
  return { calls, state, fetchImpl };
}

async function withCampaignCardEnv(work, fn) {
  const { runCli } = campaignCardModule();
  // CLI 路径的 fetch 无法注入参数——测试窗口内把最近构造的 stub 挂到
  // globalThis.fetch（离线确定性；无 stub 时不动）。
  const realFetch = globalThis.fetch;
  if (latestCampaignCardFetch) globalThis.fetch = latestCampaignCardFetch;
  const envBackup = {
    FEISHU_HOST: process.env.FEISHU_HOST, BOT_APP_ID: process.env.BOT_APP_ID,
    BOT_APP_SECRET: process.env.BOT_APP_SECRET, OPERATOR_EMAIL: process.env.OPERATOR_EMAIL,
  };
  const stdoutChunks = [];
  const stderrChunks = [];
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  process.stdout.write = (chunk) => (stdoutChunks.push(String(chunk)), true);
  process.stderr.write = (chunk) => (stderrChunks.push(String(chunk)), true);
  Object.assign(process.env, { FEISHU_HOST: 'https://feishu.example', BOT_APP_ID: 'a', BOT_APP_SECRET: 'b', OPERATOR_EMAIL: 'op@example' });
  try {
    return await fn(runCli, {
      stdout: () => stdoutChunks.join(''),
      stderr: () => stderrChunks.join(''),
    });
  } finally {
    globalThis.fetch = realFetch;
    latestCampaignCardFetch = null;
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    Object.assign(process.env, envBackup);
  }
}

test('campaign-card CLI 状态机: 首事件 send→状态存 messageId→次事件 PATCH 载荷含 messageId', async () => {
  const work = tmpdir('campaign-cli');
  const stateFile = path.join(work, 'card-python-v3.json');
  const indexFile = path.join(work, 'x.index.json');
  fs.writeFileSync(indexFile, JSON.stringify(v2IndexFixture()));
  const stub = campaignCardFetchStub();
  await withCampaignCardEnv(work, async (runCli) => {
    // ① 首事件：无 messageId → POST 新卡（interactive）
    await runCli(['campaign-card', '--state', stateFile, '--repo-root', work,
      '--event', '▶️ 派单 python-v3（PR intake 6 条）',
      '--pod', 'python-v3-worker', '--track-key', 'python-v3', '--language', 'python',
      '--open-id-cache', path.join(work, 'openid')]);
    assert.equal(stub.calls.length, 1);
    const [post] = stub.calls;
    assert.equal(post.method, 'post');
    assert.match(post.url, /\/open-apis\/im\/v1\/messages\?receive_id_type=open_id$/);
    assert.equal(post.body.msg_type, 'interactive');
    assert.equal(post.body.receive_id, 'ou_operator');
    const firstCard = JSON.parse(post.body.content);
    assert.equal(firstCard.header.title.content, '【进行中】python · python-v3');
    assert.equal(firstCard.config.update_multi, true);
    // 首事件时间戳是测试运行当下（now()），钉"图标 时间 短文本"一行形态即可
    assert.match(firstCard.elements[1].text.content, /^▶️ \d{2}-\d{2} \d{2}:\d{2} 派单 python-v3（PR intake 6 条）$/m);
    assert.match(firstCard.elements[0].text.content, /来源：待呈门登记/);   // 概况区块先于时间轴
    // 状态文件：messageId 落盘（后续 PATCH 的钥匙），timeline 1 条
    const state1 = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.deepEqual(Object.keys(state1).sort(), ['currentGate', 'messageId', 'status', 'summary', 'timeline', 'updatedAt']);
    assert.equal(state1.summary, null);   // 派单事件无呈门 → 概况未捕获
    assert.equal(state1.messageId, 'om_card_1');
    assert.equal(state1.status, 'active');
    assert.equal(state1.currentGate, null);
    assert.equal(state1.timeline.length, 1);
    assert.deepEqual(Object.keys(state1.timeline[0]).sort(), ['icon', 'text', 'ts']);
    assert.equal(state1.timeline[0].icon, '▶️');

    // ② 次事件 + 呈门：有 messageId → PATCH 同一张卡，载荷含 messageId 于 URL
    stub.state.nextMessageId = 'om_card_2';   // PATCH 成功不该触发 send；若误发可见于断言
    await runCli(['campaign-card', '--state', stateFile, '--repo-root', work,
      '--event', '⚑ 战役批准呈报',
      '--presentation', indexFile, '--index-id', 'k/x.index.json',
      '--pod', 'python-v3-worker', '--track-key', 'python-v3', '--language', 'python']);
    assert.equal(stub.calls.length, 2);
    const [patch] = stub.calls.slice(-1);
    assert.equal(patch.method, 'PATCH');   // 大写：fetch 规范不纠正 patch 大小写，小写上线=网关 HTML 400（2026-10-25 事故钉子）
    assert.equal(patch.url, 'https://feishu.example/open-apis/im/v1/messages/om_card_1');
    assert.deepEqual(Object.keys(patch.body), ['content']);   // d.ts: patch data = {content}
    const patchedCard = JSON.parse(patch.body.content);
    assert.match(patchedCard.header.title.content, /【战役批准 · 等待批准】python · python-v3/);
    const actions = patchedCard.elements.filter((element) => element.tag === 'action');
    assert.equal(actions.length, 1);   // v2IndexFixture 单 replyLine → 单按钮
    assert.equal(actions[0].actions[0].value.indexId, 'k/x.index.json');
    const state2 = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(state2.messageId, 'om_card_1');
    assert.equal(state2.timeline.length, 2);
    assert.equal(state2.currentGate.indexId, 'k/x.index.json');
    assert.equal(state2.currentGate.pod, 'python-v3-worker');
    assert.doesNotThrow(() => Date.parse(state2.currentGate.sentAt));
    assert.equal(state2.currentGate.index.gate, 'APPROVE_CAMPAIGN');
    assert.equal(state2.summary.source.origin, 'pr-intake');   // 首次呈门捕获概况
    assert.equal(state2.summary.impact.total, 12);

    // ③ --approved：清门 → PATCH 载荷无按钮（点过的按钮不能再点）
    await runCli(['campaign-card', '--state', stateFile, '--repo-root', work,
      '--approved', '--event', `✅ 写入批准已批准（注入）`,
      '--pod', 'python-v3-worker', '--track-key', 'python-v3', '--language', 'python']);
    const approvedCard = JSON.parse(stub.calls[stub.calls.length - 1].body.content);
    assert.match(approvedCard.header.title.content, /【进行中】/);
    assert.equal(approvedCard.elements.filter((element) => element.tag === 'action').length, 0);
    const state3 = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(state3.currentGate, null);
    assert.equal(state3.timeline.at(-1).icon, '✅');

    // ④ --terminal：终态 → header【已完成】+ status completed
    await runCli(['campaign-card', '--state', stateFile, '--repo-root', work,
      '--terminal', '--cleared-gate', '--event', '✔ 战役终态，轨道释放',
      '--pod', 'python-v3-worker', '--track-key', 'python-v3', '--language', 'python']);
    const terminalCard = JSON.parse(stub.calls[stub.calls.length - 1].body.content);
    assert.match(terminalCard.header.title.content, /【已完成】python · python-v3/);
    assert.equal(terminalCard.header.template, 'green');
    const state4 = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(state4.status, 'completed');
    assert.equal(state4.timeline.length, 4);
    assert.equal(stub.calls.length, 4);   // 全程 PATCH，零新卡（不发新卡裁定）
  });
});

test('campaign-card CLI 状态机: PATCH 失败降级发新卡并更新状态 messageId（stderr WARN + mode=send-fallback）', async () => {
  const work = tmpdir('campaign-cli-fallback');
  const stateFile = path.join(work, 'card-java-v26.json');
  const stub = campaignCardFetchStub({ nextMessageId: 'om_card_1' });
  await withCampaignCardEnv(work, async (runCli, io) => {
    // 首发建卡
    await runCli(['campaign-card', '--state', stateFile, '--repo-root', work,
      '--event', '▶️ 派单 java-v26（repo-scan）',
      '--pod', 'java-v26-worker', '--track-key', 'java-v26', '--language', 'java']);
    assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).messageId, 'om_card_1');
    // PATCH 被飞书拒绝（如卡已撤回/超 14 天）→ 降级 POST 新卡，messageId 换新
    stub.state.patchCode = 230013;
    stub.state.nextMessageId = 'om_card_2';
    await runCli(['campaign-card', '--state', stateFile, '--repo-root', work,
      '--event', '🔁 续跑 java-v26',
      '--pod', 'java-v26-worker', '--track-key', 'java-v26', '--language', 'java']);
    const [failedPatch, fallbackPost] = stub.calls.slice(-2);
    assert.equal(failedPatch.method, 'PATCH');   // 大写：fetch 规范不纠正 patch 的大小写（小写上线=边缘网关 HTML 400）
    assert.equal(fallbackPost.method, 'post');
    assert.equal(JSON.parse(fallbackPost.body.content).elements[1].text.content.split('\n').length, 3); // 时间轴头+2 条（elements[0]=概况）
    assert.match(io.stderr(), /CARD_PATCH_FAILED.*230013/);
    assert.match(io.stdout(), /messageId=om_card_2/);
    assert.match(io.stdout(), /mode=send-fallback/);
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(state.messageId, 'om_card_2');
    assert.equal(state.timeline.length, 2);
    // 之后事件走新 messageId 的 PATCH
    stub.state.patchCode = 0;
    await runCli(['campaign-card', '--state', stateFile, '--repo-root', work,
      '--cleared-gate', '--event', '⏱️ 宽限过期，轨道让出',
      '--pod', 'java-v26-worker', '--track-key', 'java-v26', '--language', 'java']);
    assert.equal(stub.calls[stub.calls.length - 1].url, 'https://feishu.example/open-apis/im/v1/messages/om_card_2');
  });
});

test('campaign-card CLI 状态机: PATCH 返回非 JSON（网关 HTML 400 页）同样降级发新卡——2026-10-25 小写 patch 事故钉子', async () => {
  const work = tmpdir('campaign-cli-html');
  const stateFile = path.join(work, 'card-go-v3.json');
  const stub = campaignCardFetchStub({ nextMessageId: 'om_card_1' });
  await withCampaignCardEnv(work, async (runCli, io) => {
    await runCli(['campaign-card', '--state', stateFile, '--repo-root', work,
      '--event', '▶️ 派单 go-v3（PR intake 4 条）',
      '--pod', 'go-v3-worker', '--track-key', 'go-v3', '--language', 'go']);
    // 生产事故形态：method 小写 patch → 边缘网关 HTML 400（fetch 在 json() 处炸、
    // 降级够不着）。修复后 text→JSON.parse 失败 → 非 JSON 分支 → 降级 POST。
    stub.state.patchHtml = '<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">\n<html><head><title>400 Bad Request</title></head></html>';
    stub.state.nextMessageId = 'om_card_2';
    await runCli(['campaign-card', '--state', stateFile, '--repo-root', work,
      '--event', '⚑ 战役批准呈报',
      '--pod', 'go-v3-worker', '--track-key', 'go-v3', '--language', 'go']);
    const [failedPatch, fallbackPost] = stub.calls.slice(-2);
    assert.equal(failedPatch.method, 'PATCH');
    assert.equal(fallbackPost.method, 'post');
    assert.match(io.stderr(), /CARD_PATCH_FAILED.*non-JSON response/);
    assert.match(io.stdout(), /mode=send-fallback/);
    assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).messageId, 'om_card_2');
  });
});

// ---------- 5c. 写入进展探针（relay resident 定时 exec 的 worker 侧能力） ----------

test('composeSyncProgress: 三形态（总数有/无、零失败省略、runner 存亡）；parseSyncLogText 计数与总数', () => {
  const { composeSyncProgress, parseSyncLogText } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  assert.equal(composeSyncProgress({ done: 49, failed: 6, total: 118, runnerAlive: true }), '写入 49/118 · 失败 6 · runner 运行中');
  assert.equal(composeSyncProgress({ done: 49, failed: 0, total: 118, runnerAlive: false }), '写入 49/118 · runner 已结束');
  assert.equal(composeSyncProgress({ done: 3, failed: 0, total: null, runnerAlive: true }), '写入 3 单元 · runner 运行中');
  assert.equal(composeSyncProgress({ done: -1, failed: 0, total: 118, runnerAlive: true }), null);

  const parsed = parseSyncLogText([
    'done review:go:Authentication:CreateUser (6/118)',
    'FAILED review:go:Authentication:DropUser — NO_EXECUTION_BATCH（继续下一个单元）',
    'done review:go:Authentication:DropRole (8/118)',
    'noise line',
  ].join('\n'));
  assert.deepEqual(parsed, { done: 2, failed: 1, total: 118 });
});

test('buildCampaignCard: --progress 渲染进概况区块（不进时间轴）；无 progress 不出该行', () => {
  const { buildCampaignCard } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  const base = { language: 'go', trackKey: 'go-v3', pod: 'go-v3-worker' };
  const withProgress = buildCampaignCard({ ...base, progress: '写入 49/118 · 失败 6 · runner 运行中' });
  assert.match(withProgress.elements[0].text.content, /写入进展: 写入 49\/118 · 失败 6 · runner 运行中/);
  assert.equal(withProgress.elements.length, 3);   // 概况+时间轴+尾注（无门无按钮）
  const without = buildCampaignCard({ ...base });
  assert.doesNotMatch(without.elements[0].text.content, /写入进展/);
});

test('campaign-card CLI: --progress 纯进展更新——不刷时间轴、state.progress 落盘、PATCH 同卡', async () => {
  const work = tmpdir('campaign-progress');
  const stateFile = path.join(work, 'card-go-v3.json');
  const stub = campaignCardFetchStub({ nextMessageId: 'om_card_1' });
  await withCampaignCardEnv(work, async (runCli, io) => {
    // 先发一张卡（1 条时间轴）
    await runCli(['campaign-card', '--state', stateFile, '--repo-root', work,
      '--event', '▶️ 派单 go-v3（PR intake 4 条）',
      '--pod', 'go-v3-worker', '--track-key', 'go-v3', '--language', 'go']);
    assert.equal(stub.calls.length, 1);
    // 纯进展更新：无 --event，PATCH 同卡，时间轴不增长
    await runCli(['campaign-card', '--state', stateFile, '--repo-root', work,
      '--progress', '写入 49/118 · 失败 6 · runner 运行中',
      '--pod', 'go-v3-worker', '--track-key', 'go-v3', '--language', 'go']);
    assert.equal(stub.calls.length, 2);
    assert.equal(stub.calls[1].method, 'PATCH');
    assert.match(stub.calls[1].url, /\/open-apis\/im\/v1\/messages\/om_card_1$/);
    assert.match(JSON.parse(stub.calls[1].body.content).elements[0].text.content, /写入进展: 写入 49\/118/);
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(state.progress, '写入 49/118 · 失败 6 · runner 运行中');
    assert.equal(state.timeline.length, 1);   // 不刷时间轴
    // 相同进展再刷 → 仍 PATCH（CLI 层不管去重，campaignProgress 层守卫）；但 event+progress 同给=时间轴也走
    await runCli(['campaign-card', '--state', stateFile, '--repo-root', work,
      '--event', '✅ 战役批准已批准（注入，续跑中）',
      '--pod', 'go-v3-worker', '--track-key', 'go-v3', '--language', 'go']);
    assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).timeline.length, 2);
  });
});

test('campaign-card CLI: 无 event 且无 progress → typed USAGE（进展例外不吞事件必填纪律）', async () => {
  const work = tmpdir('campaign-usage-progress');
  const { runCli } = campaignCardModule();
  await assert.rejects(
    runCli(['campaign-card', '--state', path.join(work, 'card.json'), '--repo-root', work,
      '--pod', 'p', '--track-key', 'k', '--language', 'python']),
    (error) => error.code === 'USAGE',
  );
});

test('campaign-card CLI: 必填参数缺失 typed USAGE；--approved 等布尔旗标可置于带值旗标之前（parseCli 豁免名单）', async () => {  const work = tmpdir('campaign-cli-usage');
  const { runCli, CLI_BOOLEAN_FLAGS } = campaignCardModule();
  await assert.rejects(
    runCli(['campaign-card', '--state', path.join(work, 'card.json'), '--repo-root', work, '--event', 'x']),
    (error) => error.code === 'USAGE',
  );
  assert.deepEqual([...CLI_BOOLEAN_FLAGS].sort(), ['approved', 'cleared-gate', 'new-campaign', 'terminal']);
  const stub = campaignCardFetchStub();
  await withCampaignCardEnv(work, async (runCliLocal) => {
    // 布尔旗标在最前（不吞 --event 的值）——supervisor 钩子的参数顺序自由度
    await runCliLocal(['campaign-card', '--state', path.join(work, 'card.json'), '--repo-root', work,
      '--cleared-gate', '--event', '⏱️ 宽限过期，轨道让出',
      '--pod', 'p', '--track-key', 'k', '--language', 'python']);
    assert.equal(stub.calls.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(work, 'card.json'), 'utf8')).timeline[0].text, '宽限过期，轨道让出');
  });
});

test('deploy/lib.js CLI gate-label: GATE_LABELS_ZH 单源查询口（supervisor 拼 ⚑ 事件文本用）', () => {
  const out = execFileSync(process.execPath, [
    path.join(REPO_ROOT, 'deploy', 'lib.js'), 'gate-label', '--gate', 'APPROVE_CAMPAIGN',
  ], { encoding: 'utf8' });
  assert.equal(out, '战役批准\n');
  const passthrough = execFileSync(process.execPath, [
    path.join(REPO_ROOT, 'deploy', 'lib.js'), 'gate-label', '--gate', 'NOT_A_GATE',
  ], { encoding: 'utf8' });
  assert.equal(passthrough, 'NOT_A_GATE\n');   // 未登记门名原样透传
  const empty = spawnSync(process.execPath, [
    path.join(REPO_ROOT, 'deploy', 'lib.js'), 'gate-label', '--gate', '',
  ], { encoding: 'utf8' });
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /USAGE/);
});

test('supervisor.sh 单轨模型: 常驻卡五钩子 + 一轨一 pod + notify-gate 退役（脚本 grep pin）', () => {
  const script = fs.readFileSync(path.join(REPO_ROOT, 'deploy', 'supervisor.sh'), 'utf8');
  // 一轨一 pod：TRACK 单轨 env（拒逗号）、无 slot 机制
  assert.match(script, /TRACK="\$\{TRACK:\?TRACK env is required \(single version track/);
  assert.match(script, /多轨请各起一个 pod/);
  assert.doesNotMatch(script, /SLOT_/);
  assert.doesNotMatch(script, /approve-\$\{?slot/);
  assert.match(script, /QUEUE="\$INBOUND\/approve\.queue"/);
  // 收口 helper：全部卡操作走 lib.js campaign-card，状态 per track、无 slot
  assert.match(script, /campaign-card \\\n\s+--state "\$RUNS\/card-\$\{TRACK_KEY\}\.json" --repo-root "\$REPO" \\\n\s+--pod "\$POD_NAME" --track-key "\$TRACK_KEY" --language "\$LANGUAGE"/);
  assert.match(script, /gate_label\(\)/);
  // ① 派单：--new-campaign 同卡续写 + ▶️ 时间轴首事件
  assert.match(script, /campaign_card --new-campaign --event "\$card_note"/);
  assert.match(script, /▶️ 派单 \$\{track_key\}（repo-scan）/);
  assert.match(script, /▶️ 派单 \$\{track_key\}（PR intake \$pending 条）/);
  // ② 呈门：--presentation 换当前门 + ⚑ 门中文呈报（归因=一轨一 pod）
  assert.match(script, /--presentation "\$f" --index-id "\$index_id"/);
  assert.match(script, /⚑ \$\{gate_zh\}呈报/);
  assert.match(script, /归因=一轨一 pod/);
  assert.match(script, /event gate_presented /);
  assert.match(script, /event gate_present_failed /);
  // ③ 批准注入成功：--approved 清门 + ✅ 时间轴
  assert.match(script, /--approved --event "✅ \$\{approve_label\}已批准（注入，续跑中）"/);
  // ④ 终态释放：--terminal --cleared-gate + ✔
  assert.match(script, /--terminal --cleared-gate/);
  assert.match(script, /✔ 战役终态，轨道释放/);
  // ⑤ 宽限让出：--cleared-gate + ⏱️
  assert.match(script, /--cleared-gate --event "⏱️ 宽限过期，轨道让出"/);
  // 旧单发路径退役：无 notify-gate 调用、无 sent-cards 落账、旧事件名不复存在
  assert.doesNotMatch(script, /notify-gate --index-file/);
  assert.doesNotMatch(script, /sent-cards\.jsonl/);
  assert.doesNotMatch(script, /gate_notified/);
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
  for (const name of ['bootstrap.sh', 'supervisor.sh', 'seed-backlog.sh', 'relay-entry.sh', 'relay-kubectl-fetch.sh']) {
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
    '--pod', 'python-v3-worker', '--line', 'APPROVE_CAMPAIGN sha256:nope',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /APPROVE_LINE_INVALID/);
  assert.match(result.stderr, /重新走门/);
});

test('pod-approve.js rejects bad pod names before spawn', () => {
  for (const args of [
    ['--pod', '../evil', '--line', `APPROVE_CAMPAIGN sha256:${GOOD_64HEX}`],
    ['--pod', 'python-worker; rm -rf /', '--line', `APPROVE_CAMPAIGN sha256:${GOOD_64HEX}`],
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

// ---------- 9. 控制面云化：configmap-relay 三副本 pin + 挂载布局 pin ----------
//
// 裁定（2026-10-24）：card.action.trigger 唯一订阅者=集群内 relay pod，三个 repo
// 文件（card-approve/pod-approve/lib）随 configmap sdk-relay 挂载副本进 pod。为免
// 双真相漂移：内嵌副本与 repo 源文件逐字节一致（这里钉死），volume items 在
// relay-deployment.yaml 里按 repo 目录结构重映射（relay-entry.js 的相对 require
// 与 repo 内同解——这里钉死重映射键）。

const RELAY_CONFIGMAP_KEYS = [
  ['relay-entry.js', 'deploy/relay-entry.js'],
  ['relay-entry.sh', 'deploy/relay-entry.sh'],
  ['relay-kubectl-fetch.sh', 'deploy/relay-kubectl-fetch.sh'],
  ['card-approve.js', 'scripts/dashboard/card-approve.js'],
  ['pod-approve.js', 'scripts/dashboard/pod-approve.js'],
  ['lib.js', 'deploy/lib.js'],
];

test('configmap-relay.yaml: 六副本与 repo 源文件逐字节一致（防双真相漂移）', () => {
  for (const [key, sourcePath] of RELAY_CONFIGMAP_KEYS) {
    const block = readConfigMapBlock('deploy/configmap-relay.yaml', key);
    const source = fs.readFileSync(path.join(REPO_ROOT, sourcePath), 'utf8');
    assert.ok(block.length > 100, `${key} 块内容过短`);
    assert.equal(block, source.replace(/\n$/, ''), `configmap-relay.yaml 的 ${key} 副本与 ${sourcePath} 漂移——按文件头命令重生成`);
  }
});

test('configmap-relay.yaml: 头注释带再生成命令（六 --from-file 全部指向 repo 源）', () => {
  const yaml = fs.readFileSync(path.join(REPO_ROOT, 'deploy', 'configmap-relay.yaml'), 'utf8');
  assert.match(yaml, /(^|\n)# 再生成/);
  assert.match(yaml, /kubectl create configmap sdk-relay -n sdk-doc-sync --dry-run=client -o yaml/);
  for (const [key, sourcePath] of RELAY_CONFIGMAP_KEYS) {
    assert.match(yaml, new RegExp(`--from-file=${key}=${sourcePath.replace(/\//g, '\\/')}`), `生成命令缺 ${key}`);
  }
});

test('relay-deployment.yaml: volume items 按 repo 目录结构重映射 + SA + 镜像卡 + kubectl 供给', () => {
  const yaml = fs.readFileSync(path.join(REPO_ROOT, 'deploy', 'relay-deployment.yaml'), 'utf8');
  assert.match(yaml, /serviceAccountName: relay-approver/);
  assert.match(yaml, /name: sdk-relay/);
  for (const [key, sourcePath] of RELAY_CONFIGMAP_KEYS) {
    assert.match(yaml, new RegExp(`key: ${key.replace(/\./g, '\\.')}\\n\\s+path: ${sourcePath.replace(/\//g, '\\/')}`), `items 重映射缺 ${key} → ${sourcePath}`);
  }
  assert.match(yaml, /mountPath: \/opt\/relay/);
  assert.match(yaml, /mountPath: \/relay-work/);
  assert.match(yaml, /emptyDir: \{\}/);
  assert.match(yaml, /image: node:22-bookworm/);
  // kubectl 供给：initContainer（pkgs.k8s.io 官方 apt 仓，dl.k8s.com egress 不通的
  // 实测修正）→ 共享 emptyDir → 主容器 PATH 前置。
  assert.match(yaml, /kubectl-installer/);
  assert.match(yaml, /pkgs\.k8s\.io/);
  assert.match(yaml, /mountPath: \/opt\/kubectl-bin/);
  assert.match(yaml, /\/opt\/kubectl-bin:\/usr\/local\/sbin/);
});

test('pod-approve.js kubectl 形态带 -n（in-cluster SA 生效的前提，RBAC 面依赖它）', () => {
  // relay pod 里 pod-approve 以 in-cluster 凭据跑 kubectl；NAMESPACE 显式进 argv
  // （'exec', '-n', NAMESPACE, pod）+ 全程 argv 数组无 shell 拼接——形态漂移即此处红。
  const source = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'dashboard', 'pod-approve.js'), 'utf8');
  assert.match(source, /const NAMESPACE = 'sdk-doc-sync';/);
  assert.match(source, /'exec', '-n', NAMESPACE, pod, '--',/);
});

// ---------- 10. relay-entry fail-closed 内核（零网络、零 /relay-work 依赖） ----------

const relayEntry = require(path.join(REPO_ROOT, 'deploy', 'relay-entry.js'));
const cardApproveModule = require(path.join(REPO_ROOT, 'scripts', 'dashboard', 'card-approve.js'));

function relayFixture() {
  const VALUE = {
    kind: 'pod-gate-approve', pod: 'python-v3-worker',
    line: `APPROVE_CAMPAIGN sha256:${'a'.repeat(64)}`,
    indexId: 'x/20261024-030000-APPROVE_CAMPAIGN.index.json', sentAt: '2026-10-24T03:00:00.000Z',
  };
  const event = { operator: { open_id: 'ou_operator' }, action: { value: VALUE } };
  const approverCalls = [];
  const logs = [];
  const receipts = [];
  const approver = {
    handleCardAction: async (data) => {
      approverCalls.push(data);
      return { ok: true, deduped: false, text: `已批准（python-v3-worker）` };
    },
  };
  const handler = relayEntry.createCardActionHandler({
    getOperatorOpenId: () => 'ou_operator',
    approver,
    sendReceipt: async (verdict, extracted) => receipts.push({ verdict, extracted }),
    log: (record) => logs.push(record),
  });
  return { VALUE, event, approverCalls, logs, receipts, handler };
}

test('relay fail-closed: 操作员身份未解析 → 拒批 toast，不进 approver、不发回执', async () => {
  const { event, approverCalls, logs } = relayFixture();
  const handler = relayEntry.createCardActionHandler({
    getOperatorOpenId: () => null, approver: { handleCardAction: async () => { throw new Error('must not be called'); } },
    sendReceipt: null, log: (record) => logs.push(record),
  });
  const reply = await handler(event);
  assert.equal(reply.toast.type, 'error');
  assert.match(reply.toast.content, /fail-closed/);
  assert.match(reply.toast.content, /身份未解析/);
  assert.equal(approverCalls.length, 0);
  assert.equal(logs[0].outcome, 'fail-closed');
  assert.equal(logs[0].reason, 'operator-identity-unresolved');
});

test('relay fail-closed: 包络缺 operator.open_id / 非操作员 → 都拒且不 spawn', async () => {
  const noOperator = relayFixture();
  const missing = await noOperator.handler({ action: { value: noOperator.VALUE } });
  assert.equal(missing.toast.type, 'error');
  assert.match(missing.toast.content, /operator\.open_id/);
  assert.equal(noOperator.approverCalls.length, 0);

  const stranger = relayFixture();
  const mismatch = await stranger.handler({
    operator: { open_id: 'ou_stranger' }, action: { value: stranger.VALUE },
  });
  assert.equal(mismatch.toast.type, 'error');
  assert.match(mismatch.toast.content, /仅操作员可批准/);
  assert.equal(stranger.approverCalls.length, 0);
  assert.equal(stranger.logs[0].reason, 'operator-mismatch');
});

test('relay 放行：操作员按钮 → approver 接手，toast 同步 verdict，p2p 回执发出', async () => {
  const { event, approverCalls, receipts, handler } = relayFixture();
  const reply = await handler(event);
  assert.equal(approverCalls.length, 1);
  assert.equal(reply.toast.type, 'success');
  assert.equal(reply.toast.content, '已批准（python-v3-worker）');
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].verdict.ok, true);
  assert.equal(receipts[0].extracted.operatorOpenId, 'ou_operator');
  // 失败 verdict → error toast；回执发送抛错被吞（只记日志），toast 不受影响
  const failingLogs = [];
  const failHandler = relayEntry.createCardActionHandler({
    getOperatorOpenId: () => 'ou_operator',
    approver: { handleCardAction: async () => ({ ok: false, deduped: false, text: '批准注入失败（python-v3-worker）：kubectl exec exited 1' }) },
    sendReceipt: async () => { throw new Error('feishu down'); },
    log: (record) => failingLogs.push(record),
  });
  const failReply = await failHandler(event);
  assert.equal(failReply.toast.type, 'error');
  assert.match(failReply.toast.content, /kubectl exec exited 1/);
  assert.equal(failingLogs.filter((record) => record.outcome === 'receipt-send-failed').length, 1);
});

test('buildReceiptText/truncateLine: pod/行前 60 字符/失败原因；垃圾 value 如实 ? 不编', () => {
  // 截断边界钉死：60 字符原样，61 字符截 60 + 省略号
  assert.equal(relayEntry.truncateLine('A'.repeat(60)), 'A'.repeat(60));
  assert.equal(relayEntry.truncateLine('A'.repeat(61)), `${'A'.repeat(60)}…`);
  const extracted = { operatorOpenId: 'ou_operator', value: { pod: 'python-v3-worker', line: `APPROVE_CAMPAIGN sha256:${'a'.repeat(64)}` } };
  const okText = relayEntry.buildReceiptText({ ok: true, deduped: false, text: '已批准' }, extracted);
  assert.match(okText, /呈门回执 · 已批准 · pod python-v3-worker/);
  // 88 字符回现行 → 前 60（"APPROVE_CAMPAIGN sha256:" 24 字符 + 36 个 a）+ 省略号
  assert.match(okText, /行: APPROVE_CAMPAIGN sha256:a{36}…/);
  const failText = relayEntry.buildReceiptText({ ok: false, deduped: false, text: '批准注入失败（python-v3-worker）：kubectl exec exited 1' }, extracted);
  assert.match(failText, /已拒绝/);
  assert.match(failText, /原因: .+kubectl exec exited 1/);
  // 垃圾/缺失 value：'?' 占位，绝不编 pod
  const junk = relayEntry.buildReceiptText({ ok: false, deduped: false, text: 'x' }, { operatorOpenId: null, value: null });
  assert.match(junk, /pod \?/);
  assert.doesNotMatch(junk, /行: /);
});

test('dedupe 持久化：persist→load round-trip；旧键载入即剪枝；坏文件=空窗起步', () => {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-dedupe-')));
  const file = path.join(work, 'dedupe.json');
  const now = 10_000_000;
  const map = new Map([['p:young', now - 60_000], ['p:old', now - 10 * 60_000]]);
  assert.equal(relayEntry.persistDedupeState(file, map), true);
  const loaded = relayEntry.loadDedupeState(file, { now, windowMs: cardApproveModule.DEDUPE_WINDOW_MS });
  assert.deepEqual([...loaded.keys()], ['p:young']); // 窗外旧键不带回来
  // 坏文件/缺文件 → 空 Map（重启丢窗口可接受，裁定原文）
  fs.writeFileSync(file, '{not json');
  assert.equal(relayEntry.loadDedupeState(file, { now }).size, 0);
  assert.equal(relayEntry.loadDedupeState(path.join(work, 'absent.json'), { now }).size, 0);
});

// ---------- 11. relay yaml dry-run（kubectl apply --dry-run=client） ----------
//
// 注：本文件其余测试零集群依赖；此测试是任务书显式验证门。kubectl 缺失=skip；
// server 不可达=降级 kubectl create --dry-run=client --validate=ignore（纯本地解码）。

test('relay 三卡 kubectl apply --dry-run=client 通过（或离线解码降级）', () => {
  const files = ['deploy/configmap-relay.yaml', 'deploy/relay-rbac.yaml', 'deploy/relay-deployment.yaml']
    .map((relative) => path.join(REPO_ROOT, relative));
  const probe = spawnSync('kubectl', ['version', '--client'], { encoding: 'utf8' });
  if (probe.error) {
    test.skip('kubectl not installed on this host');
    return;
  }
  const env = { ...process.env, KUBECONFIG: process.env.KUBECONFIG || path.join(os.homedir(), '.milvus-cell', 'kubeconfig') };
  let result = spawnSync('kubectl', ['apply', '--dry-run=client', '--validate=false', '-f', files[0], '-f', files[1], '-f', files[2]], { encoding: 'utf8', env, timeout: 60_000 });
  const offlineish = /connection to the server|refused|i\/o timeout|unable to connect|failed to verify certificate|api group list/i;
  if (result.status !== 0 && offlineish.test(`${result.stderr}${result.stdout}`)) {
    result = spawnSync('kubectl', ['create', '--dry-run=client', '--validate=ignore', '-f', files[0], '-f', files[1], '-f', files[2], '-o', 'yaml'], { encoding: 'utf8', env, timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
  }
  if (result.status !== 0 && offlineish.test(`${result.stderr}${result.stdout}`)) {
    // 宿主 kubeconfig 指向不可达/证书失配的集群（如 milvus-cell vCluster 休眠后重建）——
    // discovery 不可用与本仓三卡的语法契约无关（逐字节副本一致性已由六副本测试钉死）。
    test.skip('host kubeconfig points at an unreachable cluster (tls/discovery) — offline validation unavailable');
    return;
  }
  assert.equal(result.status, 0, `kubectl dry-run failed: ${result.stderr || result.stdout}`);
});
