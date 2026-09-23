#!/usr/bin/env node

const readline = require('readline');
const path = require('path');
const fs = require('fs');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const SdkDocSync = require('../src/sdk-doc-sync');
const FeishuToMarkdown = require('../src/feishu-to-markdown');
const { validateReferenceDocument } = require('../src/sdk-reference-ir/validate');
const { validateDocumentIr } = require('../src/document-ir/validate');
const { renderMarkdown } = require('../src/document-ir/ir-to-markdown');
const { validateSdkLayout } = require('../src/renderers/sdk-layout-validator');
const { validateReleaseScope } = require('../src/sdk-doc-sync/release-scope/schema');
const {
    normalizeVerbatimContent,
    verbatimCarriesIncludeMarker,
    verbatimContentDigest,
} = require('../src/sdk-doc-sync/verbatim-content');
const { withoutSelfTypeUrls } = require('../src/sdk-doc-sync/type-url-index');
const {
    getTrack,
    listLanguageTracks,
    loadReleaseTrackRegistry,
    trackBaseToken,
    trackTableId,
} = require('../src/sdk-doc-sync/release-track-registry');
const { createApprovalEnvelope } = require('../../doc-ops-core/src/approval-guard');
const {
    createReviewSession,
    loadReviewSession,
    recordDocumentExecution,
    saveReviewSession,
} = require('../src/sdk-doc-sync/review-session-store');

const adapters = Object.freeze({
    python: require('../src/sdk-reference-ir/adapters/python'),
    java: require('../src/sdk-reference-ir/adapters/java'),
    node: require('../src/sdk-reference-ir/adapters/node'),
    go: require('../src/sdk-reference-ir/adapters/go'),
    cpp: require('../src/sdk-reference-ir/adapters/cpp'),
    'zilliz-cli': require('../src/sdk-reference-ir/adapters/zilliz-cli'),
    rest: require('../src/sdk-reference-ir/adapters/openapi'),
});

const renderers = Object.freeze({
    python: require('../src/renderers/languages/python'),
    java: require('../src/renderers/languages/java'),
    node: require('../src/renderers/languages/node'),
    go: require('../src/renderers/languages/go'),
    cpp: require('../src/renderers/languages/cpp'),
    'zilliz-cli': require('../src/renderers/cli-renderer'),
    rest: require('../src/renderers/rest-renderer'),
});

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--sdk-dir' && argv[i + 1]) {
            args.sdkDir = argv[++i];
        } else if (arg === '--language' && argv[i + 1]) {
            args.language = argv[++i];
        } else if (arg === '--sdk-name' && argv[i + 1]) {
            args.sdkName = argv[++i];
        } else if (arg === '--sdk-version' && argv[i + 1]) {
            args.sdkVersion = argv[++i];
        } else if (arg === '--source-type' && argv[i + 1]) {
            args.sourceType = argv[++i];
        } else if (arg === '--previous-base-token' && argv[i + 1]) {
            args.previousBaseToken = argv[++i];
        } else if (arg === '--reference-context' && argv[i + 1]) {
            args.referenceContext = argv[++i];
        } else if (arg === '--release-scope' && argv[i + 1]) {
            args.releaseScope = argv[++i];
        } else if (arg === '--targets' && argv[i + 1]) {
            args.targets = argv[++i].split(',').map(t => t.trim());
        } else if (arg === '--exclude' && argv[i + 1]) {
            args.exclude = (args.exclude || []).concat(argv[++i]);
        } else if (arg === '--dry-run') {
            args.dryRun = true;
        } else if (arg === '--changed-only') {
            args.changedOnly = true;
        } else if (arg === '--summary-json' && argv[i + 1]) {
            args.summaryJson = argv[++i];
        } else if (arg === '--json') {
            args.json = true;
        } else if (arg === '--auto-approve') {
            args.autoApprove = true;
        } else if (arg === '--repair-approve' && argv[i + 1]) {
            args.repairApprove = (args.repairApprove || []).concat(argv[++i]);
        } else if (arg === '--approve-plan-digest' && argv[i + 1]) {
            args.approvePlanDigest = (args.approvePlanDigest || []).concat(argv[++i]);
        } else if (arg === '--approve-batch-digest' && argv[i + 1]) {
            args.approveBatchDigest = argv[++i];
        } else if (arg === '--review-unit-id' && argv[i + 1]) {
            args.reviewUnitId = argv[++i];
        } else if (arg === '--session-state' && argv[i + 1]) {
            args.sessionState = argv[++i];
        } else if (arg === '--resume-session' && argv[i + 1]) {
            args.resumeSession = argv[++i];
        } else if (arg === '--finalize-acceptance' && argv[i + 1]) {
            args.finalizeAcceptance = argv[++i];
        } else if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        }
    }
    return args;
}

function printUsage() {
    console.log(`
Usage: sdk-doc-sync [options]

Options:
  --sdk-dir <path>                 Path to the SDK source directory (required)
  --language <lang>                Programming language (default: python)
  --sdk-name <name>                SDK name for metadata (required)
  --sdk-version <ver>              SDK version for metadata (required)
  --source-type <type>             Feishu source type: drive or wiki (default: drive)
  --previous-base-token <token>    Bitable token of previous version (for incremental diff)
  --reference-context <file>       JSON file with reviewed schema-first generation context
  --release-scope <file>           Release-scout JSON artifact for approval-grade scoped planning
  --targets <list>                 Comma-separated target platforms (e.g., Milvus,Zilliz)
  --exclude <pattern>              Glob pattern to exclude (repeatable)
  --dry-run                        Show diff without executing changes
  --changed-only                   Require release scope and scan only release-scoped symbols
  --summary-json <file>            Write bounded run summary JSON to a file
  --json                           Print the run result as formatted JSON
  --auto-approve                   Skip interactive approval
  --repair-approve <doc-token>     Bind approval to an exact full-body repair token (repeatable)
  --approve-plan-digest <id=hash>  Require an exact stable ID and artifact digest (repeatable)
  --approve-batch-digest <hash>    Approve exactly one generated execution batch digest
  --review-unit-id <id>            Select exactly one document and its required resource operations
  --session-state <file>           Create a persistent session from a complete initial dry-run; with --finalize-acceptance, the canonical acceptance-pending session to finalize
  --resume-session <file>          Resume from verified persisted document-acceptance receipts
  --finalize-acceptance <file>     Finalize acceptance from a receipt bound (by acceptanceManifestDigest) to the canonical --session-state session
  --help, -h                       Show this help

Environment (.env):
  ROOT_TOKEN    Drive folder or Wiki parent node token (required for live writes)
  BASE_TOKEN    Bitable base token for the target version (required for diff baseline unless --previous-base-token is set)
  APP_ID        Feishu app ID
  APP_SECRET    Feishu app secret
  FEISHU_HOST   Feishu API host (default: https://open.feishu.cn)
`);
}

function createApprovalCallback(autoApprove) {
    if (autoApprove) return null;

    return async (actions) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        const ask = (question) => new Promise(resolve => rl.question(question, resolve));

        console.log(`\n--- Approval Required: ${actions.length} actions ---\n`);

        const approved = [];
        let approveAll = false;

        for (const action of actions) {
            if (action.kind && action.ref) {
                console.log(`  ${action.kind.toUpperCase().padEnd(10)} ${action.ref}`);
                console.log(`             dependent resource — ${action.name || action.title || action.ref}`);
                if (approveAll) {
                    approved.push(action);
                    console.log('             → approved (all)\n');
                    continue;
                }
                const answer = await ask('  [y/N/a(ll)/q(uit)] ');
                const choice = answer.trim().toLowerCase();
                if (choice === 'y' || choice === 'yes') approved.push(action);
                else if (choice === 'a' || choice === 'all') {
                    approveAll = true;
                    approved.push(action);
                } else if (choice === 'q' || choice === 'quit') break;
                console.log('');
                continue;
            }
            const symbol = action.symbol
                ? `${action.symbol.parentClass ? action.symbol.parentClass + '.' : ''}${action.symbol.name}`
                : '(orphan)';

            console.log(`  ${action.type.padEnd(10)} ${action.slug}`);
            console.log(`             ${symbol} — ${action.reason}`);

            if (approveAll) {
                approved.push(action);
                console.log('             → approved (all)\n');
                continue;
            }

            const answer = await ask('  [y/N/a(ll)/q(uit)] ');
            const choice = answer.trim().toLowerCase();

            if (choice === 'y' || choice === 'yes') {
                approved.push(action);
            } else if (choice === 'a' || choice === 'all') {
                approveAll = true;
                approved.push(action);
            } else if (choice === 'q' || choice === 'quit') {
                break;
            }
            console.log('');
        }

        rl.close();
        return approved;
    };
}

function createExecutionApprovalProvider(repairTokens = [], digestApprovals = [], approvedBatchDigest = null) {
    const approvedRepairs = new Set(repairTokens);
    const approvedDigests = new Map(digestApprovals.map((entry) => {
        const separator = entry.lastIndexOf('=');
        if (separator <= 0 || separator === entry.length - 1) {
            throw new TypeError(`Invalid --approve-plan-digest value: ${entry}`);
        }
        return [entry.slice(0, separator), entry.slice(separator + 1)];
    }));
    return (plan, action, batch) => {
        if (!approvedBatchDigest) throw new Error('BATCH_APPROVAL_REQUIRED: --approve-batch-digest is required for live execution');
        if (approvedBatchDigest !== batch.batchDigest) {
            throw new Error(`APPROVED_BATCH_DIGEST_MISMATCH: expected ${approvedBatchDigest}, got ${batch.batchDigest}`);
        }
        const approvedDigest = approvedDigests.get(plan.stableId);
        if (approvedDigests.size > 0 && plan.artifactDigest && !approvedDigest) {
            throw new Error(`PLAN_NOT_APPROVED: ${plan.stableId}`);
        }
        if (approvedDigest && approvedDigest !== plan.artifactDigest) {
            throw new Error(
                `APPROVED_PLAN_DIGEST_MISMATCH: ${plan.stableId} expected ${approvedDigest}, got ${plan.artifactDigest}`,
            );
        }
        const repair = plan.apiPatchPlan?.approval;
        if (repair?.required !== true || !approvedRepairs.has(repair.documentToken)) {
            return createApprovalEnvelope({
                skill: batch.skill,
                operation: batch.operation,
                batchDigest: batch.batchDigest,
                actionCount: batch.actions.length,
                targets: batch.targets,
                sideEffects: batch.sideEffects,
                decision: 'approved',
            });
        }
        return {
            ...createApprovalEnvelope({
                skill: batch.skill,
                operation: batch.operation,
                batchDigest: batch.batchDigest,
                actionCount: batch.actions.length,
                targets: batch.targets,
                sideEffects: batch.sideEffects,
                decision: 'approved',
            }),
            repairApproved: true,
            documentToken: repair.documentToken,
            preserveBlockIds: repair.preservedBlockIds || [],
        };
    };
}

async function withJsonConsoleIsolation(enabled, err, operation) {
    if (!enabled) return operation();
    const originalLog = console.log;
    console.log = (...values) => err(values.join(' '));
    try {
        return await operation();
    } finally {
        console.log = originalLog;
    }
}

function validationError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
}

function firstValidationCode(validation, fallback) {
    return validation.errors?.[0]?.code || fallback;
}

function defaultReferenceContext(action) {
    const scoped = action.releaseScopeAction || {};
    const source = scoped.source || {};
    return {
        repository: source.repository || '',
        revision: source.revision || '',
        category: action.symbol?.category || '',
        reviewedEvidence: scoped.evidence || [],
        related: [],
        notes: [],
    };
}

function stableIdCandidates(action, language) {
    const symbol = action.symbol || {};
    const category = symbol.parentClass || symbol.category || '';
    const name = symbol.name || action.slug || '';
    return [
        action.stableId,
        symbol.identity?.stableId,
        symbol.stableId,
        language && category && name ? `${language}:${category}:${name}` : null,
        action.slug,
        name,
    ].filter(Boolean);
}

function createReferenceContextProvider(filePath, { language } = {}) {
    if (!filePath) return null;
    const absolute = path.resolve(filePath);
    return async (action) => {
        const raw = JSON.parse(fs.readFileSync(absolute, 'utf8'));
        const contexts = raw.contexts || raw.byStableId || raw.bySlug || {};
        const match = stableIdCandidates(action, language)
            .map((key) => contexts[key])
            .find(Boolean) || {};
        const base = raw.contexts || raw.byStableId || raw.bySlug
            ? Object.fromEntries(Object.entries(raw).filter(([key]) => !['contexts', 'byStableId', 'bySlug'].includes(key)))
            : raw;
        return {
            ...base,
            ...match,
            ...(language === 'rest' ? { input: action.symbol } : {}),
        };
    };
}

function createSchemaFirstArtifactProvider({
    language,
    referenceContextProvider = null,
} = {}) {
    const adapter = adapters[language];
    const renderer = renderers[language];
    if (!adapter || !renderer) {
        throw new Error(`Unsupported language: ${language}. Supported: ${Object.keys(adapters).join(', ')}`);
    }

    return async (action, scope = {}) => {
        if (!['CREATE', 'UPDATE', 'BACKFILL'].includes(action?.type)) return undefined;
        const context = referenceContextProvider
            ? await referenceContextProvider(action, scope)
            : defaultReferenceContext(action);
        // Merged-PR pages are solidified verbatim: when the reviewed context
        // carries the upstream markdown, it replaces the schema-first
        // regenerated document entirely (block-replace patch strategy). The
        // content is normalized here (web-content footer + leading H1
        // stripped) and bound into the artifact digest so the approved batch
        // digest covers the exact solidified bytes (api.pr-verbatim-content).
        if (action?.pr && typeof context?.verbatimContent === 'string' && context.verbatimContent.trim()) {
            const verbatimContent = normalizeVerbatimContent(context.verbatimContent);
            // Pages carrying user-authored <include> conditional markers are
            // never rebuilt: the markers must survive verbatim, and the body
            // is edited surgically instead (api.literal-include-preserved).
            if (verbatimCarriesIncludeMarker(verbatimContent)) {
                throw validationError(
                    'INCLUDE_REBUILD_FORBIDDEN',
                    'verbatim content carries literal <include> conditional markers; a rebuild artifact would re-derive the body — edit such pages with surgical child-block insertion',
                    { actionId: action?.stableId || null },
                );
            }
            return {
                reviewed: true,
                validated: true,
                content: verbatimContent,
                contentDigest: verbatimContentDigest(verbatimContent),
                patchStrategy: 'rebuild',
                title: context.title,
                metadata: { description: context.summary },
                pr: context.pr || null,
            };
        }
        try {
            const source = language === 'rest' && context?.input ? context.input : action.symbol;
            const reference = adapter.toReferenceDocument(source, context || {});
            const referenceValidation = validateReferenceDocument(reference, { production: true });
            if (!referenceValidation.valid) {
                throw validationError(
                    firstValidationCode(referenceValidation, 'INVALID_REFERENCE_DOCUMENT'),
                    `Reference document validation failed: ${JSON.stringify(referenceValidation.errors)}`,
                    { validation: referenceValidation },
                );
            }
            const typeUrls = withoutSelfTypeUrls({
                ...(scope.typeUrls || {}),
                ...(context?.typeUrls || {}),
            }, reference.identity.title);
            const documentIr = renderer.render(reference, { typeUrls });
            const documentValidation = validateDocumentIr(documentIr, { lossless: true });
            if (!documentValidation.valid) {
                throw validationError(
                    firstValidationCode(documentValidation, 'INVALID_DOCUMENT_IR'),
                    `Document IR validation failed: ${JSON.stringify(documentValidation.errors)}`,
                    { validation: documentValidation },
                );
            }
            const layoutValidation = renderer.profile
                ? validateSdkLayout(documentIr, renderer.profile)
                : { valid: true, errors: [], warnings: [] };
            if (!layoutValidation.valid) {
                throw validationError(
                    firstValidationCode(layoutValidation, 'INVALID_SDK_LAYOUT'),
                    `SDK layout validation failed: ${JSON.stringify(layoutValidation.errors)}`,
                    { validation: layoutValidation },
                );
            }
            const artifact = {
                title: reference.identity.title,
                content: renderMarkdown(documentIr),
                reference,
                documentIr,
                reviewed: true,
                validated: true,
                ...(renderer.profile && {
                    layout: {
                        profileId: renderer.profile.id,
                        profileVersion: renderer.profile.version,
                    },
                }),
                validation: {
                    valid: true,
                    errors: [],
                    warnings: [...documentValidation.warnings, ...layoutValidation.warnings],
                    ...(renderer.profile && { layout: layoutValidation }),
                },
                metadata: {
                    description: reference.summary,
                    type: reference.identity.kind,
                    progress: 'Draft',
                    targets: [],
                    source: 'schema-first',
                },
            };
            if (context?.target || context?.current || context?.existingRecordLookup || context?.copySource || Object.prototype.hasOwnProperty.call(context || {}, 'tokenReferencedByOlderVersions')) {
                return {
                    artifact,
                    target: context.target,
                    current: context.current,
                    existingRecordLookup: context.existingRecordLookup,
                    copySource: context.copySource,
                    tokenReferencedByOlderVersions: context.tokenReferencedByOlderVersions,
                };
            }
            return artifact;
        } catch (error) {
            if (error.code) throw error;
            throw validationError(
                'SCHEMA_FIRST_GENERATION_FAILED',
                `Schema-first generation failed for ${action?.slug || action?.symbol?.name || '(unknown)'}: ${error.message}`,
                { cause: error.message },
            );
        }
    };
}

function createDefaultPlanningContextProvider({ rootToken, sdkVersion }) {
    return async (action = {}) => {
        if (action.planningContext?.target) return {};
        return {
        target: {
            version: sdkVersion,
            folderToken: rootToken || 'dummy',
            versionRootToken: rootToken || 'dummy',
            ancestryVerified: true,
        },
        };
    };
}

async function runCli({
    argv = process.argv,
    env = process.env,
    dependencies = {},
} = {}) {
    if (dependencies.loadEnv !== false) {
        require('dotenv').config({
            path: path.resolve(__dirname, '../../../..', '.env'),
            processEnv: env,
            quiet: true,
        });
    }

    const out = dependencies.onStdout || ((line) => console.log(line));
    const err = dependencies.onStderr || ((line) => console.error(line));
    const exit = dependencies.exit || ((code) => process.exit(code));
    const args = parseArgs(argv);
    const readFile = dependencies.readFile || ((file) => fs.readFileSync(file, 'utf8'));
    const writeFile = dependencies.writeFile || ((file, content) => fs.writeFileSync(file, content));

    if (args.finalizeAcceptance) {
        return await finalizeAcceptance({
            receiptPath: args.finalizeAcceptance,
            sessionPath: args.sessionState,
            readFile,
            out,
            err,
            exit,
            io: dependencies.finalizeAcceptanceIo || {},
        });
    }

    if (args.sessionState && args.resumeSession) {
        err('Error: choose either --session-state or --resume-session, not both');
        exit(1);
        return null;
    }
    if (args.sessionState && !args.dryRun) {
        err('Error: --session-state requires --dry-run');
        exit(1);
        return null;
    }

    if (!args.sdkDir) {
        err('Error: --sdk-dir is required');
        printUsage();
        exit(1);
        return null;
    }
    if (!args.sdkName) {
        err('Error: --sdk-name is required');
        printUsage();
        exit(1);
        return null;
    }
    if (!args.sdkVersion) {
        err('Error: --sdk-version is required');
        printUsage();
        exit(1);
        return null;
    }

    const language = args.language || 'python';
    let reviewSession = null;
    if (args.resumeSession) {
        try {
            reviewSession = loadReviewSession(path.resolve(args.resumeSession));
        } catch (error) {
            err(`Error: ${error.message}`);
            exit(1);
            return null;
        }
        if (reviewSession.language !== language
            || reviewSession.sdkName !== args.sdkName
            || reviewSession.track !== args.sdkVersion) {
            err(`Error: review session metadata does not match requested ${language}/${args.sdkName}/${args.sdkVersion}`);
            exit(1);
            return null;
        }
    }
    let releaseScope = null;
    if (args.releaseScope) {
        const releaseScopePath = path.resolve(args.releaseScope);
        releaseScope = JSON.parse(readFile(releaseScopePath));
        const validation = validateReleaseScope(releaseScope);
        if (!validation.valid) {
            err(`Error: invalid --release-scope: ${JSON.stringify(validation.errors)}`);
            exit(1);
            return null;
        }
        if (releaseScope.approvalGrade !== true || releaseScope.writesPerformed !== false || releaseScope.scanStateUpdated !== false) {
            err('Error: --release-scope must be approvalGrade=true, writesPerformed=false, and scanStateUpdated=false');
            exit(1);
            return null;
        }
        if (releaseScope.language !== language || releaseScope.sdkName !== args.sdkName || releaseScope.track !== args.sdkVersion) {
            err(`Error: --release-scope metadata does not match requested ${language}/${args.sdkName}/${args.sdkVersion}`);
            exit(1);
            return null;
        }
    }
    if (args.changedOnly && !releaseScope) {
        err('Error: --changed-only requires --release-scope');
        exit(1);
        return null;
    }

    const rootToken = env.ROOT_TOKEN;
    const baseToken = env.BASE_TOKEN;
    const indexBaseToken = args.previousBaseToken || baseToken;

    if (!args.dryRun && (!rootToken || !baseToken)) {
        err('Error: ROOT_TOKEN and BASE_TOKEN must be set in .env for live writes');
        exit(1);
        return null;
    }
    if (!indexBaseToken && !dependencies.indexReader) {
        err('Error: BASE_TOKEN is required for dry-run diff baseline; set BASE_TOKEN or pass --previous-base-token');
        exit(1);
        return null;
    }

    const fileContextProvider = createReferenceContextProvider(args.referenceContext, { language });
    const artifactProvider = dependencies.artifactProvider || createSchemaFirstArtifactProvider({
        language,
        referenceContextProvider: dependencies.referenceContextProvider || fileContextProvider,
    });
    const planningContextProvider = dependencies.planningContextProvider
        || createDefaultPlanningContextProvider({ rootToken: rootToken || 'dummy', sdkVersion: args.sdkVersion });
    const typeIndexReader = dependencies.typeIndexReader || (
        !dependencies.indexReader
        && args.previousBaseToken
        && baseToken
        && args.previousBaseToken !== baseToken
            ? new FeishuToMarkdown({
                sourceType: args.sourceType || 'drive',
                rootToken: rootToken || 'dummy',
                baseToken,
            })
            : null
    );

    // Cross-track token reference tracks for the executor's pre-write
    // shared-token revalidation. Registry resolution activates only when the
    // live BASE_TOKEN matches the registered base for the requested track, so
    // dry-runs and foreign-token runs never enumerate unrelated live bases.
    let tokenReferenceTracks = [];
    if (!args.dryRun && baseToken) {
        try {
            const registry = loadReleaseTrackRegistry();
            const track = getTrack(registry, language, args.sdkVersion);
            if (track && trackBaseToken(track) === baseToken) {
                tokenReferenceTracks = listLanguageTracks(registry, language)
                    .filter((candidate) => candidate.version !== args.sdkVersion)
                    .map((candidate) => ({
                        version: candidate.version,
                        baseToken: trackBaseToken(candidate),
                        tableId: trackTableId(candidate),
                    }))
                    .filter((candidate) => candidate.baseToken);
            }
        } catch (error) {
            err(`Warning: release track registry unavailable (${error.message}); cross-track revalidation covers the current base only`);
        }
    }

    const syncOptions = {
        scanner: dependencies.scanner || null,
        indexReader: dependencies.indexReader || null,
        typeIndexReader,
        sdkDir: args.sdkDir,
        language,
        sdkName: args.sdkName,
        sdkVersion: args.sdkVersion,
        sourceType: args.sourceType || 'drive',
        rootToken: rootToken || 'dummy',
        baseToken: baseToken || 'dummy',
        previousBaseToken: args.previousBaseToken || null,
        targets: args.targets || [],
        dryRun: args.dryRun || false,
        changedOnly: args.changedOnly || false,
        releaseScope,
        exclude: args.exclude || [],
        approvalCallback: createApprovalCallback(args.autoApprove),
        executionApprovalProvider: createExecutionApprovalProvider(args.repairApprove, args.approvePlanDigest, args.approveBatchDigest),
        artifactProvider,
        planner: dependencies.planner || null,
        planningContextProvider,
        onProgress: dependencies.onProgress || (() => {}),
        documentWriter: dependencies.documentWriter || null,
        bitableWriter: dependencies.bitableWriter || null,
        executor: dependencies.executor || null,
        documentBlockReader: dependencies.documentBlockReader || null,
        artifactBlockRenderer: dependencies.artifactBlockRenderer || null,
        apiPatchPlanner: dependencies.apiPatchPlanner,
        printPlans: args.json !== true,
        collaborativeReview: true,
        reviewUnitId: args.reviewUnitId || null,
        reviewSession,
        tokenReferenceReader: dependencies.tokenReferenceReader || null,
        tokenReferenceTracks,
    };
    const sync = dependencies.syncFactory ? dependencies.syncFactory(syncOptions) : new SdkDocSync(syncOptions);

    const result = await withJsonConsoleIsolation(args.json === true, err, () => sync.run());
    if (args.resumeSession
        && !args.dryRun
        && result.executionResult?.status === 'EXECUTED'
        && result.activeReviewUnit?.reviewUnitId
        && result.executionJournalPath
        && result.executionJournalDigest) {
        const sessionPath = path.resolve(args.resumeSession);
        reviewSession = recordDocumentExecution(reviewSession, {
            reviewUnitId: result.activeReviewUnit.reviewUnitId,
            executionJournalPath: result.executionJournalPath,
            executionJournalDigest: result.executionJournalDigest,
        });
        saveReviewSession(sessionPath, reviewSession);
        result.reviewSession = {
            ...(result.reviewSession || {}),
            sessionId: reviewSession.sessionId,
            sessionPath,
            activeReviewUnitId: reviewSession.activeExecution.reviewUnitId,
            acceptedReviewUnitIds: (reviewSession.acceptedReviewUnits || []).map((unit) => unit.reviewUnitId).sort(),
            reviewUnitManifestDigest: reviewSession.reviewUnitManifestDigest,
        };
    }
    if (args.sessionState) {
        const sessionPath = path.resolve(args.sessionState);
        if (fs.existsSync(sessionPath)) {
            err(`Error: review session already exists; use --resume-session ${sessionPath}`);
            exit(1);
            return null;
        }
        if (result.planningErrors.length > 0
            || !result.reviewUnitManifest?.manifestDigest
            || !Array.isArray(result.reviewUnitManifest.units)
            || result.reviewUnitManifest.units.length === 0
            || (result.reviewUnitManifest.unassignedResourceActionIds || []).length > 0) {
            err('Error: cannot create a review session from an incomplete or blocked dry-run');
            exit(1);
            return null;
        }
        const session = createReviewSession({
            sessionId: `sdk-doc-sync:${language}:${args.sdkName}:${args.sdkVersion}:${result.reviewUnitManifest.manifestDigest}`,
            language,
            sdkName: args.sdkName,
            track: args.sdkVersion,
            reviewUnitManifest: result.reviewUnitManifest,
            artifacts: {
                releaseScope: args.releaseScope ? path.resolve(args.releaseScope) : null,
                referenceContext: args.referenceContext ? path.resolve(args.referenceContext) : null,
                summaryJson: args.summaryJson ? path.resolve(args.summaryJson) : null,
            },
        });
        saveReviewSession(sessionPath, session);
        result.reviewSession = {
            sessionId: session.sessionId,
            sessionPath,
            acceptedReviewUnitIds: [],
            reviewUnitManifestDigest: session.reviewUnitManifestDigest,
        };
    }
    if (args.summaryJson) {
        writeFile(path.resolve(args.summaryJson), `${JSON.stringify(createBoundedSummary(result), null, 2)}\n`);
    }

    if (args.json) {
        out(JSON.stringify(result, null, 2));
        return result;
    }

    if (args.dryRun) {
        out(`\nDry run complete. ${result.scanned.length} symbols scanned, ${result.diff.length} diff actions.`);
        if (result.planningErrors.length > 0) {
            out(`Blocked: ${result.planningErrors.length} planning errors. No write approval is valid.`);
            return result;
        }
        if (result.reviewUnitSelectionRequired) {
            out(`Review-unit manifest: ${result.reviewUnitManifest.manifestDigest} (${result.reviewUnitManifest.units.length} documents).`);
            for (const unit of result.reviewUnitPreviews) {
                out(`- ${unit.reviewUnitId}: ${unit.batchDigest} (${unit.actionIds.length} actions)`);
            }
            out('Select one document with --review-unit-id <id>, rerun the dry-run, and approve only that unit digest.');
            return result;
        }
        const batchDigest = result.proposedExecutionBatch.batchDigest;
        if (result.activeReviewUnit) {
            out(`Active review unit: ${result.activeReviewUnit.reviewUnitId} (${result.activeReviewUnit.documentStableId}).`);
        }
        out(`Proposed execution batch: ${batchDigest} (${result.proposedExecutionBatch.actions.length} actions).`);
        out(`If approved, reply exactly: APPROVE_WRITES ${batchDigest}`);
        out(`Live CLI approval flag: --approve-batch-digest ${batchDigest}`);
    } else if (result.executionResult?.status === 'BLOCKED') {
        out(`\nSync blocked. ${result.executionResult.diagnostics.length} blocking diagnostics.`);
        for (const diagnostic of result.executionResult.diagnostics) {
            out(`- ${diagnostic.code}: ${diagnostic.message}`);
        }
    } else {
        const succeeded = result.results.filter(r => r.status === 'success').length;
        const failed = result.results.filter(r => r.status === 'error').length;
        out(`\nSync complete. ${succeeded} succeeded, ${failed} failed.`);
    }
    return result;
}

function createBoundedSummary(result) {
    return {
        scannedCount: result.scanned.length,
        indexedCount: result.indexed.length,
        diffCount: result.diff.length,
        resourcePlanCount: (result.resourcePlans || []).length,
        planCount: result.plans.length,
        proposedBatchDigest: result.proposedExecutionBatch?.batchDigest || null,
        proposedActionCount: result.proposedExecutionBatch?.actions?.length || 0,
        proposedReleaseBatchDigest: result.proposedReleaseBatch?.batchDigest || null,
        reviewUnitManifestDigest: result.reviewUnitManifest?.manifestDigest || null,
        reviewUnitCount: result.reviewUnitManifest?.units?.length || 0,
        reviewUnitSelectionRequired: result.reviewUnitSelectionRequired === true,
        activeReviewUnitId: result.activeReviewUnit?.reviewUnitId || null,
        planningErrorCount: result.planningErrors.length,
        approvedCount: result.approved.length,
        resultCount: result.results.length,
        releaseScope: result.releaseScope || null,
        diff: result.diff.map((action) => ({
            type: action.type,
            slug: action.slug,
            stableId: action.stableId || action.symbol?.identity?.stableId || action.symbol?.stableId || null,
            symbol: action.symbol
                ? `${action.symbol.parentClass ? action.symbol.parentClass + '.' : ''}${action.symbol.name}`
                : null,
            reason: action.reason,
            reasons: action.reasons || [action.reason].filter(Boolean),
            source: action.releaseScopeAction?.source || null,
            sourceVariants: action.sourceVariants || action.releaseScopeAction?.sourceVariants || [],
            evidence: action.releaseScopeAction?.evidence || [],
        })),
        planningErrors: result.planningErrors,
    };
}

// Production acceptance-finalization entrypoint (--finalize-acceptance
// --session-state <file>). The CANONICAL persisted review session — the file
// created by --session-state and advanced through the review flow — is the
// only accepted authority: the receipt may not embed a session. The receipt
// carries the user-confirmed acceptanceManifestDigest anchor (which must
// equal the canonical session's), the scan-state payload, and the target
// track's bitable identity. The finalizer derives everything writable from
// that session (complete accepted-unit manifest coverage + digest-verified
// per-unit journals), and only after the acceptance receipt is durable are
// recordAcceptanceFinalization + saveReviewSession invoked so the canonical
// session leaves acceptance_pending. `io` overrides are for tests only.
async function finalizeAcceptance({
    receiptPath,
    sessionPath,
    readFile,
    out,
    err,
    exit,
    io = {},
}) {
    const {
        loadReviewSession,
        recordAcceptanceFinalization,
        saveReviewSession,
    } = require('../src/sdk-doc-sync/review-session-store');
    if (!sessionPath) {
        err('Error: --finalize-acceptance requires --session-state <file> pointing at the canonical acceptance-pending session');
        exit(1);
        return null;
    }
    let receipt;
    try {
        receipt = JSON.parse(readFile(path.resolve(receiptPath)));
    } catch (error) {
        err(`Error: --finalize-acceptance receipt is unreadable: ${error.message}`);
        exit(1);
        return null;
    }
    if (receipt?.reviewSession !== undefined) {
        err('Error: the receipt must not embed a reviewSession; pass --session-state pointing at the canonical persisted session');
        exit(1);
        return null;
    }
    if (!receipt?.bitable?.baseToken) {
        err('Error: acceptance receipt requires bitable.baseToken for the target track');
        exit(1);
        return null;
    }
    if (!nonEmptyReceiptString(receipt.scanStateKey)) {
        err('Error: acceptance receipt requires scanStateKey');
        exit(1);
        return null;
    }
    if (!receipt.scanStateEntry || typeof receipt.scanStateEntry !== 'object' || Array.isArray(receipt.scanStateEntry)) {
        err('Error: acceptance receipt requires scanStateEntry');
        exit(1);
        return null;
    }
    if (!nonEmptyReceiptString(receipt.acceptanceManifestDigest)) {
        err('Error: acceptance receipt requires acceptanceManifestDigest (the approved acceptance manifest it confirms)');
        exit(1);
        return null;
    }

    let session;
    try {
        session = loadReviewSession(sessionPath);
    } catch (error) {
        err(`Error: canonical review session is unavailable: ${error.message}`);
        exit(1);
        return null;
    }
    if (session.status !== 'acceptance_pending' || !nonEmptyReceiptString(session.acceptanceManifestDigest)) {
        err(`Error: canonical session ${sessionPath} is ${session.status || '(unknown)'} without an acceptance manifest; build the complete acceptance manifest before finalization`);
        exit(1);
        return null;
    }
    if (receipt.acceptanceManifestDigest !== session.acceptanceManifestDigest) {
        err(`Error: receipt confirms acceptanceManifestDigest ${receipt.acceptanceManifestDigest}, but the canonical session is bound to ${session.acceptanceManifestDigest}`);
        exit(1);
        return null;
    }

    const AcceptanceFinalizer = require('../src/sdk-doc-sync/acceptance-finalizer');
    const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
    const { WriterGovernance } = require('../../doc-ops-core/src/writer-governance');
    const repoRoot = path.resolve(__dirname, '../../../..');
    const tmpDir = path.join(repoRoot, 'tmp', 'api-reference-sync');
    const scanStatePath = path.resolve(__dirname, '..', 'scan-state.json');
    const receiptArtifact = { path: null, digest: null };
    const finalizer = new AcceptanceFinalizer({
        bitableWriter: io.bitableWriter
            || new BitableWriter({
                baseToken: receipt.bitable.baseToken,
                tableId: receipt.bitable.tableId || undefined,
                // Unbound here: finalize() binds this governance only after the
                // receipt/session/manifest/evidence chain has been re-verified.
                governance: new WriterGovernance({ skill: 'api-reference-sync', operation: 'acceptance' }),
            }),
        readScanState: io.readScanState || (async () => {
            try {
                return JSON.parse(fs.readFileSync(scanStatePath, 'utf8'));
            } catch {
                return {};
            }
        }),
        writeScanState: io.writeScanState || (async (next) => {
            fs.mkdirSync(path.dirname(scanStatePath), { recursive: true });
            fs.writeFileSync(scanStatePath, `${JSON.stringify(next, null, 2)}\n`);
        }),
        writeJournal: async (journal) => {
            const writeProductionReceipt = async (value) => {
                fs.mkdirSync(tmpDir, { recursive: true });
                const receiptOut = path.join(tmpDir, `acceptance-${value.acceptanceManifestDigest.replace(':', '-')}.json`);
                fs.writeFileSync(receiptOut, `${JSON.stringify(value, null, 2)}\n`);
                out(`Acceptance receipt written to ${receiptOut}`);
                return { path: receiptOut, digest: digestSemanticReceipt(value) };
            };
            const written = await (io.writeJournal || writeProductionReceipt)(journal);
            if (written && typeof written === 'object') {
                receiptArtifact.path = written.path ?? null;
                receiptArtifact.digest = written.digest ?? null;
            }
        },
        readJournalEntries: io.readJournalEntries || (async (digest) => {
            const content = fs.readFileSync(SdkDocSync.journalPathForDigest(digest, repoRoot), 'utf8');
            return content.trim() ? content.trim().split('\n').map(line => JSON.parse(line)) : [];
        }),
    });
    try {
        // Idempotent resume: the acceptance receipt is written LAST by the
        // finalizer, so a receipt matching the canonical manifest proves the
        // Draft/scan-state mutations are already durable. A rerun after a
        // record/save failure skips them and only completes session
        // finalization instead of failing on records that are already Draft.
        const loadDurableReceipt = io.loadDurableReceipt || ((manifestDigest) => {
            const receiptPath = path.join(tmpDir, `acceptance-${manifestDigest.replace(':', '-')}.json`);
            if (!fs.existsSync(receiptPath)) return null;
            try {
                const journal = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
                return { path: receiptPath, digest: digestSemanticReceipt(journal) };
            } catch {
                return null;
            }
        });
        const durable = await loadDurableReceipt(session.acceptanceManifestDigest);
        if (durable?.path && durable?.digest) {
            receiptArtifact.path = durable.path;
            receiptArtifact.digest = durable.digest;
            out(`Durable acceptance receipt found for the canonical manifest (${durable.path}); skipping Draft/scan-state mutations and completing session finalization.`);
        } else {
            await finalizer.finalize({
                userConfirmed: receipt.userConfirmed === true,
                reviewSession: session,
                scanStateKey: receipt.scanStateKey,
                scanStateEntry: receipt.scanStateEntry,
            });
        }
        // The acceptance receipt is durable at this point; record finalization
        // on the canonical session (re-validates the journal artifact from
        // disk) and persist it so the session leaves acceptance_pending.
        const finalized = recordAcceptanceFinalization(session, {
            acceptanceJournalPath: receiptArtifact.path,
            acceptanceJournalDigest: receiptArtifact.digest,
        });
        saveReviewSession(sessionPath, finalized);
        out('Acceptance finalized from the canonical session (invariant evidence derived from the accepted-unit manifest and execution journals):');
        out(JSON.stringify({
            acceptanceManifestDigest: session.acceptanceManifestDigest,
            finalizedSessionPath: sessionPath,
            finalizationJournalDigest: finalized.finalizationJournalDigest,
            status: finalized.status,
        }, null, 2));
        return finalized;
    } catch (error) {
        err(`Error: acceptance finalization failed: ${error.code || 'ACCEPTANCE_FAILED'}: ${error.message}`);
        err(`If the acceptance receipt at ${tmpDir}/acceptance-${session.acceptanceManifestDigest.replace(':', '-')}.json is already durable, rerunning this command is safe: it detects the receipt, skips the Draft/scan-state mutations, and only completes session finalization.`);
        exit(1);
        return null;
    }
}

function digestSemanticReceipt(value) {
    const { digestSemantic } = require('../../doc-ops-core/src/digest');
    return digestSemantic(value);
}

function nonEmptyReceiptString(value) {
    return typeof value === 'string' && value.trim() !== '';
}

if (require.main === module) {
    runCli().catch(err => {
        console.error('Fatal error:', err.message);
        process.exit(1);
    });
}

module.exports = {
    parseArgs,
    runCli,
    finalizeAcceptance,
    createSchemaFirstArtifactProvider,
    createExecutionApprovalProvider,
    createBoundedSummary,
    withJsonConsoleIsolation,
};
