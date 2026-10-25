'use strict';
// Relay v2 slice B: gate-dispatch — the ONE guard chain shared by the board's
// HTTP approve/reject endpoints and the p2p message relay. These tests pin
// every typed refusal code AND its exact Chinese text (the byte-identical
// strings the endpoints have always answered with), the guard order, the
// verbatim reply-line binding against the re-read presentation index, and the
// stale-refusal invalidation. Pure module: recency IO arrives injected.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const {
  APPROVE_LINE_RE,
  REFUSALS,
  validateApproveLine,
  planCampaignGateDecision,
} = require('../../scripts/dashboard/gate-dispatch.js');

const DIGEST = `sha256:${'a'.repeat(64)}`;
const OTHER_DIGEST = `sha256:${'b'.repeat(64)}`;
const UNIT_DIGEST = `sha256:${'c'.repeat(64)}`;
const UNIT2_DIGEST = `sha256:${'d'.repeat(64)}`;
const SESSION_PATH = 'tmp/sdk-doc-sync-runs/node-v30/review-session.json';
const SESSION_KEY = `main::${SESSION_PATH}`;

function cardFixture(overrides = {}) {
  return {
    sessionKey: SESSION_KEY,
    sessionPath: SESSION_PATH,
    language: 'node',
    checkout: 'main',
    health: 'active',
    nextGate: { gate: 'APPROVE_CAMPAIGN', digest: DIGEST },
    workers: [{ sessionId: 'sess_w', status: 'idle' }],
    ...overrides,
  };
}

function campaignIndexFixture() {
  return {
    schema: 1,
    sessionKey: SESSION_PATH.split(path.sep).join('/').replace(/[^A-Za-z0-9._-]/g, '-'),
    sessionPath: SESSION_PATH,
    gate: 'APPROVE_CAMPAIGN',
    title: 'APPROVE_CAMPAIGN — 战役门',
    generatedAt: '2026-10-20T01:00:00.000Z',
    digest: DIGEST,
    replyLines: [`APPROVE_CAMPAIGN ${DIGEST}`],
    units: [],
    notes: '',
  };
}

function rollbackIndexFixture() {
  return {
    schema: 1,
    sessionPath: SESSION_PATH,
    gate: 'APPROVE_ROLLBACK',
    title: 'APPROVE_ROLLBACK — 2 单元',
    generatedAt: '2026-10-20T01:00:00.000Z',
    digest: null,
    replyLines: [
      `APPROVE_ROLLBACK review:u1 ${UNIT_DIGEST}`,
      `APPROVE_ROLLBACK review:u2 ${UNIT2_DIGEST}`,
    ],
    units: [],
    notes: '',
  };
}

// ---------- approval-line grammar (moved verbatim from server.js) ----------

test('validateApproveLine: campaign and rollback lines pass, prose fails', () => {
  assert.ok(validateApproveLine(`APPROVE_CAMPAIGN ${DIGEST}`));
  assert.ok(validateApproveLine(`APPROVE_ROLLBACK review:u1 ${DIGEST}`));
  assert.ok(validateApproveLine(`  APPROVE_ROLLBACK review:u1 ${UNIT_DIGEST}  `));
  assert.ok(!validateApproveLine(`APPROVE_CAMPAIGN not-a-digest`));
  assert.ok(!validateApproveLine(`批准`));
  assert.ok(!validateApproveLine(''));
  assert.match(APPROVE_LINE_RE.source, /CAMPAIGN/);
});

// ---------- approve: guard matrix (order + exact texts) ----------

test('approve happy path returns the resume action with the injected line and checkout root', () => {
  const plan = planCampaignGateDecision({
    intent: 'approve',
    card: cardFixture(),
    sessionId: 'sess_w',
    line: `APPROVE_CAMPAIGN ${DIGEST}`,
    presentationIndex: campaignIndexFixture(),
    checkoutRoot: '/repo/main',
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.code, 'OK');
  assert.deepEqual(plan.action, {
    type: 'resume',
    sessionId: 'sess_w',
    line: `APPROVE_CAMPAIGN ${DIGEST}`,
    checkoutRoot: '/repo/main',
  });
});

test('approve guard: malformed line → 400 with the exact endpoint text', () => {
  const plan = planCampaignGateDecision({
    intent: 'approve', card: cardFixture(), sessionId: 'sess_w', line: '批准一下',
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'LINE_FORMAT');
  assert.equal(plan.status, 400);
  assert.equal(plan.message, '批准行格式无效（须为 APPROVE_* [id] sha256:<64 位摘要> 精确行）');
});

test('approve guard: rejectInFlight → 409 with the exact endpoint text', () => {
  const plan = planCampaignGateDecision({
    intent: 'approve', card: cardFixture({ rejectInFlight: true }), sessionId: 'sess_w', line: `APPROVE_CAMPAIGN ${DIGEST}`,
  });
  assert.equal(plan.code, 'REJECT_IN_FLIGHT_APPROVE');
  assert.equal(plan.status, 409);
  assert.equal(plan.message, '该门已打回、新会话重规划中——旧批准行随打回失效，等新战役门呈报后再批');
});

test('approve guard: non-board worker → 404 with the exact endpoint text', () => {
  const plan = planCampaignGateDecision({
    intent: 'approve', card: cardFixture(), sessionId: 'sess_stranger', line: `APPROVE_CAMPAIGN ${DIGEST}`,
  });
  assert.equal(plan.code, 'NOT_BOARD_WORKER_APPROVE');
  assert.equal(plan.status, 404);
  assert.equal(plan.message, '该会话不是看板派出的 worker（界面批准仅限 dashboard 派出的会话）');
});

test('approve guard: worker mid-turn → 409 with the exact endpoint text', () => {
  const plan = planCampaignGateDecision({
    intent: 'approve',
    card: cardFixture({ workers: [{ sessionId: 'sess_w', status: 'running' }] }),
    sessionId: 'sess_w',
    line: `APPROVE_CAMPAIGN ${DIGEST}`,
  });
  assert.equal(plan.code, 'WORKER_BUSY_APPROVE');
  assert.equal(plan.status, 409);
  assert.equal(plan.message, 'worker 仍在首轮运行中——等它停在门禁后再批准');
});

test('approve guard: sibling running → 409 with the exact endpoint text', () => {
  const plan = planCampaignGateDecision({
    intent: 'approve',
    card: cardFixture({
      workers: [
        { sessionId: 'sess_w', status: 'idle' },
        { sessionId: 'sess_other', status: 'running' },
      ],
    }),
    sessionId: 'sess_w',
    line: `APPROVE_CAMPAIGN ${DIGEST}`,
  });
  assert.equal(plan.code, 'SIBLING_RUNNING');
  assert.equal(plan.status, 409);
  assert.equal(plan.message, '该战役另一个 worker 正在执行——等它停门后再注入（防双写）');
});

test('approve guard: recent transcript write (injected IO) → 409 with the seconds text', () => {
  const plan = planCampaignGateDecision({
    intent: 'approve', card: cardFixture(), sessionId: 'sess_w', line: `APPROVE_CAMPAIGN ${DIGEST}`,
    sessionRecentlyActiveOf: () => 34_000,
  });
  assert.equal(plan.code, 'RECENTLY_ACTIVE');
  assert.equal(plan.status, 409);
  assert.equal(plan.message, '该会话 34 秒前仍有转录写入——疑似上一回合未结束，稍候再试');
});

test('approve guard: guard order — rejectInFlight wins over worker attribution', () => {
  const plan = planCampaignGateDecision({
    intent: 'approve',
    card: cardFixture({ rejectInFlight: true }),
    sessionId: 'sess_stranger',
    line: `APPROVE_CAMPAIGN ${DIGEST}`,
  });
  assert.equal(plan.code, 'REJECT_IN_FLIGHT_APPROVE');
});

// ---------- approve: presentation-index binding (the v1 law, extended) ----------

test('approve binding: line must be verbatim one of the re-read index replyLines', () => {
  const plan = planCampaignGateDecision({
    intent: 'approve',
    card: cardFixture(),
    sessionId: 'sess_w',
    line: `APPROVE_CAMPAIGN ${OTHER_DIGEST}`, // well-formed, but not what the artifact binds
    presentationIndex: campaignIndexFixture(),
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'LINE_NOT_IN_PRESENTATION');
  assert.equal(plan.status, 409);
  assert.equal(plan.message, '批准行不在当前呈门工件的回行之列——以看板呈现的批准回行为准，逐字复制');
});

test('approve binding: re-read index bound to another session/gate refuses as mismatch', () => {
  const plan = planCampaignGateDecision({
    intent: 'approve',
    card: cardFixture({ sessionPath: 'tmp/sdk-doc-sync-runs/other/review-session.json' }),
    sessionId: 'sess_w',
    line: `APPROVE_CAMPAIGN ${DIGEST}`,
    presentationIndex: campaignIndexFixture(),
  });
  assert.equal(plan.code, 'PRESENTATION_MISMATCH');
  assert.equal(plan.message, '呈门工件与当前战役门不一致（gate/会话不匹配）——以看板最新呈现为准');
});

test('approve binding: notification-time digest disagreement → STALE with invalidateKey', () => {
  const plan = planCampaignGateDecision({
    intent: 'approve',
    card: cardFixture(),
    sessionId: 'sess_w',
    line: `APPROVE_CAMPAIGN ${DIGEST}`,
    presentationIndex: campaignIndexFixture(),
    notifyBinding: { key: 'gate:main::x:APPROVE_CAMPAIGN', digest: OTHER_DIGEST, replyLine: `APPROVE_CAMPAIGN ${DIGEST}` },
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'STALE_PRESENTATION');
  assert.equal(plan.invalidateKey, 'gate:main::x:APPROVE_CAMPAIGN');
  assert.match(plan.message, /已变化/);
});

test('approve binding: relay path requires an index at all (bindingRequired)', () => {
  const plan = planCampaignGateDecision({
    intent: 'approve',
    card: cardFixture(),
    sessionId: 'sess_w',
    line: `APPROVE_CAMPAIGN ${DIGEST}`,
    bindingRequired: true,
    presentationIndex: null,
  });
  assert.equal(plan.code, 'PRESENTATION_UNREADABLE');
  assert.equal(plan.status, 409);
});

test('approve binding: HTTP path without an attached index keeps the shape-only rule', () => {
  const plan = planCampaignGateDecision({
    intent: 'approve',
    card: cardFixture(),
    sessionId: 'sess_w',
    line: `APPROVE_CAMPAIGN ${DIGEST}`,
    presentationIndex: null,
  });
  assert.equal(plan.ok, true, 'legacy cards (no index attached) dispatch exactly as before');
});

test('approve binding: unit-scoped rollback disambiguation by targetUnitId', () => {
  const card = cardFixture({ nextGate: { gate: 'APPROVE_ROLLBACK', reviewUnitId: 'review:u1' } });
  const index = rollbackIndexFixture();
  const good = planCampaignGateDecision({
    intent: 'approve', card, sessionId: 'sess_w',
    line: `APPROVE_ROLLBACK review:u2 ${UNIT2_DIGEST}`, targetUnitId: 'review:u2',
    presentationIndex: index,
  });
  assert.equal(good.ok, true, 'the matching unit line passes');

  const wrongUnit = planCampaignGateDecision({
    intent: 'approve', card, sessionId: 'sess_w',
    line: `APPROVE_ROLLBACK review:u2 ${UNIT2_DIGEST}`, targetUnitId: 'review:u1',
    presentationIndex: index,
  });
  assert.equal(wrongUnit.ok, false);
  assert.equal(wrongUnit.code, 'LINE_NOT_IN_PRESENTATION', 'a line from ANOTHER unit may not satisfy this unit');
});

// ---------- reject: guard matrix + prompt composition ----------

test('reject happy path (write mode) composes the REJECT_WRITES prompt', () => {
  const plan = planCampaignGateDecision({
    intent: 'reject',
    card: cardFixture(),
    sessionId: 'sess_w',
    rejectMode: 'write',
    reason: '批次把 Node 30 的 manifest 写坏了，重排',
    checkoutRoot: '/repo/main',
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.action.type, 'reject');
  assert.equal(plan.action.mode, 'write');
  assert.equal(plan.action.sessionId, 'sess_w');
  assert.match(plan.action.prompt, /^REJECT_WRITES <batch>/);
  assert.match(plan.action.prompt, /批次把 Node 30 的 manifest 写坏了，重排/);
});

test('reject reason validation: empty and overlong reasons carry the exact 400 texts', () => {
  const empty = planCampaignGateDecision({
    intent: 'reject', card: cardFixture(), sessionId: 'sess_w', rejectMode: 'write', reason: '   ',
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.code, 'REASON_INVALID');
  assert.equal(empty.status, 400);
  assert.equal(empty.message, '打回意见不能为空');

  const long = planCampaignGateDecision({
    intent: 'reject', card: cardFixture(), sessionId: 'sess_w', rejectMode: 'write', reason: 'x'.repeat(2001),
  });
  assert.equal(long.message, '打回意见过长（上限 2000 字符）');
});

test('reject mode validation and per-mode prompts', () => {
  const badMode = planCampaignGateDecision({
    intent: 'reject', card: cardFixture(), sessionId: 'sess_w', rejectMode: 'spin', reason: 'x',
  });
  assert.equal(badMode.code, 'REJECT_MODE_INVALID');
  assert.equal(badMode.status, 400);
  assert.equal(badMode.message, "reject.mode 须为 'write' 或 'comments'");

  const comments = planCampaignGateDecision({
    intent: 'reject', card: cardFixture(), sessionId: 'sess_w', rejectMode: 'comments',
    targetUnitId: 'review:u1', reason: 'ignored for comments',
  });
  assert.match(comments.action.prompt, /^REJECT_DOCUMENT review:u1$/m);

  const commentsBadUnit = planCampaignGateDecision({
    intent: 'reject', card: cardFixture(), sessionId: 'sess_w', rejectMode: 'comments',
    targetUnitId: '../escape', reason: 'x',
  });
  assert.equal(commentsBadUnit.code, 'UNIT_ID_INVALID');
  assert.equal(commentsBadUnit.message, '单元 id 无效');

  const changesNoUnit = planCampaignGateDecision({
    intent: 'reject', card: cardFixture(), sessionId: 'sess_w', rejectMode: 'changes', reason: '改错了',
  });
  assert.equal(changesNoUnit.code, 'REASON_INVALID');
  assert.equal(changesNoUnit.message, '单元 id 无效（须为 review-unit 标识符）');

  const changes = planCampaignGateDecision({
    intent: 'reject', card: cardFixture(), sessionId: 'sess_w', rejectMode: 'changes',
    targetUnitId: 'review:u1', reason: '改错了',
  });
  assert.equal(changes.ok, true);
  assert.match(changes.action.prompt, /^REQUEST_CHANGES review:u1$/m);
});

test('reject guard texts mirror the request-changes endpoint byte for byte', () => {
  const inFlight = planCampaignGateDecision({
    intent: 'reject', card: cardFixture({ rejectInFlight: true }), sessionId: 'sess_w', rejectMode: 'write', reason: 'x',
  });
  assert.equal(inFlight.code, 'REJECT_IN_FLIGHT_REJECT');
  assert.equal(inFlight.message, '该门已打回、新会话重规划中——先等它重呈新战役门；对新门再提打回或修改');

  const stranger = planCampaignGateDecision({
    intent: 'reject', card: cardFixture(), sessionId: 'sess_stranger', rejectMode: 'write', reason: 'x',
  });
  assert.equal(stranger.code, 'NOT_BOARD_WORKER_REJECT');
  assert.equal(stranger.status, 404);
  assert.equal(stranger.message, '该会话不是看板派出的 worker（修改要求仅注入看板派出的会话）');

  const busy = planCampaignGateDecision({
    intent: 'reject',
    card: cardFixture({ workers: [{ sessionId: 'sess_w', status: 'running' }] }),
    sessionId: 'sess_w', rejectMode: 'write', reason: 'x',
  });
  assert.equal(busy.code, 'WORKER_BUSY_REJECT');
  assert.equal(busy.message, 'worker 正在运行——等它停在门禁后再提修改要求');

  const missing = planCampaignGateDecision({
    intent: 'reject', card: cardFixture(), sessionId: null, rejectMode: 'write', reason: 'x',
  });
  assert.equal(missing.code, 'MISSING_SESSION');
  assert.equal(missing.status, 400);
  assert.equal(missing.message, 'missing sessionId');

  const noCard = planCampaignGateDecision({
    intent: 'reject', card: null, sessionId: 'sess_w', rejectMode: 'write', reason: 'x',
  });
  assert.equal(noCard.code, 'NO_CARD');
  assert.equal(noCard.status, 404);
});

// ---------- refusal catalogue integrity ----------

test('every refusal code carries an actionable non-empty Chinese message and a status', () => {
  for (const [code, refusal] of Object.entries(REFUSALS)) {
    assert.ok(refusal.message && refusal.message.length >= 8, `${code} has text`);
    assert.ok([400, 404, 409].includes(refusal.status), `${code} status sane`);
  }
  // RECENTLY_ACTIVE is dynamic (the seconds figure is interpolated) — exercised
  // in the guard-matrix test above with its exact text.
});
