const FeishuToMarkdown = require('../feishu-to-markdown');
const MarkdownToFeishu = require('../markdown-to-feishu');
const BitableWriter = require('./bitable-writer');
const DiffEngine = require('./diff-engine');
const DocGenerator = require('./doc-generator');
const { FeishuOperationalVerifier } = require('./feishu-operational-verifier');
const SyncExecutor = require('./sync-executor');
const SyncPlanner = require('./sync-planner');
const PythonScanner = require('./scanners/python-scanner');
const JavaScanner = require('./scanners/java-scanner');
const NodeScanner = require('./scanners/node-scanner');
const CppScanner = require('./scanners/cpp-scanner');
const GoScanner = require('./scanners/go-scanner');
const ZillizCliScanner = require('./scanners/zilliz-cli-scanner');
const OpenApiScanner = require('./scanners/openapi-scanner');

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
        onProgress = null,
        dryRun = false,
        publicOnly = true,
        include = [],
        exclude = [],
        indexReader = null,
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
    }) {
        this.rootToken = rootToken;
        this.baseToken = baseToken;
        this.previousBaseToken = previousBaseToken;
        this.sourceType = sourceType;
        this.sdkVersion = sdkVersion;
        this.sdkName = sdkName;
        this.dryRun = dryRun;
        this.approvalCallback = approvalCallback;
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
        this.f2m = this.indexReader;
        this.m2f = documentWriter || null;
        this.bitableWriter = bitableWriter || null;
        this.executor = executor || null;
        this.verifier = verifier || null;

        if (!dryRun) {
            this.m2f = this.m2f || new MarkdownToFeishu({ sourceType, rootToken, baseToken });
            this.bitableWriter = this.bitableWriter || new BitableWriter({ baseToken });
            this.verifier = this.verifier || new FeishuOperationalVerifier();
            this.executor = this.executor || new SyncExecutor({
                documentWriter: this.m2f,
                bitableWriter: this.bitableWriter,
                verifier: this.verifier,
            });
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
        result.indexed = this._filterIndexedByReleaseScope(await this._readIndex());
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
        const plannedActions = [];
        for (const [index, action] of result.diff.entries()) {
            try {
                const context = await this._planningContextFor(action, index, result);
                const schemaStableId = context.artifact?.reference?.identity?.stableId;
                const plannableAction = schemaStableId && !action.stableId
                    ? { ...action, stableId: schemaStableId }
                    : action;
                const plan = this.planner.planAction(plannableAction, context);
                result.plans.push(plan);
                plannedActions.push({ action: plannableAction, plan, context });
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
        this.onProgress('PLAN', `${result.plans.length} planned, ${result.planningErrors.length} failed`);

        if (this.dryRun) {
            this.onProgress('APPROVE', 'Dry run — showing plans without executing');
            if (this.printPlans) this._printPlans(result.plans);
            result.approved = [];
            return result;
        }

        // Phase 5: APPROVE. Actions that did not produce a valid immutable plan
        // never reach approval or execution.
        const actionable = plannedActions
            .filter(({ plan }) => plan.action !== 'NOOP')
            .map(({ action }) => action);
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

        // Phase 6: EXECUTE (legacy executor retained until SyncExecutor lands)
        this.onProgress('EXECUTE', `Executing ${result.approved.length} actions...`);
        for (const action of result.approved) {
            try {
                const planned = plannedActions.find((entry) => entry.action === action)
                    || plannedActions.find((entry) => entry.plan === action);
                if (!planned) throw new Error(`Approved action was not planned: ${this._stableIdFor(action) || '(unknown)'}`);
                const execResult = await this.executor.execute(planned.plan, {
                    action: planned.action,
                    artifact: planned.context.artifact,
                    approval: { approved: true },
                });
                result.results.push({ action, status: 'success', ...execResult });
                if (execResult.status === 'error') {
                    this.onProgress('EXECUTE', `${planned.action.type} ${planned.action.slug} — ERROR: ${execResult.error?.message || execResult.failedStep}`);
                } else {
                    this.onProgress('EXECUTE', `${planned.action.type} ${planned.action.slug} — success`);
                }
            } catch (err) {
                result.results.push({ action, status: 'error', error: err.message });
                this.onProgress('EXECUTE', `${action.type} ${action.slug} — ERROR: ${err.message}`);
            }
        }

        this.onProgress('EXECUTE', `Done. ${result.results.filter(r => r.status === 'success').length}/${result.approved.length} succeeded`);
        return result;
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

    _symbolDisplayName(symbol) {
        return symbol.parentClass ? `${symbol.parentClass}.${symbol.name}` : symbol.name;
    }

    _filterByReleaseScope(symbols) {
        if (!this.releaseScope) return symbols;
        const allowed = new Map();
        for (const action of this.releaseScope.actions) {
            const lines = allowed.get(action.symbol) || new Set();
            if (Number.isInteger(action.source?.line)) lines.add(action.source.line);
            allowed.set(action.symbol, lines);
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
        const scopedCategoryMap = Object.fromEntries(this.releaseScope.actions.map((action) => [
            action.symbol.replace('.', '-'),
            action.canonicalSlug,
        ]));
        this.diffEngine.categoryMap = { ...this.diffEngine.categoryMap, ...scopedCategoryMap };
        this.diffEngine._categoryMapLower = Object.fromEntries(
            Object.entries(this.diffEngine.categoryMap).map(([key, value]) => [key.toLowerCase(), value]),
        );
    }

    _applyReleaseScopeDiffActions(actions) {
        if (!this.releaseScope) return actions;
        const scopedBySlug = new Map(this.releaseScope.actions.map((action) => [action.canonicalSlug, action]));
        return actions.map((action) => {
            const scoped = scopedBySlug.get(action.slug);
            if (!scoped) return action;
            return {
                ...action,
                type: scoped.type,
                stableId: scoped.stableId,
                reason: scoped.reason || action.reason,
                planningContext: scoped.planningContext || action.planningContext,
                releaseScopeAction: scoped,
            };
        });
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
        return {
            ...suppliedContext,
            ...extraContext,
            ...actionContext,
            artifact: extraContext.artifact ?? suppliedContext.artifact ?? actionContext.artifact,
            current,
            target,
            existingRecordLookup: actionContext.existingRecordLookup ?? extraContext.existingRecordLookup ?? suppliedContext.existingRecordLookup,
            copySource: actionContext.copySource ?? extraContext.copySource ?? suppliedContext.copySource,
        };
    }

    async _artifactFor(action, index, result) {
        if (!this.artifactProvider) return undefined;
        if (typeof this.artifactProvider === 'function') {
            return await this.artifactProvider(action, { index, result });
        }
        const stableId = this._stableIdFor(action);
        if (this.artifactProvider instanceof Map) {
            return this.artifactProvider.get(stableId) ?? this.artifactProvider.get(action.slug);
        }
        return this.artifactProvider[stableId] ?? this.artifactProvider[action.slug];
    }

    _stableIdFor(action) {
        return action.stableId
            || action.symbol?.identity?.stableId
            || action.symbol?.stableId
            || action.slug
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
            description: meta.description,
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
            description: meta.description,
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

module.exports = SdkDocSync;
