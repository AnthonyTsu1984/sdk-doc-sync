const ACTION_TYPES = Object.freeze({
  NEW: 'NEW',
  UPDATE: 'UPDATE',
  META_ONLY: 'META_ONLY',
  SKIP: 'SKIP',
  ORPHAN: 'ORPHAN',
  REFERENCE_CREATE: 'REFERENCE_CREATE',
  REFERENCE_UPDATE: 'REFERENCE_UPDATE',
  GUIDE_CODE_GAP: 'GUIDE_CODE_GAP',
  VERIFIED_DRAFT: 'VERIFIED_DRAFT',
});

const WORK_TYPES = Object.freeze({
  LOCALIZATION: 'localization',
  SDK_REFERENCE: 'sdkReference',
  REST_REFERENCE: 'restReference',
  CLI_REFERENCE: 'cliReference',
  GUIDE_DOCS: 'guideDocs',
  VERIFIED_DOCS: 'verifiedDocs',
});

const OWNER_TYPES = Object.freeze({
  DOC_COORDINATOR: 'doc-coordinator',
  LOCALIZATION_OWNER: 'localization-owner',
  JAVA_SDK_DOC_OWNER: 'java-sdk-doc-owner',
  PYTHON_SDK_DOC_OWNER: 'python-sdk-doc-owner',
  GO_SDK_DOC_OWNER: 'go-sdk-doc-owner',
  NODE_SDK_DOC_OWNER: 'node-sdk-doc-owner',
  CPP_SDK_DOC_OWNER: 'cpp-sdk-doc-owner',
  REST_API_DOC_OWNER: 'rest-api-doc-owner',
  CLI_DOC_OWNER: 'cli-doc-owner',
  GUIDE_DOC_OWNER: 'guide-doc-owner',
  VERIFIED_DOC_OWNER: 'verified-doc-owner',
  REVIEW_AGENT: 'review-agent',
});

const TASK_STATUS = Object.freeze({
  DETECTED: 'detected',
  DRY_RUN_STARTED: 'dry_run_started',
  DRY_RUN_READY: 'dry_run_ready',
  REVIEW_PASSED: 'review_passed',
  REVIEW_FAILED: 'review_failed',
  APPROVAL_REQUESTED: 'approval_requested',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CHANGES_REQUESTED: 'changes_requested',
  EXPIRED: 'expired',
  LIVE_WRITE_STARTED: 'live_write_started',
  VERIFICATION_STARTED: 'verification_started',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

const POLICY_ACTIONS = Object.freeze({
  IGNORE: 'ignore',
  DRY_RUN_ONLY: 'dry_run_only',
  PATCH_AFTER_APPROVAL: 'patch_after_approval',
  CUSTOM: 'custom',
});

function assertKnownActionType(type) {
  if (!Object.prototype.hasOwnProperty.call(ACTION_TYPES, type)) {
    throw new Error(`Unknown action type: ${type}`);
  }
}

function isLiveActionAllowed(type, allowed = []) {
  assertKnownActionType(type);
  return allowed.includes(type);
}

module.exports = {
  ACTION_TYPES,
  WORK_TYPES,
  OWNER_TYPES,
  TASK_STATUS,
  POLICY_ACTIONS,
  assertKnownActionType,
  isLiveActionAllowed,
};
