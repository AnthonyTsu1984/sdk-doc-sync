'use strict';

// Batch 16 slice 1 (design §3/§9/§10 row 1): the campaign plan v2 kernel.
// Offline only — no Feishu, no engine, no filesystem beyond nothing at all.
// The fixture is the design §3 JSON example fleshed out with every required
// segment filled.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CAMPAIGN_KIND_UNSUPPORTED,
  CAMPAIGN_PLAN_INVALID,
  CAMPAIGN_PLAN_SCHEMA_VERSION,
  CampaignPlanError,
  assertValidCampaignPlan,
  planDigest,
  validateCampaignPlan,
} = require('../src/sdk-doc-sync/campaign-plan');
const {
  TRIGGER_UNSUPPORTED,
  normalizeCampaignRunPlan,
  validateCampaignRunPlan,
} = require('../src/sdk-doc-sync/campaign-runner');

const SHA = (char) => `sha256:${char.repeat(64)}`;

// The design §3 example, completed: every required segment present and well
// formed, so each test mutates a copy at exactly one place.
function fixturePlan() {
  const campaignDir = 'tmp/api-reference-sync/campaigns/java-v30-sync';
  return {
    schemaVersion: 2,
    campaignId: 'java-v30-sync',
    kind: 'release-sync',
    template: {
      path: '.claude/skills/api-reference-sync/workflows/release-sync-campaign.dwf.ts',
      sha256: SHA('a'),
      pinnedScripts: { intakeAssemble: SHA('b') },
    },
    identity: { language: 'java', sdkName: 'milvus-sdk-java', track: 'v3.0.x' },
    trigger: { kind: 'pr', prNumber: 1181 },
    feishu: {
      host: 'https://open.feishu.example',
      baseToken: 'bascnExampleBaseToken',
      tableId: 'tblExampleTable',
      rootToken: 'rtcnExampleRootToken',
    },
    paths: {
      sdkDir: 'repos/milvus-sdk-java',
      campaignDir,
      sessionPath: `${campaignDir}/session.json`,
      scopePath: `${campaignDir}/release-scope.json`,
      groupingPath: `${campaignDir}/grouping.json`,
      candidateSpecPath: `${campaignDir}/candidate-spec.json`,
      referenceContext: `${campaignDir}/reference-context`,
      targetsJson: `${campaignDir}/targets.json`,
      identityMap: `${campaignDir}/identity.json`,
    },
    run: {
      journalPath: `${campaignDir}/execution-journal.jsonl`,
      ledgerPath: 'tmp/api-reference-sync/daily-scan/pr-findings.jsonl',
      freezeDir: 'tmp/api-reference-sync/campaign-freezes',
      phases: [{
        label: 'close-session',
        argv: ['node', 'scripts/sdk-review-session.js', 'close-session', '--scan-state-key', 'java:v3.0.x'],
      }],
    },
    terminal: {
      scanStateKey: 'java:v3.0.x',
      scanStateEntryPath: 'tmp/api-reference-sync/scan-state/java-v3.0.x.json',
      // P0-2 (2026-10-22): close-session entry content rides in the plan
      // (date-less — the dwf template stamps lastScanDate at close).
      scanStateEntry: { lastScannedTag: 'pr-1181' },
    },
    batch: { defaultSize: 3, cap: 40, firstBatchK1: false },
    crossTrack: { peerTag: 'v2.6.x-latest' },
    seats: { a1: { pagesPerWriter: 12, maxRounds: 3 }, a2: {}, a3: {} },
    notes: { scoutWarnings: 9 },
    promptFacts: {
      sourceRevision: 'v3.0.25',
      createWhitelistNote: 'CREATE is milvus-specific APIs only',
      exemplarPath: `${campaignDir}/exemplar.md`,
    },
  };
}

// Deep reverse of key order everywhere — digestSemantic must not care (its
// canonical JSON sorts object keys), arrays keep their order.
function reverseKeyOrder(value) {
  if (Array.isArray(value)) return value.map(reverseKeyOrder);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).reverse()) out[key] = reverseKeyOrder(value[key]);
    return out;
  }
  return value;
}

test('the pinned schema version is 2', () => {
  assert.equal(CAMPAIGN_PLAN_SCHEMA_VERSION, 2);
});

test('a well-formed plan validates clean and digests to a sha256 digest', () => {
  const plan = fixturePlan();
  assert.deepEqual(validateCampaignPlan(plan), { valid: true, errors: [] });
  assert.doesNotThrow(() => assertValidCampaignPlan(plan));
  assert.match(planDigest(plan), /^sha256:[0-9a-f]{64}$/);
});

test('validation is fail-closed on non-plans', () => {
  for (const bad of [null, undefined, 'plan', 42, [], true]) {
    const validation = validateCampaignPlan(bad);
    assert.equal(validation.valid, false, JSON.stringify(bad));
    assert.deepEqual(validation.errors, [{ code: CAMPAIGN_PLAN_INVALID, path: '$', message: 'must be an object' }]);
  }
});

test('each broken segment is reported at its exact field path', () => {
  const cases = [
    ['schemaVersion', (plan) => { plan.schemaVersion = 1; }, '$.schemaVersion'],
    ['campaignId', (plan) => { plan.campaignId = 'Java_V30'; }, '$.campaignId'],
    ['template.path', (plan) => { delete plan.template.path; }, '$.template.path'],
    ['template.sha256', (plan) => { plan.template.sha256 = 'sha256:tooshort'; }, '$.template.sha256'],
    ['identity.track', (plan) => { delete plan.identity.track; }, '$.identity.track'],
    ['trigger.prNumber', (plan) => { plan.trigger.prNumber = 0; }, '$.trigger.prNumber'],
    ['trigger.kind', (plan) => { plan.trigger = { kind: 'carrier-pigeon' }; }, '$.trigger.kind'],
    ['feishu.rootToken', (plan) => { delete plan.feishu.rootToken; }, '$.feishu.rootToken'],
    ['paths.targetsJson', (plan) => { delete plan.paths.targetsJson; }, '$.paths.targetsJson'],
    ['paths.identityMap', (plan) => { delete plan.paths.identityMap; }, '$.paths.identityMap'],
    ['run.phases', (plan) => { plan.run.phases = []; }, '$.run.phases'],
    ['run.phases[].argv', (plan) => { plan.run.phases[0].argv = ['node', 7]; }, '$.run.phases[0].argv'],
    ['terminal.scanStateKey', (plan) => { delete plan.terminal.scanStateKey; }, '$.terminal.scanStateKey'],
    ['batch.cap', (plan) => { plan.batch.cap = plan.batch.defaultSize - 1; }, '$.batch.cap'],
    ['batch.firstBatchK1', (plan) => { plan.batch.firstBatchK1 = 'no'; }, '$.batch.firstBatchK1'],
    ['crossTrack.peerTag', (plan) => { delete plan.crossTrack.peerTag; }, '$.crossTrack.peerTag'],
    ['seats.a1.pagesPerWriter', (plan) => { plan.seats.a1.pagesPerWriter = 0; }, '$.seats.a1.pagesPerWriter'],
    ['notes', (plan) => { plan.notes = 'nine warnings'; }, '$.notes'],
    ['promptFacts', (plan) => { plan.promptFacts.sourceRevision = 1181; }, '$.promptFacts.sourceRevision'],
  ];
  for (const [segment, breakPlan, expectedPath] of cases) {
    const plan = fixturePlan();
    breakPlan(plan);
    const validation = validateCampaignPlan(plan);
    assert.equal(validation.valid, false, segment);
    assert.ok(
      validation.errors.some((error) => error.code === CAMPAIGN_PLAN_INVALID && error.path === expectedPath),
      `${segment} must report at ${expectedPath}, got ${JSON.stringify(validation.errors)}`,
    );
  }
});

test('pinnedScripts values must each be a digest', () => {
  const plan = fixturePlan();
  plan.template.pinnedScripts = { intakeAssemble: SHA('b'), verifier: 'sha256:short' };
  const validation = validateCampaignPlan(plan);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.path === '$.template.pinnedScripts.verifier'));
  assert.ok(!validation.errors.some((error) => error.path === '$.template.pinnedScripts.intakeAssemble'));
});

test('kind "revision" is open as of slice 7 and validates under the revision path spine', () => {
  const plan = fixturePlan();
  plan.kind = 'revision';
  // The revision shape requires the contexts/manifest/unit-digests trio, not
  // the release-sync sdk paths — the same fixture passes only if the
  // per-kind spine is honored (the sdk paths are simply not required here).
  plan.paths = {
    campaignDir: 'tmp/campaign-rev',
    sessionPath: 'tmp/campaign-rev/session.json',
    scopePath: 'tmp/campaign-rev/scope.json',
    contextsPath: 'tmp/campaign-rev/contexts.json',
    manifestProjectionPath: 'tmp/campaign-rev/manifest-projection.json',
    candidateSpecProjectionPath: 'tmp/campaign-rev/contexts-spec.json',
    unitDigestsPath: 'tmp/campaign-rev/unit-digests.json',
  };
  assert.deepEqual(validateCampaignPlan(plan), { valid: true, errors: [] });

  // A revision plan missing the trio is refused with the exact field paths.
  plan.paths = { campaignDir: 'tmp/campaign-rev', sessionPath: 's', scopePath: 's' };
  const validation = validateCampaignPlan(plan);
  assert.equal(validation.valid, false);
  for (const key of ['contextsPath', 'manifestProjectionPath', 'candidateSpecProjectionPath', 'unitDigestsPath']) {
    assert.ok(validation.errors.some((error) => error.path === `$.paths.${key}`), key);
  }

  // A release-sync plan missing its sdk spine is still refused.
  const releasePlan = fixturePlan();
  releasePlan.paths = { campaignDir: 'c', sessionPath: 's', scopePath: 's' };
  assert.equal(validateCampaignPlan(releasePlan).valid, false);
});

test('a tag trigger is kernel-legal (the shell is what refuses it)', () => {
  const plan = fixturePlan();
  plan.trigger = { kind: 'tag', baselineTag: 'v2.6.25', targetTag: 'v3.0.25' };
  assert.deepEqual(validateCampaignPlan(plan), { valid: true, errors: [] });
  // A tag trigger without its two tags still names the exact fields.
  plan.trigger.targetTag = '';
  const validation = validateCampaignPlan(plan);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.path === '$.trigger.targetTag'));
});

test('optional segments may be absent and peerTag may be null', () => {
  const plan = fixturePlan();
  delete plan.template.pinnedScripts;
  delete plan.notes;
  delete plan.promptFacts;
  delete plan.seats.a1;
  plan.crossTrack.peerTag = null;
  plan.run.phases[0].outcomeFile = `${plan.paths.campaignDir}/close-session.json`;
  assert.deepEqual(validateCampaignPlan(plan), { valid: true, errors: [] });
});

test('the digest is key-order insensitive and moves when any field moves', () => {
  const plan = fixturePlan();
  const digest = planDigest(plan);
  assert.equal(planDigest(reverseKeyOrder(plan)), digest, 'key order must not change the semantic digest');

  const drifted = fixturePlan();
  drifted.template.sha256 = SHA('c');
  assert.notEqual(planDigest(drifted), digest, 'a template pin change is a different plan');

  // Unknown fields are ignored by validation but still digest-covered.
  const extended = fixturePlan();
  extended.someFutureField = { addedBy: 'a newer generator' };
  assert.equal(validateCampaignPlan(extended).valid, true);
  assert.notEqual(planDigest(extended), digest);
});

test('planDigest refuses non-objects typed', () => {
  for (const bad of [null, undefined, 'plan', 42, [], true]) {
    assert.throws(
      () => planDigest(bad),
      (error) => error instanceof CampaignPlanError && error.code === CAMPAIGN_PLAN_INVALID,
      JSON.stringify(bad),
    );
  }
});

test('assertValidCampaignPlan joins every error into the thrown message', () => {
  const plan = fixturePlan();
  plan.identity.track = '';
  plan.batch.firstBatchK1 = 'yes';
  assert.throws(
    () => assertValidCampaignPlan(plan),
    (error) => {
      assert.ok(error instanceof CampaignPlanError);
      assert.equal(error.code, CAMPAIGN_PLAN_INVALID);
      assert.match(error.message, /\$\.identity\.track/);
      assert.match(error.message, /\$\.batch\.firstBatchK1/);
      assert.equal(error.details.errors.length, 2);
      return true;
    },
  );
});

// --- shell compatibility (batch 16 slice 4): the v2 plan is a v1 VIEW ---

test('a valid v2 plan passes the shell validator through its v1 view', () => {
  const plan = fixturePlan();
  assert.deepEqual(validateCampaignRunPlan(plan), { valid: true, errors: [] });
  const view = normalizeCampaignRunPlan(plan);
  assert.equal(view.schemaVersion, 1);
  assert.equal(view.prNumber, 1181);
  assert.equal(view.language, 'java');
  assert.deepEqual(validateCampaignRunPlan(view), { valid: true, errors: [] });
});

test('a tag-triggered v2 plan is kernel-legal but refused typed by the shell', () => {
  const plan = fixturePlan();
  plan.trigger = { kind: 'tag', baselineTag: 'v2.6.25', targetTag: 'v3.0.25' };
  assert.equal(validateCampaignPlan(plan).valid, true);
  const validation = validateCampaignRunPlan(plan);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors[0].code, TRIGGER_UNSUPPORTED);
  assert.match(validation.errors[0].message, /tag/);
});
