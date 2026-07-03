const crypto = require('crypto');
const http = require('http');
const { handleEvent } = require('./event-consumer');
const { FeishuImClient } = require('./feishu-im');

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function decryptFeishuEvent(encrypt, encryptKey) {
  if (!encryptKey) {
    throw new Error('FEISHU_EVENT_ENCRYPT_KEY is required for encrypted Feishu callbacks');
  }
  const key = crypto.createHash('sha256').update(encryptKey).digest();
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  let decrypted = decipher.update(encrypt, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

function maybeDecryptPayload(body, { encryptKey } = {}) {
  if (body && typeof body.encrypt === 'string') {
    return decryptFeishuEvent(body.encrypt, encryptKey);
  }
  return body;
}

function verifyCallbackToken(payload, expectedToken) {
  if (!expectedToken) return;
  const actual = payload?.token || payload?.header?.token;
  if (!timingSafeEqualString(actual, expectedToken)) {
    throw new Error('Invalid Feishu event verification token');
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

async function processFeishuCallback({
  body,
  config,
  githubToken,
  respond,
  dispatch,
  verificationToken = process.env.FEISHU_EVENT_VERIFICATION_TOKEN,
  encryptKey = process.env.FEISHU_EVENT_ENCRYPT_KEY,
}) {
  const payload = maybeDecryptPayload(body, { encryptKey });
  verifyCallbackToken(payload, verificationToken);

  if (payload?.type === 'url_verification' && payload.challenge) {
    return { statusCode: 200, body: { challenge: payload.challenge }, result: { challenge: true } };
  }

  const event = normalizeFeishuCallbackEvent(payload);
  const result = await handleEvent({
    config,
    event,
    githubToken,
    dispatch,
    respond,
  });
  return { statusCode: 200, body: { ok: true }, result };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error.message}`));
      }
    });
    request.on('error', reject);
  });
}

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function logResult(result) {
  if (result?.ignored) console.error(`[doc-agent] ignored event: ${result.reason}`);
  else if (result?.duplicate) console.error(`[doc-agent] duplicate decision: ${result.decision.decisionId}`);
  else if (result?.local) console.error(`[doc-agent] sent local response: ${result.parsed.action}`);
  else if (result?.ok) console.error(`[doc-agent] dispatched decision: ${result.decision.decisionId}`);
  else if (result?.challenge) console.error('[doc-agent] answered Feishu URL verification challenge');
}

function createFeishuWebhookServer({
  config,
  githubToken,
  path = process.env.DOC_AGENT_WEBHOOK_PATH || '/feishu/events',
  im = new FeishuImClient({ host: config.feishu.host }),
} = {}) {
  return http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && requestUrl.pathname === '/healthz') {
        writeJson(response, 200, { ok: true });
        return;
      }
      if (request.method !== 'POST' || requestUrl.pathname !== path) {
        writeJson(response, 404, { ok: false, error: 'not found' });
        return;
      }
      const body = await readJsonBody(request);
      const processed = await processFeishuCallback({
        body,
        config,
        githubToken,
        respond: message => im.sendText(message),
      });
      logResult(processed.result);
      writeJson(response, processed.statusCode, processed.body);
    } catch (error) {
      console.error(error.stack || error.message);
      writeJson(response, 400, { ok: false, error: error.message });
    }
  });
}

module.exports = {
  createFeishuWebhookServer,
  decryptFeishuEvent,
  normalizeFeishuCallbackEvent,
  processFeishuCallback,
};
