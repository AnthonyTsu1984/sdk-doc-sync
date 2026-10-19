#!/usr/bin/env node
'use strict';

// Campaign plan v2 generator (batch 16 design §8, slice 2 / §10 row 2): turns
// a track identity + a trigger + a campaign directory into one validated,
// digest-stamped campaign plan JSON — the single parameterization surface of
// the batch 16 dwf orchestration (design §3). Every quantity the hand-copied
// dwf templates used to hardcode per campaign (java-v26-sync-campaign.dwf.ts /
// java-v30-campaign.dwf.ts: base token, table id, campaign dir, path layout)
// comes from HERE, so a new track campaign is a CLI invocation, not a 973-line
// copy that drifts (the v30 copy already drifted: its v30:38 scope default
// still points at the v26 scope file, v30:430 still admits under the
// `java-v26-sync-` prefix, v30:539 pins the wrong tag in the review prompt).
//
//   node scripts/build-campaign-plan.js \
//     --identity <lang>:<sdk>:<track> \
//     --trigger pr:<N> | tag:<baselineTag>..<targetTag> \
//     --campaign-dir <dir> \
//     [--kind release-sync|revision] \
//     [--artifacts k=v ...] [--out <file>] [--json] [--repo-root <dir>]
//     [--run-nonce <string>]
//
// --kind selects the campaign shape (batch 16 design §10 slice 7): the default
// `release-sync` keeps every byte of the slice 2 behavior; `revision` swaps
// the template pin, the campaignId suffix, and the paths spine (the six-key
// REVISION_PATH_KEYS shape of campaign-plan.js) while keeping the rest of the
// plan isomorphic.
// --run-nonce is OPTIONAL per-run bookkeeping (design §4: the nonce is per-run
// args injection into the dwf template; the plan field is a double-lock, not a
// requirement). When passed, it is stamped as plan.runNonce and the digest
// moves with it; when omitted, the field is NOT emitted, so two same-argument
// runs stay byte-identical. The dwf template fails closed only when a stamped
// plan.runNonce differs from the submitted args.nonce.
//
// Per-track facts (bitable.baseToken, bitable.tableId, drive.releaseRoot.token)
// are pulled from config/release-tracks.json by identity — never guessed. Any
// registry gap (unknown track, field resolving to nothing) is a typed
// fail-closed error, exit 64; so is a missing template or pinned script to
// hash: pinning a digest of a file that is not on disk would freeze a lie into
// the campaign (B-4). If the assembled plan somehow fails its own kernel
// validation (assertValidCampaignPlan), that is a GENERATOR bug, not operator
// data: exit 1.
//
// Exit codes: 0 plan generated · 1 generator bug (kernel rejected the plan it
// just assembled) · 64 usage / registry / template / pin errors.
// With --json, stdout is a single JSON document {plan, planDigest,
// nextCommands}; otherwise stdout is exactly two lines: the planDigest
// and the record-campaign-approval argv to run once the dry-run artifacts
// exist.
//
// Determinism contract: the same arguments always produce byte-identical plan
// JSON and the same digest. The generator reads no clock and NO environment —
// registry identity values are resolved against a closed empty env, so an
// {env:'VAR'} registry reference is refused (put the literal in the registry)
// rather than making the digest depend on the invoking shell.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { CampaignPlanError, assertValidCampaignPlan, planDigest } = require('../src/sdk-doc-sync/campaign-plan');
const {
  ReleaseTrackRegistryError,
  listLanguageTracks,
  loadReleaseTrackRegistry,
  requireTrack,
  trackBaseToken,
  trackReleaseRootToken,
  trackTableId,
} = require('../src/sdk-doc-sync/release-track-registry');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// Repo-root-relative constants of the release-sync shape. The template path is
// the canonical tracked template of design §4 (slice 5 writes it; until then
// generation fails closed naming the missing file instead of pinning a guess).
// REVISION_TEMPLATE_PATH is the slice 7 sibling under the same discipline: the
// revision template is parallel work, so --kind revision fails closed naming
// the missing file until it lands.
const TEMPLATE_PATH = '.claude/skills/api-reference-sync/workflows/release-sync-campaign.dwf.ts';
const REVISION_TEMPLATE_PATH = '.claude/skills/api-reference-sync/workflows/revision-campaign.dwf.ts';
// The kind enum, mirroring the kernel (campaign-plan.js CAMPAIGN_KINDS).
const CAMPAIGN_KINDS = Object.freeze(['release-sync', 'revision']);
const KIND_TEMPLATE_PATHS = Object.freeze({
  'release-sync': TEMPLATE_PATH,
  'revision': REVISION_TEMPLATE_PATH,
});
// The intake-assemble pin (B-4): the reviewed-context assembly script whose
// bytes the campaign freezes (task-specified: scripts/build-reviewed-release-context.js).
// The revision campaign freezes its own intake bin instead (slice 7): that bin
// CREATES the session only — its header routes every later operation (close
// included) through bin/sdk-review-session.js.
const INTAKE_ASSEMBLE_SCRIPT = '.claude/skills/api-reference-sync/scripts/build-reviewed-release-context.js';
const REVISION_INTAKE_SCRIPT = '.claude/skills/api-reference-sync/bin/revision-intake.js';
const REGISTRY_PATH = '.claude/skills/api-reference-sync/config/release-tracks.json';
const RECORD_APPROVAL_SCRIPT = '.claude/skills/api-reference-sync/scripts/record-campaign-approval.js';
const REVIEW_SESSION_SCRIPT = '.claude/skills/api-reference-sync/bin/sdk-review-session.js';
const LEDGER_PATH = 'tmp/api-reference-sync/daily-scan/pr-findings.jsonl';
const FREEZE_DIR = 'tmp/api-reference-sync/campaign-freezes';
// The Feishu host both hand templates agree on (java-v26:35 / java-v30:35,
// FEISHU_HOST) and the live doc links default to (index.js FEISHU_DOC_HOST
// default). A registry `host` field can replace this pin when one lands.
const FEISHU_HOST = 'https://zilliverse.feishu.cn';

// The generator is deterministic: identity references resolve against a closed
// environment, never process.env.
const CLOSED_ENV = Object.freeze({});

const BUILD_CAMPAIGN_PLAN_USAGE = 'BUILD_CAMPAIGN_PLAN_USAGE';
const BUILD_CAMPAIGN_PLAN_REGISTRY = 'BUILD_CAMPAIGN_PLAN_REGISTRY';
const BUILD_CAMPAIGN_PLAN_TEMPLATE_MISSING = 'BUILD_CAMPAIGN_PLAN_TEMPLATE_MISSING';
const BUILD_CAMPAIGN_PLAN_PINNED_SCRIPT_MISSING = 'BUILD_CAMPAIGN_PLAN_PINNED_SCRIPT_MISSING';
const BUILD_CAMPAIGN_PLAN_OUTPUT = 'BUILD_CAMPAIGN_PLAN_OUTPUT';

const USAGE_LINE = 'Usage: build-campaign-plan --identity <lang>:<sdk>:<track> --trigger pr:<N>|tag:<baseline>..<target> '
  + '--campaign-dir <dir> [--kind release-sync|revision] [--artifacts k=v ...] [--out <file>] [--json] '
  + '[--repo-root <dir>] [--run-nonce <string>]';

// --artifacts may override exactly these plan.paths keys; everything else in
// `paths` is derived. The overridable set is per-kind because the paths spine
// is per-kind (slice 7). Unknown keys are a usage error — an override of a
// name the schema does not carry would silently change nothing.
const ARTIFACT_PATH_KEYS = Object.freeze([
  'sdkDir', 'sessionPath', 'scopePath', 'groupingPath', 'candidateSpecPath', 'referenceContext', 'targetsJson', 'identityMap',
]);
const REVISION_ARTIFACT_PATH_KEYS = Object.freeze([
  'sessionPath', 'scopePath', 'contextsPath', 'manifestProjectionPath', 'candidateSpecProjectionPath', 'unitDigestsPath',
]);

function artifactKeysForKind(kind) {
  return kind === 'revision' ? REVISION_ARTIFACT_PATH_KEYS : ARTIFACT_PATH_KEYS;
}

// campaignId convention: `<lang>-v<major><minor>-sync` for release-sync and
// `<lang>-v<major><minor>-revision` for the revision shape (slice 7: e.g.
// java-v30-revision). This is the root the hand templates already use:
// java-v26-sync-campaign.dwf.ts:430 admits under `java-v26-sync-<nonce>`, and
// the design §3 example / published reports use `java-v30-sync`. Digits are
// pinned rather than the raw track string so the id cannot carry dots (the
// kernel's CAMPAIGN_ID_PATTERN would allow them, but the report/admit-prefix
// root has always been dot-free).
const TRACK_VERSION_PATTERN = /^v(\d+)\.(\d+)/;
const KIND_CAMPAIGN_ID_SUFFIXES = Object.freeze({ 'release-sync': 'sync', 'revision': 'revision' });

class BuildCampaignPlanError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BuildCampaignPlanError';
    this.code = code;
    this.details = details;
  }
}

// Internal: contract violations are usage (exit 64) but reported as a RETURN
// from runCli (house style of campaign-settle), so parseArgs signals them
// through this class and runCli converts them.
class UsageError extends Error {}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function flagValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const args = { artifacts: [], kind: 'release-sync' };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--identity') args.identity = flagValue(argv, ++index, '--identity');
    else if (arg === '--trigger') args.trigger = flagValue(argv, ++index, '--trigger');
    else if (arg === '--campaign-dir') args.campaignDir = flagValue(argv, ++index, '--campaign-dir');
    else if (arg === '--kind') args.kind = flagValue(argv, ++index, '--kind');
    else if (arg === '--artifacts') args.artifacts.push(flagValue(argv, ++index, '--artifacts'));
    else if (arg === '--run-nonce') args.runNonce = flagValue(argv, ++index, '--run-nonce');
    else if (arg === '--out') args.out = flagValue(argv, ++index, '--out');
    else if (arg === '--repo-root') args.repoRoot = flagValue(argv, ++index, '--repo-root');
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new UsageError(`unknown argument: ${arg}`);
  }
  return args;
}

function printUsage(out) {
  out(USAGE_LINE);
}

// --identity <lang>:<sdk>:<track>: exactly three non-empty colon segments.
// The sdk segment becomes a path segment (repos/<sdk>), so path-hostile
// characters are refused here rather than poisoning plan.paths.
function parseIdentity(raw) {
  const value = String(raw ?? '');
  const segments = value.split(':');
  if (segments.length !== 3 || segments.some((segment) => segment.trim() === '')) {
    throw new UsageError(`--identity must be <lang>:<sdk>:<track>, three non-empty colon segments (got ${JSON.stringify(raw)})`);
  }
  const [language, sdkName, track] = segments;
  if (/\s/.test(language) || /\s/.test(sdkName) || /\s/.test(track)) {
    throw new UsageError('--identity segments must not contain whitespace');
  }
  if (/[/\\]|\.\./.test(sdkName)) {
    throw new UsageError(`--identity sdk segment becomes repos/<sdk> and must be a plain path segment (got ${JSON.stringify(sdkName)})`);
  }
  return { language, sdkName, track };
}

// --kind release-sync|revision: the campaign shape selector (slice 7). The
// default is applied in parseArgs, so an omitted flag and `--kind release-sync`
// are the same plan; any other value is usage — a misspelled kind must never
// silently generate a release-sync plan.
function parseKind(raw) {
  const value = String(raw ?? '');
  if (!CAMPAIGN_KINDS.includes(value)) {
    throw new UsageError(`--kind must be one of ${CAMPAIGN_KINDS.join('|')} (got ${JSON.stringify(raw)})`);
  }
  return value;
}

// --trigger pr:<N> → {kind:'pr', prNumber} · tag:<baseline>..<target> →
// {kind:'tag', baselineTag, targetTag}. Anything else is usage. Git tags
// cannot contain '..', so a two-way split on '..' is an exact parse.
function parseTrigger(raw) {
  const value = String(raw ?? '');
  const colon = value.indexOf(':');
  const kind = colon < 0 ? '' : value.slice(0, colon);
  const rest = colon < 0 ? '' : value.slice(colon + 1);
  if (kind === 'pr') {
    if (!/^[1-9][0-9]*$/.test(rest)) {
      throw new UsageError(`--trigger pr:<positive integer> required (got ${JSON.stringify(raw)})`);
    }
    return { kind: 'pr', prNumber: Number(rest) };
  }
  if (kind === 'tag') {
    const parts = rest.split('..');
    if (parts.length !== 2 || parts.some((part) => part === '' || /\s/.test(part))) {
      throw new UsageError(`--trigger tag:<baselineTag>..<targetTag> required (got ${JSON.stringify(raw)})`);
    }
    return { kind: 'tag', baselineTag: parts[0], targetTag: parts[1] };
  }
  throw new UsageError(`--trigger must be pr:<N> or tag:<baseline>..<target> (got ${JSON.stringify(raw)})`);
}

// Forward-slash join that preserves the campaignDir spelling the operator gave
// (absolute tmp dirs and repo-relative conventions both round-trip byte-exact).
function joinPath(dir, file) {
  const trimmed = String(dir).replace(/\/+$/, '');
  return trimmed === '' ? file : `${trimmed}/${file}`;
}

function sha256File(absolutePath, { code, label }) {
  let content;
  try {
    content = fs.readFileSync(absolutePath);
  } catch (error) {
    throw new BuildCampaignPlanError(code, `${label} is not readable at ${absolutePath}: ${error.message}`, { path: absolutePath });
  }
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
}

// crossTrack.peerTag: the adjacent track's moving tag `<version>-latest` (the
// design §3 example value for java-v30-sync is exactly `v2.6.x-latest`), or
// null for a single-track language. The registry orders tracks oldest-first
// and pins adjacency implicitly in that order (release-tracks.json comment;
// release-track-registry.js adjacentTracks). The seat compares against the
// NEIGHBORING track: the next-newer one when it exists — the direction the
// hand template actually used (java-v26's seat compared v2.6.25 against the
// v3.0.x track, java-v26:469) — falling back to the nearest older track at the
// top of the order.
function derivePeerTag(registry, language, track) {
  const tracks = listLanguageTracks(registry, language);
  const index = tracks.findIndex((entry) => entry.version === track);
  if (index < 0) return null; // unreachable: requireTrack already ran
  const newer = tracks.slice(index + 1);
  const older = tracks.slice(0, index).reverse();
  const peer = newer[0] || older[0] || null;
  return peer ? `${peer.version}-latest` : null;
}

function campaignIdFor(language, track, kind = 'release-sync') {
  const suffix = KIND_CAMPAIGN_ID_SUFFIXES[kind];
  const match = TRACK_VERSION_PATTERN.exec(track);
  if (!match) {
    throw new UsageError(`--identity track ${JSON.stringify(track)} must start with v<major>.<minor> to root a campaignId of the form <lang>-v<major><minor>-${suffix} (java-v26-sync / java-v30-revision convention)`);
  }
  return `${language}-v${match[1]}${match[2]}-${suffix}`;
}

// The per-track identity map the intake chain's candidate-spec/grouping stages
// resolve symbols through (intake-plan.js REQUIRES_IDENTITY_MAP). Same
// v<major><minor> root as campaignIdFor, repo-root-relative like every other
// plan.paths value (intake-assemble resolves it against the process cwd).
function identityMapPathFor(identity) {
  const match = TRACK_VERSION_PATTERN.exec(identity.track);
  if (!match) {
    throw new UsageError(`--identity track ${JSON.stringify(identity.track)} must start with v<major>.<minor> to name a per-track identity map (references/identity/<lang>-v<major><minor>.json)`);
  }
  return `.claude/skills/api-reference-sync/references/identity/${identity.language}-v${match[1]}${match[2]}.json`;
}

function parseArtifacts(values, allowedKeys = ARTIFACT_PATH_KEYS) {
  const overrides = new Map();
  for (const raw of values) {
    const eq = raw.indexOf('=');
    if (eq <= 0) {
      throw new UsageError(`--artifacts must be k=v (got ${JSON.stringify(raw)}); allowed keys: ${allowedKeys.join(', ')}`);
    }
    const key = raw.slice(0, eq);
    const value = raw.slice(eq + 1);
    if (!allowedKeys.includes(key)) {
      throw new UsageError(`--artifacts key ${JSON.stringify(key)} is not a plan.paths field of this kind; allowed keys: ${allowedKeys.join(', ')}`);
    }
    if (!nonEmptyString(value)) {
      throw new UsageError(`--artifacts ${key}=<path> requires a non-empty value`);
    }
    overrides.set(key, value);
  }
  return overrides;
}

function buildCampaignPlan({ identity, trigger, registry, campaignDir, kind = 'release-sync', artifactOverrides = new Map(), repoRoot = PROJECT_ROOT, runNonce = null }) {
  const track = requireTrack(registry, identity.language, identity.track);
  const scanStateKey = `${identity.language}:${identity.track}`;
  const campaignId = campaignIdFor(identity.language, identity.track, kind);

  // The campaignDir layout is a convention, not operator input: one directory
  // (keyed by campaignId per design §11.10) holds every artifact of the
  // campaign. This deliberately CONVERGES the hand templates' scattered paths
  // (session in tmp/sdk-doc-sync-runs/<track>/, context in the scout daily
  // dir) — and fixes the v30:38 copy-drift where the scope default still
  // pointed at the v26 scope file.
  //
  // Revision spine (slice 7): the three shared keys keep the release-sync
  // basenames; the derived trio carries the rev intake surfaces — contextsPath
  // is the reviewed-contexts document bin/revision-intake.js consumes
  // (--contexts), manifestProjectionPath is the reviewUnitManifest projection,
  // unitDigestsPath is the file scripts/revision-unit-digests.js writes
  // (--out) and record-campaign-approval reads back (--unit-digests). The
  // basenames follow the kernel's revision-spine fixture vocabulary
  // (campaign-plan.test.js: contexts.json / manifest-projection.json /
  // unit-digests.json).
  const paths = kind === 'revision' ? {
    campaignDir,
    sessionPath: joinPath(campaignDir, 'session-state.json'),
    scopePath: joinPath(campaignDir, 'release-scope.json'),
    contextsPath: joinPath(campaignDir, 'contexts.json'),
    manifestProjectionPath: joinPath(campaignDir, 'manifest-projection.json'),
    candidateSpecProjectionPath: joinPath(campaignDir, 'contexts-spec.json'),
    unitDigestsPath: joinPath(campaignDir, 'unit-digests.json'),
  } : {
    sdkDir: `repos/${identity.sdkName}`,
    campaignDir,
    sessionPath: joinPath(campaignDir, 'session-state.json'),
    scopePath: joinPath(campaignDir, 'release-scope.json'),
    groupingPath: joinPath(campaignDir, 'grouping-proposal.json'),
    candidateSpecPath: joinPath(campaignDir, 'candidate-spec.json'),
    referenceContext: joinPath(campaignDir, 'reviewed-context.md'),
    targetsJson: joinPath(campaignDir, 'targets.json'),
    identityMap: identityMapPathFor(identity),
  };
  for (const [key, value] of artifactOverrides) paths[key] = value;

  const terminal = {
    scanStateKey,
    scanStateEntryPath: joinPath(campaignDir, 'scan-state-entry.json'),
  };

  const plan = {
    schemaVersion: 2,
    campaignId,
    kind,
    template: {
      path: KIND_TEMPLATE_PATHS[kind],
      sha256: null, // pinned below, before validation
      pinnedScripts: {
        intakeAssemble: null, // pinned below
      },
    },
    identity: {
      language: identity.language,
      sdkName: identity.sdkName,
      track: identity.track,
    },
    trigger,
    feishu: null, // registry facts, filled below
    paths,
    run: {
      journalPath: joinPath(campaignDir, 'execution-journal.jsonl'),
      ledgerPath: LEDGER_PATH,
      freezeDir: FREEZE_DIR,
      phases: [{
        label: 'close-session',
        // Terminal wiring of design §5 step 8 / §6: close-session advances the
        // scan-state watermark (--scan-state-key/--scan-state-entry), with the
        // session path pointing at THIS campaign's session-state.json so two
        // campaigns can never close each other's session. BOTH kinds use this
        // entry: bin/revision-intake.js only CREATES a session (it has no
        // close-session subcommand — its header routes every later operation
        // through bin/sdk-review-session.js, whose COMMAND_REQUIREMENTS pin
        // close-session to --scan-state-key/--scan-state-entry).
        argv: [
          'node',
          REVIEW_SESSION_SCRIPT,
          'close-session',
          '--session', paths.sessionPath,
          '--scan-state-key', terminal.scanStateKey,
          '--scan-state-entry', terminal.scanStateEntryPath,
        ],
      }],
    },
    terminal,
    // Canary discipline: default batch of three (hand templates' batchSize
    // default, java-v26:13), capped at the hand templates' batchCap = 40
    // (java-v26:651), first batch K=1 (design §5 step 7 "首批 K 可 canary").
    batch: { defaultSize: 3, cap: 40, firstBatchK1: true },
    crossTrack: { peerTag: derivePeerTag(registry, identity.language, identity.track) },
    // Three-seat shape of design §7: A1 writing fan-out, A2/A3 single-seat.
    seats: {
      a1: { pagesPerWriter: 12, maxRounds: 3 },
      a2: {},
      a3: {},
    },
    // Per-campaign scout facts default to zero here: the "9 条
    // UNMAPPED_CANONICAL_IDENTITY" of the java-v26:506 / java-v30:506 prompts
    // was THAT campaign's scan result, hardcoding it into every future
    // campaign is exactly bug #7 of design §1. The operator updates the count
    // from the campaign's actual scout run (a plan edit is a new digest, so
    // the gate sees it).
    notes: { scoutWarnings: 0 },
    // sourceRevision is trigger-derived: the revision the reviewed context and
    // the independent verifier must pin (the hand templates hardcoded it and
    // the v30 copy kept the v26 pin — bug #3, java-v30:539).
    promptFacts: {
      sourceRevision: trigger.kind === 'pr' ? `pr-${trigger.prNumber}` : trigger.targetTag,
      createWhitelistNote: '',
      exemplarPath: '',
    },
  };

  // Per-track Feishu facts from the registry — the whole point of slice 2
  // (design §8: kill the hardcoded V26_BASE/V30_BASE). Fail-closed on ANY gap:
  // a campaign pointed at a guessed base/root would write into the wrong tree.
  const facts = [
    ['bitable.baseToken', trackBaseToken(track, CLOSED_ENV)],
    ['bitable.tableId', trackTableId(track, CLOSED_ENV)],
    ['drive.releaseRoot.token', trackReleaseRootToken(track, CLOSED_ENV)],
  ];
  const missing = facts.filter(([, value]) => !nonEmptyString(value)).map(([name]) => name);
  if (missing.length > 0) {
    throw new BuildCampaignPlanError(
      BUILD_CAMPAIGN_PLAN_REGISTRY,
      `release track registry entry ${identity.language}/${identity.track} has no usable ${missing.join(', ')} `
      + `(null, absent, or an {env:...} reference — the generator reads no environment by design). `
      + `Register the literal in ${REGISTRY_PATH} and retry; refusing to guess a campaign's write target.`,
      { language: identity.language, track: identity.track, missing },
    );
  }
  plan.feishu = {
    host: FEISHU_HOST,
    baseToken: trackBaseToken(track, CLOSED_ENV),
    tableId: trackTableId(track, CLOSED_ENV),
    rootToken: trackReleaseRootToken(track, CLOSED_ENV),
  };

  // Optional per-run bookkeeping (design §4): --run-nonce stamps plan.runNonce
  // so a per-run re-generated plan double-locks against the dwf args.nonce.
  // Omitted flag → the field is NOT emitted (byte-determinism of same-argument
  // runs is preserved); the digest covers the whole plan either way, so a
  // stamped runNonce always moves the digest.
  if (nonEmptyString(runNonce)) {
    plan.runNonce = runNonce;
  }

  // B-4 pins: the template and the intake script are hashed from the bytes
  // ACTUALLY on disk. A missing file is a typed error — a pinned digest of a
  // file that does not exist would freeze a lie into the campaign. The intake
  // pin follows the kind: release-sync freezes the reviewed-context assembler,
  // revision freezes bin/revision-intake.js (the session creation entry the
  // rev campaign runs first).
  const pinnedIntakeScript = kind === 'revision' ? REVISION_INTAKE_SCRIPT : INTAKE_ASSEMBLE_SCRIPT;
  plan.template.sha256 = sha256File(path.join(repoRoot, KIND_TEMPLATE_PATHS[kind]), {
    code: BUILD_CAMPAIGN_PLAN_TEMPLATE_MISSING,
    label: `campaign template (plan.template.path ${KIND_TEMPLATE_PATHS[kind]})`,
  });
  plan.template.pinnedScripts.intakeAssemble = sha256File(path.join(repoRoot, pinnedIntakeScript), {
    code: BUILD_CAMPAIGN_PLAN_PINNED_SCRIPT_MISSING,
    label: `pinned intake script (${pinnedIntakeScript})`,
  });

  // The generator's own kernel gate: a plan that cannot validate is a
  // GENERATOR bug (exit 1 at the entrypoint), never shipped as data.
  assertValidCampaignPlan(plan);
  return plan;
}

// Minimal single-arg quoting for the printed next-step line (paths in this
// repo carry no spaces; tmpdir paths do not either — quoting is safety net).
function shellArg(value) {
  return /\s|'/.test(value) ? `'${String(value).replace(/'/g, `'\\''`)}'` : String(value);
}

function recordApprovalArgv(plan) {
  // Slice 7 ruling (campaign-plan.js header): the revision kind is open under
  // the same units-based (b) semantics as release-sync — the approval
  // envelope's batch component IS the combined digest of the sorted unit set.
  // The printed next command is the recorder's --unit-digests mode with all
  // three chains named: grouping = the reviewUnitManifest projection, and
  // candidate-spec = the CONTEXTS SPECIFICATION projection (content bytes
  // stripped — bound by the units' batchDigest instead, review P1-1 / P0-1).
  // The spec-projection file is produced by the template's step 7 before the
  // gate; the printed argv names its plan-keyed path (candidateSpecProjectionPath).
  if (plan.kind === 'revision') {
    return [
      'node',
      RECORD_APPROVAL_SCRIPT,
      '--scope', plan.paths.scopePath,
      '--grouping', plan.paths.manifestProjectionPath,
      '--candidate-spec', plan.paths.candidateSpecProjectionPath,
      '--unit-digests', plan.paths.unitDigestsPath,
    ];
  }
  // The batch digest does not exist yet at generation time: it comes from the
  // initial full dry-run (design §5 step 5), so the argv carries an explicit
  // placeholder the operator/template replaces — never a fabricated digest.
  return [
    'node',
    RECORD_APPROVAL_SCRIPT,
    '--scope', plan.paths.scopePath,
    '--grouping', plan.paths.groupingPath,
    '--candidate-spec', plan.paths.candidateSpecPath,
    '--batch-digest', '<sha256:initial-dry-run-batch-digest>',
  ];
}

function runCli({ argv = process.argv, repoRoot = PROJECT_ROOT, dependencies = {} } = {}) {
  const out = dependencies.onStdout || ((line) => console.log(line));
  const err = dependencies.onStderr || ((line) => console.error(line));

  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    err(`Error: ${error.message}`);
    printUsage(err);
    return { status: 'usage', exitCode: 64 };
  }
  if (parsed.help) {
    printUsage(out);
    return { status: 'help', exitCode: 0 };
  }
  for (const required of ['identity', 'trigger', 'campaignDir']) {
    if (!nonEmptyString(parsed[required])) {
      err(`Error: --${required === 'campaignDir' ? 'campaign-dir' : required} is required`);
      printUsage(err);
      return { status: 'usage', exitCode: 64 };
    }
  }

  let identity;
  let trigger;
  let artifactOverrides;
  let kind;
  try {
    kind = parseKind(parsed.kind);
    identity = parseIdentity(parsed.identity);
    trigger = parseTrigger(parsed.trigger);
    artifactOverrides = parseArtifacts(parsed.artifacts, artifactKeysForKind(kind));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    err(`Error: ${error.message}`);
    printUsage(err);
    return { status: 'usage', exitCode: 64 };
  }

  const root = path.resolve(parsed.repoRoot || repoRoot);
  const registry = loadReleaseTrackRegistry(path.join(root, REGISTRY_PATH), { env: CLOSED_ENV });

  let plan;
  try {
    plan = buildCampaignPlan({
      identity,
      trigger,
      registry,
      campaignDir: parsed.campaignDir,
      kind,
      artifactOverrides,
      repoRoot: root,
      runNonce: nonEmptyString(parsed.runNonce) ? parsed.runNonce : null,
    });
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    // e.g. a track that cannot root a campaignId (campaignIdFor) is an input
    // shape problem, so it reports as usage like its siblings.
    err(`Error: ${error.message}`);
    printUsage(err);
    return { status: 'usage', exitCode: 64 };
  }

  const digest = planDigest(plan);
  const nextCommands = [recordApprovalArgv(plan)];

  if (parsed.out) {
    const outPath = path.resolve(parsed.out);
    const body = `${JSON.stringify(plan, null, 2)}\n`;
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, body);
    } catch (error) {
      throw new BuildCampaignPlanError(BUILD_CAMPAIGN_PLAN_OUTPUT, `--out ${parsed.out} is not writable: ${error.message}`, { path: outPath });
    }
    err(`campaign plan written: ${outPath}`);
  }
  // The nonce hint only appears when the bookkeeping field is actually stamped
  // (the dwf args.nonce is the per-run authority; plan.runNonce is the
  // optional double-lock it must match when present).
  if (plan.runNonce !== undefined) {
    err(`plan.runNonce stamped: ${plan.runNonce} — submit the dwf with args.nonce equal to it (or regenerate per run)`);
  }

  if (parsed.json) {
    out(JSON.stringify({ plan, planDigest: digest, nextCommands }, null, 2));
  } else {
    out(`planDigest ${digest}`);
    out(nextCommands[0].map(shellArg).join(' '));
  }

  return { status: 'ok', exitCode: 0, plan, digest, nextCommands, outPath: parsed.out ? path.resolve(parsed.out) : null };
}

if (require.main === module) {
  try {
    const result = runCli({ argv: process.argv });
    process.exit(result && Number.isInteger(result.exitCode) ? result.exitCode : 0);
  } catch (error) {
    process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.message}\n`);
    if (error instanceof CampaignPlanError) process.exit(1); // the generator built a plan its own kernel rejects
    if (error instanceof BuildCampaignPlanError || error instanceof ReleaseTrackRegistryError) process.exit(64);
    process.exit(1);
  }
}

module.exports = {
  ARTIFACT_PATH_KEYS,
  BUILD_CAMPAIGN_PLAN_OUTPUT,
  BUILD_CAMPAIGN_PLAN_PINNED_SCRIPT_MISSING,
  BUILD_CAMPAIGN_PLAN_REGISTRY,
  BUILD_CAMPAIGN_PLAN_TEMPLATE_MISSING,
  BUILD_CAMPAIGN_PLAN_USAGE,
  BuildCampaignPlanError,
  CAMPAIGN_KINDS,
  FEISHU_HOST,
  REVISION_INTAKE_SCRIPT,
  REVISION_TEMPLATE_PATH,
  TEMPLATE_PATH,
  buildCampaignPlan,
  parseArgs,
  parseIdentity,
  parseTrigger,
  printUsage,
  runCli,
};
