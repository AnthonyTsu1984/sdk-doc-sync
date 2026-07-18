const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parseApprovalCommand, normalizeFeishuMessageEvent } = require('./approval-commands');
const { FeishuImClient } = require('./feishu-im');
const { dispatchGithub } = require('./github-dispatch');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function appendDecision(filePath, decision) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(decision)}\n`);
}

function hasDecision(filePath, decisionId) {
  if (!fs.existsSync(filePath)) return false;
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).some(line => {
    try {
      return JSON.parse(line).decisionId === decisionId;
    } catch {
      return false;
    }
  });
}

function createDecision({ parsed, event, sourceRunId = null }) {
  const decisionId = `${parsed.taskId}:${parsed.action}:${event.senderId}`;
  return {
    decisionId,
    taskId: parsed.taskId,
    action: parsed.action,
    sourceRunId,
    customInstruction: parsed.customInstruction,
    userId: event.senderId,
    messageId: event.messageId,
    decidedAt: new Date().toISOString(),
  };
}

function isAllowedSender(config, normalized) {
  const allowedIds = config.feishu.approverIds || [];
  const senderIds = normalized.senderIds?.length ? normalized.senderIds : [normalized.senderId];
  return senderIds.some(id => allowedIds.includes(id));
}

function formatIgnoredResult(result) {
  if (result?.reason === 'not an approval command' && result.text) {
    const preview = String(result.text).replace(/\s+/g, ' ').trim().slice(0, 120);
    return `${result.reason} (${preview})`;
  }
  if (result?.reason !== 'sender not allowed' || !result.senderIds?.length) return result.reason;
  return `${result.reason} (${result.senderIds.join(', ')})`;
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

async function handleEvent({
  config,
  event,
  githubToken,
  sourceRunIdResolver = () => null,
  dispatch = decision => dispatchGithub({ config, token: githubToken, decision }),
  respond = null,
}) {
  const normalized = normalizeFeishuMessageEvent(event);
  if (normalized.chatId !== config.feishu.chatId) return { ignored: true, reason: 'chat mismatch' };
  if (!isAllowedSender(config, normalized)) {
    return { ignored: true, reason: 'sender not allowed', senderIds: normalized.senderIds || [] };
  }
  const parsed = parseApprovalCommand(normalized.text);
  if (!parsed) return { ignored: true, reason: 'not an approval command', text: normalized.text };
  if (parsed.local) {
    const responseText = localResponseText(parsed);
    if (respond) {
      await respond({ chatId: normalized.chatId, text: responseText });
    }
    return { local: true, parsed, responseText };
  }
  const decision = createDecision({
    parsed,
    event: normalized,
    sourceRunId: parsed.sourceRunId || sourceRunIdResolver(parsed.taskId),
  });
  const logPath = config.approvalConsumer.decisionLogPath;
  if (hasDecision(logPath, decision.decisionId)) return { duplicate: true, decision };
  appendDecision(logPath, decision);
  await dispatch(decision);
  return { ok: true, decision };
}

function waitForReady(child, eventKey) {
  return new Promise((resolve, reject) => {
    const readyLine = `[event] ready event_key=${eventKey}`;
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${readyLine}`)), 30000);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr += chunk;
      process.stderr.write(chunk);
      if (stderr.includes(readyLine)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`lark-cli event consumer exited before ready, code=${code}`));
    });
  });
}

async function runEventConsumer({ config, githubToken }) {
  const command = config.approvalConsumer.larkCliCommand || 'lark-cli';
  const eventKey = config.approvalConsumer.eventKey || 'im.message.receive_v1';
  const im = new FeishuImClient({ host: config.feishu.host });
  const child = spawn(command, ['event', 'consume', eventKey, '--as', 'bot'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  await waitForReady(child, eventKey);
  child.stdout.setEncoding('utf8');
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      Promise.resolve()
        .then(() => handleEvent({
          config,
          event: JSON.parse(line),
          githubToken,
          respond: message => im.sendText(message),
        }))
        .then(result => {
          if (result?.ignored) console.error(`[doc-agent] ignored event: ${formatIgnoredResult(result)}`);
          else if (result?.duplicate) console.error(`[doc-agent] duplicate decision: ${result.decision.decisionId}`);
          else if (result?.local) console.error(`[doc-agent] sent local response: ${result.parsed.action}`);
          else if (result?.ok) console.error(`[doc-agent] dispatched decision: ${result.decision.decisionId}`);
        })
        .catch(error => console.error(error.stack || error.message));
    }
  });
  return child;
}

function getSdkCredentials(config) {
  const appIdEnv = config.feishu?.appIdEnv || 'APP_ID';
  const appSecretEnv = config.feishu?.appSecretEnv || 'APP_SECRET';
  const appId = process.env[appIdEnv];
  const appSecret = process.env[appSecretEnv];
  if (!appId) throw new Error(`Missing Feishu SDK app id env: ${appIdEnv}`);
  if (!appSecret) throw new Error(`Missing Feishu SDK app secret env: ${appSecretEnv}`);
  return { appId, appSecret };
}

async function runSdkEventConsumer({
  config,
  githubToken,
  lark = require('@larksuiteoapi/node-sdk'),
  im = new FeishuImClient({ host: config.feishu.host }),
}) {
  const credentials = getSdkCredentials(config);
  const loggerLevel = lark.LoggerLevel?.info ?? 3;
  const wsClient = new lark.WSClient({
    ...credentials,
    loggerLevel,
    onReady: () => console.error('[doc-agent] Feishu SDK long-connection consumer ready'),
    onReconnecting: () => console.error('[doc-agent] Feishu SDK long-connection reconnecting'),
    onReconnected: () => console.error('[doc-agent] Feishu SDK long-connection reconnected'),
    onError: error => console.error(error.stack || error.message),
  });
  const eventDispatcher = new lark.EventDispatcher({}).register({
    'im.message.receive_v1': async data => {
      try {
        const result = await handleEvent({
          config,
          event: data,
          githubToken,
          respond: message => im.sendText(message),
        });
        if (result?.ignored) console.error(`[doc-agent] ignored event: ${formatIgnoredResult(result)}`);
        else if (result?.duplicate) console.error(`[doc-agent] duplicate decision: ${result.decision.decisionId}`);
        else if (result?.local) console.error(`[doc-agent] sent local response: ${result.parsed.action}`);
        else if (result?.ok) console.error(`[doc-agent] dispatched decision: ${result.decision.decisionId}`);
      } catch (error) {
        console.error(error.stack || error.message);
        throw error;
      }
    },
  });
  await wsClient.start({ eventDispatcher });
  return wsClient;
}

module.exports = {
  appendDecision,
  createDecision,
  formatIgnoredResult,
  handleEvent,
  localResponseText,
  runEventConsumer,
  runSdkEventConsumer,
  waitForReady,
};
