const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parseApprovalCommand, normalizeFeishuMessageEvent } = require('./approval-commands');
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
}) {
  const normalized = normalizeFeishuMessageEvent(event);
  if (normalized.chatId !== config.feishu.chatId) return { ignored: true, reason: 'chat mismatch' };
  if (!config.feishu.approverIds.includes(normalized.senderId)) return { ignored: true, reason: 'sender not allowed' };
  const parsed = parseApprovalCommand(normalized.text);
  if (!parsed) return { ignored: true, reason: 'not an approval command' };
  if (parsed.local) {
    return { local: true, parsed, responseText: localResponseText(parsed) };
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
        .then(() => handleEvent({ config, event: JSON.parse(line), githubToken }))
        .catch(error => console.error(error.stack || error.message));
    }
  });
  return child;
}

module.exports = {
  appendDecision,
  createDecision,
  handleEvent,
  localResponseText,
  runEventConsumer,
  waitForReady,
};
