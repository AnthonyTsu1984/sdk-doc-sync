'use strict';

// Batch 16 slice 2 (design §8/§9/§10 row 2): the campaign plan generator CLI,
// offline only. The golden section pins the generator's java v2.6.x / v3.0.x
// plans field-by-field against the hand templates' hardcoded constant blocks
// (the orchestrator edition of the "6 目录黄金比对"). The template sources are
// gitignored (.zcode/workflows/*.dwf.ts) and are NEVER read by this file —
// every dwf value below is a literal pinned at review time, each assertion
// citing its dwf file + line.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const {
  BUILD_CAMPAIGN_PLAN_PINNED_SCRIPT_MISSING,
  BUILD_CAMPAIGN_PLAN_REGISTRY,
  BUILD_CAMPAIGN_PLAN_TEMPLATE_MISSING,
  BuildCampaignPlanError,
  REVISION_INTAKE_SCRIPT,
  REVISION_TEMPLATE_PATH,
  TEMPLATE_PATH,
  runCli,
} = require('../scripts/build-campaign-plan');
const { assertValidCampaignPlan, planDigest, validateCampaignPlan } = require('../src/sdk-doc-sync/campaign-plan');
const { ReleaseTrackRegistryError } = require('../src/sdk-doc-sync/release-track-registry');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'build-campaign-plan.js');
const REAL_REGISTRY_PATH = path.resolve(__dirname, '..', 'config', 'release-tracks.json');
const REAL_INTAKE_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'build-reviewed-release-context.js');
const REAL_REVISION_INTAKE_SCRIPT = path.resolve(__dirname, '..', 'bin', 'revision-intake.js');

// --- dwf-extracted golden literals (sources are gitignored; pinned, not read) ---
// .zcode/workflows/java-v26-sync-campaign.dwf.ts (line):
//   32  CAMPAIGN_DIR = "tmp/sdk-release-scout/campaign-v26"
//   33  V26_BASE     = "Sbtcbm660abngWsXryKct5nOn2e"
//   34  V26_TABLE    = "tblCwLhDHim25oVt"
//   35  FEISHU_HOST  = "https://zilliverse.feishu.cn"
//   38  SCOPE_PATH default "tmp/sdk-release-scout/daily/2026-10-03-java-v26.json"
//   105-107  --sdk-dir repos/milvus-sdk-java · --sdk-name milvus-sdk-java · --sdk-version v2.6.x
//   430 admit phase prefix "java-v26-sync-"
//   469 cross-track seat compares v2.6.25 against the v3.0.x track (v3.0.10)
//   486 gate title "java v2.6.22→v2.6.25" (the campaign's tag range)
//   506 scout layer "9 条 UNMAPPED_CANONICAL_IDENTITY" warnings
//   651 batchCap = 40 · frontmatter:13 batchSize default 3
// .zcode/workflows/java-v30-campaign.dwf.ts (line):
//   32  CAMPAIGN_DIR = "tmp/sdk-release-scout/campaign-v30"
//   33  V30_BASE     = "AOFDbSmwma9XrNsLa8KcQgt9ngc"
//   34  V30_TABLE    = "tbl63oNrbGDCXorc"
//   38  SCOPE_PATH default "tmp/sdk-release-scout/daily/2026-10-03-java-v26.json"  ← copy-drift BUG
//   430 admit phase prefix still "java-v26-sync-"                                  ← copy-drift BUG
//   506 scout layer "9 条" (copied from v26)                                        ← copy-drift BUG
//   539 review prompt pins "v3.0.25" as the campaign target tag
const DWF = Object.freeze({
  V26_BASE: 'Sbtcbm660abngWsXryKct5nOn2e',
  V26_TABLE: 'tblCwLhDHim25oVt',
  V26_CAMPAIGN_DIR: 'tmp/sdk-release-scout/campaign-v26',
  V30_BASE: 'AOFDbSmwma9XrNsLa8KcQgt9ngc',
  V30_TABLE: 'tbl63oNrbGDCXorc',
  V30_CAMPAIGN_DIR: 'tmp/sdk-release-scout/campaign-v30',
  V30_DRIFT_SCOPE_DEFAULT: 'tmp/sdk-release-scout/daily/2026-10-03-java-v26.json',
  FEISHU_HOST: 'https://zilliverse.feishu.cn',
  SDK_DIR: 'repos/milvus-sdk-java',
});

// --- registry fixtures ---

function realRegistry() {
  return JSON.parse(fs.readFileSync(REAL_REGISTRY_PATH, 'utf8'));
}

// The real registry on file (2026-10-16) carries `bitable.tableId: null` for
// every track — the per-table tokens exist only inside the gitignored dwf
// sources. The generator is fail-closed on that gap (see the missing-field
// test), so the success/golden fixtures use the REAL registry bytes with ONLY
// the two java tableIds pinned from the dwf literals above.
function registryWithDwfTableIds() {
  const registry = realRegistry();
  const java = registry.languages.java.tracks;
  java.find((track) => track.version === 'v2.6.x').bitable.tableId = DWF.V26_TABLE; // dwf v26:34
  java.find((track) => track.version === 'v3.0.x').bitable.tableId = DWF.V30_TABLE; // dwf v30:34
  return registry;
}

const TEMPLATE_STUB = '// release-sync campaign template — slice 5 writes the real one\n'
  + 'export const PLACEHOLDER = "the generator only hashes these bytes";\n';

const REVISION_TEMPLATE_STUB = '// revision campaign template — slice 7 lands the real one\n'
  + 'export const PLACEHOLDER = "the generator only hashes these bytes";\n';

function sha256Of(content) {
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
}

function makeRepoRoot({ registry = registryWithDwfTableIds(), withTemplate = true, withRevisionTemplate = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-plan-builder-'));
  const skillRoot = path.join(root, '.claude', 'skills', 'api-reference-sync');
  fs.mkdirSync(path.join(skillRoot, 'config'), { recursive: true });
  fs.mkdirSync(path.join(skillRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(skillRoot, 'config', 'release-tracks.json'), `${JSON.stringify(registry, null, 2)}\n`);
  // The intake-assemble pin hashes the REAL script's bytes (copied verbatim),
  // so the pin can be asserted against an independently computed digest.
  fs.copyFileSync(REAL_INTAKE_SCRIPT, path.join(skillRoot, 'scripts', 'build-reviewed-release-context.js'));
  if (withTemplate) {
    fs.mkdirSync(path.join(skillRoot, 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(skillRoot, 'workflows', 'release-sync-campaign.dwf.ts'), TEMPLATE_STUB);
  }
  if (withRevisionTemplate) {
    // The revision kind pins the same way: template stub + the REAL intake bin
    // (copied verbatim) for the pinnedScripts digest assertion.
    fs.mkdirSync(path.join(skillRoot, 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(skillRoot, 'workflows', 'revision-campaign.dwf.ts'), REVISION_TEMPLATE_STUB);
    fs.mkdirSync(path.join(skillRoot, 'bin'), { recursive: true });
    fs.copyFileSync(REAL_REVISION_INTAKE_SCRIPT, path.join(skillRoot, 'bin', 'revision-intake.js'));
  }
  return root;
}

function runBuilder(argv, repoRoot) {
  const stdout = [];
  const stderr = [];
  const result = runCli({
    argv: ['node', 'scripts/build-campaign-plan.js', ...argv],
    repoRoot,
    dependencies: { onStdout: (line) => stdout.push(line), onStderr: (line) => stderr.push(line) },
  });
  return { result, stdout, stderr };
}

function goldenArgv(track, campaignDir, trigger) {
  return ['--identity', `java:milvus-sdk-java:${track}`, '--trigger', trigger, '--campaign-dir', campaignDir];
}

// --- golden comparison: java v2.6.x vs java-v26-sync-campaign.dwf.ts ---

test('golden java v2.6.x: every registry-sourced field matches the dwf constant block', () => {
  const root = makeRepoRoot();
  const { result, stdout } = runBuilder(
    goldenArgv('v2.6.x', DWF.V26_CAMPAIGN_DIR, 'tag:v2.6.22..v2.6.25'),
    root,
  );
  assert.equal(result.status, 'ok');
  const plan = result.plan;
  assert.deepEqual(validateCampaignPlan(plan), { valid: true, errors: [] });

  // feishu — the constants the generator exists to de-hardcode
  assert.equal(plan.feishu.host, DWF.FEISHU_HOST); // dwf v26:35 FEISHU_HOST
  assert.equal(plan.feishu.baseToken, DWF.V26_BASE); // dwf v26:33 V26_BASE === registry java/v2.6.x bitable.baseToken
  assert.equal(plan.feishu.tableId, DWF.V26_TABLE); // dwf v26:34 V26_TABLE (registry pin, fixture above)
  assert.equal(plan.feishu.rootToken, 'B1agfRbPglv4tpdTkjlcUMgVnRV'); // registry java/v2.6.x drive.releaseRoot.token — the dwf took ROOT_TOKEN from the operator at each write gate (dwf v26:763-767); design §5 migrates it into the plan

  // identity / trigger
  assert.deepEqual(plan.identity, { language: 'java', sdkName: 'milvus-sdk-java', track: 'v2.6.x' }); // dwf v26:105-107
  assert.deepEqual(plan.trigger, { kind: 'tag', baselineTag: 'v2.6.22', targetTag: 'v2.6.25' }); // dwf v26:486 "java v2.6.22→v2.6.25"
  assert.equal(plan.campaignId, 'java-v26-sync'); // dwf v26:430 admit prefix "java-v26-sync-" · <lang>-v<major><minor>-sync convention
  assert.equal(plan.kind, 'release-sync');
  assert.equal(plan.schemaVersion, 2);

  // paths — same campaignDir as the dwf (v26:32), converged layout beneath it.
  // sessionPath deliberately DIFFERS from dwf v26:30
  // (tmp/sdk-doc-sync-runs/java-v26/review-session.json): design §11.10 keys
  // every campaign path under the campaignDir, so parallel campaigns cannot
  // collide; scopePath deliberately DIFFERS from dwf v26:38's daily-scout
  // default: the scope artifact is campaign material, not a scout temp file.
  assert.equal(plan.paths.campaignDir, DWF.V26_CAMPAIGN_DIR); // dwf v26:32
  assert.equal(plan.paths.sdkDir, DWF.SDK_DIR); // dwf v26:105 --sdk-dir repos/milvus-sdk-java
  assert.equal(plan.paths.sessionPath, `${DWF.V26_CAMPAIGN_DIR}/session-state.json`);
  assert.equal(plan.paths.scopePath, `${DWF.V26_CAMPAIGN_DIR}/release-scope.json`);
  assert.equal(plan.paths.groupingPath, `${DWF.V26_CAMPAIGN_DIR}/grouping-proposal.json`);
  assert.equal(plan.paths.candidateSpecPath, `${DWF.V26_CAMPAIGN_DIR}/candidate-spec.json`);
  assert.equal(plan.paths.referenceContext, `${DWF.V26_CAMPAIGN_DIR}/reviewed-context.md`);
  assert.equal(plan.paths.targetsJson, `${DWF.V26_CAMPAIGN_DIR}/targets.json`);
  assert.equal(plan.paths.identityMap, '.claude/skills/api-reference-sync/references/identity/java-v26.json'); // intake chain REQUIRES_IDENTITY_MAP

  // run / terminal — the terminal the dwf templates did NOT have (dwf v26:947:
  // "close-session→scan-state 是操作员步骤, 本工作流不含")
  assert.equal(plan.run.journalPath, `${DWF.V26_CAMPAIGN_DIR}/execution-journal.jsonl`);
  assert.equal(plan.run.ledgerPath, 'tmp/api-reference-sync/daily-scan/pr-findings.jsonl');
  assert.equal(plan.run.freezeDir, 'tmp/api-reference-sync/campaign-freezes');
  assert.deepEqual(plan.terminal, {
    scanStateKey: 'java:v2.6.x',
    scanStateEntryPath: `${DWF.V26_CAMPAIGN_DIR}/scan-state-entry.json`,
  });
  assert.equal(plan.run.phases.length, 1);
  assert.equal(plan.run.phases[0].label, 'close-session');
  assert.deepEqual(plan.run.phases[0].argv, [
    'node',
    '.claude/skills/api-reference-sync/bin/sdk-review-session.js',
    'close-session',
    '--session', plan.paths.sessionPath,
    '--scan-state-key', 'java:v2.6.x',
    '--scan-state-entry', plan.terminal.scanStateEntryPath,
  ]);

  // batch / seats / notes / promptFacts
  assert.deepEqual(plan.batch, { defaultSize: 3, cap: 40, firstBatchK1: true }); // dwf frontmatter:13 default 3 · dwf v26:651 batchCap 40 · design §5 step 7 first-batch canary
  assert.deepEqual(plan.seats, { a1: { pagesPerWriter: 12, maxRounds: 3 }, a2: {}, a3: {} }); // design §7
  assert.deepEqual(plan.notes, { scoutWarnings: 0 }); // dwf v26:506 hardcoded THAT campaign's 9 warnings; the generator defaults to 0 = not yet known
  assert.deepEqual(plan.promptFacts, {
    sourceRevision: 'v2.6.25', // tag trigger → targetTag (the pin dwf v26:524 hardcodes as revision 6de3ccd…)
    createWhitelistNote: '',
    exemplarPath: '',
  });

  // crossTrack — adjacent newer track (registry order), <version>-latest form
  assert.equal(plan.crossTrack.peerTag, 'v3.0.x-latest'); // dwf v26:469 seat compares v2.6.25 against the v3.0.x track

  // template pins
  assert.equal(plan.template.path, TEMPLATE_PATH); // design §4 canonical tracked template
  assert.equal(plan.template.sha256, sha256Of(TEMPLATE_STUB));
  assert.equal(plan.template.pinnedScripts.intakeAssemble, sha256Of(fs.readFileSync(REAL_INTAKE_SCRIPT)));

  // stdout contract: exactly two lines — digest + next command
  assert.equal(stdout.length, 2);
  assert.equal(stdout[0], `planDigest ${planDigest(plan)}`);
  assert.match(stdout[0], /^planDigest sha256:[0-9a-f]{64}$/);
  assert.ok(stdout[1].startsWith('node .claude/skills/api-reference-sync/scripts/record-campaign-approval.js'), stdout[1]);
  for (const artifactPath of [plan.paths.scopePath, plan.paths.groupingPath, plan.paths.candidateSpecPath]) {
    assert.ok(stdout[1].includes(artifactPath), `next command must reference ${artifactPath}`);
  }
});

// --- golden comparison: java v3.0.x vs java-v30-campaign.dwf.ts ---

test('golden java v3.0.x: registry facts replace the v30 constants and the copy-drift bugs stay fixed', () => {
  const root = makeRepoRoot();
  const { result } = runBuilder(
    goldenArgv('v3.0.x', DWF.V30_CAMPAIGN_DIR, 'tag:v2.6.25..v3.0.25'),
    root,
  );
  assert.equal(result.status, 'ok');
  const plan = result.plan;
  assert.deepEqual(validateCampaignPlan(plan), { valid: true, errors: [] });

  assert.equal(plan.feishu.host, DWF.FEISHU_HOST); // dwf v30:35
  assert.equal(plan.feishu.baseToken, DWF.V30_BASE); // dwf v30:33 V30_BASE === registry java/v3.0.x bitable.baseToken
  assert.equal(plan.feishu.tableId, DWF.V30_TABLE); // dwf v30:34 V30_TABLE (registry pin, fixture above)
  assert.equal(plan.feishu.rootToken, 'C4Ckfsx5qlKHbnd5PVrcpxvTn2d'); // registry java/v3.0.x drive.releaseRoot.token (design §5: rootToken stops being an operator answer)

  assert.deepEqual(plan.identity, { language: 'java', sdkName: 'milvus-sdk-java', track: 'v3.0.x' });
  assert.deepEqual(plan.trigger, { kind: 'tag', baselineTag: 'v2.6.25', targetTag: 'v3.0.25' }); // dwf v30:539 pins v3.0.25 as the campaign target
  assert.equal(plan.campaignId, 'java-v30-sync'); // design §3 example / published report root
  assert.equal(plan.paths.campaignDir, DWF.V30_CAMPAIGN_DIR); // dwf v30:32
  assert.equal(plan.paths.sdkDir, DWF.SDK_DIR);

  // Copy-drift regression pin (design §1 bug #2): dwf v30:38's SCOPE_PATH
  // default still pointed at the V26 scope file while the v30 frontmatter
  // (v30:23) promised java-v30.json. The generated plan must scope v30 under
  // v30's OWN campaignDir — never the v26 file, never the scout daily dir.
  assert.equal(plan.paths.scopePath, `${DWF.V30_CAMPAIGN_DIR}/release-scope.json`);
  assert.ok(plan.paths.scopePath.startsWith(plan.paths.campaignDir));
  assert.notEqual(plan.paths.scopePath, DWF.V30_DRIFT_SCOPE_DEFAULT); // dwf v30:38 default
  assert.ok(!plan.paths.scopePath.includes('java-v26'));

  assert.deepEqual(plan.promptFacts, {
    sourceRevision: 'v3.0.25', // trigger-derived; dwf v30:539 hardcoded it (and bug #3 was a WRONG pin surviving a copy)
    createWhitelistNote: '',
    exemplarPath: '',
  });
  assert.equal(plan.crossTrack.peerTag, 'v2.6.x-latest'); // design §3 example value for java-v30-sync (adjacent older track: v3.0.x is newest)
  assert.deepEqual(plan.notes, { scoutWarnings: 0 }); // dwf v30:506 copied v26's "9 条" — not a v30 fact
  assert.equal(plan.template.pinnedScripts.intakeAssemble, sha256Of(fs.readFileSync(REAL_INTAKE_SCRIPT)));
});

// --- revision kind (batch 16 slice 7: design §10 row 7) ---

test('kind=revision generates a validating plan: six-key spine, revision template pin, units-mode next command', () => {
  const root = makeRepoRoot({ withRevisionTemplate: true });
  const campaignDir = 'tmp/sdk-release-scout/campaign-v30-revision';
  const { result, stdout } = runBuilder(
    ['--kind', 'revision', '--identity', 'java:milvus-sdk-java:v3.0.x', '--trigger', 'tag:v3.0.24..v3.0.25', '--campaign-dir', campaignDir],
    root,
  );
  assert.equal(result.status, 'ok');
  const plan = result.plan;
  assert.deepEqual(validateCampaignPlan(plan), { valid: true, errors: [] });
  assert.equal(plan.kind, 'revision');
  assert.equal(plan.campaignId, 'java-v30-revision'); // <lang>-v<major><minor>-revision convention (slice 7)
  assert.equal(plan.template.path, REVISION_TEMPLATE_PATH);
  assert.equal(plan.template.sha256, sha256Of(REVISION_TEMPLATE_STUB));
  // The B-4 pin follows the kind: the rev campaign freezes its intake bin.
  assert.equal(plan.template.pinnedScripts.intakeAssemble, sha256Of(fs.readFileSync(REAL_REVISION_INTAKE_SCRIPT)));

  // The seven-key revision spine (kernel REVISION_PATH_KEYS): the shared
  // trio keeps the release-sync basenames; the derived four follow the kernel
  // fixture vocabulary (contexts.json / manifest-projection.json /
  // contexts-spec.json / unit-digests.json) beneath the same campaignDir.
  assert.equal(plan.paths.campaignDir, campaignDir);
  assert.equal(plan.paths.sessionPath, `${campaignDir}/session-state.json`);
  assert.equal(plan.paths.scopePath, `${campaignDir}/release-scope.json`);
  assert.equal(plan.paths.contextsPath, `${campaignDir}/contexts.json`);
  assert.equal(plan.paths.manifestProjectionPath, `${campaignDir}/manifest-projection.json`);
  assert.equal(plan.paths.candidateSpecProjectionPath, `${campaignDir}/contexts-spec.json`);
  assert.equal(plan.paths.unitDigestsPath, `${campaignDir}/unit-digests.json`);

  // close-session: bin/revision-intake.js only CREATES a session (no
  // close-session subcommand — its header routes every later operation
  // through bin/sdk-review-session.js), so the terminal phase names the real
  // entry with the same argv shape as release-sync.
  assert.equal(plan.run.phases.length, 1);
  assert.equal(plan.run.phases[0].label, 'close-session');
  assert.deepEqual(plan.run.phases[0].argv, [
    'node',
    '.claude/skills/api-reference-sync/bin/sdk-review-session.js',
    'close-session',
    '--session', plan.paths.sessionPath,
    '--scan-state-key', 'java:v3.0.x',
    '--scan-state-entry', plan.terminal.scanStateEntryPath,
  ]);

  // The next command rides the ruled units-based (b) semantics: the
  // recorder's --unit-digests mode over the plan's unitDigestsPath.
  assert.equal(stdout.length, 2);
  assert.equal(stdout[0], `planDigest ${planDigest(plan)}`);
  assert.ok(stdout[1].includes('--unit-digests'), stdout[1]);
  assert.ok(stdout[1].includes(plan.paths.unitDigestsPath), stdout[1]);

  // --artifacts honors the per-kind allowlist: a rev key is overridable, a
  // release-sync-only key is a usage refusal.
  const overridden = runBuilder(
    ['--kind', 'revision', '--identity', 'java:milvus-sdk-java:v3.0.x', '--trigger', 'pr:1200', '--campaign-dir', campaignDir,
      '--artifacts', `contextsPath=${campaignDir}/materialized/contexts.json`],
    root,
  ).result.plan;
  assert.equal(overridden.paths.contextsPath, `${campaignDir}/materialized/contexts.json`);
  assert.equal(overridden.paths.unitDigestsPath, `${campaignDir}/unit-digests.json`);
  const refused = runBuilder(
    ['--kind', 'revision', '--identity', 'java:milvus-sdk-java:v3.0.x', '--trigger', 'pr:1200', '--campaign-dir', campaignDir,
      '--artifacts', 'sdkDir=repos/milvus-sdk-java'],
    root,
  );
  assert.deepEqual({ status: refused.result.status, exitCode: refused.result.exitCode }, { status: 'usage', exitCode: 64 });
});

test('revision plans are byte-deterministic across same-argument runs', () => {
  const root = makeRepoRoot({ withRevisionTemplate: true });
  const argv = ['--kind', 'revision', '--identity', 'java:milvus-sdk-java:v3.0.x', '--trigger', 'pr:1200', '--campaign-dir', 'tmp/sdk-release-scout/campaign-v30-revision'];
  const first = runBuilder(argv, root).result;
  const second = runBuilder(argv, root).result;
  assert.equal(JSON.stringify(first.plan), JSON.stringify(second.plan));
  assert.equal(first.digest, second.digest);
  assert.equal(planDigest(first.plan), planDigest(second.plan));
});

test('--kind: explicit release-sync equals the default; unknown/missing values are usage 64', () => {
  const root = makeRepoRoot();
  const base = goldenArgv('v2.6.x', 'tmp/sdk-release-scout/campaign-v26', 'pr:1181');
  const plain = runBuilder(base, root).result;
  const explicit = runBuilder([...base, '--kind', 'release-sync'], root).result;
  assert.equal(explicit.status, 'ok');
  assert.equal(explicit.plan.kind, 'release-sync');
  assert.equal(explicit.plan.template.path, TEMPLATE_PATH);
  assert.equal(JSON.stringify(explicit.plan), JSON.stringify(plain.plan));

  for (const bad of [['--kind', 'bad'], ['--kind', ''], ['--kind'], ['--kind', '--json']]) {
    const { result, stderr } = runBuilder([...base, ...bad], root);
    assert.deepEqual({ status: result.status, exitCode: result.exitCode }, { status: 'usage', exitCode: 64 }, bad.join(' '));
    assert.ok(stderr.join('\n').length > 0, 'a usage refusal explains itself');
  }
});

// --- kernel gate, digest, stdout/--json/--out contracts ---

test('a pr-triggered plan for a temp campaignDir validates, pins real bytes, and prints the two-line contract', () => {
  const root = makeRepoRoot();
  const campaignDir = path.join(root, 'tmp', 'campaign-pr');
  const { result, stdout } = runBuilder(
    ['--identity', 'java:milvus-sdk-java:v2.6.x', '--trigger', 'pr:1181', '--campaign-dir', campaignDir],
    root,
  );
  assert.equal(result.status, 'ok');
  const plan = result.plan;
  assert.doesNotThrow(() => assertValidCampaignPlan(plan));
  assert.deepEqual(plan.trigger, { kind: 'pr', prNumber: 1181 });
  assert.equal(plan.promptFacts.sourceRevision, 'pr-1181'); // pr trigger → pr-<N>
  assert.match(result.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(result.digest, planDigest(plan));
  assert.equal(plan.template.sha256, sha256Of(TEMPLATE_STUB));
  assert.equal(stdout.length, 2);
  assert.equal(stdout[0], `planDigest ${result.digest}`);
  assert.ok(stdout[1].includes(campaignDir));
});

test('--json emits a single JSON document with plan, digest, and nextCommands', () => {
  const root = makeRepoRoot();
  const { stdout, stderr } = runBuilder(
    [...goldenArgv('v2.6.x', 'tmp/sdk-release-scout/campaign-v26', 'pr:1181'), '--json'],
    root,
  );
  assert.equal(stderr.length, 0);
  assert.equal(stdout.length, 1);
  const envelope = JSON.parse(stdout[0]);
  assert.deepEqual(Object.keys(envelope).sort(), ['nextCommands', 'plan', 'planDigest']);
  assert.equal(envelope.planDigest, planDigest(envelope.plan));
  assert.match(envelope.planDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(envelope.nextCommands.length, 1);
  const [argv] = envelope.nextCommands;
  assert.ok(argv.includes('--scope') && argv.includes('--grouping') && argv.includes('--candidate-spec'));
  assert.ok(argv.includes(envelope.plan.paths.scopePath));
});

test('the same arguments produce byte-identical plans and the same digest', () => {
  const root = makeRepoRoot();
  const argv = [...goldenArgv('v2.6.x', 'tmp/sdk-release-scout/campaign-v26', 'tag:v2.6.22..v2.6.25')];
  const first = runBuilder(argv, root).result;
  const second = runBuilder(argv, root).result;
  assert.equal(JSON.stringify(first.plan), JSON.stringify(second.plan));
  assert.equal(first.digest, second.digest);
  // The envelope the operator quotes into APPROVE_CAMPAIGN is the digest, so a
  // re-run before approval must not move it.
  assert.equal(planDigest(first.plan), planDigest(second.plan));
});

test('without --run-nonce the plan carries no runNonce field (per-run nonce lives in dwf args)', () => {
  const root = makeRepoRoot();
  const argv = [...goldenArgv('v2.6.x', 'tmp/sdk-release-scout/campaign-v26', 'tag:v2.6.22..v2.6.25')];
  const { result, stderr } = runBuilder(argv, root);
  assert.equal(result.status, 'ok');
  // The field is bookkeeping, not a requirement: absent flag → absent field,
  // so the same-argument determinism contract above stays byte-exact.
  assert.ok(!('runNonce' in result.plan), 'runNonce must not be emitted without --run-nonce');
  assert.ok(!stderr.some((line) => line.includes('runNonce')), 'no nonce hint without --run-nonce');
});

test('--run-nonce stamps plan.runNonce, moves the digest, and hints the dwf args.nonce pairing', () => {
  const root = makeRepoRoot();
  const base = [...goldenArgv('v2.6.x', 'tmp/sdk-release-scout/campaign-v26', 'tag:v2.6.22..v2.6.25')];
  const plain = runBuilder(base, root).result;
  const { result: stamped, stderr } = runBuilder([...base, '--run-nonce', 'run-20261016-a'], root);
  assert.equal(stamped.status, 'ok');
  assert.equal(stamped.plan.runNonce, 'run-20261016-a');
  // The digest covers the WHOLE plan (unknown fields included), so the stamped
  // bookkeeping must move the envelope — a stale plan cannot pass as this run's.
  assert.notEqual(stamped.digest, plain.digest);
  assert.equal(stamped.digest, planDigest(stamped.plan));
  // Same nonce → byte-identical plan (bookkeeping, not a clock); different
  // nonce → different plan, so every re-stamp is a new envelope.
  const again = runBuilder([...base, '--run-nonce', 'run-20261016-a'], root).result;
  assert.equal(JSON.stringify(stamped.plan), JSON.stringify(again.plan));
  const other = runBuilder([...base, '--run-nonce', 'run-20261016-b'], root).result;
  assert.notEqual(JSON.stringify(stamped.plan), JSON.stringify(other.plan));
  // The hint names the pairing semantics: args.nonce is the per-run authority.
  assert.ok(stderr.some((line) => line.includes('runNonce stamped: run-20261016-a') && line.includes('args.nonce')), stderr.join('\n'));
});

test('--out writes the plan (2-space JSON + trailing newline) whose digest equals stdout', () => {
  const root = makeRepoRoot();
  const outPath = path.join(root, 'tmp', 'plans', 'java-v26-sync.json');
  const { result, stdout, stderr } = runBuilder(
    [...goldenArgv('v2.6.x', DWF.V26_CAMPAIGN_DIR, 'pr:1181'), '--out', outPath],
    root,
  );
  assert.equal(result.status, 'ok');
  const body = fs.readFileSync(outPath, 'utf8');
  assert.ok(body.endsWith('\n'));
  assert.equal(body, `${JSON.stringify(result.plan, null, 2)}\n`);
  const written = JSON.parse(body);
  assert.deepEqual(written, result.plan);
  assert.equal(planDigest(written), result.digest);
  assert.equal(stdout[0], `planDigest ${result.digest}`);
  assert.ok(stderr.some((line) => line.includes(outPath)), 'the write is reported on stderr, stdout stays two lines');
});

// --- --artifacts overrides ---

test('--artifacts overrides the named plan.paths keys only', () => {
  const root = makeRepoRoot();
  const { result } = runBuilder(
    [
      ...goldenArgv('v2.6.x', 'tmp/sdk-release-scout/campaign-v26', 'pr:1181'),
      '--artifacts', 'scopePath=tmp/sdk-release-scout/daily/2026-10-03-java-v26.json',
      '--artifacts', 'sdkDir=repos/custom-checkout',
    ],
    root,
  );
  const plan = result.plan;
  assert.equal(plan.paths.scopePath, 'tmp/sdk-release-scout/daily/2026-10-03-java-v26.json');
  assert.equal(plan.paths.sdkDir, 'repos/custom-checkout');
  // untouched layout keys keep the convention
  assert.equal(plan.paths.sessionPath, 'tmp/sdk-release-scout/campaign-v26/session-state.json');
  assert.equal(plan.paths.targetsJson, 'tmp/sdk-release-scout/campaign-v26/targets.json');
  // and the terminal phase tracks the (overridden) session path
  assert.ok(plan.run.phases[0].argv.includes(plan.paths.sessionPath));
});

test('--artifacts refuses unknown keys and malformed k=v with usage 64', () => {
  const root = makeRepoRoot();
  for (const bad of [
    ['--artifacts', 'feishu=oops'],
    ['--artifacts', 'campaignDir=tmp/elsewhere'],
    ['--artifacts', 'noequals-sign'],
    ['--artifacts', 'scopePath='],
  ]) {
    const { result, stderr } = runBuilder([...goldenArgv('v2.6.x', 'tmp/x', 'pr:1'), ...bad], root);
    assert.deepEqual({ status: result.status, exitCode: result.exitCode }, { status: 'usage', exitCode: 64 }, bad.join(' '));
    assert.ok(stderr.join('\n').length > 0, 'a usage refusal explains itself');
  }
});

// --- fail-closed registry behavior ---

test('a track missing from the registry is a typed fail-closed error', () => {
  const registry = realRegistry();
  registry.languages.java.tracks = registry.languages.java.tracks.filter((track) => track.version !== 'v2.6.x');
  const root = makeRepoRoot({ registry });
  assert.throws(
    () => runBuilder(goldenArgv('v2.6.x', 'tmp/x', 'pr:1181'), root),
    (error) => error instanceof ReleaseTrackRegistryError
      && error.code === 'TRACK_REGISTRY_TRACK_NOT_REGISTERED'
      && /java\/v2\.6\.x/.test(error.message),
  );
});

test('a registry field resolving to nothing is a typed error naming the field (real-registry gap pinned)', () => {
  // As of 2026-10-16 the REAL registry carries bitable.tableId: null for every
  // track (the table tokens lived only in the gitignored dwf sources). The
  // generator must refuse — a campaign pointed at a guessed write target is
  // not a campaign — and name exactly what is missing. Nulling explicitly (the
  // real value today) keeps this pin honest even after the registry fills the
  // field.
  const registry = realRegistry();
  for (const track of registry.languages.java.tracks) track.bitable.tableId = null;
  const root = makeRepoRoot({ registry });
  assert.throws(
    () => runBuilder(goldenArgv('v2.6.x', 'tmp/x', 'pr:1181'), root),
    (error) => error instanceof BuildCampaignPlanError
      && error.code === BUILD_CAMPAIGN_PLAN_REGISTRY
      && /bitable\.tableId/.test(error.message)
      && /fail-closed|refusing to guess/i.test(error.message),
  );
});

// --- fail-closed template / pin behavior ---

test('a missing template file is a typed error, not a hash of nothing', () => {
  const root = makeRepoRoot({ withTemplate: false });
  assert.throws(
    () => runBuilder(goldenArgv('v2.6.x', 'tmp/x', 'pr:1181'), root),
    (error) => error instanceof BuildCampaignPlanError
      && error.code === BUILD_CAMPAIGN_PLAN_TEMPLATE_MISSING
      && error.message.includes(TEMPLATE_PATH),
  );
});

test('a missing intake-assemble script cannot be pinned either', () => {
  const root = makeRepoRoot();
  fs.unlinkSync(path.join(root, '.claude', 'skills', 'api-reference-sync', 'scripts', 'build-reviewed-release-context.js'));
  assert.throws(
    () => runBuilder(goldenArgv('v2.6.x', 'tmp/x', 'pr:1181'), root),
    (error) => error instanceof BuildCampaignPlanError && error.code === BUILD_CAMPAIGN_PLAN_PINNED_SCRIPT_MISSING,
  );
});

// --- usage: trigger and identity shapes ---

test('malformed triggers are usage 64', () => {
  const root = makeRepoRoot();
  for (const trigger of ['pr:abc', 'pr:0', 'pr:-3', 'pr:', 'pr', 'tag:v1', 'tag:..v2', 'tag:v1..', 'tag:a..b..c', 'carrier:v1..v2', '']) {
    const { result } = runBuilder(['--identity', 'java:milvus-sdk-java:v2.6.x', '--trigger', trigger, '--campaign-dir', 'tmp/x'], root);
    assert.deepEqual({ status: result.status, exitCode: result.exitCode }, { status: 'usage', exitCode: 64 }, trigger);
  }
});

test('malformed identities are usage 64 — segment count and emptiness enforced', () => {
  const root = makeRepoRoot();
  for (const identity of ['java:v2.6.x', 'java:milvus-sdk-java:v2.6.x:extra', 'java::v2.6.x', 'java:milvus-sdk-java:', 'java:milvus-sdk-java', ':java:v2.6.x', 'java :milvus-sdk-java:v2.6.x', 'java:repos/../etc:v2.6.x']) {
    const { result } = runBuilder(['--identity', identity, '--trigger', 'pr:1181', '--campaign-dir', 'tmp/x'], root);
    assert.deepEqual({ status: result.status, exitCode: result.exitCode }, { status: 'usage', exitCode: 64 }, identity);
  }
});

test('a track that cannot root a campaignId is usage 64, not a guessed id', () => {
  // A REGISTERED track (requireTrack passes) whose version still cannot root
  // <lang>-v<major><minor>-sync — the derivation refuses instead of guessing.
  const registry = realRegistry();
  registry.languages.java.tracks.push({
    version: 'latest',
    bitable: { baseToken: 'FakeBaseForShapeTest0000000000000000', tableId: 'tblShapeTest000000' },
    drive: { configuredRootToken: 'FakeRootForShapeTest0000000000000', releaseRoot: { resolution: 'configured-root', token: 'FakeRootForShapeTest0000000000000' } },
  });
  const root = makeRepoRoot({ registry });
  const { result, stderr } = runBuilder(['--identity', 'java:milvus-sdk-java:latest', '--trigger', 'pr:1181', '--campaign-dir', 'tmp/x'], root);
  assert.deepEqual({ status: result.status, exitCode: result.exitCode }, { status: 'usage', exitCode: 64 });
  assert.match(stderr.join('\n'), /campaignId/);
});

test('missing required flags and unknown flags are usage 64', () => {
  const root = makeRepoRoot();
  const { result } = runBuilder(['--identity', 'java:milvus-sdk-java:v2.6.x', '--trigger', 'pr:1181'], root);
  assert.deepEqual({ status: result.status, exitCode: result.exitCode }, { status: 'usage', exitCode: 64 });
  const unknown = runBuilder(['--identity', 'java:milvus-sdk-java:v2.6.x', '--trigger', 'pr:1181', '--campaign-dir', 'tmp/x', '--wat'], root);
  assert.equal(unknown.result.exitCode, 64);
});

// --- entrypoint wiring (spawned process: shebang, exit codes, stderr codes) ---

test('spawned CLI: usage refusals exit 64 with the typed code on stderr; --help exits 0', () => {
  const missing = spawnSync(process.execPath, [SCRIPT, '--trigger', 'pr:1181', '--campaign-dir', 'tmp/x'], { encoding: 'utf8' });
  assert.equal(missing.status, 64, missing.stderr);
  assert.match(missing.stderr, /--identity is required/);

  const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: build-campaign-plan/);
});

test('spawned CLI: a registry gap exits 64 with the registry typed code on stderr', () => {
  const registry = realRegistry();
  registry.languages.go.tracks = registry.languages.go.tracks.filter((track) => track.version !== 'v3.0.x');
  const root = makeRepoRoot({ registry });
  const run = spawnSync(
    process.execPath,
    [SCRIPT, '--identity', 'go:milvus-sdk-go:v3.0.x', '--trigger', 'tag:v2.6.25..v3.0.25', '--campaign-dir', 'tmp/x', '--repo-root', root],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 64, run.stderr);
  assert.match(run.stderr, /TRACK_REGISTRY_TRACK_NOT_REGISTERED/);
  assert.ok(!fs.existsSync(path.join(root, 'tmp', 'x')), 'a refused generation writes nothing');
});
