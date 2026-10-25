const { spawn } = require('child_process');
const { parseApprovalCommand, normalizeFeishuMessageEvent } = require('./approval-commands');
const { FeishuImClient } = require('./feishu-im');
const { dispatchGithub } = require('./github-dispatch');
const { TaskStore } = require('./task-store');
const { DecisionLedger } = require('../../skills/doc-ops-core/src/decision-ledger');
const { digestSemantic } = require('../../skills/doc-ops-core/src/digest');

const LIVE_DECISION_ACTIONS = new Set(['approve_live_write', 'reject', 'changes_requested']);

function decisionOutcome(action) {
  if (action === 'reject' || action === 'ignore') return 'rejected';
  if (action === 'changes_requested') return 'changes_requested';
  return 'approved';
}

function createDecision({ parsed, event, sourceRunId = null, actionBatch = null }) {
  const proposalDigest = parsed.batchDigest || digestSemantic({
    schemaVersion: 1,
    taskId: parsed.taskId,
    action: parsed.action,
    sourceRunId,
    instruction: parsed.customInstruction || null,
  });
  const decisionId = `decision:agent-team:${parsed.taskId}:${parsed.action}:${proposalDigest}`;
  return {
    ledgerEvent: {
      schemaVersion: 1,
      decisionId,
      skill: actionBatch?.skill || 'localized-doc-sync',
      gate: LIVE_DECISION_ACTIONS.has(parsed.action) ? 'WRITE' : 'WORKFLOW_DISPATCH',
      outcome: decisionOutcome(parsed.action),
      taskId: parsed.taskId,
      sessionId: sourceRunId ? `github-run:${sourceRunId}` : null,
      reviewUnitId: `task:${parsed.taskId}`,
      proposalDigest,
      resultDigest: null,
      instruction: parsed.customInstruction || null,
      rationale: parsed.customInstruction || null,
      durableRuleRequested: false,
      scopeHint: { level: 'review-unit', skill: actionBatch?.skill || 'localized-doc-sync' },
      evidence: [{
        type: actionBatch ? 'action-batch' : 'workflow-dispatch',
        digest: proposalDigest,
      }],
      runtime: {
        reviewerId: event.senderId,
        messageId: event.messageId,
        decidedAt: new Date().toISOString(),
      },
    },
    dispatchDecision: {
      decisionId,
      taskId: parsed.taskId,
      action: parsed.action,
      batchDigest: parsed.batchDigest || null,
      sourceRunId,
      customInstruction: parsed.customInstruction,
    },
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

function localResponseText(parsed, { actionBatch = null } = {}) {
  if (parsed.action === 'help') {
    return [
      'ztrans understands:',
      '- @ztrans dry run <task-id>',
      '- @ztrans patch <task-id>',
      '- APPROVE_WRITES <task-id> sha256:<batch-digest>',
      '- REJECT_WRITES <task-id> sha256:<batch-digest>: <reason>',
      '- REQUEST_CHANGES <task-id> sha256:<batch-digest>: <instruction>',
      '- @ztrans explain <task-id>',
    ].join('\n');
  }
  if (parsed.action === 'explain') {
    return `I can explain task ${parsed.taskId}, but task lookup is not wired into chat replies yet. Use the latest scan card or artifact summary for now.`;
  }
  if (parsed.action === 'legacy_live_command') {
    if (!actionBatch?.batchDigest) {
      return `Task-only live commands are no longer executable. Use the exact digest command from the latest approval card for task ${parsed.taskId}.`;
    }
    const commands = {
      approve: `APPROVE_WRITES ${parsed.taskId} ${actionBatch.batchDigest}`,
      reject: `REJECT_WRITES ${parsed.taskId} ${actionBatch.batchDigest}: <reason>`,
      changes: `REQUEST_CHANGES ${parsed.taskId} ${actionBatch.batchDigest}: <instruction>`,
    };
    return `Task-only live commands are no longer executable. Use:\n${commands[parsed.legacyAction]}`;
  }
  return 'ztrans did not dispatch a workflow for this local instruction.';
}

function defaultSourceRunIdResolver(taskId) {
  try {
    return new TaskStore().readTask(taskId).sourceRunId || null;
  } catch {
    return null;
  }
}

function defaultActionBatchResolver(taskId) {
  try {
    return new TaskStore().readArtifact(taskId, 'action-batch.json');
  } catch {
    return null;
  }
}

async function handleEvent({
  config,
  event,
  githubToken,
  sourceRunIdResolver = defaultSourceRunIdResolver,
  actionBatchResolver = defaultActionBatchResolver,
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
    const actionBatch = parsed.action === 'legacy_live_command' ? actionBatchResolver(parsed.taskId) : null;
    const responseText = localResponseText(parsed, { actionBatch });
    if (respond) {
      await respond({ chatId: normalized.chatId, text: responseText });
    }
    return { local: true, parsed, responseText };
  }
  const actionBatch = LIVE_DECISION_ACTIONS.has(parsed.action) ? actionBatchResolver(parsed.taskId) : null;
  if (LIVE_DECISION_ACTIONS.has(parsed.action)) {
    if (!actionBatch?.batchDigest) throw new Error(`ACTION_BATCH_NOT_FOUND: ${parsed.taskId}`);
    if (actionBatch.batchDigest !== parsed.batchDigest) {
      throw new Error(`ACTION_BATCH_DIGEST_MISMATCH: expected ${actionBatch.batchDigest}, received ${parsed.batchDigest}`);
    }
  }
  const { ledgerEvent, dispatchDecision } = createDecision({
    parsed,
    event: normalized,
    sourceRunId: parsed.sourceRunId || sourceRunIdResolver(parsed.taskId),
    actionBatch,
  });
  const logPath = config.approvalConsumer.decisionLogPath;
  let decision;
  try {
    decision = new DecisionLedger({ filePath: logPath }).append(ledgerEvent);
  } catch (error) {
    if (error.code === 'DUPLICATE_DECISION_ID') return { duplicate: true, decision: dispatchDecision };
    throw error;
  }
  const dispatched = { ...dispatchDecision, decisionDigest: decision.decisionDigest };
  await dispatch(dispatched);
  return { ok: true, decision: dispatched, ledgerEntry: decision };
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
  createDecision,
  formatIgnoredResult,
  handleEvent,
  localResponseText,
  runEventConsumer,
  runSdkEventConsumer,
  waitForReady,
};
