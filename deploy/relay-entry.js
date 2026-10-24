#!/usr/bin/env node
'use strict';

// deploy/relay-entry.js — 呈门卡片回调接收器的集群内常驻入口（控制面云化裁定
// 2026-10-24，操作员定）：card.action.trigger 的唯一订阅者是本 relay pod
// （vCluster sdk-doc-sync namespace），飞书事件订阅走长连接（WSClient，免公网
// 回调地址）；批准注入走集群内 kubectl exec（SA relay-approver，relay-rbac.yaml）。
// Mac 侧 server.js 默认不再订阅同一事件（CARD_APPROVE_SUBSCRIBE=local 才启用），
// Mac 退场为可选观察端，杜绝双订阅双注入。
//
// 挂载布局（configmap sdk-relay → /opt/relay，volume items 按 repo 目录结构
// 重映射——/opt/relay 就是本仓的局部镜像，本文件的相对 require 与 repo 内
// 完全一致，card-approve/pod-approve 一行不改；单真相=repo 文件，configmap
// 副本由 tests/skills/deploy-scaffold.test.js 钉死一致）：
//   /opt/relay/deploy/{relay-entry.js, relay-entry.sh, lib.js}
//   /opt/relay/scripts/dashboard/{card-approve.js, pod-approve.js}
//
// 与 Mac relay 的差异（集群侧 day one 收紧，不继承降级包袱）：
//   - fail-closed 身份：OPERATOR_EMAIL → contact/v3/users/batch_get_id（复用
//     ./lib.js resolveOperatorOpenId，不复制实现）。身份解析不出来=只记日志
//     拒批，绝不降级为仅形状校验；回调包络缺 operator.open_id 同样拒。
//   - 去重窗持久化到 emptyDir /relay-work/dedupe.json（重启丢窗口可接受，
//     5 分钟窗；card-approve 注入持久 Map，语义仍单源）。
//   - 每次批准/拒绝除卡片 toast 外，回发一条 p2p 文本回执给操作员
//     （im/v1/messages：pod/slot/行前 60 字符/失败原因）。
//
// 常驻语义：进程级错误 catch-all 不退出（WSClient 自带断线重连；首连失败与
// terminal failed 由 redial 看门狗重拨）；SIGTERM/SIGINT 优雅退出（落盘去重窗）。
// bootstrap 失败（SDK 装不上 / BOT 凭据缺失 / kubectl 装不上，见 relay-entry.sh）
// fail-loud 硬退交 kube 重启——容器起不来说明环境坏，赖着不退只会更难发现。
//
// 红线沿用 card-approve.js：本入口只包装与转发，不代替操作员判断；批准只有
// 落成回执才生效。

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// 决策面单源：scripts/dashboard/card-approve.js（repo 与 /opt/relay 镜像下相对
// 路径同解，见文件头布局）。appover 的批准/去重/argv 注入逻辑全在那里。
const cardApprove = require('../scripts/dashboard/card-approve.js');

// 运行时常量（deployment.yaml 的 emptyDir/configMap 挂载对应；改挂载点两处同步）。
const WORK_DIR = '/relay-work';
const DEDUPE_PATH = `${WORK_DIR}/dedupe.json`;
const OPEN_ID_CACHE_PATH = `${WORK_DIR}/open-id-cache`;
// 钉版本（repo package.json 同款 SDK；egress 冒烟已证 npmjs 连通）。
const LARK_SDK_SPEC = '@larksuiteoapi/node-sdk@1.68.0';
const LARK_SDK_MARKER = path.join(WORK_DIR, 'node_modules', '@larksuiteoapi', 'node-sdk', 'package.json');

// ---------- 可测内核（不碰 /relay-work 与网络，repo 内 tests 直测） ----------

// 行前 60 字符（p2p 回执口径）。
function truncateLine(line, max = 60) {
  const text = String(line ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// 卡片回调响应（保守 toast 形态，与 Mac handler 同款）。
function toastFor(verdict) {
  return { toast: { type: verdict.ok ? 'success' : 'error', content: verdict.text } };
}

function failClosedToast(reason) {
  return { toast: { type: 'error', content: `批准被拒（fail-closed）：${reason}` } };
}

// p2p 回执文本：pod/slot/行前 60 字符/失败原因。extracted 是
// cardApprove.extractCardActionEvent 的产出（value 可能是 null/垃圾——解析失败
// 时如实显示，绝不编）。
function buildReceiptText(verdict, extracted) {
  const value = extracted?.value && typeof extracted.value === 'object' ? extracted.value : {};
  const pod = typeof value.pod === 'string' && value.pod ? value.pod : '?';
  const slot = typeof value.slot === 'string' && value.slot ? value.slot : '?';
  const status = verdict.ok ? (verdict.deduped ? '去重命中（该批准已在处理中）' : '已批准') : '已拒绝';
  const head = `呈门回执 · ${status} · pod ${pod} · slot ${slot}`;
  const linePart = value.line ? `\n行: ${truncateLine(value.line)}` : '';
  const tail = verdict.ok ? '' : `\n原因: ${truncateLine(verdict.text, 200)}`;
  return `${head}${linePart}${tail}`;
}

// fail-closed 闸门 + 审批 + 回执的组装。全部 IO 注入：
//   getOperatorOpenId(): string|null —— 当前已解析的操作员身份（活引用；
//     null=未解析，一切按钮拒批，绝不降级）；
//   approver: cardApprove.createCardApprover 产出；
//   sendReceipt: async (verdict, extracted) => void —— p2p 回执（main 接飞书）；
//   log: (record) => void —— 结构化事件行。
// 返回 (data) => toast 响应，直接挂到 dispatcher 的 card.action.trigger。
function createCardActionHandler({ getOperatorOpenId, approver, sendReceipt = null, log }) {
  if (typeof getOperatorOpenId !== 'function') throw new Error('createCardActionHandler requires getOperatorOpenId');
  if (!approver || typeof approver.handleCardAction !== 'function') throw new Error('createCardActionHandler requires approver');
  if (typeof log !== 'function') throw new Error('createCardActionHandler requires log');
  return async function handleCardAction(data) {
    const extracted = cardApprove.extractCardActionEvent(data);
    const expected = getOperatorOpenId();
    // fail-closed 三连：身份未解析 / 包络缺 operator / 非操作员。三种都只记
    // 日志拒批，不进 approver（不消耗去重键、不落账、不 spawn）。
    if (!expected) {
      log({ event: 'card-action', outcome: 'fail-closed', reason: 'operator-identity-unresolved', operator: extracted.operatorOpenId });
      return failClosedToast('操作员身份未解析（identity resolve 失败），本次按钮已拒绝；请查 relay pod logs');
    }
    if (!extracted.operatorOpenId) {
      log({ event: 'card-action', outcome: 'fail-closed', reason: 'callback-missing-operator-open-id' });
      return failClosedToast('回调包络缺少 operator.open_id，无法比对身份，已拒绝');
    }
    if (extracted.operatorOpenId !== expected) {
      log({ event: 'card-action', outcome: 'fail-closed', reason: 'operator-mismatch', operator: extracted.operatorOpenId });
      return failClosedToast(`仅操作员可批准：按钮来自 ${extracted.operatorOpenId}，与操作员身份不符`);
    }
    const verdict = await approver.handleCardAction(data);
    log({
      event: 'card-action',
      outcome: verdict.ok ? (verdict.deduped ? 'deduped' : 'approved') : 'rejected',
      operator: extracted.operatorOpenId,
      pod: extracted.value?.pod ?? null,
      slot: extracted.value?.slot ?? null,
      detail: verdict.text,
    });
    if (sendReceipt) {
      try {
        await sendReceipt(verdict, extracted);
      } catch (error) {
        // 回执发送失败不影响批准本身（批准已落队列）；只记日志。
        log({ event: 'card-action', outcome: 'receipt-send-failed', detail: error?.message ?? String(error) });
      }
    }
    return toastFor(verdict);
  };
}

// ---------- 去重窗持久化（emptyDir；重启丢窗口可接受，5 分钟窗） ----------

function loadDedupeState(filePath, { now = Date.now(), windowMs = cardApprove.DEDUPE_WINDOW_MS } = {}) {
  const map = new Map();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(parsed)) return map;
    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [key, seenAt] = entry;
      if (typeof key !== 'string' || !Number.isFinite(seenAt)) continue;
      if (now - seenAt >= windowMs) continue; // 载入即剪枝，旧键不带回来
      map.set(key, seenAt);
    }
  } catch {
    // 缺文件/坏文件=空窗起步（裁定：重启丢窗口可接受）
  }
  return map;
}

function persistDedupeState(filePath, map) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify([...map.entries()]));
    return true;
  } catch {
    return false; // best-effort：盘挂了只损失重启后的去重记忆，不阻塞批准
  }
}

// ---------- 飞书 p2p 回执（main 接线用；fetchImpl 注入可测） ----------

async function sendOperatorText({ host, appId, appSecret, openId, text, lib, fetchImpl = globalThis.fetch }) {
  const token = await lib.fetchTenantToken({ host, appId, appSecret, fetchImpl });
  const response = await fetchImpl(`${host}/open-apis/im/v1/messages?receive_id_type=open_id`, {
    method: 'post',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ receive_id: openId, msg_type: 'text', content: JSON.stringify({ text }) }),
  });
  const payload = await response.json();
  if (payload.code !== 0) {
    const error = new Error(`im/v1/messages failed: ${payload.code} ${payload.msg}`);
    error.code = 'FEISHU_SEND_FAILED';
    throw error;
  }
  return payload?.data?.message_id ?? null;
}

// ---------- main：真实 IO 接线 ----------

function log(record) {
  // stdout 双面：kubectl logs 可读 + 一行一条结构化 JSON 事件。
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`);
}

function main() {
  const host = process.env.FEISHU_HOST;
  const appId = process.env.BOT_APP_ID;
  const appSecret = process.env.BOT_APP_SECRET;
  const email = process.env.OPERATOR_EMAIL;
  const missing = Object.entries({ FEISHU_HOST: host, BOT_APP_ID: appId, BOT_APP_SECRET: appSecret })
    .filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    // BOT 凭据缺失=连 WS 都起不来，bootstrap 失败，硬退交 kube 重启（secret sdk-env）。
    process.stderr.write(`[relay] FATAL: missing env ${missing.join(',')} (secret sdk-env / envFrom)\n`);
    process.exit(1);
  }
  if (!email) {
    // OPERATOR_EMAIL 缺失=身份永远解析不出来 → 常驻但一切按钮 fail-closed 拒批。
    process.stderr.write('[relay] WARN: OPERATOR_EMAIL missing — identity can never resolve, every card action will be rejected fail-closed\n');
  }

  fs.mkdirSync(WORK_DIR, { recursive: true });

  // SDK 自举：emptyDir 里钉版本装一次（emptyDir 随 pod 生灭，重启重装）。
  if (!fs.existsSync(LARK_SDK_MARKER)) {
    process.stdout.write(`[relay] installing ${LARK_SDK_SPEC} into ${WORK_DIR} ...\n`);
    const result = spawnSync('npm', ['install', '--prefix', WORK_DIR, '--no-audit', '--no-fund', '--loglevel', 'warn', LARK_SDK_SPEC], {
      stdio: 'inherit',
      env: process.env,
      timeout: 5 * 60_000,
    });
    if (result.status !== 0 || !fs.existsSync(LARK_SDK_MARKER)) {
      process.stderr.write(`[relay] FATAL: npm install failed (exit ${result.status}) — bootstrap 失败，硬退重试\n`);
      process.exit(1);
    }
  }
  const lark = require(path.dirname(LARK_SDK_MARKER));
  const lib = require('./lib.js');

  // 身份：启动解析一次；失败 60s 自旋重试；解析出来前一切按钮 fail-closed。
  const identity = { openId: null };
  async function resolveIdentity() {
    try {
      const token = await lib.fetchTenantToken({ host, appId, appSecret });
      identity.openId = await lib.resolveOperatorOpenId({ host, token, email, cachePath: OPEN_ID_CACHE_PATH });
      log({ event: 'identity', outcome: 'resolved', operator: identity.openId });
    } catch (error) {
      identity.openId = null;
      log({ event: 'identity', outcome: 'unresolved', detail: error?.message ?? String(error) });
    }
  }

  const dedupeState = loadDedupeState(DEDUPE_PATH);
  log({ event: 'dedupe', outcome: 'loaded', keys: dedupeState.size });

  // approver 的身份比对只做纵深防御（创建时的身份快照，可能还是 null）；fail-
  // closed 的唯一权威是 createCardActionHandler 闸门（活引用，晚解析同样收紧）。
  const approver = cardApprove.createCardApprover({
    operatorOpenId: identity.openId,
    repoRoot: WORK_DIR, // spawn cwd + outbox 落 /relay-work/tmp/dashboard-events/notify-outbox.jsonl
    dedupeState,
  });

  const handleCardAction = createCardActionHandler({
    getOperatorOpenId: () => identity.openId,
    approver,
    sendReceipt: async (verdict, extracted) => {
      // 闸门保证到这里的按钮都已过身份比对（identity.openId 非空）。
      await sendOperatorText({
        host, appId, appSecret, openId: identity.openId, lib,
        text: buildReceiptText(verdict, extracted),
      });
    },
    log,
  });

  const dispatcher = new lark.EventDispatcher({ loggerLevel: 'warn' }).register({
    // 唯一订阅者：本 pod（Mac 侧默认不订阅，见 server.js CARD_APPROVE_SUBSCRIBE）。
    'card.action.trigger': (data) => handleCardAction(data).catch((error) => {
      log({ event: 'card-action', outcome: 'handler-error', detail: error?.message ?? String(error) });
      return failClosedToast(`handler error: ${error?.message ?? error}`);
    }),
  });

  function newClient() {
    return new lark.WSClient({ appId, appSecret, loggerLevel: 'warn' });
  }
  let client = null;
  let starting = false;
  async function connect() {
    if (starting) return;
    starting = true;
    client = newClient();
    try {
      await client.start({ eventDispatcher: dispatcher });
      log({ event: 'ws', outcome: 'connected' });
    } catch (error) {
      log({ event: 'ws', outcome: 'connect-failed', detail: error?.message ?? String(error) });
    } finally {
      starting = false;
    }
  }

  resolveIdentity();
  // 身份未解析期间 60s 自旋；解析成功即停（cachePath 已持久化，重启秒回）。
  const identityTimer = setInterval(() => {
    if (identity.openId === null) resolveIdentity().catch(() => {});
    else clearInterval(identityTimer);
  }, 60_000);
  identityTimer.unref();

  connect();
  // WSClient 自带断线重连；redial 只兜它自己不救的态：首连失败 / terminal failed
  // / 从未连上。connected/reconnecting 态交给 SDK 内部重连，不重复拨。
  const redial = setInterval(() => {
    if (starting) return;
    const state = typeof client?.getConnectionStatus === 'function'
      ? client.getConnectionStatus().state
      : 'unknown';
    if (state === 'connected' || state === 'reconnecting') return;
    log({ event: 'ws', outcome: 'redial', state });
    connect();
  }, 60_000);
  redial.unref();

  // 进程级错误不许退出：记日志继续跑（裁定：常驻）。
  process.on('uncaughtException', (error) => {
    log({ event: 'process', outcome: 'uncaught-exception', detail: error?.stack ?? String(error) });
  });
  process.on('unhandledRejection', (reason) => {
    log({ event: 'process', outcome: 'unhandled-rejection', detail: reason?.stack ?? String(reason) });
  });

  process.on('SIGTERM', () => {
    log({ event: 'process', outcome: 'shutdown', detail: 'SIGTERM' });
    persistDedupeState(DEDUPE_PATH, dedupeState);
    process.exit(0);
  });
  process.on('SIGINT', () => {
    log({ event: 'process', outcome: 'shutdown', detail: 'SIGINT' });
    persistDedupeState(DEDUPE_PATH, dedupeState);
    process.exit(0);
  });

  process.stdout.write(`[relay] entry ready (work=${WORK_DIR} sdk=${LARK_SDK_SPEC}) — card.action.trigger 唯一订阅者\n`);
}

// repo 内 require 本文件（tests）不触发 main；relay pod 里 node 直接跑触发。
if (require.main === module) main();

module.exports = {
  DEDUPE_PATH,
  LARK_SDK_SPEC,
  WORK_DIR,
  buildReceiptText,
  createCardActionHandler,
  failClosedToast,
  loadDedupeState,
  persistDedupeState,
  sendOperatorText,
  toastFor,
  truncateLine,
};
