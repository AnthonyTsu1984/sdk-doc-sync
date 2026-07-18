const DEFAULT_WEBHOOK_PATH = '/feishu/events';

const ACTION_ALIASES = Object.freeze({
  ignore: 'ignore',
  'dry-run': 'dry_run_only',
  dryrun: 'dry_run_only',
  patch: 'patch_after_approval',
  custom: 'custom',
  approve: 'approve_live_write',
  reject: 'reject',
  changes: 'changes_requested',
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function stripBotMention(text) {
  return String(text || '')
    .replace(/^@\s*ztrans\b[:,]?\s*/i, '')
    .replace(/^ztrans\b[:,]?\s*/i, '')
    .replace(/^<at[^>]*>[^<]*<\/at>\s*/i, '')
    .replace(/^[＠@]_[a-zA-Z0-9_-]+\s*/i, '')
    .trim();
}

function normalizeFriendlyCommand(text) {
  return text
    .replace(/^dry\s+run\b/i, 'dry-run')
    .replace(/^create\s+patch\s+plan\b/i, 'patch')
    .replace(/^approve\s+live\s+write\b/i, 'approve')
    .replace(/^show\s+/i, 'explain ');
}

function localIntent(action, taskId, raw) {
  return {
    action,
    local: true,
    taskId: taskId || null,
    sourceRunId: null,
    customInstruction: '',
    raw,
  };
}

function parseApprovalCommand(text) {
  const raw = String(text || '').trim();
  const normalized = normalizeFriendlyCommand(stripBotMention(raw));
  if (!normalized) return null;
  if (/^help$/i.test(normalized)) return localIntent('help', null, raw);
  const explainMatch = normalized.match(/^explain\s+([a-zA-Z0-9_.:-]+)$/i);
  if (explainMatch) return localIntent('explain', explainMatch[1], raw);

  const match = normalized.match(/^([a-zA-Z-]+)\s+([a-zA-Z0-9_.:-]+)(?:\s+([0-9]+))?(?::\s*([\s\S]+))?$/);
  if (!match) return null;
  const action = ACTION_ALIASES[match[1].toLowerCase()];
  if (!action) return null;
  return {
    action,
    taskId: match[2],
    sourceRunId: match[3] || null,
    customInstruction: match[4] ? match[4].trim() : '',
    raw,
  };
}

function textFromFeishuContent(content) {
  if (!content) return '';
  if (typeof content !== 'string') return content.text || '';
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed.text === 'string' ? parsed.text : content;
  } catch {
    return content;
  }
}

function normalizeFeishuCallbackEvent(payload) {
  if (payload?.schema === '2.0' && payload.header && payload.event) {
    return {
      ...payload.event,
      event_id: payload.header.event_id,
      type: payload.header.event_type,
      timestamp: payload.header.create_time,
    };
  }
  return payload?.event || payload;
}

function addSenderCandidate(candidates, value) {
  if (!value) return;
  if (typeof value === 'string') {
    candidates.push(value);
    return;
  }
  if (typeof value !== 'object') return;
  for (const key of ['open_id', 'user_id', 'union_id', 'id']) {
    addSenderCandidate(candidates, value[key]);
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeFeishuMessageEvent(event) {
  const root = event.event || event;
  const content = root.text || root.content || root.message?.content || '';
  const senderCandidates = [];
  addSenderCandidate(senderCandidates, root.sender_id);
  addSenderCandidate(senderCandidates, root.sender?.sender_id?.open_id);
  addSenderCandidate(senderCandidates, root.sender?.sender_id?.user_id);
  addSenderCandidate(senderCandidates, root.sender?.sender_id?.union_id);
  addSenderCandidate(senderCandidates, root.sender?.sender_id);
  addSenderCandidate(senderCandidates, root.sender?.id);
  const senderIds = unique(senderCandidates);
  return {
    chatId: root.chat_id || root.message?.chat_id || '',
    senderId: senderIds[0] || '',
    senderIds,
    messageId: root.message_id || root.message?.message_id || root.id || root.event_id || '',
    threadId: root.thread_id || root.message?.thread_id || '',
    text: textFromFeishuContent(content),
  };
}

function localResponseText(parsed) {
  if (parsed.action === 'help') {
    return [
      'ztrans understands:',
      '- @ztrans dry run <task-id>',
      '- @ztrans patch <task-id>',
      '- @ztrans approve <task-id>',
      '- @ztrans reject <task-id>',
      '- @ztrans changes <task-id>: <instruction>',
      '- @ztrans explain <task-id>',
    ].join('\n');
  }
  if (parsed.action === 'explain') {
    return `I can explain task ${parsed.taskId}, but task lookup is not wired into chat replies yet. Use the latest scan card or artifact summary for now.`;
  }
  return 'ztrans did not dispatch a workflow for this local instruction.';
}

async function sha256Bytes(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || ''))));
}

async function safeEqualString(left, right) {
  const leftHash = await sha256Bytes(left);
  const rightHash = await sha256Bytes(right);
  let diff = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    diff |= leftHash[index] ^ rightHash[index];
  }
  return diff === 0;
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

function stripPkcs7Padding(bytes) {
  const padLength = bytes[bytes.length - 1];
  if (padLength < 1 || padLength > 16) return bytes;
  for (let index = bytes.length - padLength; index < bytes.length; index += 1) {
    if (bytes[index] !== padLength) return bytes;
  }
  return bytes.slice(0, bytes.length - padLength);
}

async function decryptFeishuEvent(encrypt, encryptKey) {
  if (!encryptKey) throw new Error('FEISHU_EVENT_ENCRYPT_KEY is required for encrypted Feishu callbacks');
  const keyBytes = await sha256Bytes(encryptKey);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: keyBytes.slice(0, 16) },
    key,
    base64ToBytes(encrypt)
  );
  return JSON.parse(new TextDecoder().decode(stripPkcs7Padding(new Uint8Array(decrypted))));
}

async function maybeDecryptPayload(body, env) {
  if (body && typeof body.encrypt === 'string') {
    return decryptFeishuEvent(body.encrypt, env.FEISHU_EVENT_ENCRYPT_KEY);
  }
  return body;
}

async function verifyCallbackToken(payload, env) {
  if (!env.FEISHU_EVENT_VERIFICATION_TOKEN) return;
  const actual = payload?.token || payload?.header?.token;
  if (!(await safeEqualString(actual, env.FEISHU_EVENT_VERIFICATION_TOKEN))) {
    throw new Error('Invalid Feishu event verification token');
  }
}

function loadConfig(env) {
  if (!env.DOC_AGENT_CONFIG_JSON) throw new Error('DOC_AGENT_CONFIG_JSON is required');
  return JSON.parse(env.DOC_AGENT_CONFIG_JSON);
}

async function fetchTenantAccessToken(env) {
  const appId = env.APP_ID || env.FEISHU_APP_ID;
  const appSecret = env.APP_SECRET || env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw new Error('APP_ID and APP_SECRET are required');
  const host = env.FEISHU_HOST || 'https://open.feishu.cn';
  const response = await fetch(`${host}/open-apis/auth/v3/tenant_access_token/internal/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await response.json();
  if (data.code !== 0) throw new Error(`Failed to fetch Feishu tenant token: ${data.msg || response.status}`);
  return data.tenant_access_token;
}

async function sendFeishuText({ chatId, text }, env) {
  const token = await fetchTenantAccessToken(env);
  const host = env.FEISHU_HOST || 'https://open.feishu.cn';
  const response = await fetch(`${host}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
  });
  const data = await response.json();
  if (data.code !== 0) throw new Error(`Failed to send Feishu text: ${data.msg || response.status}`);
  return data.data;
}

async function dispatchGithub({ config, decision, env }) {
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required for workflow dispatch');
  const prefix = config.github.dispatchEventPrefix || 'doc-agent';
  const response = await fetch(`https://api.github.com/repos/${config.github.owner}/${config.github.repo}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'ztrans-doc-agent-worker',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      event_type: `${prefix}-${decision.action}`,
      client_payload: {
        ...decision,
        ref: config.github.ref || 'master',
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub dispatch failed: ${response.status} ${await response.text()}`);
  }
}

async function handleEvent({ config, event, env }) {
  const normalized = normalizeFeishuMessageEvent(event);
  if (normalized.chatId !== config.feishu.chatId) return { ignored: true, reason: 'chat mismatch' };
  const senderIds = normalized.senderIds?.length ? normalized.senderIds : [normalized.senderId];
  if (!senderIds.some(id => config.feishu.approverIds.includes(id))) {
    return { ignored: true, reason: 'sender not allowed', senderIds: normalized.senderIds || [] };
  }

  const parsed = parseApprovalCommand(normalized.text);
  if (!parsed) return { ignored: true, reason: 'not an approval command' };
  if (parsed.local) {
    const responseText = localResponseText(parsed);
    await sendFeishuText({ chatId: normalized.chatId, text: responseText }, env);
    return { local: true, parsed, responseText };
  }

  const decision = {
    decisionId: `${parsed.taskId}:${parsed.action}:${normalized.senderId}`,
    taskId: parsed.taskId,
    action: parsed.action,
    sourceRunId: parsed.sourceRunId || null,
    customInstruction: parsed.customInstruction,
    userId: normalized.senderId,
    messageId: normalized.messageId,
    decidedAt: new Date().toISOString(),
  };

  if (env.DECISIONS) {
    const existing = await env.DECISIONS.get(decision.decisionId);
    if (existing) return { duplicate: true, decision };
    const ttl = Math.max(60, Number(config.approvalConsumer?.taskTtlMinutes || 1440) * 60);
    await env.DECISIONS.put(decision.decisionId, JSON.stringify(decision), { expirationTtl: ttl });
  }

  await dispatchGithub({ config, decision, env });
  return { ok: true, decision };
}

function logResult(result) {
  if (result?.ignored) console.log(JSON.stringify({ level: 'info', event: 'ignored', reason: result.reason }));
  else if (result?.duplicate) console.log(JSON.stringify({ level: 'info', event: 'duplicate', decisionId: result.decision.decisionId }));
  else if (result?.local) console.log(JSON.stringify({ level: 'info', event: 'local', action: result.parsed.action }));
  else if (result?.ok) console.log(JSON.stringify({ level: 'info', event: 'dispatch', decisionId: result.decision.decisionId }));
  else if (result?.challenge) console.log(JSON.stringify({ level: 'info', event: 'challenge' }));
}

export async function processFeishuCallback({ body, env }) {
  const payload = await maybeDecryptPayload(body, env);
  await verifyCallbackToken(payload, env);

  if (payload?.type === 'url_verification' && payload.challenge) {
    return { response: { challenge: payload.challenge }, result: { challenge: true } };
  }

  const config = loadConfig(env);
  const event = normalizeFeishuCallbackEvent(payload);
  const result = await handleEvent({ config, event, env });
  return { response: { ok: true }, result };
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const webhookPath = env.DOC_AGENT_WEBHOOK_PATH || DEFAULT_WEBHOOK_PATH;
      if (request.method === 'GET' && url.pathname === '/healthz') return jsonResponse({ ok: true });
      if (request.method !== 'POST' || url.pathname !== webhookPath) {
        return jsonResponse({ ok: false, error: 'not found' }, 404);
      }
      const contentLength = Number(request.headers.get('content-length') || 0);
      if (contentLength > 1024 * 1024) return jsonResponse({ ok: false, error: 'request too large' }, 413);

      const body = await request.json();
      const processed = await processFeishuCallback({ body, env });
      logResult(processed.result);
      return jsonResponse(processed.response);
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', message: error.message, stack: error.stack }));
      return jsonResponse({ ok: false, error: error.message }, 400);
    }
  },
};

export {
  decryptFeishuEvent,
  handleEvent,
  normalizeFeishuCallbackEvent,
  normalizeFeishuMessageEvent,
  parseApprovalCommand,
};
