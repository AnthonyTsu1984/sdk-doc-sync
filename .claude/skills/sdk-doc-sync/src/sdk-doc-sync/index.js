const FeishuToMarkdown = require('../feishu-to-markdown');
const MarkdownToFeishu = require('../markdown-to-feishu');
const BitableWriter = require('./bitable-writer');
const DiffEngine = require('./diff-engine');
const DocGenerator = require('./doc-generator');
const PythonScanner = require('./scanners/python-scanner');
const JavaScanner = require('./scanners/java-scanner');
const CppScanner = require('./scanners/cpp-scanner');
const GoScanner = require('./scanners/go-scanner');
const ZillizCliScanner = require('./scanners/zilliz-cli-scanner');

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

        // Build scanner if not provided
        if (scanner) {
            this.scanner = scanner;
        } else if (sdkDir) {
            this.scanner = this._createScanner(language, { rootDir: sdkDir, publicOnly, include, exclude });
        } else {
            throw new Error('Either scanner or sdkDir must be provided');
        }

        this.diffEngine = new DiffEngine({ sdkVersion });
        this.docGenerator = new DocGenerator({ sdkName, sdkVersion, targets, language });

        if (!dryRun) {
            // Use previousBaseToken for INDEX (reading baseline), baseToken for EXECUTE (writing)
            const indexBaseToken = previousBaseToken || baseToken;
            this.f2m = new FeishuToMarkdown({ sourceType, rootToken, baseToken: indexBaseToken });
            this.m2f = new MarkdownToFeishu({ sourceType, rootToken, baseToken });
            this.bitableWriter = new BitableWriter({ baseToken });
        }
    }

    _createScanner(language, opts) {
        switch (language) {
            case 'python':
                return new PythonScanner(opts);
            case 'java':
                return new JavaScanner(opts);
            case 'cpp':
                return new CppScanner(opts);
            case 'go':
                return new GoScanner(opts);
            case 'zilliz-cli':
                return new ZillizCliScanner(opts);
            default:
                throw new Error(`Unsupported language: ${language}. Supported: python, java, cpp, go, zilliz-cli`);
        }
    }

    async run() {
        const result = {
            scanned: [],
            indexed: [],
            diff: [],
            approved: [],
            results: [],
        };

        // Phase 1: SCAN
        this.onProgress('SCAN', `Scanning source code in ${this.scanner.rootDir}...`);
        result.scanned = await this.scanner.scan();
        this.onProgress('SCAN', `Found ${result.scanned.length} symbols`);

        // Phase 2: INDEX (read previous version's bitable as baseline)
        if (this.dryRun) {
            this.onProgress('INDEX', 'Dry run — skipping KB index fetch');
            result.indexed = [];
        } else {
            const source = this.previousBaseToken ? 'previous version' : 'current';
            this.onProgress('INDEX', `Fetching ${source} KB index from Feishu...`);
            result.indexed = await this.f2m.list_documents();
            this.onProgress('INDEX', `Found ${result.indexed.length} existing documents`);
        }

        // Phase 3: DIFF
        this.onProgress('DIFF', 'Computing diff between source and KB...');
        result.diff = this.diffEngine.diff(result.scanned, result.indexed);

        const summary = this._summarizeDiff(result.diff);
        this.onProgress('DIFF', `${summary.create} new, ${summary.update} updated, ${summary.deprecate} deprecated, ${summary.skip} unchanged, ${summary.orphan} orphaned`);

        if (this.dryRun) {
            this.onProgress('APPROVE', 'Dry run — showing actions without executing');
            this._printActions(result.diff);
            result.approved = [];
            return result;
        }

        // Phase 4: APPROVE
        const actionable = result.diff.filter(a => a.type !== 'SKIP');
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

        // Phase 5: EXECUTE
        this.onProgress('EXECUTE', `Executing ${result.approved.length} actions...`);
        for (const action of result.approved) {
            try {
                const execResult = await this._executeAction(action);
                result.results.push({ action, status: 'success', ...execResult });
                this.onProgress('EXECUTE', `${action.type} ${action.slug} — success`);
            } catch (err) {
                result.results.push({ action, status: 'error', error: err.message });
                this.onProgress('EXECUTE', `${action.type} ${action.slug} — ERROR: ${err.message}`);
            }
        }

        this.onProgress('EXECUTE', `Done. ${result.results.filter(r => r.status === 'success').length}/${result.approved.length} succeeded`);
        return result;
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
        // Generate scaffold — caller (skill) can override action.markdown for intelligent content
        const markdown = action.markdown || this.docGenerator.generate(action.symbol);
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
        const markdown = action.markdown || this.docGenerator.generate(action.symbol);
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
}

module.exports = SdkDocSync;
