'use strict';

// deploy/lib.js — S2 双 pod 部署脚手架的共享内核（deploy/README.md 是 ops 手册）。
//
// 设计约束（批 S2）：
// - 零 npm 依赖：pod 里跑在 /workspace/feishu-markdown-bridge（bootstrap clone），
//   Mac 侧由 scripts/dashboard/pod-approve.js require；都只有 node 内建。
// - 纯函数与 IO 分层（daily-scan.js 先例）：renderOpencodeConfig /
//   validateApproveLine / extractBacklogEntries / trackEnvLine 是纯函数，被
//   tests/skills/deploy-scaffold.test.js 直测；CLI 面只做参数与 IO。
// - 治理账本一律复用 canonical 基质（daily-scan-core 的 readLedger/fold），
//   不在本文件重写第二套 fold。

const fs = require('node:fs');
const path = require('node:path');

// ---------- approve 行（supervisor 消费与 Mac 注入共用同一正则） ----------

// 任务书钉死的形态：APPROVE_<GATE> [可选第二 token] sha256:<64hex>。
// APPROVE_DOCUMENT <review-unit-id> sha256:… 走可选段；APPROVE_WRITES sha256:… 无。
const APPROVE_LINE_RE = /^APPROVE_[A-Z]+( \S+)? sha256:[0-9a-f]{64}$/;

function validateApproveLine(line) {
  const text = String(line ?? '').trim();
  return { ok: APPROVE_LINE_RE.test(text), line: text };
}

// ---------- opencode.json 渲染器（bootstrap 每次启动重渲染） ----------

// 形态照 ~/.config/opencode/opencode.json 的 custom openai-compatible 先例：
// baseURL/apiKey 用 opencode 运行时 {env:VAR} 插值（真值不落盘）；models 键
// 无法插值，必须由 bootstrap 用当时 env 的 LLM_MODEL 值渲染写死。
const OPENCODE_PROVIDER_KEY = 'custom';

// LLM_BASE_URL 的 openai-compatible 规范化：无路径前缀的网关形如
// https://token.zasdas.com —— openai-compatible provider 在 baseURL 后拼
// /chat/completions，裸域名会撞到站点登录页/网关 403（2026-10-24 双 pod 首战
// 实测：裸 URL 403，加 /v1 后 200 出真补全）。幂等：已带 /v<N> 尾缀的原样返回。
function normalizeLlmBaseUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return url;
  const trimmed = url.trim().replace(/\/+$/, '');
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

function renderOpencodeConfig({ baseUrlEnv = 'LLM_BASE_URL', apiKeyEnv = 'LLM_API_KEY', model } = {}) {
  if (typeof model !== 'string' || model.trim() === '') {
    const error = new Error('renderOpencodeConfig: LLM_MODEL is empty — secret sdk-env 缺键或 envFrom 未生效（fail-loud，不渲染空模型配置）');
    error.code = 'OPENCODE_MODEL_MISSING';
    throw error;
  }
  return {
    $schema: 'https://opencode.ai/config.json',
    // 无头 pod worker 的权限面：campaign 安全由 canonical CLI 的 APPROVE_* 门与
    // digest 绑定承担，pod 本身就是沙箱——opencode 逐动作弹窗在 headless 下只会
    // 全部 auto-reject（2026-10-24 首战实测 external_directory 拒了 ../web-content）。
    permission: {
      bash: 'allow',
      edit: 'allow',
      read: 'allow',
      external_directory: 'allow',
    },
    provider: {
      [OPENCODE_PROVIDER_KEY]: {
        npm: '@ai-sdk/openai-compatible',
        name: 'OpenAI-compatible (LLM_BASE_URL)',
        options: {
          baseURL: `{env:${baseUrlEnv}}`,
          apiKey: `{env:${apiKeyEnv}}`,
        },
        models: {
          [model]: { name: model },
        },
      },
    },
  };
}

// 求证结论（2026-10-24，本机 opencode 1.18.30 实测）：
//   `opencode run --format json` 产出 NDJSON 事件，每行事件都带顶层
//   "sessionID":"ses_…"；`opencode run -s <ses_…> -m <provider/model> "<prompt>"`
//   续跑该具体会话（实测续会话能回忆上一轮内容）。`-c/--continue` 只续"该项目
//   目录的最后一个会话"，双 slot 共用 cwd 时有串会话风险——supervisor 因此
//   每 slot 落 session 文件，用 -s 精确续接。
function extractSessionId(jsonlText) {
  const match = /"sessionID":"(ses_[A-Za-z0-9]+)"/.exec(String(jsonlText || ''));
  return match ? match[1] : null;
}

// ---------- findings 账本 → per-language backlog 提取器 ----------

// 机械提取规则（configmap-backlog.yaml 的生成口径，也是它的可复算证明）：
// 输入是 daily-scan findings 账本的原始 jsonl 行（discovered/disposed 事件流）；
// 1) fold 出 disposed prNumber 集合（scan-state 之外的唯一水位语义，照抄账本）；
// 2) 逐 prNumber 对**全部** discovered 事件做 languages 并集（import-backlog 的
//    幂等语义就是 languages 并集，这里预演同一合并；首见事件携带 title/url/
//    mergedAt，后续事件仅在缺值时补位）；
// 3) 归属判定在并集之后：并集含目标语言即该语言的 pending 条目——否则多语 PR
//    会被"首见事件不含目标语言"误伤（#1198 首见事件只有 go）。
// 输出按 prNumber 升序 —— 提取是幂等的：extract(extract(x)) === extract(x)。
function extractBacklogEntries(events, language, { discoveredOn } = {}) {
  if (!Array.isArray(events)) throw new TypeError('events must be an array of parsed ledger lines');
  if (!language) throw new TypeError('language is required');
  const disposed = new Set();
  for (const event of events) {
    if (event && event.type === 'disposed' && Number.isInteger(event.prNumber)) disposed.add(event.prNumber);
  }
  const byPr = new Map();
  for (const event of events) {
    if (!event || event.type !== 'discovered') continue;
    if (disposed.has(event.prNumber)) continue;
    if (!Array.isArray(event.languages) || event.languages.length === 0) continue;
    const existing = byPr.get(event.prNumber);
    if (!existing) {
      byPr.set(event.prNumber, {
        prNumber: event.prNumber,
        languages: [...event.languages],
        title: typeof event.title === 'string' ? event.title : null,
        url: typeof event.url === 'string' ? event.url : null,
        mergedAt: typeof event.mergedAt === 'string' ? event.mergedAt : null,
      });
    } else {
      for (const lang of event.languages) {
        if (!existing.languages.includes(lang)) existing.languages.push(lang);
      }
      if (existing.title === null && typeof event.title === 'string') existing.title = event.title;
      if (existing.url === null && typeof event.url === 'string') existing.url = event.url;
      if (existing.mergedAt === null && typeof event.mergedAt === 'string') existing.mergedAt = event.mergedAt;
    }
  }
  return [...byPr.values()]
    .filter((entry) => entry.languages.includes(language))
    .sort((a, b) => a.prNumber - b.prNumber)
    .map((entry) => ({ ...entry, discoveredOn: discoveredOn ?? null }));
}

// ---------- release-tracks 注册表 → per-track BASE_TOKEN ----------

const RELEASE_TRACKS_RELATIVE_PATH = '.claude/skills/api-reference-sync/config/release-tracks.json';

// 照抄 scripts/dashboard/ledger.js registryTrackKey：显式 scanStateKey 覆写优先，
// 否则派生 <language>-v<major><minor>。deploy 侧自持一份派生逻辑是因为
// bootstrap 阶段只 clone 了仓库，直接走 ledger.js 亦可，但保持本地纯函数
// 便于单测口径一致。
function registryTrackKey(language, track) {
  if (track && typeof track.scanStateKey === 'string' && track.scanStateKey) return track.scanStateKey;
  const match = /^v(\d+)\.(\d+)\./.exec(String(track?.version || ''));
  return match ? `${language}-v${match[1]}${match[2]}` : language;
}

// 返回 `BASE_TOKEN=<token>` 一行（supervisor eval 用）；注册表不可读/轨道缺失/
// baseToken 缺失一律 typed 抛错 —— fail-loud，绝不静默返回空 token
// （BASE_TOKEN 教训：runner/engine 的 BASE_TOKEN 必须是目标轨的 base）。
function trackEnvLine(registry, language, version) {
  const entry = registry?.languages?.[language];
  const track = (entry?.tracks || []).find((t) => t.version === version);
  if (!track) {
    const error = new Error(`trackEnvLine: 轨道未登记 ${language}/${version}（release-tracks.json 无此轨）`);
    error.code = 'TRACK_NOT_REGISTERED';
    throw error;
  }
  const token = track?.bitable?.baseToken;
  if (typeof token !== 'string' || !/^[A-Za-z0-9]+$/.test(token)) {
    const error = new Error(`trackEnvLine: ${language}/${version} 的 bitable.baseToken 缺失或形态非法（fail-loud）`);
    error.code = 'BASE_TOKEN_UNAVAILABLE';
    throw error;
  }
  return { line: `BASE_TOKEN=${token}`, trackKey: registryTrackKey(language, track) };
}

// ---------- 确定性门铃归因（规格 3，supervisor gate_watch 消费） ----------
//
// 旧"检测瞬间恰在跑的 slot"启发式（active==1）已删除——实测错配/unknown。
// 改为从工件路径确定性反解：工件路径含 gate-presentation/<sessionKey>/ 前缀，
// sessionKey 由 sessionPath 派生（src/sdk-doc-sync/gate-presentation.js
// sessionKeyOf），其中的 track 字样（python-v3 / python / java-v26 / v3.0 /
// v26 …）唯一反解。两级：
//   1) trackKey 反查：长 key 优先——python-v3 必须先于裸 python 匹配，否则
//      python-v30-* 路径会被裸 key 吞掉；
//   2) 查不到（slot 已释放/pod 重启清场）→ TRACKS 顺序固定映射（slot1=第1轨
//      v3.0.x、slot2=第2轨 v2.6.x——与派单顺序一致）：从路径提取版本字样
//      （v<maj>.<min> / v<maj><min>）逐 slot 匹配。
// 两级都落空 → unknown（如实显示，绝不猜）。纯函数：tests 直测反解表。
function deriveGateAttribution(artifactPath, slots) {
  if (!Array.isArray(slots) || slots.length === 0) return { slot: 'unknown', trackKey: 'unknown' };
  const haystack = String(artifactPath ?? '');
  let best = null;
  for (const entry of slots) {
    const key = entry.trackKey;
    if (typeof key !== 'string' || key === '') continue;
    if (haystack.includes(key) && (best === null || key.length > best.trackKey.length)) {
      best = entry;
    }
  }
  if (best) return { slot: best.slot, trackKey: best.trackKey };
  for (const entry of slots) {
    const version = String(entry.track ?? '');
    const match = /^v(\d+)\.(\d+)\./.exec(version);
    if (!match) continue;
    const dotted = `v${match[1]}.${match[2]}`;
    const compact = `v${match[1]}${match[2]}`;
    if (haystack.includes(dotted) || haystack.includes(compact)) {
      return { slot: entry.slot, trackKey: entry.trackKey || entry.track };
    }
  }
  return { slot: 'unknown', trackKey: 'unknown' };
}

// ---------- CLI ----------

function readJsonlLedger(filePath) {
  const events = [];
  for (const [index, line] of fs.readFileSync(filePath, 'utf8').split('\n').entries()) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      const wrapped = new Error(`ledger line ${index + 1} is not valid JSON: ${error.message}`);
      wrapped.code = 'LEDGER_LINE_INVALID';
      throw wrapped;
    }
  }
  return events;
}

function rejectCli(code, message) {
  process.stderr.write(`deploy/lib: ${code}: ${message}\n`);
  process.exit(1);
}

function emitEvent(eventFile, event, fields) {
  const record = {
    ts: new Date().toISOString(),
    pod: process.env.POD_NAME || process.env.HOSTNAME || 'unknown',
    language: process.env.LANGUAGE || null,
    event,
    ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== '')),
  };
  fs.appendFileSync(eventFile, `${JSON.stringify(record)}\n`);
}

// 飞书通知（BOT_* 应用；token 取法照 .claude/skills/api-reference-sync/lib/
// lark-docs/larkTokenFetcher.js 的 /open-apis/auth/v3/tenant_access_token/internal/
// 先例）。open_id 由 OPERATOR_EMAIL 经 contact/v3/users/batch_get_id 求解并缓存。
async function fetchTenantToken({ host, appId, appSecret, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(`${host}/open-apis/auth/v3/tenant_access_token/internal/`, {
    method: 'post',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const payload = await response.json();
  if (payload.code !== 0) {
    const error = new Error(`tenant_access_token fetch failed: ${payload.code} ${payload.msg}`);
    error.code = 'FEISHU_TOKEN_FAILED';
    throw error;
  }
  return payload.tenant_access_token;
}

async function resolveOperatorOpenId({ host, token, email, cachePath, fetchImpl = globalThis.fetch }) {
  if (cachePath && fs.existsSync(cachePath)) {
    const cached = fs.readFileSync(cachePath, 'utf8').trim();
    if (/^ou_[A-Za-z0-9]+$/.test(cached)) return cached;
  }
  const response = await fetchImpl(`${host}/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id`, {
    method: 'post',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ emails: [email] }),
  });
  const payload = await response.json();
  const userId = payload?.data?.user_list?.[0]?.user_id;
  if (payload.code !== 0 || typeof userId !== 'string' || !userId.startsWith('ou_')) {
    const error = new Error(`operator open_id resolve failed for ${email}: code=${payload.code} msg=${payload.msg} user_id=${userId ?? 'null'}`);
    error.code = 'FEISHU_OPEN_ID_FAILED';
    throw error;
  }
  if (cachePath) {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, `${userId}\n`);
  }
  return userId;
}

// ---------- 呈门卡片 v2（内容三件套 + 批准按钮） ----------
//
// 求证结论（2026-10-24）：飞书 legacy 卡片按钮形态以本机
// node_modules/@larksuiteoapi/node-sdk@1.68 types/index.d.ts 为准
// （InteractiveCardButtonActionItem）：{tag:'button',
// text:{tag:'plain_text',content}, type:'primary', value:Record<string,any>}，
// 外层 {tag:'action', actions:[…]}；卡片回传事件名 'card.action.trigger'
// （同文件 EventDispatcher 注释）。open.feishu.cn 文档页 JS 渲染抓不到正文，
// 以 SDK d.ts 作为落盘权威。

// 六门中文映射（gate-registry.js GATE_NAMES 一一对应；卡片标题给操作员看的
// 是中文名，回现行/事件保持英文门名——那是协议面，不翻译）。
const GATE_LABELS_ZH = Object.freeze({
  APPROVE_GROUPING: '分组批准',
  APPROVE_WRITES: '写入批准',
  APPROVE_DOCUMENT: '文档批准',
  APPROVE_ROLLBACK: '回滚批准',
  APPROVE_ACCEPTANCE: '验收批准',
  APPROVE_CAMPAIGN: '战役批准',
});

function gateLabelZh(gate) {
  return GATE_LABELS_ZH[gate] ?? gate;
}

// 会话位置钉死（规格 5）：卡片上的会话标识只用工件自带 sessionPath 的短形态
// —— 去掉 sync-session.json 后缀后的目录名，固定位置渲染，不掺启发式字段。
function sessionShortName(sessionPath) {
  const posix = String(sessionPath ?? '').split(path.sep).join('/').replace(/\/+$/, '');
  const stripped = posix.replace(/\/?sync-session\.json$/, '');
  if (stripped === '') return posix || '';
  const segments = stripped.split('/');
  return segments[segments.length - 1];
}

// 来源面：pr-intake 列 PR 号（lark_md 可点链接，>5 条尾部"等 N 条"）；
// repo-scan 列 tag 迁移。与 gate-presentation kernel 的 sourceHeadline 同口径
// （deploy 侧不能 require skill 内核——pod bootstrap 只 clone 本仓到 /workspace，
//  路径存在但保持零跨层依赖，两份实现由测试钉死同输出）。
function sourceLarkMd(source) {
  if (!source || typeof source !== 'object') return null;
  if (source.origin === 'repo-scan') {
    return source.baselineTag && source.targetTag
      ? `来源 仓库扫描：${source.baselineTag} → ${source.targetTag}`
      : '来源 仓库扫描：版本信息未登记';
  }
  if (source.origin === 'pr-intake') {
    const prs = Array.isArray(source.prs) ? source.prs : [];
    if (prs.length === 0) return '来源 PR intake：无待办 PR';
    const head = prs.slice(0, 5).map((pr) => `[#${pr.number}](${pr.url})`).join(' ');
    return prs.length > 5 ? `来源 PR intake：${head} 等 ${prs.length} 条` : `来源 PR intake：${head}`;
  }
  return null;
}

// 动作面：`文档 12 篇 · CREATE 3 · UPDATE 9` + 清单（≤10 条 `标题 —— 动作`）。
// 工件没有分类数据（impact null）时如实显示"待 dry-run 细化"，绝不编数。
function impactLarkMd(impact) {
  if (!impact) return { headline: '动作面：待 dry-run 细化', total: 0, documents: [] };
  const parts = [`文档 ${impact.total} 篇`, `CREATE ${impact.create}`, `UPDATE ${impact.update}`];
  if (impact.other > 0) parts.push(`其他 ${impact.other}`);
  const documents = Array.isArray(impact.documents) ? impact.documents : [];
  return { headline: `动作面：${parts.join(' · ')}`, total: impact.total ?? documents.length, documents };
}

const IMPACT_CARD_ACTION_LABEL = { CREATE: 'CREATE', UPDATE: 'UPDATE' };
function impactDocumentLabel(action) {
  return IMPACT_CARD_ACTION_LABEL[action] ?? '待分类';
}

// legacy interactive 卡片（card 1.0）：三件套 div + 每 replyLine 一个 primary
// 按钮 + 打回尾注。value 全字符串，回调侧（scripts/dashboard/card-approve.js）
// 按同一形状解析。
function buildGateCard({ index, pod, slot, trackKey, language, indexId }) {
  const sentAt = new Date().toISOString();
  const sourceText = sourceLarkMd(index.source);
  const impact = impactLarkMd(index.impact);
  const lines = [];
  lines.push(`**${index.title}**`);
  if (sourceText) lines.push(sourceText);
  lines.push(impact.headline);
  const documents = impact.documents;
  if (documents.length > 10) {
    for (const doc of documents.slice(0, 10)) lines.push(`${doc.title} —— ${impactDocumentLabel(doc.action)}`);
    lines.push(`… 等共 ${impact.total} 篇（全清单见工件）`);
  } else {
    for (const doc of documents) lines.push(`${doc.title} —— ${impactDocumentLabel(doc.action)}`);
  }
  lines.push(`pod: ${pod} · slot: ${slot} · 轨道: ${trackKey} · 语言: ${language} · 门: ${index.gate}`);
  lines.push(`会话: ${sessionShortName(index.sessionPath)} · digest: ${index.digest ?? '（逐单元，见回行）'}`);
  lines.push('批准行（按钮或逐字复制回信均可）:');
  for (const line of index.replyLines || []) lines.push(line);

  const replyLines = index.replyLines || [];
  const elements = [{ tag: 'div', text: { tag: 'lark_md', content: lines.join('\n') } }];
  for (const [position, line] of replyLines.entries()) {
    elements.push({
      tag: 'action',
      actions: [{
        tag: 'button',
        text: { tag: 'plain_text', content: replyLines.length > 1 ? `批准 ${position + 1}` : '批准' },
        type: 'primary',
        value: {
          kind: 'pod-gate-approve',
          pod: String(pod),
          slot: String(slot),
          line,
          indexId: String(indexId ?? ''),
          sentAt,
        },
      }],
    });
  }
  elements.push({
    tag: 'note',
    elements: [{ tag: 'plain_text', content: '打回请回复本消息：打回 <原因> · 批准由按钮或回信注入 pod 队列' }],
  });

  return {
    config: { wide_screen_mode: true },
    header: { template: 'orange', title: { tag: 'plain_text', content: `呈门 · ${gateLabelZh(index.gate)} · ${language} slot ${slot}（${trackKey}）` } },
    elements,
  };
}

// 文本降级面（卡片发送失败/无按钮环境）：保留完整批准行可复制 + 三件套内容。
function buildGateCardText({ index, pod, slot, trackKey, language }) {
  const sourceText = sourceLarkMd(index.source);
  const impact = impactLarkMd(index.impact);
  const lines = [];
  lines.push(`【呈门 · ${gateLabelZh(index.gate)} · ${language}-worker · slot ${slot} · ${trackKey}】${index.title}`);
  lines.push(`pod: ${pod} · slot: ${slot} · 轨道: ${trackKey} · 语言: ${language} · 门: ${index.gate}`);
  if (sourceText) lines.push(sourceText);
  lines.push(impact.headline);
  const documents = impact.documents;
  if (documents.length > 10) {
    for (const doc of documents.slice(0, 10)) lines.push(`${doc.title} —— ${impactDocumentLabel(doc.action)}`);
    lines.push(`… 等共 ${impact.total} 篇（全清单见工件）`);
  } else {
    for (const doc of documents) lines.push(`${doc.title} —— ${impactDocumentLabel(doc.action)}`);
  }
  lines.push(`会话: ${sessionShortName(index.sessionPath)} · digest: ${index.digest ?? '（逐单元，见回行）'} · 生成于 ${index.generatedAt}`);
  lines.push('精确回现行（批准必须逐字绑定 digest）:');
  for (const line of index.replyLines || []) lines.push(`${line}`);
  lines.push('回信批准由 Mac 侧注入（node scripts/dashboard/pod-approve.js …），或看板处理。');
  lines.push('打回请回复本消息：打回 <原因>');
  return lines.join('\n');
}

// ---------- message_id 入账（规格 4：现发完即弃=撤不回，先入账） ----------

function appendSentCardRecords(sentCardsPath, records) {
  if (!sentCardsPath) return;
  fs.mkdirSync(path.dirname(sentCardsPath), { recursive: true });
  fs.appendFileSync(sentCardsPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
}

async function notifyGate({ indexFile, pod, slot, trackKey, language, cachePath, indexId, sentCardsPath, fetchImpl = globalThis.fetch } = {}) {
  const host = process.env.FEISHU_HOST;
  const appId = process.env.BOT_APP_ID;
  const appSecret = process.env.BOT_APP_SECRET;
  const email = process.env.OPERATOR_EMAIL;
  const missing = Object.entries({ FEISHU_HOST: host, BOT_APP_ID: appId, BOT_APP_SECRET: appSecret, OPERATOR_EMAIL: email })
    .filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    const error = new Error(`notifyGate: 缺 env ${missing.join(',')}（secret sdk-env）`);
    error.code = 'FEISHU_ENV_MISSING';
    throw error;
  }
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const text = buildGateCardText({ index, pod, slot, trackKey, language });
  const token = await fetchTenantToken({ host, appId, appSecret, fetchImpl });
  const openId = await resolveOperatorOpenId({ host, token, email, cachePath, fetchImpl });
  // 首选卡片（interactive，带批准按钮），失败降级纯文本 —— 两者都走 im/v1/messages。
  const post = (msgType, content) => fetchImpl(`${host}/open-apis/im/v1/messages?receive_id_type=open_id`, {
    method: 'post',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ receive_id: openId, msg_type: msgType, content: JSON.stringify(content) }),
  }).then((response) => response.json());

  const card = buildGateCard({ index, pod, slot, trackKey, language, indexId: indexId ?? path.basename(indexFile) });
  let payload = await post('interactive', card);
  let mode = 'interactive';
  if (payload.code !== 0) {
    payload = await post('text', { text });
    mode = 'text';
  }
  if (payload.code !== 0) {
    const error = new Error(`im/v1/messages failed: ${payload.code} ${payload.msg}`);
    error.code = 'FEISHU_SEND_FAILED';
    throw error;
  }
  // message_id 入账（规格 4）：发出即弃导致将来撤不回；这里把 message_id 返回
  // 并按 replyLine 逐行落账 sent-cards.jsonl（撤回/更新卡片的钥匙）。
  const messageId = typeof payload?.data?.message_id === 'string' ? payload.data.message_id : null;
  if (sentCardsPath) {
    if (!messageId) {
      const error = new Error(`im/v1/messages returned no message_id (mode=${mode}) — 撤回链路要求入账，fail-loud`);
      error.code = 'FEISHU_MESSAGE_ID_MISSING';
      throw error;
    }
    const sentAt = new Date().toISOString();
    appendSentCardRecords(sentCardsPath, (index.replyLines || []).map((line) => ({
      messageId,
      pod,
      slot,
      track: trackKey,
      indexId: indexId ?? path.basename(indexFile),
      line,
      digest: index.digest ?? null,
      sentAt,
    })));
  }
  process.stdout.write(`messageId=${messageId ?? '(absent)'}\n`);
  return { text, openId, messageId, mode };
}

function parseCli(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!flag.startsWith('--')) throw new Error(`unexpected argument: ${flag}`);
    args[flag.slice(2)] = argv[i + 1];
  }
  return args;
}

async function runCli(argv = process.argv.slice(2)) {
  const command = argv[0];
  const args = parseCli(argv.slice(1));
  switch (command) {
    case 'render-opencode-json': {
      const model = args.model ?? process.env.LLM_MODEL;
      process.stdout.write(`${JSON.stringify(renderOpencodeConfig({ model }), null, 2)}\n`);
      return 0;
    }
    case 'validate-approve-line': {
      const verdict = validateApproveLine(args.line ?? '');
      if (!verdict.ok) {
        process.stderr.write(`deploy/lib: APPROVE_LINE_INVALID: ${JSON.stringify(args.line ?? '')}\n`);
        return 1;
      }
      process.stdout.write(`ok: ${verdict.line}\n`);
      return 0;
    }
    case 'extract-backlog': {
      const events = readJsonlLedger(requireAbsolute(args.ledger, '--ledger'));
      for (const entry of extractBacklogEntries(events, requireValue(args.language, '--language'), { discoveredOn: args['discovered-on'] ?? null })) {
        process.stdout.write(`${JSON.stringify(entry)}\n`);
      }
      return 0;
    }
    case 'pending-count': {
      // 复用 canonical fold：daily-scan-core.ledgerPending（语言水位语义唯一）。
      const core = require(path.join(__dirname, '..', '.claude', 'skills', 'api-reference-sync', 'src', 'sdk-doc-sync', 'daily-scan-core'));
      const pending = core.ledgerPending(requireAbsolute(args.ledger, '--ledger'), requireValue(args.language, '--language'));
      process.stdout.write(`${pending.length}\n`);
      return 0;
    }
    case 'track-env': {
      const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', RELEASE_TRACKS_RELATIVE_PATH), 'utf8'));
      const resolved = trackEnvLine(registry, requireValue(args.language, '--language'), requireValue(args.track, '--track'));
      process.stdout.write(`${resolved.line}\n`);
      process.stderr.write(`trackKey=${resolved.trackKey}\n`);
      return 0;
    }
    case 'notify-gate': {
      await notifyGate({
        indexFile: requireAbsolute(args['index-file'], '--index-file'),
        pod: requireValue(args.pod, '--pod'),
        slot: requireValue(args.slot, '--slot'),
        trackKey: requireValue(args['track-key'], '--track-key'),
        language: requireValue(args.language, '--language'),
        cachePath: args['open-id-cache'] ?? null,
        indexId: args['index-id'] ?? null,
        sentCardsPath: args['sent-cards'] ? path.resolve(args['sent-cards']) : null,
      });
      return 0;
    }
    case 'gate-slot': {
      const tracks = String(requireValue(args.tracks, '--tracks')).split(',').map((value) => value.trim()).filter(Boolean);
      const keys = String(args['track-keys'] ?? '').split(',').map((value) => value.trim());
      const artifact = requireValue(args.artifact, '--artifact');
      const slots = tracks.map((track, index) => ({ slot: index + 1, track, trackKey: keys[index] ?? '' }));
      const attribution = deriveGateAttribution(artifact, slots);
      process.stdout.write(`slot=${attribution.slot} trackKey=${attribution.trackKey}\n`);
      return 0;
    }
    case 'emit-event': {
      emitEvent(requireAbsolute(args.file, '--file'), requireValue(args.event, '--event'), {
        slot: args.slot, track: args.track, count: args.count, exit: args.exit, code: args.code, detail: args.detail, messageId: args['message-id'],
      });
      return 0;
    }
    case 'help':
    case undefined:
      process.stdout.write([
        'deploy/lib.js — S2 pod scaffold shared kernel',
        '',
        'Subcommands:',
        '  render-opencode-json [--model <id>]        opencode.json to stdout ({env:} interpolation)',
        '  validate-approve-line --line <text>        exit 0/1 on APPROVE_* sha256 line form',
        '  extract-backlog --ledger <jsonl> --language <lang> [--discovered-on <date>]',
        '  pending-count --ledger <jsonl> --language <lang>   (canonical daily-scan-core fold)',
        '  track-env --language <lang> --track <version>      prints BASE_TOKEN=<token>',
        '  notify-gate --index-file <index.json> --pod <name> --slot <n> --track-key <key> --language <lang> [--open-id-cache <path>] [--index-id <id>] [--sent-cards <jsonl>]',
        '  gate-slot --artifact <path> --tracks <v3.0.x,v2.6.x> [--track-keys <k1,k2>]   deterministic gate attribution',
        '  emit-event --file <events.jsonl> --event <name> [--slot --track --count --exit --code --detail --message-id]',
      ].join('\n'));
      process.stdout.write('\n');
      return 0;
    default:
      rejectCli('USAGE', `unknown subcommand: ${command} (see 'deploy/lib.js help')`);
      return 64;
  }
}

function requireValue(value, flag) {
  if (value === undefined || value === '') {
    const error = new Error(`${flag} is required`);
    error.code = 'USAGE';
    throw error;
  }
  return value;
}

function requireAbsolute(value, flag) {
  return path.resolve(requireValue(value, flag));
}

if (require.main === module) {
  runCli()
    .then((code) => {
      // typed 拒绝/校验失败以返回码落地——CLI 消费方（supervisor、测试）靠它分支。
      if (typeof code === 'number' && code !== 0) process.exit(code);
    })
    .catch((error) => {
      if (error && error.code === 'USAGE') {
        rejectCli('USAGE', `${error.message}\n  see 'deploy/lib.js help'`);
      }
      rejectCli(error?.code ?? 'UNEXPECTED', error?.message ?? String(error));
    });
}

module.exports = {
  APPROVE_LINE_RE,
  GATE_LABELS_ZH,
  OPENCODE_PROVIDER_KEY,
  RELEASE_TRACKS_RELATIVE_PATH,
  buildGateCard,
  buildGateCardText,
  deriveGateAttribution,
  emitEvent,
  extractBacklogEntries,
  extractSessionId,
  gateLabelZh,
  impactLarkMd,
  notifyGate,
  normalizeLlmBaseUrl,
  registryTrackKey,
  renderOpencodeConfig,
  sessionShortName,
  sourceLarkMd,
  trackEnvLine,
  validateApproveLine,
  runCli,
};
