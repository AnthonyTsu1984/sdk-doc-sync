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
// APPROVE_ROLLBACK <review-unit-id> sha256:… 走可选段；APPROVE_CAMPAIGN sha256:… 无。
const APPROVE_LINE_RE = /^APPROVE_(CAMPAIGN|ROLLBACK)(?: \S+)? sha256:[0-9a-f]{64}$/;

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
//   目录的最后一个会话"——一 pod 一轨后虽无串会话风险，仍以 -s 精确续接
//   （session 文件落 /workspace/runs/campaign.session）。
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
// 两级都落空 → unknown（如实显示，绝不猜）。纯函数：tests 直测反解表。
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

// 门中文映射（卡片标题给操作员看的是中文名，回现行/事件保持英文门名——
// 那是协议面，不翻译）。APPROVE_CAMPAIGN=唯一战役门；APPROVE_ROLLBACK=单元级
// 破坏性确认，走同一通道。
const GATE_LABELS_ZH = Object.freeze({
  APPROVE_ROLLBACK: '回滚批准',
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

// 每 replyLine 一个 primary 按钮（v2 门卡与战役常驻卡共用同一形状——回调侧
// scripts/dashboard/card-approve.js 按同一 value 契约解析，改动即双端同步测试红）。
function gateActionElements(replyLines, { pod, indexId, sentAt }) {
  const lines = replyLines || [];
  return lines.map((line, position) => ({
    tag: 'action',
    actions: [{
      tag: 'button',
      text: { tag: 'plain_text', content: lines.length > 1 ? `批准 ${position + 1}` : '批准' },
      type: 'primary',
      value: {
        kind: 'pod-gate-approve',
        pod: String(pod),
        line,
        indexId: String(indexId ?? ''),
        sentAt,
      },
    }],
  }));
}

// legacy interactive 卡片（card 1.0）：三件套 div + 每 replyLine 一个 primary
// 按钮 + 打回尾注。value 全字符串，回调侧（scripts/dashboard/card-approve.js）
// 按同一形状解析。
function buildGateCard({ index, pod, trackKey, language, indexId }) {
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
  lines.push(`pod: ${pod} · 轨道: ${trackKey} · 语言: ${language} · 门: ${index.gate}`);
  lines.push(`会话: ${sessionShortName(index.sessionPath)} · digest: ${index.digest ?? '（逐单元，见回行）'}`);
  lines.push('批准行（按钮或逐字复制回信均可）:');
  for (const line of index.replyLines || []) lines.push(line);

  const elements = [{ tag: 'div', text: { tag: 'lark_md', content: lines.join('\n') } }];
  elements.push(...gateActionElements(index.replyLines, { pod, indexId, sentAt }));
  elements.push({
    tag: 'note',
    elements: [{ tag: 'plain_text', content: '打回请回复本消息：打回 <原因> · 批准由按钮或回信注入 pod 队列' }],
  });

  return {
    config: { wide_screen_mode: true },
    header: { template: 'orange', title: { tag: 'plain_text', content: `呈门 · ${gateLabelZh(index.gate)} · ${language}（${trackKey}）` } },
    elements,
  };
}

// 文本降级面（卡片发送失败/无按钮环境）：保留完整批准行可复制 + 三件套内容。
function buildGateCardText({ index, pod, trackKey, language }) {
  const sourceText = sourceLarkMd(index.source);
  const impact = impactLarkMd(index.impact);
  const lines = [];
  lines.push(`【呈门 · ${gateLabelZh(index.gate)} · ${language}（${trackKey}）】${index.title}`);
  lines.push(`pod: ${pod} · 轨道: ${trackKey} · 语言: ${language} · 门: ${index.gate}`);
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

// ---------- 战役常驻卡（2026-10-24 操作员裁定：一场战役一张卡，事件驱动 PATCH） ----------
//
// 旧方案（每扇门单发一张 v2 门卡，notify-gate）退役——消息刷屏、点过的按钮留在
// 旧卡上可再点。新方案：supervisor 是卡的所有者（它知道全部生命周期），每轨
// /workspace/runs/card-<trackKey>.json 存 {messageId, timeline, currentGate, status}，
// 生命周期事件（派单/呈门/批准/让出/终态）追加时间轴并 PATCH 同一张卡；当前门
// 非空时按钮长在卡上，--approved/--cleared-gate/--terminal 清门即按钮消失。

// PATCH 求证结论（2026-10-24，本机 @larksuiteoapi/node-sdk@1.68 types/index.d.ts
// 257483–257505 行）：im.v1.message.patch 入参 = {data:{content:string},
// path:{message_id:string}} → 裸 fetch 形态 PATCH
// `${host}/open-apis/im/v1/messages/${messageId}`，body {content:"<卡 JSON 字符串>"}。
// 同页注意事项：共享卡须在 config 显式 update_multi:true 才可全员更新；卡请求体
// ≤30KB；仅支持修改 14 天内的消息；单消息 5QPS——本卡体量与事件频度都远低于闸。

const TIMELINE_VISIBLE = 10;   // 时间轴只保留最近 10 条，更早的合并一行
const CAMPAIGN_CARD_STATUS = Object.freeze({ ACTIVE: 'active', COMPLETED: 'completed' });

// 事件文本的图标前缀拆分：supervisor 传来形如 "▶️ 派单 python-v3（…）"——首个
// 非 ASCII 连续段 = icon，其余 = text（▶️/⏱️ 这类 emoji 是 U+FE0F 变体选择符
// 结尾的双码点，一并吃进 icon 段）；无图标前缀则 icon=''，text 原样。
function splitEventIcon(event) {
  const text = String(event ?? '');
  const match = /^([^\x00-\x7F]+)\s+([\s\S]*)$/.exec(text.trim());
  return match ? { icon: match[1], text: match[2] } : { icon: '', text };
}

// digest 短版：sha256:<64hex> → 前 12 hex + …；其余形态截 24 字符，绝不编造。
function shortDigest(digest) {
  const text = String(digest ?? '');
  const match = /^(sha256:)([0-9a-f]{64})$/.exec(text);
  if (match) return `${match[1]}${match[2].slice(0, 12)}…`;
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

// ISO ts → `MM-DD HH:mm`（直接切字符串，不做时区换算——pod 与事件账本同为 UTC）。
function timelineStamp(ts) {
  const iso = String(ts ?? '');
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? iso.slice(5, 16).replace('T', ' ') : iso;
}

function timelineLarkMd(timeline) {
  const lines = ['**时间轴**'];
  const entries = Array.isArray(timeline) ? timeline : [];
  const overflow = Math.max(0, entries.length - TIMELINE_VISIBLE);
  if (overflow > 0) lines.push(`…更早 ${overflow} 条`);
  for (const entry of entries.slice(-TIMELINE_VISIBLE)) {
    const icon = entry.icon ? `${entry.icon} ` : '';
    lines.push(`${icon}${timelineStamp(entry.ts)} ${entry.text}`);
  }
  return lines.join('\n');
}

// 战役概况区块（持久）：一场战役的身份面——来源/文档面/pod 归属三件套。首次
// 呈门时从 gate index 的 source/impact 捕获进 card state（state.summary），此后
// 整场战役常驻卡面（批准后、执行中、终态都不消失——操作员随时能看到这场战役
// 在写什么、为什么写、在哪个 pod）。
function summaryLarkMd(summary, { pod, trackKey, language }) {
  const lines = ['**战役概况**'];
  const sourceText = sourceLarkMd(summary?.source);
  lines.push(sourceText ?? '来源：待呈门登记');
  const impact = impactLarkMd(summary?.impact);
  lines.push(impact.headline);
  const documents = impact.documents;
  if (documents.length > 10) {
    for (const doc of documents.slice(0, 10)) lines.push(`${doc.title} —— ${impactDocumentLabel(doc.action)}`);
    lines.push(`… 等共 ${impact.total} 篇（全清单见工件）`);
  } else {
    for (const doc of documents) lines.push(`${doc.title} —— ${impactDocumentLabel(doc.action)}`);
  }
  lines.push(`pod: ${pod} · 轨道: ${trackKey} · 语言: ${language}`);
  return lines.join('\n');
}

// 当前门区块（currentGate 非空）：门名 + digest + 完整批准行（来源/文档面在概况
// 区块持久渲染，不在此重复）。按钮由 buildCampaignCard 单独 append（每行一个）。
function currentGateLarkMd(currentGate) {
  const index = currentGate.index ?? {};
  const lines = [];
  lines.push(`**当前门 · ${gateLabelZh(index.gate)} — ${index.title ?? index.gate}**`);
  lines.push(`会话: ${sessionShortName(index.sessionPath)} · digest: ${index.digest ? shortDigest(index.digest) : '（逐单元，见回行）'}`);
  lines.push('批准行（按钮或逐字复制回信均可）:');
  for (const line of index.replyLines || []) lines.push(line);
  return lines.join('\n');
}

// header：有等待批准的门 → `【<门中文> · 等待批准】`；无门进行中 → `【进行中】`；
// 终态 → `【已完成】`。模板色随状态（橙=等批准 / 蓝=进行 / 绿=终态）。
function campaignHeaderTitle({ language, trackKey, status, currentGate }) {
  if (status === CAMPAIGN_CARD_STATUS.COMPLETED) return { template: 'green', text: `【已完成】${language} · ${trackKey}` };
  if (currentGate) return { template: 'orange', text: `【${gateLabelZh(currentGate.index?.gate)} · 等待批准】${language} · ${trackKey}` };
  return { template: 'blue', text: `【进行中】${language} · ${trackKey}` };
}

// 纯函数：状态 → legacy interactive 卡 JSON。config.update_multi 按 PATCH 求证
// 结论必带（否则共享卡不可全员更新）。零依赖，tests 直测形状。区块序（自上而下）：
// 战役概况（持久）→ 时间轴 → 当前门（非空时）→ 当前门按钮 → 打回尾注。
function buildCampaignCard({ language, trackKey, pod, status = CAMPAIGN_CARD_STATUS.ACTIVE, summary = null, timeline = [], currentGate = null } = {}) {
  if (!language || typeof language !== 'string' || !trackKey || typeof trackKey !== 'string' || !pod || typeof pod !== 'string') {
    const error = new Error('buildCampaignCard: language/pod/trackKey 必填（一轨一 pod：pod 名即归属）');
    error.code = 'CAMPAIGN_CARD_INPUT_INVALID';
    throw error;
  }
  const header = campaignHeaderTitle({ language, trackKey, status, currentGate });
  const elements = [{ tag: 'div', text: { tag: 'lark_md', content: summaryLarkMd(summary, { pod, trackKey, language }) } }];
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: timelineLarkMd(timeline) } });
  if (currentGate) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: currentGateLarkMd(currentGate) } });
    elements.push(...gateActionElements(currentGate.index?.replyLines, currentGate));
  }
  elements.push({
    tag: 'note',
    elements: [{ tag: 'plain_text', content: '打回请回复本消息：打回 <原因> · 批准由按钮或回信注入 pod 队列' }],
  });
  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: { template: header.template, title: { tag: 'plain_text', content: header.text } },
    elements,
  };
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

// campaignCard CLI 内核：追加时间轴 →（可选）换当前门 / 清门 / 终态 → 重算卡
// JSON → send（无 messageId）或 PATCH（有）→ 原子写回状态。PATCH 失败降级发新卡
// 并更新状态里的 messageId（stderr WARN + stdout mode=send-fallback，supervisor
// 捕获后入事件）。顺序按裁定原文：写回状态在飞书操作成功之后——发送失败即 typed
// 抛错、状态不落盘，绝不出现"状态说发了、飞书没有"的漂移。
async function campaignCard({
  stateFile, repoRoot, event, presentationFile = null, indexId = null,
  pod, trackKey, language,
  approved = false, clearedGate = false, terminal = false, newCampaign = false,
  openIdCachePath = null, fetchImpl = globalThis.fetch, now = () => new Date().toISOString(),
} = {}) {
  void repoRoot; // 任务书钉死的 CLI 签名位（相对路径锚点；当前实现全部走绝对路径）
  for (const [value, name] of [[stateFile, 'stateFile'], [event, 'event'], [pod, 'pod'], [trackKey, 'trackKey'], [language, 'language']]) {
    if (value === undefined || value === null || value === '') {
      const error = new Error(`campaignCard: ${name} is required`);
      error.code = 'USAGE';
      throw error;
    }
  }
  let state;
  if (fs.existsSync(stateFile)) {
    try {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch (error) {
      const wrapped = new Error(`campaignCard: state file unreadable (${stateFile}): ${error.message}`);
      wrapped.code = 'CARD_STATE_INVALID';
      throw wrapped;
    }
    if (typeof state !== 'object' || state === null || Array.isArray(state)) {
      const error = new Error(`campaignCard: state file is not an object (${stateFile})`);
      error.code = 'CARD_STATE_INVALID';
      throw error;
    }
    state.timeline = Array.isArray(state.timeline) ? state.timeline : [];
    state.summary = state.summary ?? null;
  } else {
    state = { messageId: null, summary: null, timeline: [], currentGate: null, status: CAMPAIGN_CARD_STATUS.ACTIVE };
  }

  if (newCampaign) {
    // 新战役同卡续写：状态回 active、时间轴/概况/当前门清零（上一场的 ✔ 时间轴
    // 归档在旧 PATCH 里），messageId 保留——还是同一张卡，PATCH 覆盖。
    state.status = CAMPAIGN_CARD_STATUS.ACTIVE;
    state.timeline = [];
    state.summary = null;
    state.currentGate = null;
  }
  const { icon, text } = splitEventIcon(event);
  state.timeline.push({ ts: now(), icon, text });
  if (presentationFile) {
    const index = JSON.parse(fs.readFileSync(presentationFile, 'utf8'));
    state.currentGate = {
      pod: String(pod),
      indexId: indexId ?? path.basename(presentationFile),
      sentAt: now(),
      index,
    };
    // 概况捕获：首次带 source/impact 的呈门把三件套钉进 card state——此后整场
    // 战役常驻卡面（重呈门只换 currentGate，不覆盖已捕获的概况）。
    if (!state.summary && (index.source || index.impact)) {
      state.summary = { source: index.source ?? null, impact: index.impact ?? null };
    }
  }
  if (approved || clearedGate || terminal) state.currentGate = null;   // 按钮随之消失
  if (terminal) state.status = CAMPAIGN_CARD_STATUS.COMPLETED;

  const host = process.env.FEISHU_HOST;
  const appId = process.env.BOT_APP_ID;
  const appSecret = process.env.BOT_APP_SECRET;
  const missing = Object.entries({ FEISHU_HOST: host, BOT_APP_ID: appId, BOT_APP_SECRET: appSecret })
    .filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    const error = new Error(`campaignCard: 缺 env ${missing.join(',')}（secret sdk-env）`);
    error.code = 'FEISHU_ENV_MISSING';
    throw error;
  }

  const card = buildCampaignCard({ language, trackKey, pod, status: state.status, summary: state.summary ?? null, timeline: state.timeline, currentGate: state.currentGate });
  const token = await fetchTenantToken({ host, appId, appSecret, fetchImpl });
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  let mode = 'send';
  let messageId = state.messageId;
  if (messageId) {
    mode = 'patch';
    // method 必须大写：fetch 规范只自动大写 POST/GET/PUT/DELETE/HEAD/OPTIONS，
    // 小写 'patch' 按字面量上线（HTTP 方法区分大小写）→ 飞书边缘网关路由不进
    // JSON API、回 HTML 400 页（2026-10-25 go-v3 首战实测，UNDICI-FETCH-patch
    // 警告即此坑）。响应统一 text→JSON.parse：非 JSON（HTML 错误页）也走降级
    // 发新卡，降级路径不可被响应形状短路。
    const response = await fetchImpl(`${host}/open-apis/im/v1/messages/${messageId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ content: JSON.stringify(card) }),
    });
    const responseText = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = null;
    }
    if (!payload || payload.code !== 0) {
      mode = 'send-fallback';
      const detail = payload ? `code=${payload.code} msg=${payload.msg}` : `non-JSON response head=${JSON.stringify(responseText.slice(0, 80))}`;
      process.stderr.write(`deploy/lib: CARD_PATCH_FAILED messageId=${messageId} ${detail} — 降级发新卡，状态里的 messageId 将更新\n`);
    }
  }
  if (mode !== 'patch') {
    const email = process.env.OPERATOR_EMAIL;
    if (!email) {
      const error = new Error('campaignCard: 缺 env OPERATOR_EMAIL（首发/降级发新卡需要 open_id）');
      error.code = 'FEISHU_ENV_MISSING';
      throw error;
    }
    const openId = await resolveOperatorOpenId({ host, token, email, cachePath: openIdCachePath, fetchImpl });
    const payload = await fetchImpl(`${host}/open-apis/im/v1/messages?receive_id_type=open_id`, {
      method: 'post',
      headers,
      body: JSON.stringify({ receive_id: openId, msg_type: 'interactive', content: JSON.stringify(card) }),
    }).then((response) => response.json());
    if (payload.code !== 0) {
      const error = new Error(`im/v1/messages failed: ${payload.code} ${payload.msg}`);
      error.code = 'FEISHU_SEND_FAILED';
      throw error;
    }
    messageId = typeof payload?.data?.message_id === 'string' ? payload.data.message_id : null;
    if (!messageId) {
      const error = new Error('im/v1/messages returned no message_id — 常驻卡后续 PATCH 无钥匙，fail-loud');
      error.code = 'FEISHU_MESSAGE_ID_MISSING';
      throw error;
    }
  }

  state.messageId = messageId;
  state.updatedAt = now();
  atomicWriteJson(stateFile, state);
  process.stdout.write(`messageId=${messageId}\nmode=${mode}\n`);
  return { state, messageId, mode, card };
}

// ---------- message_id 入账（规格 4：现发完即弃=撤不回，先入账） ----------

function appendSentCardRecords(sentCardsPath, records) {
  if (!sentCardsPath) return;
  fs.mkdirSync(path.dirname(sentCardsPath), { recursive: true });
  fs.appendFileSync(sentCardsPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
}

// @deprecated 2026-10-24 战役常驻卡上线：gate_watch 改走 campaign-card（per-track
// 一卡 PATCH，messageId 由 card state 文件持有，sent-cards.jsonl 语义随之退役）。
// 本函数保留仅为存量测试兼容与人工兜底，supervisor 不再调用。
async function notifyGate({ indexFile, pod, trackKey, language, cachePath, indexId, sentCardsPath, fetchImpl = globalThis.fetch } = {}) {
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
  const text = buildGateCardText({ index, pod, trackKey, language });
  const token = await fetchTenantToken({ host, appId, appSecret, fetchImpl });
  const openId = await resolveOperatorOpenId({ host, token, email, cachePath, fetchImpl });
  // 首选卡片（interactive，带批准按钮），失败降级纯文本 —— 两者都走 im/v1/messages。
  const post = (msgType, content) => fetchImpl(`${host}/open-apis/im/v1/messages?receive_id_type=open_id`, {
    method: 'post',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ receive_id: openId, msg_type: msgType, content: JSON.stringify(content) }),
  }).then((response) => response.json());

  const card = buildGateCard({ index, pod, trackKey, language, indexId: indexId ?? path.basename(indexFile) });
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

// 布尔旗标（出现即 true，不吞下一个参数）——campaign-card 的状态开关。历史上
// parseCli 严格两两配对；campaign-card 的 `--approved|--cleared-gate|--terminal`
// 不带值，登记在名单里豁免配对（其余子命令不使用这些名字，行为不变）。
const CLI_BOOLEAN_FLAGS = new Set(['approved', 'cleared-gate', 'terminal', 'new-campaign']);

function parseCli(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag.startsWith('--')) throw new Error(`unexpected argument: ${flag}`);
    const name = flag.slice(2);
    if (CLI_BOOLEAN_FLAGS.has(name)) {
      args[name] = true;
      continue;
    }
    args[name] = argv[i + 1];
    i += 1;
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
        trackKey: requireValue(args['track-key'], '--track-key'),
        language: requireValue(args.language, '--language'),
        cachePath: args['open-id-cache'] ?? null,
        indexId: args['index-id'] ?? null,
        sentCardsPath: args['sent-cards'] ? path.resolve(args['sent-cards']) : null,
      });
      return 0;
    }
    case 'gate-label': {
      // supervisor 拼 "⚑ <门中文>呈报" 事件文本用的查询口（GATE_LABELS_ZH 单源，
      // 防 bash case 双真相）。
      process.stdout.write(`${gateLabelZh(requireValue(args.gate, '--gate'))}\n`);
      return 0;
    }
    case 'campaign-card': {
      // 战役常驻卡唯一收口：追加时间轴 → 重算卡 JSON → send/PATCH → 原子写回状态。
      await campaignCard({
        stateFile: requireAbsolute(args.state, '--state'),
        repoRoot: requireAbsolute(args['repo-root'], '--repo-root'),
        event: requireValue(args.event, '--event'),
        presentationFile: args.presentation ? path.resolve(args.presentation) : null,
        indexId: args['index-id'] ?? null,
        pod: requireValue(args.pod, '--pod'),
        trackKey: requireValue(args['track-key'], '--track-key'),
        language: requireValue(args.language, '--language'),
        approved: args.approved === true,
        clearedGate: args['cleared-gate'] === true,
        terminal: args.terminal === true,
        newCampaign: args['new-campaign'] === true,
        openIdCachePath: args['open-id-cache'] ? path.resolve(args['open-id-cache']) : null,
      });
      return 0;
    }
    case 'emit-event': {
      emitEvent(requireAbsolute(args.file, '--file'), requireValue(args.event, '--event'), {
        track: args.track, count: args.count, exit: args.exit, code: args.code, detail: args.detail, messageId: args['message-id'],
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
        '  notify-gate --index-file <index.json> --pod <name> --track-key <key> --language <lang> [--open-id-cache <path>] [--index-id <id>] [--sent-cards <jsonl>]   (deprecated: supervisor 改走 campaign-card)',
        '  campaign-card --state <card.json> --repo-root <repo> --event "<icon 短文本>" [--presentation <index.json>] [--index-id <id>] --pod <name> --track-key <key> --language <lang> [--open-id-cache <path>] [--new-campaign|--approved|--cleared-gate|--terminal]',
        '  gate-label --gate <GATE_NAME>              中文门名（GATE_LABELS_ZH 单源查询口）',
        '  emit-event --file <events.jsonl> --event <name> [--track --count --exit --code --detail --message-id]',
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
  CAMPAIGN_CARD_STATUS,
  CLI_BOOLEAN_FLAGS,
  GATE_LABELS_ZH,
  OPENCODE_PROVIDER_KEY,
  RELEASE_TRACKS_RELATIVE_PATH,
  TIMELINE_VISIBLE,
  buildCampaignCard,
  buildGateCard,
  buildGateCardText,
  campaignCard,
  emitEvent,
  extractBacklogEntries,
  extractSessionId,
  fetchTenantToken,
  gateActionElements,
  gateLabelZh,
  impactLarkMd,
  notifyGate,
  normalizeLlmBaseUrl,
  parseCli,
  registryTrackKey,
  renderOpencodeConfig,
  resolveOperatorOpenId,
  sessionShortName,
  shortDigest,
  sourceLarkMd,
  splitEventIcon,
  timelineStamp,
  trackEnvLine,
  validateApproveLine,
  runCli,
};
