'use strict';

// Intake assembly plan (batch 18 step 1). One campaign = one ordered list of
// canonical stage invocations, derived from config/intake-profiles.json
// (per-language facts) plus the per-campaign artifact paths. Pure and
// side-effect free: it names the stages and their script arguments; it never
// runs them — execution (`--run`) lands in a later slice, once the plan is
// validated against the six existing per-campaign intake directories (batch 18
// §9 step 2).
//
// Every campaign's intake was hand-assembled from a heap of bespoke scripts
// (compose-decisions.js / compose-candidate-spec.js / build-*-decisions.js /
// fix-*.js / patch-*.js). This module is the canonical replacement: the chain
// order and the per-language facts live in data, the argv construction lives
// here, and a campaign's campaign-specific decisions stay an explicit input.

const KNOWN_LANGUAGES = Object.freeze(['cpp', 'node', 'python', 'java', 'go', 'rust']);
const KNOWN_ROUTES = Object.freeze(['verbatim', 'structured']);

// Canonical stage order. Provisional until validated against the six intake
// directories (batch 18 §9 step 2): the reviewed context emits the of-record
// filtered scope, so grouping consumes it; the dry-run is last.
const STAGE_ORDER = Object.freeze([
  'dump-pr-pages',
  'placement-audit',
  'candidate-spec',
  'reviewed-context',
  'grouping-proposal',
  'intake-preflight',
  'dry-run',
]);

// Per-stage artifact contract: what a stage reads and what it writes. The
// plan refuses a campaign that does not supply every consumed artifact, so a
// half-assembled intake fails loudly instead of running with empty paths.
const STAGE_IO = Object.freeze({
  'dump-pr-pages': { consumes: ['decisions'], produces: ['pagesDir'] },
  'placement-audit': { consumes: ['scope'], produces: ['placementAudit', 'rootWalk'] },
  'candidate-spec': { consumes: ['decisions', 'pagesDir', 'placementAudit', 'rootWalk', 'scope'], produces: ['candidateSpec'] },
  'reviewed-context': { consumes: ['candidateSpec', 'scope'], produces: ['filteredScope', 'reviewedContext'] },
  'grouping-proposal': { consumes: ['filteredScope', 'decisions'], produces: ['groupingProposal'] },
  'intake-preflight': { consumes: ['reviewedContext'], produces: [] },
  'dry-run': { consumes: ['reviewedContext', 'filteredScope'], produces: ['session'] },
});

const ARTIFACT_KEYS = Object.freeze([
  'decisions', 'scope', 'pagesDir', 'placementAudit', 'rootWalk',
  'candidateSpec', 'filteredScope', 'reviewedContext', 'groupingProposal', 'session',
  // categoryCreates: OPTIONAL per-campaign category-create plan (placement
  // ruling: a changed page whose target folder is missing in this track gets
  // CREATE_FOLDER → COPY_PATCH_AND_REPOINT → REPOINT_CATEGORY_VIRTUAL_NODE).
  // The composer emits folder-create resources ONLY when this plan is supplied
  // (compose-pr-reconcile-candidate-spec.js: resources: [] without it), so a
  // wave that needs folder creates MUST carry it; waves that do not leave it
  // out. Not in STAGE_IO.consumes: the chain would otherwise demand it for
  // every language.
  'categoryCreates',
]);

// Stages whose scripts hard-require --identity-map (build-grouping-proposal.js,
// compose-pr-reconcile-candidate-spec.js). The plan refuses a campaign without
// it rather than emitting a bare flag.
const REQUIRES_IDENTITY_MAP = Object.freeze(new Set(['candidate-spec', 'grouping-proposal']));

class IntakePlanError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IntakePlanError';
    this.code = code;
    this.details = details;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// Profile validation (`--profile-check` and every plan build). Fail-closed:
// an unknown key, a missing required fact, or a malformed language entry loads
// as a typed error and the assemble refuses to run.
function validateIntakeProfile(profile) {
  const errors = [];
  const fail = (where, message) => errors.push({ code: 'INTAKE_PROFILE_INVALID', path: where, message });

  if (!isPlainObject(profile)) {
    throw new IntakePlanError('INTAKE_PROFILE_INVALID', 'intake profile must be an object');
  }
  if (profile.profileVersion !== 1) fail('profileVersion', 'must be 1');
  if (!isPlainObject(profile.shared)) {
    fail('shared', 'must be an object');
  } else {
    if (!nonEmptyString(profile.shared.webContentRepo)) fail('shared.webContentRepo', 'required');
    if (!nonEmptyString(profile.shared.webContentDir)) fail('shared.webContentDir', 'required');
  }
  if (!isPlainObject(profile.languages) || Object.keys(profile.languages).length === 0) {
    fail('languages', 'must declare at least one language');
    throw new IntakePlanError('INTAKE_PROFILE_INVALID', 'intake profile is invalid', { errors });
  }
  const order = profile.stageOrder ?? STAGE_ORDER;
  if (!Array.isArray(order) || order.length === 0) {
    fail('stageOrder', 'must be a non-empty array');
  } else {
    for (const stage of order) {
      if (!STAGE_IO[stage]) fail(`stageOrder.${stage}`, 'unknown stage');
    }
  }
  for (const [language, entry] of Object.entries(profile.languages)) {
    if (!KNOWN_LANGUAGES.includes(language)) {
      fail(`languages.${language}`, `unknown language (expected one of ${KNOWN_LANGUAGES.join(', ')})`);
      continue;
    }
    if (!isPlainObject(entry)) { fail(`languages.${language}`, 'must be an object'); continue; }
    if (!nonEmptyString(entry.sdkDir)) fail(`languages.${language}.sdkDir`, 'required');
    if (!nonEmptyString(entry.webContentPathPrefix)) fail(`languages.${language}.webContentPathPrefix`, 'required');
    if (!KNOWN_ROUTES.includes(entry.route)) fail(`languages.${language}.route`, `must be one of ${KNOWN_ROUTES.join(', ')}`);
    if (!isPlainObject(entry.tracks) || Object.keys(entry.tracks).length === 0) {
      fail(`languages.${language}.tracks`, 'must declare at least one track');
    } else {
      for (const [version, track] of Object.entries(entry.tracks)) {
        if (!/^v\d+\.\d+\.x$/.test(version)) fail(`languages.${language}.tracks.${version}`, 'track version must look like vX.Y.x');
        if (track && track.successorTrack != null && !/^v\d+\.\d+\.x$/.test(track.successorTrack)) {
          fail(`languages.${language}.tracks.${version}.successorTrack`, 'must look like vX.Y.x');
        }
      }
    }
  }
  if (errors.length > 0) {
    throw new IntakePlanError('INTAKE_PROFILE_INVALID', `intake profile is invalid (${errors.length} error(s))`, { errors });
  }
  return true;
}

// The argv for each stage. Flag names mirror the canonical scripts' own
// parseArgs (verified against scripts/*.js). A stage that cannot be built from
// the supplied artifacts is reported, not silently skipped.
function stageArgv(stage, ctx) {
  const a = ctx.artifacts;
  switch (stage) {
    case 'dump-pr-pages':
      return {
        script: 'scripts/dump-pr-pages.js',
        args: { '--decisions': a.decisions, '--web-content-dir': ctx.webContentDir, '--output-dir': a.pagesDir },
      };
    case 'placement-audit':
      return {
        script: 'scripts/build-current-placement-audit.js',
        args: { '--proposal': a.scope, '--version': ctx.track, '--output': a.placementAudit, '--dump-walk': a.rootWalk },
      };
    case 'candidate-spec':
      return {
        script: 'scripts/compose-pr-reconcile-candidate-spec.js',
        args: {
          '--language': ctx.language,
          '--track': ctx.track,
          '--release-scope': a.scope,
          '--decisions': a.decisions,
          '--pages-dir': a.pagesDir,
          '--placement-audit': a.placementAudit,
          '--root-walk': a.rootWalk,
          '--identity-map': ctx.identityMap,
          '--category-creates': a.categoryCreates || null,
          '--output': a.candidateSpec,
        },
      };
    case 'reviewed-context':
      return {
        script: 'scripts/build-reviewed-release-context.js',
        args: { '--release-scope': a.scope, '--candidate-spec': a.candidateSpec, '--output-scope': a.filteredScope, '--output-context': a.reviewedContext },
      };
    case 'grouping-proposal':
      return {
        script: 'scripts/build-grouping-proposal.js',
        args: { '--scope': a.filteredScope, '--identity-map': ctx.identityMap, '--decisions': a.decisions, '--output': a.groupingProposal },
      };
    case 'intake-preflight':
      return {
        script: 'scripts/intake-preflight.js',
        args: { '--contexts': a.reviewedContext, '--language': ctx.language, '--strict': true },
      };
    case 'dry-run':
      return {
        script: 'bin/sdk-doc-sync.js',
        args: {
          '--sdk-dir': ctx.sdkDir,
          '--language': ctx.language,
          '--sdk-name': ctx.sdkName,
          '--sdk-version': ctx.track,
          '--reference-context': a.reviewedContext,
          '--release-scope': a.filteredScope,
          '--dry-run': true,
          '--session-state': a.session,
        },
      };
    default:
      throw new IntakePlanError('INTAKE_PROFILE_INVALID', `unknown stage ${stage}`);
  }
}

// Build the ordered plan for one (language, track). Artifacts the stage list
// consumes must all be supplied; a missing one is a typed failure, never an
// empty path handed to a script.
function buildIntakePlan(profile, { language, track, artifacts = {}, identityMap = null } = {}) {
  validateIntakeProfile(profile);
  if (!nonEmptyString(language)) {
    throw new IntakePlanError('UNKNOWN_LANGUAGE', 'a language is required', { languages: KNOWN_LANGUAGES });
  }
  const entry = profile.languages?.[language];
  if (!entry) {
    throw new IntakePlanError('UNKNOWN_LANGUAGE', `language ${language} has no intake profile entry`, { languages: Object.keys(profile.languages ?? {}) });
  }
  if (!nonEmptyString(track)) {
    throw new IntakePlanError('UNKNOWN_TRACK', 'a track is required', { tracks: Object.keys(entry.tracks ?? {}) });
  }
  const trackEntry = entry.tracks?.[track];
  if (!trackEntry) {
    throw new IntakePlanError('UNKNOWN_TRACK', `language ${language} has no track ${track}`, { tracks: Object.keys(entry.tracks ?? {}) });
  }

  const order = profile.stageOrder ?? STAGE_ORDER;
  const consumed = new Set();
  for (const stage of order) for (const key of STAGE_IO[stage].consumes) consumed.add(key);
  const missing = [...consumed].filter((key) => !nonEmptyString(artifacts[key]));
  if (missing.length > 0) {
    throw new IntakePlanError(
      'INTAKE_ARTIFACT_REQUIRED',
      `intake plan for ${language} ${track} is missing artifact path(s): ${missing.join(', ')}`,
      { missing },
    );
  }
  // Stages that resolve identities need the identity map; omitting it must fail
  // here, not silently emit a bare `--identity-map` that swallows the next
  // token (review P1-5).
  if (order.some((stage) => REQUIRES_IDENTITY_MAP.has(stage)) && !nonEmptyString(identityMap)) {
    throw new IntakePlanError(
      'INTAKE_ARTIFACT_REQUIRED',
      `intake plan for ${language} ${track} is missing artifact path(s): identityMap`,
      { missing: ['identityMap'] },
    );
  }

  const ctx = {
    language,
    track,
    sdkDir: entry.sdkDir,
    sdkName: entry.sdkName ?? language,
    webContentDir: profile.shared.webContentDir,
    webContentPathPrefix: entry.webContentPathPrefix,
    route: entry.route,
    identityMap,
    artifacts,
  };

  const stages = order.map((stage) => {
    const { script, args } = stageArgv(stage, ctx);
    return {
      stage,
      script,
      argv: Object.entries(args)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([flag, value]) => (value === true ? flag : [flag, String(value)]))
        .flat(),
      consumes: [...STAGE_IO[stage].consumes],
      produces: [...STAGE_IO[stage].produces],
    };
  });

  return Object.freeze({
    language,
    track,
    sdkDir: entry.sdkDir,
    sdkName: ctx.sdkName,
    webContentPathPrefix: entry.webContentPathPrefix,
    route: entry.route,
    successorTrack: trackEntry.successorTrack ?? null,
    stageOrder: [...order],
    stages: Object.freeze(stages),
  });
}

// Execute a built plan. The `run` step is injected so the orchestration is
// pure and testable: it receives { stage, script, argv, cwd } and returns
// { exitCode, stderr? }. The loop stops at the first non-zero exit and raises a
// typed INTAKE_STAGE_FAILED carrying the stage, exit code, and stderr tail —
// the chain never continues past a broken stage.
async function runIntakePlan(plan, { run, cwd, onStage = null } = {}) {
  if (typeof run !== 'function') {
    throw new IntakePlanError('INTAKE_PROFILE_INVALID', 'runIntakePlan requires a run function');
  }
  const executed = [];
  for (const step of plan.stages) {
    const outcome = await run({ stage: step.stage, script: step.script, argv: step.argv, cwd });
    const exitCode = Number.isInteger(outcome?.exitCode) ? outcome.exitCode : 0;
    executed.push({ stage: step.stage, script: step.script, exitCode });
    if (typeof onStage === 'function') onStage({ stage: step.stage, script: step.script, exitCode });
    if (exitCode !== 0) {
      const stderrTail = typeof outcome?.stderr === 'string' && outcome.stderr.length > 0
        ? outcome.stderr.slice(-2000)
        : null;
      throw new IntakePlanError(
        'INTAKE_STAGE_FAILED',
        `intake stage ${step.stage} failed (exit ${exitCode})`,
        { stage: step.stage, script: step.script, exitCode, stderr: stderrTail },
      );
    }
  }
  return { stages: executed };
}

module.exports = {
  ARTIFACT_KEYS,
  IntakePlanError,
  KNOWN_LANGUAGES,
  STAGE_IO,
  STAGE_ORDER,
  buildIntakePlan,
  runIntakePlan,
  validateIntakeProfile,
};
