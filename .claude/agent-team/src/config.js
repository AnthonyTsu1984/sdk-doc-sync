const fs = require('fs');
const path = require('path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required config string: ${name}`);
  }
}

function requireArray(value, name) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Missing required config array: ${name}`);
  }
}

function requireArrayValue(value, name) {
  if (!Array.isArray(value)) {
    throw new Error(`Missing required config array: ${name}`);
  }
}

function requireEqualLength(left, right, leftName, rightName) {
  requireArray(left, leftName);
  requireArray(right, rightName);
  if (left.length !== right.length) {
    throw new Error(`Config arrays must have equal length: ${leftName} and ${rightName}`);
  }
}

function requireBoolean(value, name) {
  if (typeof value !== 'boolean') {
    throw new Error(`Missing required config boolean: ${name}`);
  }
}

function validateOwnerList(surface, name) {
  requireBoolean(surface?.enabled, `surfaces.${name}.enabled`);
  requireArray(surface?.owners, `surfaces.${name}.owners`);
  for (const [index, owner] of surface.owners.entries()) {
    requireString(owner.id, `surfaces.${name}.owners.${index}.id`);
    requireString(owner.repo, `surfaces.${name}.owners.${index}.repo`);
    requireString(owner.defaultBranch, `surfaces.${name}.owners.${index}.defaultBranch`);
  }
}

function validateConfig(config) {
  requireString(config.feishu?.chatId, 'feishu.chatId');
  requireArray(config.feishu?.approverIds, 'feishu.approverIds');
  requireString(config.github?.owner, 'github.owner');
  requireString(config.github?.repo, 'github.repo');
  requireString(config.github?.ref, 'github.ref');
  requireString(config.approvalConsumer?.decisionLogPath, 'approvalConsumer.decisionLogPath');
  requireString(config.approvalConsumer?.larkCliCommand, 'approvalConsumer.larkCliCommand');
  requireString(config.approvalConsumer?.eventKey, 'approvalConsumer.eventKey');
  const surfaces = config.surfaces || {};
  requireBoolean(surfaces.localization?.enabled, 'surfaces.localization.enabled');
  requireString(surfaces.localization?.owner, 'surfaces.localization.owner');
  requireString(surfaces.localization?.sourceBaseToken, 'surfaces.localization.sourceBaseToken');
  requireEqualLength(
    surfaces.localization?.sourceTableIds,
    surfaces.localization?.targetTableIds,
    'surfaces.localization.sourceTableIds',
    'surfaces.localization.targetTableIds'
  );
  requireString(surfaces.localization?.sourceRootToken, 'surfaces.localization.sourceRootToken');
  requireString(surfaces.localization?.targetBaseToken, 'surfaces.localization.targetBaseToken');
  requireString(surfaces.localization?.targetRootToken, 'surfaces.localization.targetRootToken');
  requireBoolean(surfaces.localization?.linkCheck?.enabled, 'surfaces.localization.linkCheck.enabled');
  requireBoolean(surfaces.localization?.linkCheck?.checkMentionDoc, 'surfaces.localization.linkCheck.checkMentionDoc');
  requireBoolean(surfaces.localization?.linkCheck?.checkExternalLinks, 'surfaces.localization.linkCheck.checkExternalLinks');
  requireArray(surfaces.localization?.allowedLiveActions, 'surfaces.localization.allowedLiveActions');
  validateOwnerList(surfaces.sdkReference, 'sdkReference');
  validateOwnerList(surfaces.restReference, 'restReference');
  validateOwnerList(surfaces.cliReference, 'cliReference');
  requireBoolean(surfaces.guideDocs?.enabled, 'surfaces.guideDocs.enabled');
  requireString(surfaces.guideDocs?.owner, 'surfaces.guideDocs.owner');
  requireArrayValue(surfaces.guideDocs?.docs, 'surfaces.guideDocs.docs');
  requireBoolean(surfaces.verifiedDocs?.enabled, 'surfaces.verifiedDocs.enabled');
  requireString(surfaces.verifiedDocs?.owner, 'surfaces.verifiedDocs.owner');
  requireArrayValue(surfaces.verifiedDocs?.docs, 'surfaces.verifiedDocs.docs');
  return config;
}

function loadConfig(explicitPath = process.env.DOC_AGENT_CONFIG) {
  const configPath = explicitPath || path.resolve('.claude/agent-team/config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}. Copy .claude/agent-team/config.example.json and fill real values.`);
  }
  return validateConfig(readJson(configPath));
}

module.exports = {
  loadConfig,
  validateConfig,
};
