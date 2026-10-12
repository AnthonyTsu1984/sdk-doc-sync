'use strict';

// Batch-14 Feishu direct-message notifier — the doorbell's outbound channel.
//
// Sends plain-text p2p messages to the OPERATOR only (never a group chat).
// The dashboard's no-write-path red line concerns governed doc/record state;
// an IM notification is telemetry like the SSE stream, rides the same opt-in
// pattern as spawn/approve forwarding (--notify), and writes nothing to
// Feishu docs, Bitable, or scan-state.
//
// Recipient resolution: OPERATOR_OPEN_ID verbatim, or OPERATOR_EMAIL through
// the contact batch_get_id API (needs the read-only contact:user.id:readonly
// app scope). Credentials reuse the skill's larkTokenFetcher pointed at the
// MESSAGING app (.env BOT_APP_ID/BOT_APP_SECRET/FEISHU_HOST — the doc app's
// DOC_* creds have no IM scopes). Tests inject fetch/token so nothing here
// touches the network by accident.

const path = require('node:path');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FETCH_TIMEOUT_MS = 15_000;
const TOKEN_REFRESH_MARGIN_MS = 30_000;

function defaultFetchImpl() {
  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('no global fetch available (Node >= 18 required)');
  }
  return fetchImpl.bind(globalThis);
}

function defaultTokenFetcher(repoRoot) {
  // Requiring this module runs dotenv.config(), so the repo-root .env is
  // already in process.env for the OPERATOR_* reads below. Messaging rides
  // the BOT_* app; the fetcher's no-arg default is the DOC_* writing app.
  const LarkTokenFetcher = require(path.join(
    repoRoot,
    '.claude/skills/api-reference-sync/lib/lark-docs/larkTokenFetcher.js',
  ));
  return new LarkTokenFetcher({ appIdEnv: 'BOT_APP_ID', appSecretEnv: 'BOT_APP_SECRET' });
}

function createFeishuNotifier({
  repoRoot,
  fetchImpl = defaultFetchImpl(),
  tokenFetcher = defaultTokenFetcher(repoRoot),
  env = process.env,
} = {}) {
  if (!repoRoot) throw new Error('createFeishuNotifier requires repoRoot');
  const state = { openId: null };

  async function resolveOpenId() {
    if (env.OPERATOR_OPEN_ID) return env.OPERATOR_OPEN_ID;
    if (state.openId) return state.openId;
    if (!env.OPERATOR_EMAIL) {
      throw new Error('notify target missing: set OPERATOR_OPEN_ID or OPERATOR_EMAIL');
    }
    const token = await tokenFetcher.token();
    const res = await fetchImpl(
      `${FEISHU_HOST}/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: [env.OPERATOR_EMAIL] }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    const data = await res.json();
    if (!data || data.code !== 0) {
      throw new Error(`operator lookup ${data?.code}: ${data?.msg ?? 'non-json response'}`);
    }
    const entry = data.data?.user_list?.[0];
    const openId = entry?.user_id || entry?.user_open_id || null;
    if (!openId) {
      throw new Error(`no Feishu user found for ${env.OPERATOR_EMAIL}`);
    }
    state.openId = openId;
    return openId;
  }

  async function sendText(text) {
    const token = await tokenFetcher.token();
    const receiveId = await resolveOpenId();
    const res = await fetchImpl(`${FEISHU_HOST}/open-apis/im/v1/messages?receive_id_type=open_id`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const data = await res.json();
    if (!data || data.code !== 0) {
      throw new Error(`im send ${data?.code}: ${data?.msg ?? 'non-json response'}`);
    }
    return { messageId: data.data?.message_id ?? null, receiveId };
  }

  // Threaded reply (relay answers ride the command's thread). Falls back to
  // the caller when messageId is absent.
  async function replyText(messageId, text) {
    if (!messageId) return sendText(text);
    const token = await tokenFetcher.token();
    const receiveId = await resolveOpenId();
    const res = await fetchImpl(`${FEISHU_HOST}/open-apis/im/v1/messages/${messageId}/reply`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const data = await res.json();
    if (!data || data.code !== 0) {
      throw new Error(`im reply ${data?.code}: ${data?.msg ?? 'non-json response'}`);
    }
    return { messageId: data.data?.message_id ?? null, receiveId };
  }

  return { resolveOpenId, sendText, replyText };
}

// Manual smoke / cron one-off: `node scripts/dashboard/notify-feishu.js --text "..."`
function main(argv) {
  const args = Array.isArray(argv) ? argv : process.argv.slice(2);
  const index = args.indexOf('--text');
  const text = index >= 0 ? args[index + 1] : null;
  if (!text) {
    process.stderr.write('usage: node scripts/dashboard/notify-feishu.js --text "<message>"\n');
    process.exit(2);
  }
  const repoRoot = path.resolve(__dirname, '..', '..');
  const notifier = createFeishuNotifier({ repoRoot });
  notifier.sendText(text).then(
    (result) => {
      process.stdout.write(`[notify] sent to ${result.receiveId} (message ${result.messageId})\n`);
    },
    (error) => {
      process.stderr.write(`[notify] send failed: ${error?.message ?? error}\n`);
      process.exit(1);
    },
  );
}

if (require.main === module) main();

module.exports = { createFeishuNotifier, FEISHU_HOST, TOKEN_REFRESH_MARGIN_MS };
