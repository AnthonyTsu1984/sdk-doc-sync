const { isDeepStrictEqual } = require('node:util');
const path = require('node:path');

const FeishuToMarkdown = require('../feishu-to-markdown');
const MarkdownToFeishu = require('../markdown-to-feishu');
const BitableWriter = require('./bitable-writer');
const DiffEngine = require('./diff-engine');
const DocGenerator = require('./doc-generator');
const { FeishuOperationalVerifier } = require('./feishu-operational-verifier');
const { validateRenderedApiBlocks } = require('./feishu-block-safety');
const SyncExecutor = require('./sync-executor');
const SyncPlanner = require('./sync-planner');
const { bitableRecordTokens, createTokenReferenceReader } = require('./token-reference-reader');
const { planApiReferencePatch } = require('./docx-section-patcher');
const sdkLayoutProfiles = require('../renderers/sdk-layout-profiles');
const PythonScanner = require('./scanners/python-scanner');
const JavaScanner = require('./scanners/java-scanner');
const NodeScanner = require('./scanners/node-scanner');
const CppScanner = require('./scanners/cpp-scanner');
const GoScanner = require('./scanners/go-scanner');
const ZillizCliScanner = require('./scanners/zilliz-cli-scanner');
const OpenApiScanner = require('./scanners/openapi-scanner');
const { buildTypeUrlIndex } = require('./type-url-index');
const { normalizedCopy, resolvePlanningContexts } = require('./release-scope/planning-context');
const { createActionBatch } = require('../../../doc-ops-core/src/action-batch');
const { digestSemantic } = require('../../../doc-ops-core/src/digest');
const { ExecutionJournal } = require('../../../doc-ops-core/src/journal');
const { assertApproval } = require('../../../doc-ops-core/src/approval-guard');
const {
    WriterGovernance,
    bindWriterGovernance,
} = require('../../../doc-ops-core/src/writer-governance');
const { createResult } = require('../../../doc-ops-core/src/result-contract');
const {
    INVARIANT_ID,
    verifyTreeDeltaPostconditions,
    WRITE_PLAN_ACTIONS,
} = require('./versioned-tree-policy');
const { buildAcceptanceManifest, buildReviewUnitManifest } = require('./review-units');
const { validateResumeSession } = require('./review-session-store');
const { compareVerbatimContent } = require('./verbatim-content');

const VERBATIM_INVARIANT_ID = 'api.pr-verbatim-content';

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

// Five levels up: src/sdk-doc-sync/ → src/ → api-reference-sync/ → skills/ →
// .claude/ → repository root. Must match bin/sdk-doc-sync.js's own resolution
// so execution journals and the acceptance finalizer agree on one location.
const REPO_ROOT = path.resolve(__dirname, '../../../../..');

// Canonical execution-journal location for a batch digest. Acceptance
// finalization resolves the journal receipt through this binding.
function journalPathForDigest(batchDigest, repoRoot = REPO_ROOT) {
    return path.resolve(repoRoot, 'tmp', 'api-reference-sync', `${batchDigest.replace(':', '-')}.jsonl`);
}

function executionSideEffects(plan) {
    switch (plan.action) {
        case 'CREATE_FOLDER': return ['feishu.drive.create_folder'];
        case 'CREATE_VIRTUAL_NODE': return ['feishu.bitable.create'];
        case 'REPOINT_CATEGORY_VIRTUAL_NODE': return ['feishu.bitable.update'];
        case 'CREATE': return ['feishu.doc.create', 'feishu.bitable.create'];
        case 'UPDATE_IN_PLACE': return ['feishu.doc.patch', 'feishu.bitable.update'];
        case 'UPDATE_RECORD_METADATA': return ['feishu.bitable.update'];
        case 'COPY_PATCH_AND_REPOINT': return ['feishu.drive.copy', 'feishu.doc.patch', 'feishu.bitable.update'];
        case 'DEPRECATE': return ['feishu.bitable.update'];
        default: return [];
    }
}

function executionTarget(plan) {
    return plan.resource?.parentFolderToken
        || plan.resource?.folderRef
        || plan.source?.documentToken
        || plan.target?.folderToken
        || plan.target?.folderRef
        || plan.stableId;
}

function normalizedDependency(dependency, knownActionIds) {
    if (knownActionIds.has(dependency)) return dependency;
    const resourceStableId = `resource:${dependency}`;
    if (knownActionIds.has(resourceStableId)) return resourceStableId;
    return null;
}

// Batch-construction enforcement for the api.versioned-tree-delta invariant:
// every document write plan must carry a well-formed attestation (bound into
// planDigest, so an approval covers the exact decision and DAG), and a
// category-create attestation's required resource DAG must be present and
// wired in the same batch — folder without an embedded repoint, repoint as a
// distinct downstream action depending on folder and document.
function assertBatchInvariantCoverage(plannedActions, planIds) {
    const byPlanId = new Map(plannedActions.map(({ plan }) => [plan.stableId, plan]));
    for (const { plan } of plannedActions) {
        if (!WRITE_PLAN_ACTIONS.has(plan.action)) continue;
        const attestation = (plan.invariantAttestations || [])
            .find(entry => entry?.id === INVARIANT_ID) || null;
        if (!attestation
            || typeof attestation.decision !== 'string'
            || !DIGEST_PATTERN.test(attestation.inputDigest || '')) {
            const error = new Error(`INVARIANT_ATTESTATION_REQUIRED: write plan ${plan.stableId} carries no valid ${INVARIANT_ID} attestation`);
            error.code = 'INVARIANT_ATTESTATION_REQUIRED';
            error.details = { actionId: plan.stableId };
            throw error;
        }
        const dag = attestation.requiredResourceDag;
        if (!dag) continue;
        for (const node of dag) {
            if (node.action === 'COPY_PATCH_AND_REPOINT') {
                if (!planIds.has(node.stableId)) {
                    const error = new Error(`TREE_DELTA_DAG_VIOLATION: attested document action ${node.stableId} is not part of this batch`);
                    error.code = 'TREE_DELTA_DAG_VIOLATION';
                    error.details = { actionId: plan.stableId, node: node.stableId };
                    throw error;
                }
                continue;
            }
            if (node.action === 'VERIFY_TREE_DELTA') continue;
            const resourcePlan = byPlanId.get(node.stableId);
            if (!resourcePlan || resourcePlan.action !== node.action) {
                const error = new Error(`TREE_DELTA_DAG_VIOLATION: required resource ${node.stableId} (${node.action}) is missing from the batch for ${plan.stableId}`);
                error.code = 'TREE_DELTA_DAG_VIOLATION';
                error.details = { actionId: plan.stableId, node: node.stableId, action: node.action };
                throw error;
            }
            if (node.action === 'CREATE_FOLDER' && resourcePlan.resource?.repointVirtualNode !== undefined) {
                const error = new Error(`TREE_DELTA_DAG_VIOLATION: folder resource ${node.stableId} must not embed the VirtualNode repoint for ${plan.stableId}`);
                error.code = 'TREE_DELTA_DAG_VIOLATION';
                error.details = { actionId: plan.stableId, node: node.stableId };
                throw error;
            }
            if (node.action === 'REPOINT_CATEGORY_VIRTUAL_NODE') {
                const dependsOn = new Set((resourcePlan.dependencies || []));
                const folderNode = dag.find(entry => entry.action === 'CREATE_FOLDER');
                // Plan dependencies store raw resource refs; the attestation
                // DAG addresses the same resources as resource:<ref> stables.
                const folderDependencies = [folderNode.stableId, folderNode.stableId.replace(/^resource:/, '')];
                const folderWired = folderDependencies.some(dependency => dependsOn.has(dependency));
                const documentWired = dependsOn.has(plan.stableId);
                if (!folderWired || !documentWired) {
                    const missing = !folderWired ? folderDependencies[0] : plan.stableId;
                    const error = new Error(`TREE_DELTA_DAG_VIOLATION: repoint resource ${node.stableId} must depend on ${missing}`);
                    error.code = 'TREE_DELTA_DAG_VIOLATION';
                    error.details = { actionId: plan.stableId, node: node.stableId, missingDependency: missing };
                    throw error;
                }
            }
        }
    }
}

function buildExecutionBatch(plannedActions, knownActionIds = new Set(plannedActions.map(({ plan }) => plan.stableId))) {
    assertBatchInvariantCoverage(plannedActions, knownActionIds);
    return createActionBatch({
        skill: 'api-reference-sync',
        operation: 'execute',
        actions: plannedActions.map(({ plan }) => ({
            actionId: plan.stableId,
            target: executionTarget(plan),
            dependsOn: (plan.dependencies || [])
                .map(dependency => normalizedDependency(dependency, knownActionIds))
                .filter(Boolean),
            sideEffects: executionSideEffects(plan),
            planDigest: digestSemantic(plan),
        })),
    });
}

function actionLabel(action, plan = null) {
    if (plan?.metadata?.artifactKind === 'dependent-resource' || action?.kind) {
        return `${plan?.action || action?.kind || 'RESOURCE'} ${action?.ref || plan?.stableId || '(unknown)'}`;
    }
    return `${action?.type || plan?.action || 'ACTION'} ${action?.slug || plan?.stableId || '(unknown)'}`;
}

function diagnosticFor(error, details = {}) {
    const message = error?.message || String(error);
    const messageCode = /^([A-Z][A-Z0-9_]+)(?::|\b)/.exec(message)?.[1];
    return {
        code: error?.code || messageCode || 'EXECUTION_BLOCKED',
        message,
        ...details,
    };
}

function blockedExecutionResult({ batch, proposedBatch, diagnostics }) {
    return createResult({
        skill: 'api-reference-sync',
        operation: 'execute',
        status: 'BLOCKED',
        diagnostics,
        evidence: {
            batchDigest: batch?.batchDigest || null,
            proposedBatchDigest: proposedBatch?.batchDigest || null,
        },
    });
}

function rawParentRecordId(fields = {}) {
    const cell = fields['父记录'] || fields.Parent;
    if (!Array.isArray(cell)) return null;
    return cell[0]?.record_ids?.[0] || cell[0]?.record_id || null;
}

function docsResourceType(link) {
    if (typeof link !== 'string') return null;
    if (link.includes('/drive/folder/')) return 'folder';
    if (link.includes('/docx/')) return 'docx';
    return null;
}

function normalizeLiveRecord(raw) {
    if (!raw) return null;
    const fields = raw.fields || {};
    const docs = fields.Docs || {};
    const link = docs.link || null;
    return {
        recordId: raw.record_id || raw.id || null,
        documentToken: link ? link.split('/').filter(Boolean).at(-1) : null,
        link,
        parentRecordId: rawParentRecordId(fields),
        version: fields['Added Since'] || fields['Last Modified At'] || null,
        lastModified: fields['Last Modified At'] || null,
        state: fields.Progress || null,
        progress: fields.Progress || null,
        type: fields.Type || null,
        docsResourceType: docsResourceType(link),
        targets: fields.Targets || [],
        metadata: {
            type: fields.Type || null,
            docsResourceType: docsResourceType(link),
        },
    };
}

function liveRecordReader(bitableWriter) {
    if (typeof bitableWriter?.getRecord !== 'function') return null;
    return async (recordId) => {
        // A just-created record can be momentarily unreadable (eventual
        // consistency); the post-execution verifier must not fail the batch on
        // that race.
        let lastError = null;
        for (let attempt = 1; attempt <= 6; attempt += 1) {
            try {
                return normalizeLiveRecord(await bitableWriter.getRecord(recordId));
            } catch (error) {
                lastError = error;
                if (attempt < 6) {
                    await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
                }
            }
        }
        throw lastError;
    };
}

function liveDocumentReader(documentWriter) {
    if (typeof documentWriter?.listFolder !== 'function') return null;
    return async (documentToken, { expectedFolderToken = null } = {}) => {
        if (!expectedFolderToken) {
            if (typeof documentWriter.get_document_blocks === 'function') {
                await documentWriter.get_document_blocks(documentToken);
            }
            return { token: documentToken, folderToken: null };
        }
        const files = await documentWriter.listFolder({ folderToken: expectedFolderToken, type: 'all' });
        const item = (files || []).find((file) => (
            file.token === documentToken
            || file.file_token === documentToken
            || file.obj_token === documentToken
        ));
        if (!item) return null;
        return { token: documentToken, folderToken: expectedFolderToken, resource: item };
    };
}

/**
 * SdkDocSync — orchestrates the 5-phase pipeline: SCAN → INDEX → DIFF → APPROVE → EXECUTE
 *
 * Version-incremental: takes a previous version's bitable as baseline,
 * produces a delta of new/updated/deprecated records for the new version.
 *
 * In the EXECUTE phase, this class only handles mechanical operations
 * (bitable record CRUD, doc creation via push_markdown). The actual doc
 * content is expected to be provided by the caller (e.g., a Claude skill
 * that reads source code and writes intelligent documentation).
 */
class SdkDocSync {
    constructor({
        scanner = null,
        rootToken,
        baseToken,
        previousBaseToken = null,
        sourceType = 'drive',
        sdkVersion,
        sdkName,
        language = 'python',
        sdkDir = null,
        targets = [],
        approvalCallback = null,
        executionApprovalProvider = null,
        onProgress = null,
        dryRun = false,
        publicOnly = true,
        include = [],
        exclude = [],
        indexReader = null,
        typeIndexReader = null,
        planner = null,
        executor = null,
        verifier = null,
        artifactProvider = null,
        artifacts = null,
        planningContextProvider = null,
        documentWriter = null,
        bitableWriter = null,
        docGenerator = null,
        printPlans = true,
        releaseScope = null,
        changedOnly = false,
        documentBlockReader = null,
        artifactBlockRenderer = null,
        apiPatchPlanner = planApiReferencePatch,
        executionJournalFactory = null,
        collaborativeReview = false,
        reviewUnitId = null,
        reviewSession = null,
        tokenReferenceReader = null,
        tokenReferenceTracks = [],
    }) {
        this.rootToken = rootToken;
        this.baseToken = baseToken;
        this.previousBaseToken = previousBaseToken;
        this.sourceType = sourceType;
        this.sdkVersion = sdkVersion;
        this.sdkName = sdkName;
        this.language = language;
        this.dryRun = dryRun;
        this.approvalCallback = approvalCallback;
        this.executionApprovalProvider = executionApprovalProvider;
        this.onProgress = onProgress || ((phase, msg) => console.log(`[${phase}] ${msg}`));
        this.artifactProvider = artifactProvider || artifacts;
        this.planningContextProvider = planningContextProvider;
        this.printPlans = printPlans;
        this.releaseScope = releaseScope;
        this.changedOnly = changedOnly;
        this._planningContexts = new WeakMap();

        // Build scanner if not provided
        if (scanner) {
            this.scanner = scanner;
        } else if (sdkDir) {
            this.scanner = this._createScanner(language, { rootDir: sdkDir, publicOnly, include, exclude });
        } else {
            throw new Error('Either scanner or sdkDir must be provided');
        }

        this.diffEngine = new DiffEngine({ sdkVersion });
        this.planner = planner || new SyncPlanner();
        this.docGenerator = docGenerator || new DocGenerator({ sdkName, sdkVersion, targets, language });

        // INDEX is a read in both live and dry-run modes. Writers are only
        // constructed for live runs, but injectable writer spies remain useful
        // for proving the dry-run mutation boundary.
        const indexBaseToken = previousBaseToken || baseToken;
        this.indexReader = indexReader || new FeishuToMarkdown({
            sourceType,
            rootToken,
            baseToken: indexBaseToken,
        });
        this.typeIndexReader = typeIndexReader || this.indexReader;
        this.typeUrls = Object.freeze({});
        this.f2m = this.indexReader;
        this.documentBlockReader = documentBlockReader
            || (typeof this.indexReader?.readBlocks === 'function' ? this.indexReader : null);
        this.artifactBlockRenderer = artifactBlockRenderer;
        this.apiPatchPlanner = apiPatchPlanner;
        this.executionJournalFactory = executionJournalFactory;
        this.collaborativeReview = collaborativeReview === true;
        this.reviewUnitId = reviewUnitId;
        this.reviewSession = reviewSession;
        this.m2f = documentWriter || null;
        this.bitableWriter = bitableWriter || null;
        this.executor = executor || null;
        this.verifier = verifier || null;
        this.tokenReferenceReader = tokenReferenceReader || null;

        if (!dryRun) {
            // Writers refuse every mutation until this governance is bound to
            // the approved execution batch (see run()), so no code path —
            // canonical or incidental — can write without the verified approval.
            this.writerGovernance = new WriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
            this.m2f = this.m2f || new MarkdownToFeishu({ sourceType, rootToken, baseToken, governance: this.writerGovernance });
            const usingInjectedBitableWriter = Boolean(this.bitableWriter);
            this.bitableWriter = this.bitableWriter || new BitableWriter({ baseToken, governance: this.writerGovernance });
            this.verifier = this.verifier || new FeishuOperationalVerifier({
                readDocument: liveDocumentReader(this.m2f),
                readRecord: liveRecordReader(this.bitableWriter),
                governance: this.writerGovernance,
            });
            // Cross-track token reference reader for the executor's pre-write
            // shared-token revalidation. The current base is enumerated through
            // the (possibly injected) bitableWriter; adjacent bases are added
            // only for production runs so injected test spies never trigger
            // network reads against registry tokens.
            const referenceTracks = [];
            if (typeof this.bitableWriter?.listRecords === 'function') {
                referenceTracks.push({
                    version: sdkVersion,
                    baseToken: baseToken || null,
                    listDocumentTokens: async () => bitableRecordTokens(await this.bitableWriter.listRecords()),
                });
            }
            if (!usingInjectedBitableWriter) {
                const adjacent = [...(tokenReferenceTracks || [])];
                if (previousBaseToken && previousBaseToken !== baseToken
                    && !adjacent.some((track) => track?.baseToken === previousBaseToken)) {
                    adjacent.push({ version: null, baseToken: previousBaseToken, tableId: null });
                }
                for (const track of adjacent) {
                    if (!track?.baseToken || track.baseToken === baseToken) continue;
                    referenceTracks.push({
                        version: track.version || null,
                        baseToken: track.baseToken,
                        listDocumentTokens: async () => bitableRecordTokens(
                            await new BitableWriter({ baseToken: track.baseToken, tableId: track.tableId || null }).listRecords(),
                        ),
                    });
                }
            }
            this.executor = this.executor || new SyncExecutor({
                documentWriter: this.m2f,
                bitableWriter: this.bitableWriter,
                verifier: this.verifier,
                tokenReferenceReader: tokenReferenceReader
                    || (referenceTracks.length > 0 ? createTokenReferenceReader({ tracks: referenceTracks }) : null),
            });
            this.tokenReferenceReader = this.executor.tokenReferenceReader || tokenReferenceReader || null;
        }
    }

    _createScanner(language, opts) {
        switch (language) {
            case 'python':
                return new PythonScanner(opts);
            case 'java':
                return new JavaScanner(opts);
            case 'node':
                return new NodeScanner(opts);
            case 'cpp':
                return new CppScanner(opts);
            case 'go':
                return new GoScanner(opts);
            case 'zilliz-cli':
                return new ZillizCliScanner(opts);
            case 'rest':
                return new OpenApiScanner(opts);
            default:
                throw new Error(`Unsupported language: ${language}. Supported: python, java, node, cpp, go, zilliz-cli, rest`);
        }
    }

    async run() {
        const result = {
            scanned: [],
            indexed: [],
            diff: [],
            resourcePlans: [],
            plans: [],
            planningErrors: [],
            approved: [],
            results: [],
        };

        // Phase 1: SCAN
        this.onProgress('SCAN', `Scanning source code in ${this.scanner.rootDir}...`);
        result.scanned = this._filterByReleaseScope(await this.scanner.scan());
        if (this.releaseScope) {
            result.releaseScope = {
                baselineTag: this.releaseScope.baselineTag,
                targetTag: this.releaseScope.targetTag,
                releaseRange: this.releaseScope.releaseRange,
                approvalGrade: this.releaseScope.approvalGrade,
                actionCount: this.releaseScope.actions.length,
            };
        }
        this.onProgress('SCAN', `Found ${result.scanned.length} symbols`);

        // Phase 2: INDEX (read previous version's bitable as baseline)
        const source = this.previousBaseToken ? 'previous version' : 'current';
        this.onProgress('INDEX', `Fetching ${source} KB index...`);
        const completeIndex = await this._readIndex();
        const typeIndex = this.typeIndexReader === this.indexReader
            ? completeIndex
            : await this._readTypeIndex();
        this.typeUrls = buildTypeUrlIndex(typeIndex);
        result.indexed = this._filterIndexedByReleaseScope(completeIndex);
        this.onProgress('INDEX', `Found ${result.indexed.length} existing documents`);

        // Phase 3: DIFF
        this.onProgress('DIFF', 'Computing diff between source and KB...');
        this._applyReleaseScopeCategoryMap();
        result.diff = this._applyReleaseScopeDiffActions(this.diffEngine.diff(result.scanned, result.indexed));
        if (this.changedOnly) {
            result.diff = result.diff.filter((action) => action.type !== 'SKIP');
        }

        const summary = this._summarizeDiff(result.diff);
        this.onProgress('DIFF', `${summary.create} new, ${summary.update} updated, ${summary.deprecate} deprecated, ${summary.skip} unchanged, ${summary.orphan} orphaned`);

        // Phase 4: PLAN. Dry and live modes share this exact path; planning is
        // read-only and never invokes DocGenerator scaffold generation.
        this.onProgress('PLAN', `Planning ${result.diff.length} actions...`);
        // Units this review session has already executed keep a live record the
        // execution itself created; re-planning them must not treat that record
        // as a foreign CREATE-conflict.
        const sessionExecutedDocumentIds = this._sessionExecutedDocumentIds();
        const plannedEntries = [];
        for (const resource of this.releaseScope?.resources || []) {
            try {
                const plan = this.planner.planResource(resource);
                result.resourcePlans.push(plan);
                plannedEntries.push({ kind: 'resource', action: resource, plan, context: {} });
            } catch (error) {
                result.planningErrors.push({
                    stableId: resource?.ref ? `resource:${resource.ref}` : null,
                    diffAction: resource?.kind || 'RESOURCE',
                    code: error.code || 'RESOURCE_PLANNING_FAILED',
                    message: error.message,
                });
            }
        }
        for (const [index, action] of result.diff.entries()) {
            try {
                if (action.planningConflict) {
                    throw new SyncPlanner.SyncPlanningError(
                        action.planningConflict.code,
                        action.planningConflict.message,
                        action.planningConflict.details,
                    );
                }
                const context = await this._planningContextFor(action, index, result);
                const schemaStableId = context.artifact?.reference?.identity?.stableId;
                const plannableAction = schemaStableId && !action.stableId
                    ? { ...action, stableId: schemaStableId }
                    : action;
                if (sessionExecutedDocumentIds?.has(plannableAction.stableId)) {
                    context.reviewSessionExecuted = true;
                }
                const plan = this.planner.planAction(plannableAction, context);
                result.plans.push(plan);
                plannedEntries.push({ kind: 'document', action: plannableAction, plan, context });
                this._planningContexts.set(plannableAction, context);
            } catch (error) {
                result.planningErrors.push({
                    stableId: this._stableIdFor(action),
                    diffAction: action.type,
                    code: error.code || 'PLANNING_FAILED',
                    message: error.message,
                });
            }
        }
        this.onProgress('PLAN', `${result.resourcePlans.length} resources and ${result.plans.length} documents planned, ${result.planningErrors.length} failed`);

        const fullActionablePlanned = plannedEntries.filter(({ plan }) => plan.action !== 'NOOP');
        const fullActionablePlanIds = new Set(fullActionablePlanned.map(({ plan }) => plan.stableId));
        result.proposedReleaseBatch = buildExecutionBatch(fullActionablePlanned, fullActionablePlanIds);
        const reviewUnits = buildReviewUnitManifest(
            this.reviewSession ? plannedEntries : fullActionablePlanned,
            buildExecutionBatch,
            {
                documentStableIds: this.reviewSession
                    ? this.reviewSession.reviewUnitManifest.units.map((unit) => unit.documentStableId)
                    : null,
            },
        );
        result.reviewUnitManifest = reviewUnits.manifest;
        result.reviewUnitPreviews = reviewUnits.units;
        const verifiedAcceptedReviewUnitIds = new Set();
        let activeExecutionReviewUnitId = null;

        if (this.reviewSession) {
            try {
                const resumed = validateResumeSession({
                    session: this.reviewSession,
                    reviewUnitManifest: reviewUnits.manifest,
                    currentRecords: typeIndex,
                });
                for (const unitId of resumed.acceptedReviewUnitIds) verifiedAcceptedReviewUnitIds.add(unitId);
                activeExecutionReviewUnitId = resumed.activeReviewUnitId;
                result.reviewSession = {
                    sessionId: this.reviewSession.sessionId,
                    acceptedReviewUnitIds: resumed.acceptedReviewUnitIds,
                    reviewUnitManifestDigest: this.reviewSession.reviewUnitManifestDigest,
                    activeReviewUnitId: activeExecutionReviewUnitId,
                };
            } catch (error) {
                result.planningErrors.push({
                    stableId: null,
                    diffAction: 'REVIEW_SESSION',
                    code: 'REVIEW_SESSION_INVALID',
                    message: error.message,
                });
            }
        }

        let actionablePlanned = fullActionablePlanned;
        let actionablePlanIds = fullActionablePlanIds;
        if (this.collaborativeReview) {
            if (activeExecutionReviewUnitId) {
                result.planningErrors.push({
                    stableId: activeExecutionReviewUnitId,
                    diffAction: 'REVIEW_UNIT',
                    code: 'ACTIVE_DOCUMENT_REVIEW_REQUIRED',
                    message: `${activeExecutionReviewUnitId} must be accepted or rolled back before another write`,
                });
            }
            if (reviewUnits.manifest.unassignedResourceActionIds.length > 0) {
                result.planningErrors.push({
                    stableId: null,
                    diffAction: 'RESOURCE',
                    code: 'UNASSIGNED_REVIEW_UNIT_RESOURCE',
                    message: `Every resource action must belong to one document review unit: ${reviewUnits.manifest.unassignedResourceActionIds.join(', ')}`,
                });
            }
            const selectableUnits = reviewUnits.units.filter((unit) => (
                unit.actionIds.length > 0 && !verifiedAcceptedReviewUnitIds.has(unit.reviewUnitId)
            ) && !activeExecutionReviewUnitId);
            result.remainingReviewUnitIds = selectableUnits.map((unit) => unit.reviewUnitId);
            result.allReviewUnitsAccepted = reviewUnits.manifest.units.length > 0
                && reviewUnits.manifest.units.every((unit) => verifiedAcceptedReviewUnitIds.has(unit.reviewUnitId));
            let selectedUnit = this.reviewUnitId
                ? selectableUnits.find((unit) => unit.reviewUnitId === this.reviewUnitId)
                : null;
            if (!selectedUnit && !this.reviewUnitId && selectableUnits.length === 1) {
                [selectedUnit] = selectableUnits;
            }
            if (this.reviewUnitId && !selectedUnit) {
                result.planningErrors.push({
                    stableId: this.reviewUnitId,
                    diffAction: 'REVIEW_UNIT',
                    code: 'REVIEW_UNIT_NOT_FOUND',
                    message: `Unknown review unit: ${this.reviewUnitId}`,
                });
            }
            if (selectedUnit) {
                const missingPrerequisites = selectedUnit.prerequisiteReviewUnitIds
                    .filter((unitId) => !verifiedAcceptedReviewUnitIds.has(unitId));
                if (missingPrerequisites.length > 0) {
                    result.planningErrors.push({
                        stableId: selectedUnit.documentStableId,
                        diffAction: 'REVIEW_UNIT',
                        code: 'REVIEW_UNIT_PREREQUISITE_NOT_ACCEPTED',
                        message: `${selectedUnit.reviewUnitId} requires accepted units: ${missingPrerequisites.join(', ')}`,
                    });
                }
                result.activeReviewUnit = selectedUnit;
                actionablePlanned = reviewUnits.entriesByUnitId.get(selectedUnit.reviewUnitId) || [];
                actionablePlanIds = new Set(actionablePlanned.map(({ plan }) => plan.stableId));
            } else if (selectableUnits.length > 1) {
                result.reviewUnitSelectionRequired = true;
                actionablePlanned = [];
                actionablePlanIds = new Set();
            }
        }
        result.proposedExecutionBatch = actionablePlanned.length > 0
            ? buildExecutionBatch(actionablePlanned, actionablePlanIds)
            : fullActionablePlanned.length === 0
                ? result.proposedReleaseBatch
                : null;

        // Gate presentation (NOT part of the signed batch): markdown preview
        // and direct links for the exact plans the write approval would cover.
        if (this.dryRun && actionablePlanned.length > 0) {
            result.writeApprovalPresentation = await this._buildWriteApprovalPresentation(actionablePlanned);
        }

        if (this.dryRun) {
            this.onProgress('APPROVE', 'Dry run — showing plans without executing');
            if (this.printPlans) this._printPlans(result.plans);
            result.approved = [];
            return result;
        }

        if (this.collaborativeReview && result.reviewUnitSelectionRequired) {
            result.executionResult = blockedExecutionResult({
                batch: null,
                proposedBatch: result.proposedReleaseBatch,
                diagnostics: [{
                    code: 'REVIEW_UNIT_REQUIRED',
                    message: 'Select exactly one document review unit before live execution.',
                }],
            });
            return result;
        }
        if (this.collaborativeReview && result.planningErrors.length > 0) {
            result.executionResult = blockedExecutionResult({
                batch: result.proposedExecutionBatch,
                proposedBatch: result.proposedReleaseBatch,
                diagnostics: result.planningErrors.map((error) => diagnosticFor(new Error(error.message), error)),
            });
            return result;
        }

        // Phase 5: APPROVE. Actions that did not produce a valid immutable plan
        // never reach approval or execution.
        const actionable = actionablePlanned.map(({ action }) => action);
        if (actionable.length === 0) {
            this.onProgress('APPROVE', 'Nothing to do — all symbols are up to date');
            result.approved = [];
            return result;
        }

        if (this.approvalCallback) {
            this.onProgress('APPROVE', `${actionable.length} actions pending approval`);
            result.approved = await this.approvalCallback(actionable);
        } else {
            result.approved = actionable;
        }

        if (result.approved.length === 0) {
            this.onProgress('APPROVE', 'All actions rejected');
            return result;
        }

        const approvedPlans = result.approved.map((action) => {
            const planned = plannedEntries.find((entry) => entry.action === action)
                || plannedEntries.find((entry) => entry.plan === action);
            if (!planned) throw new Error(`Approved action was not planned: ${this._stableIdFor(action) || '(unknown)'}`);
            return planned;
        });
        try {
            result.executionBatch = buildExecutionBatch(approvedPlans, actionablePlanIds);
        } catch (error) {
            result.executionResult = blockedExecutionResult({
                batch: null,
                proposedBatch: result.proposedExecutionBatch,
                diagnostics: [diagnosticFor(error)],
            });
            return result;
        }
        const journal = this.executionJournalFactory
            ? this.executionJournalFactory(result.executionBatch)
            : new ExecutionJournal({
                filePath: journalPathForDigest(result.executionBatch.batchDigest),
                batchDigest: result.executionBatch.batchDigest,
                approvedActionIds: result.executionBatch.actions.map(action => action.actionId),
            });
        if (journal.read().length > 0) {
            result.executionResult = blockedExecutionResult({
                batch: result.executionBatch,
                proposedBatch: result.proposedExecutionBatch,
                diagnostics: [{
                    code: 'EXECUTION_RECONCILIATION_REQUIRED',
                    message: 'An existing journal must be reconciled before replay.',
                }],
            });
            return result;
        }

        const approvals = new Map();
        const approvalDiagnostics = [];
        if (!this.executionApprovalProvider) {
            approvalDiagnostics.push({
                code: 'EXECUTION_APPROVAL_PROVIDER_REQUIRED',
                message: 'Exact batch approval is required before execution.',
            });
        } else {
            for (const planned of approvedPlans) {
                try {
                    const approval = await this.executionApprovalProvider(planned.plan, planned.action, result.executionBatch);
                    assertApproval(approval, {
                        skill: result.executionBatch.skill,
                        operation: result.executionBatch.operation,
                        batchDigest: result.executionBatch.batchDigest,
                        actionCount: result.executionBatch.actions.length,
                        targets: result.executionBatch.targets,
                        sideEffects: result.executionBatch.sideEffects,
                    });
                    approvals.set(planned.plan.stableId, approval);
                } catch (error) {
                    approvalDiagnostics.push(diagnosticFor(error, { actionId: planned.plan.stableId }));
                }
            }
        }
        if (approvalDiagnostics.length > 0) {
            result.executionResult = blockedExecutionResult({
                batch: result.executionBatch,
                proposedBatch: result.proposedExecutionBatch,
                diagnostics: approvalDiagnostics,
            });
            return result;
        }

        // Every writer mutation below this line is gated on the governance
        // bound to this verified batch: envelope first, then execution. The
        // envelope is the one the execution approval provider issued and the
        // per-plan loop already verified against the batch — binding never
        // manufactures its own approval, so weakening or removing that loop
        // also removes the writer's license to mutate.
        const governance = this.writerGovernance
            || new WriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
        const issuedApproval = approvals.get(approvedPlans[0].plan.stableId);
        governance.bindApproval({
            batchDigest: result.executionBatch.batchDigest,
            actionCount: result.executionBatch.actions.length,
            targets: result.executionBatch.targets,
            sideEffects: result.executionBatch.sideEffects,
            approval: issuedApproval,
            invariantAttestations: approvedPlans.flatMap(({ plan }) => plan.invariantAttestations || []),
            // Batch targets are folder/document-level refs while the executor
            // resolves per-record ids live during execution, so per-call target
            // enforcement stays off here; the acceptance finalizer binds the
            // exact recordId list with enforceTargets enabled.
            enforceTargets: false,
        });
        bindWriterGovernance(this.m2f, governance);
        bindWriterGovernance(this.bitableWriter, governance);

        // Phase 6: EXECUTE
        this.onProgress('EXECUTE', `Executing ${result.executionBatch.actions.length} actions...`);
        const approvedById = new Map(approvedPlans.map(entry => [entry.plan.stableId, entry]));
        const executionStatus = new Map();
        const resourceResolutions = new Map();
        for (const batchAction of result.executionBatch.actions) {
            const planned = approvedById.get(batchAction.actionId);
            const action = planned?.action;
            try {
                if (!planned) throw new Error(`Approved action was not planned: ${batchAction.actionId}`);
                const failedDependencies = batchAction.dependsOn.filter(dependency => executionStatus.get(dependency) !== 'success');
                const rollbackCapsule = failedDependencies.length === 0 && typeof this.executor.prepareRollback === 'function'
                    ? await this.executor.prepareRollback(planned.plan, { resourceResolutions })
                    : null;
                journal.prepared({
                    actionId: planned.plan.stableId,
                    dependsOn: batchAction.dependsOn,
                    preconditionDigest: digestSemantic(planned.plan.preconditions || []),
                    mutation: { action: planned.plan.action, artifactDigest: planned.plan.artifactDigest },
                    // Attested invariant ids ride the prepared entry so the
                    // acceptance finalizer can require per-invariant
                    // evidence (e.g. content-fidelity for verbatim pages)
                    // without trusting the caller.
                    invariantAttestationIds: (planned.plan.invariantAttestations || [])
                        .map((attestation) => attestation?.id)
                        .filter((id) => typeof id === 'string' && id.length > 0),
                    rollbackCapsule,
                });
                if (failedDependencies.length > 0) {
                    const error = new Error(`DEPENDENCY_EXECUTION_FAILED: ${planned.plan.stableId} blocked by ${failedDependencies.join(', ')}`);
                    error.code = 'DEPENDENCY_EXECUTION_FAILED';
                    const blocked = {
                        action,
                        status: 'error',
                        failedStep: 'dependency',
                        error,
                        failedDependencies,
                    };
                    result.results.push(blocked);
                    executionStatus.set(planned.plan.stableId, 'failure');
                    journal.observed({
                        actionId: planned.plan.stableId,
                        status: 'failure',
                        verified: false,
                        observedDigest: digestSemantic({ code: error.code, failedDependencies }),
                        diagnostics: [diagnosticFor(error, { failedDependencies })],
                    });
                    this.onProgress('EXECUTE', `${actionLabel(action, planned.plan)} — BLOCKED: dependency failure`);
                    continue;
                }
                const execResult = await this.executor.execute(planned.plan, {
                    action: planned.action,
                    artifact: planned.context.artifact,
                    approval: approvals.get(planned.plan.stableId),
                    approvalContext: result.executionBatch,
                    resourceResolutions,
                    rollbackCapsule,
                });
                result.results.push({ action, status: 'success', ...execResult });
                const succeeded = execResult.status !== 'error' && execResult.verification?.ok !== false;
                executionStatus.set(planned.plan.stableId, succeeded ? 'success' : 'failure');
                if (succeeded && execResult.resolvedResource?.ref) {
                    resourceResolutions.set(execResult.resolvedResource.ref, execResult.resolvedResource);
                }
                const rollbackEvidence = typeof this.executor.observeRollback === 'function'
                    ? await this.executor.observeRollback(planned.plan, execResult)
                    : {
                        schemaVersion: 1,
                        action: planned.plan.action,
                        actionId: planned.plan.stableId,
                        completedSteps: execResult.completedSteps || [],
                        createdDocument: execResult.createdDocument || null,
                        createdFolder: execResult.createdFolder || null,
                        recordId: execResult.record?.record_id || execResult.record?.recordId || null,
                        resolvedResource: execResult.resolvedResource || null,
                    };
                journal.observed({
                    actionId: planned.plan.stableId,
                    status: succeeded ? 'success' : 'failure',
                    verified: succeeded,
                    observedDigest: digestSemantic(rollbackEvidence),
                    rollbackEvidence,
                });
                if (execResult.status === 'error') {
                    this.onProgress('EXECUTE', `${actionLabel(action, planned.plan)} — ERROR: ${execResult.error?.message || execResult.failedStep}`);
                } else {
                    this.onProgress('EXECUTE', `${actionLabel(action, planned.plan)} — success`);
                }
            } catch (err) {
                result.results.push({ action, status: 'error', error: err.message });
                if (planned) executionStatus.set(planned.plan.stableId, 'failure');
                if (planned && journal.read().some(entry => entry.type === 'prepared' && entry.actionId === planned.plan.stableId)
                    && !journal.read().some(entry => entry.type === 'observed' && entry.actionId === planned.plan.stableId)) {
                    journal.observed({
                        actionId: planned.plan.stableId,
                        status: 'failure',
                        verified: false,
                        observedDigest: digestSemantic({ errorCode: err.code || null, message: err.message }),
                    });
                }
                this.onProgress('EXECUTE', `${actionLabel(action, planned?.plan)} — ERROR: ${err.message}`);
            }
        }

        // Phase 6b: VERIFY_TREE_DELTA — batch-level post-write verification of
        // every attested document action against freshly refetched state. The
        // outcomes persist in the execution journal; a failed verification
        // keeps the writes but blocks acceptance via the diagnostics below.
        result.treeDeltaVerifications = [];
        const repointRecordIds = new Map();
        for (const entry of result.results) {
            if (entry.status === 'success' && entry.resolvedResource?.kind === 'virtual_node_repoint') {
                repointRecordIds.set(`resource:${entry.resolvedResource.ref}`, entry.resolvedResource.recordId);
            }
        }
        for (const entry of result.results) {
            const plan = entry.plan;
            if (entry.status !== 'success' || !plan || !WRITE_PLAN_ACTIONS.has(plan.action)) continue;
            const attestation = (plan.invariantAttestations || [])
                .find(candidate => candidate?.id === INVARIANT_ID);
            if (!attestation) continue;
            const { observed, observationErrors } = await this._observeTreeDelta(plan, entry, attestation, {
                repointRecordIds,
                resourceResolutions,
            });
            let outcome;
            if (observationErrors.length > 0) {
                outcome = {
                    actionId: plan.stableId,
                    invariantId: INVARIANT_ID,
                    decision: attestation.decision,
                    ok: false,
                    errors: observationErrors,
                };
            } else {
                const verified = verifyTreeDeltaPostconditions({ plan, observed });
                outcome = {
                    actionId: plan.stableId,
                    invariantId: verified.invariantId,
                    decision: verified.decision,
                    ok: verified.ok,
                    errors: verified.errors,
                };
            }
            outcome.observedDigest = digestSemantic(observed);
            result.treeDeltaVerifications.push(outcome);
            journal.treeDelta(outcome);
        }
        const treeDeltaFailures = result.treeDeltaVerifications.filter(outcome => !outcome.ok);

        // Post-write verbatim content verification: for every action whose
        // plan attests api.pr-verbatim-content, refetch the document's
        // raw_content and compare it against the attested upstream markdown
        // through the declared canonicalization. Evidence persists in the
        // journal (type content-fidelity) before the completion sentinel so
        // acceptance consumers can reject a batch whose verbatim pages
        // drifted (api.pr-verbatim-content).
        result.contentFidelityVerifications = result.contentFidelityVerifications || [];
        for (const planned of approvedPlans) {
            const verbatimAttestation = (planned.plan.invariantAttestations || [])
                .find((item) => item?.id === VERBATIM_INVARIANT_ID);
            if (!verbatimAttestation) continue;
            const execResult = result.results.find((entry) => entry.action === planned.action
                && entry.status === 'success') || {};
            const documentToken = execResult.patchedDocument?.token
                || execResult.createdDocument?.token
                || planned.plan.source?.documentToken
                || null;
            let outcome;
            if (!documentToken || typeof this.m2f.getRawContent !== 'function') {
                outcome = {
                    actionId: planned.plan.stableId,
                    invariantId: VERBATIM_INVARIANT_ID,
                    decision: verbatimAttestation.decision,
                    ok: false,
                    errors: [{ code: 'VERBATIM_REFETCH_UNAVAILABLE', documentToken }],
                };
            } else {
                try {
                    const rawContent = await this.m2f.getRawContent(documentToken);
                    const comparison = compareVerbatimContent({
                        expectedContent: planned.context?.artifact?.content ?? '',
                        rawContent,
                        pageTitle: planned.context?.artifact?.title || null,
                    });
                    outcome = {
                        actionId: planned.plan.stableId,
                        invariantId: VERBATIM_INVARIANT_ID,
                        decision: verbatimAttestation.decision,
                        documentToken,
                        ok: comparison.ok,
                        errors: comparison.ok ? [] : comparison.diffs,
                    };
                } catch (error) {
                    outcome = {
                        actionId: planned.plan.stableId,
                        invariantId: VERBATIM_INVARIANT_ID,
                        decision: verbatimAttestation.decision,
                        documentToken,
                        ok: false,
                        errors: [{ code: error.code || 'VERBATIM_REFETCH_FAILED', message: error.message }],
                    };
                }
            }
            result.contentFidelityVerifications.push(outcome);
            journal.contentFidelity(outcome);
        }
        const contentFidelityFailures = (result.contentFidelityVerifications || [])
            .filter(outcome => !outcome.ok);

        const journalEntries = journal.read();
        const observedActionIds = new Set(journalEntries.filter(entry => entry.type === 'observed').map(entry => entry.actionId));
        const missingObserved = result.executionBatch.actions
            .map(action => action.actionId)
            .filter(actionId => !observedActionIds.has(actionId));
        if (missingObserved.length > 0) {
            result.executionResult = blockedExecutionResult({
                batch: result.executionBatch,
                proposedBatch: result.proposedExecutionBatch,
                diagnostics: missingObserved.map(actionId => ({
                    code: 'EXECUTION_RECONCILIATION_REQUIRED',
                    actionId,
                    message: `Action ${actionId} has no durable observed result; reconcile before replay.`,
                })),
            });
            return result;
        }

        journal.complete();
        result.executionJournalPath = journal.filePath;
        result.executionJournalDigest = digestSemantic(journal.read());
        result.documentReviewPresentation = await this._buildDocumentReviewPresentation(result);
        const failedResults = result.results.filter(entry => entry.status === 'error');
        result.executionResult = createResult({
            skill: 'api-reference-sync',
            operation: 'execute',
            status: failedResults.length === 0 && treeDeltaFailures.length === 0 && contentFidelityFailures.length === 0 ? 'EXECUTED' : 'PARTIAL',
            diagnostics: [
                ...failedResults.map(entry => diagnosticFor(entry.error, {
                    actionId: this._stableIdFor(entry.action),
                })),
                ...treeDeltaFailures.map(outcome => ({
                    code: 'TREE_DELTA_VERIFICATION_FAILED',
                    actionId: outcome.actionId,
                    message: `Post-write tree-delta verification failed for ${outcome.actionId}`,
                    errors: outcome.errors,
                })),
                ...contentFidelityFailures.map(outcome => ({
                    code: 'VERBATIM_CONTENT_VERIFICATION_FAILED',
                    actionId: outcome.actionId,
                    message: `Post-write verbatim content verification failed for ${outcome.actionId}`,
                    errors: outcome.errors,
                })),
            ],
            artifactPaths: [journal.filePath],
            evidence: {
                batchDigest: result.executionBatch.batchDigest,
                executionJournalDigest: result.executionJournalDigest,
                treeDeltaVerifications: result.treeDeltaVerifications.length,
                treeDeltaFailures: treeDeltaFailures.length,
                contentFidelityVerifications: result.contentFidelityVerifications.length,
                contentFidelityFailures: contentFidelityFailures.length,
            },
        });

        this.onProgress('EXECUTE', `Done. ${result.results.filter(r => r.status === 'success').length}/${result.approved.length} succeeded`);
        return result;
    }

    driveFolderLink(token) {
        const host = (process.env.FEISHU_DOC_HOST || 'https://zilliverse.feishu.cn').replace(/\/$/, '');
        return `${host}/drive/folder/${token}`;
    }

    docxLink(token) {
        if (!token) return null;
        const host = (process.env.FEISHU_DOC_HOST || 'https://zilliverse.feishu.cn').replace(/\/$/, '');
        return `${host}/docx/${token}`;
    }

    async recordLink(recordId) {
        if (!recordId || !this.baseToken) return null;
        const host = (process.env.FEISHU_DOC_HOST || 'https://zilliverse.feishu.cn').replace(/\/$/, '');
        let tableId = this._cachedTableId || null;
        if (!tableId) {
            try {
                tableId = await this.bitableWriter?._resolveTableId?.() || null;
                this._cachedTableId = tableId;
            } catch {
                tableId = null;
            }
        }
        return `${host}/base/${this.baseToken}${tableId ? `?table=${tableId}&record=${recordId}` : `?record=${recordId}`}`;
    }

    // Standardized WRITE_APPROVAL gate payload: what will land (markdown) and
    // where it will land (direct doc/record links) for the exact batch the
    // digest covers. Presentation only — never part of the signed batch.
    async _buildWriteApprovalPresentation(plannedEntries) {
        if (!Array.isArray(plannedEntries)) return [];
        const entries = [];
        for (const planned of plannedEntries) {
            const { action, plan, context } = planned;
            if (!plan || plan.action === 'NOOP') continue;
            entries.push({
                stableId: plan.stableId,
                action: plan.action,
                title: context?.artifact?.title || action?.slug || plan.stableId,
                documentLink: this.docxLink(plan?.source?.documentToken),
                recordLink: await this.recordLink(plan?.source?.recordId),
                markdownPreview: typeof context?.artifact?.content === 'string' ? context.artifact.content : null,
            });
        }
        return entries;
    }

    // Standardized DOCUMENT_REVIEW gate payload: direct links to the live
    // page and record for every action this execution touched.
    async _buildDocumentReviewPresentation(result) {
        const host = (process.env.FEISHU_DOC_HOST || 'https://zilliverse.feishu.cn').replace(/\/$/, '');
        const units = [];
        const seen = new Set();
        for (const entry of result.results || []) {
            const verification = entry.verification || {};
            const documentToken = verification.document?.token || entry.patchedDocument?.token || entry.createdDocument?.token || null;
            const recordId = verification.record?.recordId || entry.record?.record_id || null;
            const key = `${documentToken}|${recordId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            units.push({
                stableId: entry.action?.stableId || this._stableIdFor(entry.action) || entry.slug || null,
                documentLink: this.docxLink(documentToken),
                recordLink: await this.recordLink(recordId),
                progress: verification.record?.progress || null,
            });
        }
        return {
            journalDigest: result.executionJournalDigest || null,
            units,
        };
    }

    _resolvedResourceToken(resourceResolutions, ref) {
        if (!ref) return null;
        const resolution = resourceResolutions instanceof Map ? resourceResolutions.get(ref) : resourceResolutions?.[ref];
        return resolution?.value || resolution?.token || null;
    }

    // Refetches the drift-prone state VERIFY_TREE_DELTA asserts on. Read-only:
    // observation failures become verification errors, never retries-writes.
    async _observeTreeDelta(plan, entry, attestation, { repointRecordIds, resourceResolutions }) {
        const observed = {};
        const observationErrors = [];
        const decision = attestation.decision;
        const readRecord = this.bitableWriter
            && typeof this.bitableWriter.getRecord === 'function'
            ? liveRecordReader(this.bitableWriter)
            : null;

        if (decision === 'COPY_PATCH_AND_REPOINT'
            || decision === 'COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE'
            || decision === 'UPDATE_IN_PLACE_VERIFIED_UNSHARED') {
            if (this.tokenReferenceReader) {
                try {
                    const references = await this.tokenReferenceReader.listTokenReferences({
                        documentToken: plan.source.documentToken,
                    });
                    observed.olderDocumentReferences = [...new Set((references || [])
                        .map(reference => reference?.recordId)
                        .filter(Boolean))];
                } catch (error) {
                    observationErrors.push({ code: 'TREE_DELTA_OBSERVATION_FAILED', detail: 'tokenReferences', message: error.message });
                }
            }
        }

        if (decision === 'COPY_PATCH_AND_REPOINT'
            || decision === 'COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE') {
            observed.createdDocumentToken = entry.createdDocument?.token
                || entry.createdDocument?.documentToken
                || entry.patchedDocument?.token
                || null;
            if (readRecord) {
                try {
                    const targetRecord = await readRecord(plan.source.recordId);
                    observed.targetRecordDocumentToken = targetRecord?.documentToken ?? null;
                } catch (error) {
                    observationErrors.push({ code: 'TREE_DELTA_OBSERVATION_FAILED', detail: 'targetRecord', message: error.message });
                }
            }
        }

        if (decision === 'COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE') {
            const folderToken = this._resolvedResourceToken(resourceResolutions, plan.target.folderRef);
            observed.categoryFolderToken = folderToken;
            observed.categoryFolderLink = folderToken ? this.driveFolderLink(folderToken) : null;
            const repointNode = (attestation.requiredResourceDag || [])
                .find(node => node.action === 'REPOINT_CATEGORY_VIRTUAL_NODE');
            const repointRecordId = repointNode ? repointRecordIds.get(repointNode.stableId) : null;
            if (readRecord && repointRecordId) {
                try {
                    const nodeRecord = await readRecord(repointRecordId);
                    observed.categoryNodeLink = nodeRecord?.link ?? null;
                } catch (error) {
                    observationErrors.push({ code: 'TREE_DELTA_OBSERVATION_FAILED', detail: 'categoryNode', message: error.message });
                }
            }
            if (typeof this.m2f?.listFolder === 'function' && folderToken && observed.createdDocumentToken) {
                try {
                    const files = await this.m2f.listFolder({ folderToken, type: 'all' });
                    const created = (files || []).find(file => (
                        file.token === observed.createdDocumentToken
                        || file.file_token === observed.createdDocumentToken
                        || file.obj_token === observed.createdDocumentToken
                    ));
                    observed.createdDocumentFolderToken = created ? folderToken : null;
                } catch (error) {
                    observationErrors.push({ code: 'TREE_DELTA_OBSERVATION_FAILED', detail: 'createdDocumentLocation', message: error.message });
                }
            }
        }

        return { observed, observationErrors };
    }

    async _readIndex() {
        if (typeof this.indexReader === 'function') return await this.indexReader();
        if (typeof this.indexReader?.list_documents === 'function') {
            return await this.indexReader.list_documents();
        }
        if (typeof this.indexReader?.listRecords === 'function') {
            return await this.indexReader.listRecords();
        }
        throw new TypeError('indexReader must be a function or expose list_documents()/listRecords()');
    }

    async _readTypeIndex() {
        if (typeof this.typeIndexReader === 'function') return await this.typeIndexReader();
        if (typeof this.typeIndexReader?.list_documents === 'function') {
            return await this.typeIndexReader.list_documents();
        }
        if (typeof this.typeIndexReader?.listRecords === 'function') {
            return await this.typeIndexReader.listRecords();
        }
        throw new TypeError('typeIndexReader must be a function or expose list_documents()/listRecords()');
    }

    _symbolDisplayName(symbol) {
        return symbol.parentClass ? `${symbol.parentClass}.${symbol.name}` : symbol.name;
    }

    _releaseScopeSourceVariants(action) {
        return Array.isArray(action.sourceVariants) && action.sourceVariants.length > 0
            ? action.sourceVariants
            : [action];
    }

    _filterByReleaseScope(symbols) {
        if (!this.releaseScope) return symbols;
        const allowed = new Map();
        for (const action of this.releaseScope.actions) {
            for (const variant of this._releaseScopeSourceVariants(action)) {
                const lines = allowed.get(variant.symbol) || new Set();
                if (Number.isInteger(variant.source?.line)) lines.add(variant.source.line);
                allowed.set(variant.symbol, lines);
            }
        }
        const byDisplayName = new Map();
        for (const symbol of symbols) {
            const key = this._symbolDisplayName(symbol);
            const entries = byDisplayName.get(key) || [];
            entries.push(symbol);
            byDisplayName.set(key, entries);
        }
        const mismatches = [];
        for (const [symbolName, expectedLines] of allowed.entries()) {
            if (expectedLines.size === 0) continue;
            const candidates = byDisplayName.get(symbolName) || [];
            if (candidates.length === 0) continue;
            const actualLines = new Set(candidates.map((symbol) => symbol.lineNumber).filter(Number.isInteger));
            const hasAnyExpectedLine = [...expectedLines].some((line) => actualLines.has(line));
            if (!hasAnyExpectedLine) {
                mismatches.push(`${symbolName}: expected line ${[...expectedLines].join('/')} but scanned line ${[...actualLines].join('/') || 'unknown'}`);
            }
        }
        if (mismatches.length > 0) {
            const error = new Error(`Release scope source line mismatch. Ensure --sdk-dir is checked out at ${this.releaseScope.targetCommit || this.releaseScope.targetTag}: ${mismatches.join('; ')}`);
            error.code = 'RELEASE_SCOPE_LINE_MISMATCH';
            throw error;
        }
        return symbols.filter((symbol) => {
            const lines = allowed.get(this._symbolDisplayName(symbol));
            if (!lines) return false;
            return lines.size === 0 || lines.has(symbol.lineNumber);
        });
    }

    _filterIndexedByReleaseScope(docs) {
        if (!this.releaseScope) return docs;
        const allowed = new Set(this.releaseScope.actions.map((action) => action.canonicalSlug));
        return docs.filter((doc) => allowed.has(doc.metadata?.slug));
    }

    _applyReleaseScopeCategoryMap() {
        if (!this.releaseScope) return;
        const scopedCategoryMap = {};
        for (const action of this.releaseScope.actions) {
            for (const variant of this._releaseScopeSourceVariants(action)) {
                const rawSlug = variant.symbol.replace('.', '-');
                const existing = scopedCategoryMap[rawSlug];
                if (!existing) {
                    scopedCategoryMap[rawSlug] = action.canonicalSlug;
                } else if (Array.isArray(existing)) {
                    if (!existing.includes(action.canonicalSlug)) existing.push(action.canonicalSlug);
                } else if (existing !== action.canonicalSlug) {
                    scopedCategoryMap[rawSlug] = [existing, action.canonicalSlug];
                }
            }
        }
        this.diffEngine.categoryMap = { ...this.diffEngine.categoryMap, ...scopedCategoryMap };
        this.diffEngine._categoryMapLower = Object.fromEntries(
            Object.entries(this.diffEngine.categoryMap).map(([key, value]) => [key.toLowerCase(), value]),
        );
    }

    _applyReleaseScopeDiffActions(actions) {
        if (!this.releaseScope) return actions;
        const scopedBySlug = new Map();
        for (const scoped of this.releaseScope.actions) {
            const entries = scopedBySlug.get(scoped.canonicalSlug) || [];
            entries.push(scoped);
            scopedBySlug.set(scoped.canonicalSlug, entries);
        }
        const mapped = actions.flatMap((action) => {
            const candidates = scopedBySlug.get(action.slug) || [];
            const displayName = action.symbol ? this._symbolDisplayName(action.symbol) : null;
            const lineNumber = action.symbol?.lineNumber;
            const sourceMatches = displayName ? candidates.filter((scoped) => (
                this._releaseScopeSourceVariants(scoped).some((variant) => (
                    variant.symbol === displayName
                    && (!Number.isInteger(variant.source?.line)
                        || !Number.isInteger(lineNumber)
                        || variant.source.line === lineNumber)
                ))
            )) : [];
            const matches = sourceMatches.length > 0 ? sourceMatches : candidates;
            if (matches.length === 0) return [action];
            return matches.map((scoped) => {
                const sourceVariants = this._releaseScopeReviewVariants(scoped);
                return {
                    ...action,
                    type: scoped.type,
                    stableId: scoped.stableId,
                    reason: scoped.reason || action.reason,
                    reasons: [scoped.reason, ...sourceVariants.map((variant) => variant.reason), action.reason]
                        .filter((reason) => typeof reason === 'string' && reason.length > 0),
                    evidence: [
                        ...(scoped.evidence || []),
                        ...sourceVariants.flatMap((variant) => variant.evidence || []),
                    ],
                    sourceVariants,
                    planningContext: scoped.planningContext || action.planningContext,
                    // PR provenance rides the remapped action so the artifact
                    // provider can select verbatim merged-PR content.
                    pr: scoped.pr || action.pr || null,
                    target: scoped.target || action.target,
                    documentationOwnership: scoped.documentationOwnership || action.documentationOwnership,
                    releaseScopeAction: scoped,
                };
            });
        });
        return this._consolidateReleaseScopeDiffActions(mapped);
    }

    _releaseScopeReviewVariants(action) {
        const variants = Array.isArray(action.sourceVariants) && action.sourceVariants.length > 0
            ? action.sourceVariants
            : [{
                stableId: action.stableId,
                canonicalSlug: action.canonicalSlug,
                symbol: action.symbol,
                source: action.source,
                reason: action.reason,
                evidence: action.evidence,
            }];
        return variants.map((variant) => ({
            ...variant,
            stableId: variant.stableId || action.stableId,
            canonicalSlug: variant.canonicalSlug || action.canonicalSlug,
            reason: variant.reason || action.reason,
            evidence: variant.evidence || action.evidence || [],
        }));
    }

    _appendUnique(target, values) {
        for (const value of values) {
            if (!target.some((existing) => isDeepStrictEqual(existing, value))) target.push(value);
        }
    }

    _consolidateReleaseScopeDiffActions(actions) {
        const consolidated = new Map();
        for (const action of actions) {
            const existing = consolidated.get(action.slug);
            if (!existing) {
                const primary = {
                    ...action,
                    planningContext: normalizedCopy(action.planningContext),
                    reasons: [],
                    evidence: [],
                    sourceVariants: [],
                };
                this._appendUnique(primary.reasons, action.reasons || [action.reason].filter(Boolean));
                this._appendUnique(primary.evidence, action.evidence || []);
                this._appendUnique(primary.sourceVariants, action.sourceVariants || []);
                consolidated.set(action.slug, primary);
                continue;
            }

            const existingIsHelperUpdate = existing.type === 'UPDATE'
                && existing.documentationOwnership?.classification === 'method_owned';
            const actionIsHelperUpdate = action.type === 'UPDATE'
                && action.documentationOwnership?.classification === 'method_owned';
            const existingIsStandaloneOwner = existing.documentationOwnership?.classification === 'standalone';
            const actionIsStandaloneOwner = action.documentationOwnership?.classification === 'standalone';
            const compatibleOwnerLifecycle = (existingIsHelperUpdate && actionIsStandaloneOwner)
                || (actionIsHelperUpdate && existingIsStandaloneOwner);
            const planningContext = resolvePlanningContexts([
                existing.planningContext,
                action.planningContext,
            ]);
            const conflictFields = [];
            if (existing.type !== action.type && !compatibleOwnerLifecycle) conflictFields.push('type');
            if (existing.stableId !== action.stableId) conflictFields.push('stableId');
            const existingOwnership = existing.documentationOwnership || {};
            const actionOwnership = action.documentationOwnership || {};
            if (existingOwnership.classification !== actionOwnership.classification
                || existingOwnership.selectedOwnerStableId !== actionOwnership.selectedOwnerStableId) {
                if (!compatibleOwnerLifecycle) {
                    conflictFields.push('documentationOwnership.selectedOwnerStableId');
                }
            }
            if (planningContext.conflict) conflictFields.push('planningContext');
            if (existing.target !== undefined && action.target !== undefined
                && !isDeepStrictEqual(existing.target, action.target)) {
                conflictFields.push('target');
            }
            existing.planningContext = planningContext.value;
            if (existing.target === undefined && action.target !== undefined) existing.target = action.target;
            this._appendUnique(existing.reasons, action.reasons || [action.reason].filter(Boolean));
            this._appendUnique(existing.evidence, action.evidence || []);
            this._appendUnique(existing.sourceVariants, action.sourceVariants || []);
            if (existingIsHelperUpdate && actionIsStandaloneOwner) {
                const aggregate = {
                    reasons: existing.reasons,
                    evidence: existing.evidence,
                    sourceVariants: existing.sourceVariants,
                    planningContext: existing.planningContext,
                    planningConflict: existing.planningConflict,
                };
                Object.assign(existing, action, aggregate);
            }
            if (conflictFields.length > 0) {
                const fields = [...new Set([
                    ...(existing.planningConflict?.details?.fields || []),
                    ...conflictFields,
                ])].sort();
                existing.planningConflict = {
                    code: 'CONFLICTING_RELEASE_SCOPE_ACTIONS',
                    message: `Conflicting release-scope actions for ${action.slug}: ${fields.join(', ')}`,
                    details: { slug: action.slug, fields },
                };
            }
        }
        return [...consolidated.values()].map((action) => ({
            ...action,
            releaseScopeAction: action.releaseScopeAction ? {
                ...action.releaseScopeAction,
                sourceVariants: action.sourceVariants,
                reasons: action.reasons,
                evidence: action.evidence,
            } : action.releaseScopeAction,
        }));
    }

    _sessionExecutedDocumentIds() {
        const session = this.reviewSession;
        if (!session) return null;
        const executedUnitIds = new Set(
            (session.acceptedReviewUnits || []).map((unit) => unit.reviewUnitId),
        );
        if (session.activeExecution?.reviewUnitId) {
            executedUnitIds.add(session.activeExecution.reviewUnitId);
        }
        if (executedUnitIds.size === 0) return null;
        const documentIds = new Set();
        for (const unit of session.reviewUnitManifest?.units || []) {
            if (executedUnitIds.has(unit.reviewUnitId)) {
                documentIds.add(unit.documentStableId);
            }
        }
        return documentIds;
    }

    async _planningContextFor(action, index, result) {
        const supplied = await this._artifactFor(action, index, result);
        const suppliedContext = supplied
            && typeof supplied === 'object'
            && (Object.prototype.hasOwnProperty.call(supplied, 'artifact')
                || supplied.target
                || supplied.current
                || supplied.existingRecordLookup
                || supplied.copySource
                || Object.prototype.hasOwnProperty.call(supplied, 'tokenReferencedByOlderVersions'))
            ? supplied
            : { artifact: supplied };
        const actionContext = action.planningContext || {};
        const extraContext = this.planningContextProvider
            ? await this.planningContextProvider(action, { index, result })
            : {};
        const metadata = action.doc?.metadata || {};
        const current = {
            version: metadata.version ?? null,
            recordId: action.doc?.id ?? null,
            documentToken: metadata.documentToken ?? metadata.token ?? null,
            folderToken: metadata.folderToken ?? null,
            parentRecordId: metadata.parentRecordId ?? null,
            ancestryVerified: false,
            ...(suppliedContext.current || {}),
            ...(extraContext.current || {}),
            ...(actionContext.current || {}),
        };
        const target = {
            version: this.sdkVersion,
            parentRecordId: null,
            folderToken: this.rootToken || null,
            versionRootToken: this.rootToken || null,
            ancestryVerified: false,
            ...(suppliedContext.target || {}),
            ...(extraContext.target || {}),
            ...(actionContext.target || {}),
        };
        const artifact = extraContext.artifact ?? suppliedContext.artifact ?? actionContext.artifact;
        const requiredLinkedInlineCode = actionContext.requiredLinkedInlineCode
            ?? extraContext.requiredLinkedInlineCode
            ?? suppliedContext.requiredLinkedInlineCode
            ?? [];
        let apiPatchPlan = actionContext.apiPatchPlan ?? extraContext.apiPatchPlan ?? suppliedContext.apiPatchPlan;
        if (action.type === 'UPDATE' && artifact?.layout && !apiPatchPlan) {
            if (!this.documentBlockReader || typeof this.documentBlockReader.readBlocks !== 'function') {
                const error = new Error(`Live document blocks are required to plan SDK UPDATE ${this._stableIdFor(action)}`);
                error.code = 'DOCUMENT_BLOCK_READER_REQUIRED';
                throw error;
            }
            const profile = sdkLayoutProfiles[artifact.layout.profileId];
            if (!profile || profile.version !== artifact.layout.profileVersion) {
                const error = new Error(`Unknown SDK layout profile ${artifact.layout.profileId}@${artifact.layout.profileVersion}`);
                error.code = 'INVALID_LAYOUT_PROFILE';
                throw error;
            }
            const currentBlocks = await this.documentBlockReader.readBlocks(current.documentToken);
            const desiredBlocks = await this._renderArtifactBlocks(artifact);
            const desiredBlockSafety = validateRenderedApiBlocks(desiredBlocks, {
                requiredLinkedInlineCode,
                requireLinkedIdentifiersInlineCode: this.language === 'java',
            });
            if (!desiredBlockSafety.ok) {
                const error = new Error(
                    `Desired Feishu blocks failed publication safety for ${this._stableIdFor(action)}: ${JSON.stringify(desiredBlockSafety.errors)}`,
                );
                error.code = 'DESIRED_BLOCK_SAFETY_FAILED';
                error.details = { errors: desiredBlockSafety.errors };
                throw error;
            }
            apiPatchPlan = this.apiPatchPlanner({
                currentBlocks,
                desiredBlocks,
                profile,
                documentToken: current.documentToken,
                repairApproval: actionContext.repairApproval || extraContext.repairApproval || suppliedContext.repairApproval || null,
                preservedBlockPlacements: actionContext.preservedBlockPlacements
                    || extraContext.preservedBlockPlacements
                    || suppliedContext.preservedBlockPlacements
                    || [],
                copyOnWrite: current.version !== target.version
                    || current.folderToken !== target.folderToken
                    || actionContext.tokenReferencedByOlderVersions === true
                    || extraContext.tokenReferencedByOlderVersions === true
                    || suppliedContext.tokenReferencedByOlderVersions === true,
            });
            if (apiPatchPlan.validation?.valid !== true) {
                const firstError = apiPatchPlan.validation?.errors?.[0];
                const error = new Error(`API patch planning failed for ${this._stableIdFor(action)}: ${JSON.stringify(apiPatchPlan.validation?.errors || [])}`);
                error.code = firstError?.code || 'PATCH_PLANNING_BLOCKED';
                throw error;
            }
        }
        return {
            ...suppliedContext,
            ...extraContext,
            ...actionContext,
            artifact,
            apiPatchPlan,
            requiredLinkedInlineCode,
            current,
            target,
            existingRecordLookup: actionContext.existingRecordLookup ?? extraContext.existingRecordLookup ?? suppliedContext.existingRecordLookup,
            copySource: actionContext.copySource ?? extraContext.copySource ?? suppliedContext.copySource,
        };
    }

    async _renderArtifactBlocks(artifact) {
        if (Array.isArray(artifact.blocks)) return artifact.blocks;
        if (typeof this.artifactBlockRenderer === 'function') {
            return await this.artifactBlockRenderer(artifact);
        }
        const renderer = this.m2f || new MarkdownToFeishu({
            sourceType: this.sourceType,
            rootToken: this.rootToken,
            baseToken: this.baseToken,
        });
        if (typeof renderer.parse_markdown !== 'function' || typeof renderer.markdown_to_blocks !== 'function') {
            const error = new Error('A pure artifact block renderer is required for SDK API patch planning');
            error.code = 'ARTIFACT_BLOCK_RENDERER_REQUIRED';
            throw error;
        }
        const { tokens } = await renderer.parse_markdown(artifact.content);
        return await renderer.markdown_to_blocks(tokens);
    }

    async _artifactFor(action, index, result) {
        if (!this.artifactProvider) return undefined;
        if (typeof this.artifactProvider === 'function') {
            return await this.artifactProvider(action, { index, result, typeUrls: this.typeUrls });
        }
        const stableId = this._stableIdFor(action);
        if (this.artifactProvider instanceof Map) {
            return this.artifactProvider.get(stableId) ?? this.artifactProvider.get(action.slug);
        }
        return this.artifactProvider[stableId] ?? this.artifactProvider[action.slug];
    }

    _stableIdFor(action) {
        return action?.stableId
            || action?.symbol?.identity?.stableId
            || action?.symbol?.stableId
            || action?.slug
            || (action?.ref ? `resource:${action.ref}` : null)
            || null;
    }

    async _executeAction(action) {
        switch (action.type) {
            case 'CREATE':
                return await this._executeCreate(action);
            case 'UPDATE':
                return await this._executeUpdate(action);
            case 'DEPRECATE':
                return await this._executeDeprecate(action);
            case 'ORPHAN':
                return { note: 'Orphan flagged, no destructive action taken' };
            default:
                return { note: `Skipped action type: ${action.type}` };
        }
    }

    async _executeCreate(action) {
        const markdown = action.markdown || this._planningContexts.get(action)?.artifact?.content;
        if (!markdown) throw new TypeError('Reviewed artifact content is required for CREATE execution');
        const meta = this.docGenerator.generateMeta(action.symbol);

        // Create doc in Drive folder
        const pushResult = await this.m2f.push_markdown({
            markdown_content: markdown,
            title: meta.title,
            folder_token: this.sourceType === 'drive' ? this.rootToken : null,
            parent_node_token: this.sourceType === 'wiki' ? this.rootToken : null,
        });

        // Create bitable record — slug is auto-populated from Docs field
        const docUrl = pushResult.wiki_url || '';
        const record = await this.bitableWriter.createRecord({
            title: meta.title,
            link: docUrl,
            progress: meta.progress,
            addedSince: meta.addedSince,
            type: meta.type,
            targets: meta.targets,
            parentRecordId: meta.parentRecordId,
        });

        return { pushResult, record };
    }

    async _executeUpdate(action) {
        const markdown = action.markdown || this._planningContexts.get(action)?.artifact?.content;
        if (!markdown) throw new TypeError('Reviewed artifact content is required for UPDATE execution');
        const meta = this.docGenerator.generateMeta(action.symbol);

        const docToken = action.doc.metadata.token;

        const { tokens } = await this.m2f.parse_markdown(markdown);
        const blocks = await this.m2f.markdown_to_blocks(tokens);

        const patchResult = await this.m2f.patch_document({
            document_id: docToken,
            blocks,
            strategy: 'smart',
        });

        const record = await this.bitableWriter.updateRecord(action.doc.id, {
            lastModified: this.sdkVersion,
        });

        return { patchResult, record };
    }

    async _executeDeprecate(action) {
        const record = await this.bitableWriter.updateRecord(action.doc.id, {
            deprecateSince: this.sdkVersion,
            progress: 'Deprecated',
        });

        return { record };
    }

    _summarizeDiff(actions) {
        return {
            create: actions.filter(a => a.type === 'CREATE').length,
            update: actions.filter(a => a.type === 'UPDATE').length,
            deprecate: actions.filter(a => a.type === 'DEPRECATE').length,
            skip: actions.filter(a => a.type === 'SKIP').length,
            orphan: actions.filter(a => a.type === 'ORPHAN').length,
        };
    }

    _printActions(actions) {
        for (const action of actions) {
            if (action.type === 'SKIP') continue;
            const symbol = action.symbol
                ? `${action.symbol.parentClass ? action.symbol.parentClass + '.' : ''}${action.symbol.name}`
                : '(orphan)';
            console.log(`  ${action.type.padEnd(10)} ${action.slug.padEnd(40)} ${symbol.padEnd(30)} ${action.reason}`);
        }
    }

    _printPlans(plans) {
        for (const plan of plans) {
            if (plan.action === 'NOOP') continue;
            console.log(`  ${plan.action.padEnd(20)} ${plan.stableId} ${plan.metadata.reason || ''}`);
        }
    }
}

SdkDocSync.buildExecutionBatch = buildExecutionBatch;
SdkDocSync.buildAcceptanceManifest = buildAcceptanceManifest;
SdkDocSync.buildReviewUnitManifest = (plannedEntries) => buildReviewUnitManifest(plannedEntries, buildExecutionBatch);
SdkDocSync.journalPathForDigest = journalPathForDigest;

module.exports = SdkDocSync;
