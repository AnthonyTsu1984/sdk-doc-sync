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

function buildGateCardText({ index, pod, slot, trackKey, language }) {
  const lines = [];
  lines.push(`【呈门 · ${language}-worker · slot ${slot} · ${trackKey}】${index.title}`);
  lines.push(`pod: ${pod} · slot: ${slot} · 轨道: ${trackKey} · 门: ${index.gate}`);
  lines.push(`会话: ${index.sessionPath} · digest: ${index.digest} · 生成于 ${index.generatedAt}`);
  lines.push('精确回现行（批准必须逐字绑定 digest）:');
  for (const line of index.replyLines || []) lines.push(`${line}`);
  lines.push('回信批准由 Mac 侧注入（node scripts/dashboard/pod-approve.js …），或看板处理。');
  return lines.join('\n');
}

async function notifyGate({ indexFile, pod, slot, trackKey, language, cachePath, fetchImpl = globalThis.fetch } = {}) {
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
  // 首选卡片（interactive），失败降级纯文本 —— 两者都走 im/v1/messages。
  const post = (msgType, content) => fetchImpl(`${host}/open-apis/im/v1/messages?receive_id_type=open_id`, {
    method: 'post',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ receive_id: openId, msg_type: msgType, content: JSON.stringify(content) }),
  }).then((response) => response.json());

  const card = {
    config: { wide_screen_mode: true },
    header: { template: 'orange', title: { tag: 'plain_text', content: `呈门 · ${index.gate} · ${language} slot ${slot}（${trackKey}）` } },
    elements: [{ tag: 'div', text: { tag: 'lark_md', content: text } }],
  };
  let payload = await post('interactive', card);
  if (payload.code !== 0) payload = await post('text', { text });
  if (payload.code !== 0) {
    const error = new Error(`im/v1/messages failed: ${payload.code} ${payload.msg}`);
    error.code = 'FEISHU_SEND_FAILED';
    throw error;
  }
  return { text, openId };
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
      });
      return 0;
    }
    case 'emit-event': {
      emitEvent(requireAbsolute(args.file, '--file'), requireValue(args.event, '--event'), {
        slot: args.slot, track: args.track, count: args.count, exit: args.exit, code: args.code, detail: args.detail,
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
        '  notify-gate --index-file <index.json> --pod <name> --slot <n> --track-key <key> --language <lang> [--open-id-cache <path>]',
        '  emit-event --file <events.jsonl> --event <name> [--slot --track --count --exit --code --detail]',
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
  OPENCODE_PROVIDER_KEY,
  RELEASE_TRACKS_RELATIVE_PATH,
  buildGateCardText,
  emitEvent,
  extractBacklogEntries,
  extractSessionId,
  notifyGate,
  normalizeLlmBaseUrl,
  registryTrackKey,
  renderOpencodeConfig,
  trackEnvLine,
  validateApproveLine,
  runCli,
};
