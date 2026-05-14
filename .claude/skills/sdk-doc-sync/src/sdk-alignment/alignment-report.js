/**
 * AlignmentReport — orchestrates the SDK alignment pipeline:
 *   scan → normalize methods → normalize params → compare → report → push
 */

const path = require('path');
const MethodNormalizer = require('./method-normalizer');
const ParamNormalizer = require('./param-normalizer');
const ReportGenerator = require('./report-generator');
const AlignmentBitable = require('./alignment-bitable');

// Scanners (lazy-loaded to avoid requiring all SDKs when only some are needed)
const SCANNER_MAP = {
    python: () => require('../sdk-doc-sync/scanners/python-scanner'),
    java: () => require('../sdk-doc-sync/scanners/java-scanner'),
    node: () => require('../sdk-doc-sync/scanners/node-scanner'),
    cpp: () => require('../sdk-doc-sync/scanners/cpp-scanner'),
    go: () => require('../sdk-doc-sync/scanners/go-scanner'),
};

const DEFAULT_ROOTS = {
    python: 'repos/pymilvus/pymilvus',
    java: 'repos/milvus-sdk-java/sdk-core/src/main/java/io/milvus',
    node: 'repos/milvus-sdk-node',
    cpp: 'repos/milvus-sdk-cpp',
    go: 'repos/milvus-sdk-go',
};

class AlignmentReport {
    /**
     * @param {Object} opts
     * @param {string[]} opts.languages - SDKs to compare (default: all 5)
     * @param {Object} opts.repos - { language: rootDir } overrides
     * @param {string} opts.folderToken - Feishu folder for report
     * @param {boolean} opts.dryRun - Print to stdout instead of pushing
     * @param {string} opts.projectRoot - Project root for resolving relative repo paths
     * @param {string} [opts.appToken] - Existing bitable app token
     * @param {string} [opts.tableId] - Existing bitable table ID
     * @param {boolean} [opts.cleanup] - Delete orphan records
     */
    constructor({
        languages = ['python', 'java', 'node', 'cpp', 'go'],
        repos = {},
        folderToken = 'Gw47fZMsAltMqxdb6Y4cYfVknfe',
        dryRun = false,
        projectRoot = path.resolve(__dirname, '../..'),
        appToken = null,
        tableId = null,
        cleanup = false,
    } = {}) {
        this.languages = languages;
        this.repos = repos;
        this.folderToken = folderToken;
        this.dryRun = dryRun;
        this.projectRoot = projectRoot;
        this.appToken = appToken;
        this.tableId = tableId;
        this.cleanup = cleanup;

        this.methodNormalizer = new MethodNormalizer();
        this.paramNormalizer = new ParamNormalizer();
        this.reportGenerator = new ReportGenerator(languages);

        this.date = new Date().toISOString().slice(0, 10);
    }

    /**
     * Scan → normalize → compare (shared pipeline for both report and bitable modes).
     */
    async _scanAndCompare() {
        // 1. Scan all SDKs
        console.log('[SCAN] Scanning SDK sources...');
        const scanResults = {};

        for (const lang of this.languages) {
            const rootDir = this._resolveRootDir(lang);
            console.log(`[SCAN] ${lang}: ${rootDir}`);

            const ScannerClass = SCANNER_MAP[lang]();
            const scanner = new ScannerClass({ rootDir });
            const symbols = await scanner.scan();

            // Filter to public API methods only
            const methods = symbols.filter(s => this.methodNormalizer.isApiMethod(s, lang));
            scanResults[lang] = methods;
            console.log(`[SCAN] ${lang}: ${methods.length} methods (${symbols.length} total symbols)`);
        }

        // 2. Build canonical registry
        console.log('[NORMALIZE] Building canonical method registry...');
        const registry = this.methodNormalizer.buildRegistry(scanResults);
        console.log(`[NORMALIZE] ${registry.size} canonical methods`);

        // 2b. Initialize Node type resolver if Node is in the language list
        if (this.languages.includes('node')) {
            const nodeRoot = this._resolveRootDir('node');
            this.paramNormalizer.initNodeTypeResolver(nodeRoot);
        }

        // 3. Compare parameters for each method
        console.log('[COMPARE] Comparing parameters...');
        const paramComparisons = {};
        for (const [name, entry] of registry) {
            paramComparisons[name] = this.paramNormalizer.compareParams(entry);
        }

        return { registry, paramComparisons };
    }

    async run() {
        const { registry, paramComparisons } = await this._scanAndCompare();

        // 4. Generate markdown report
        console.log('[REPORT] Generating report...');
        const markdown = this.reportGenerator.generate(registry, paramComparisons, this.date);

        // 5. Push to Feishu or print
        if (this.dryRun) {
            console.log('\n' + markdown);
        } else {
            console.log('[PUSH] Pushing report to Feishu...');
            const MarkdownToFeishu = require('../markdown-to-feishu');
            const m2f = new MarkdownToFeishu({ sourceType: 'drive' });
            const result = await m2f.push_markdown({
                markdown_content: markdown,
                title: `Alignment Reports - ${this.date}`,
                folder_token: this.folderToken,
            });
            console.log(`[PUSH] Done: ${result.document_id}`);
        }

        return { markdown, registry, paramComparisons };
    }

    async runBitable() {
        const { registry, paramComparisons } = await this._scanAndCompare();

        const bitable = new AlignmentBitable({
            appToken: this.appToken,
            tableId: this.tableId,
            folderToken: this.folderToken,
            dryRun: this.dryRun,
            cleanup: this.cleanup,
        });

        await bitable.populate(registry, paramComparisons, this.languages);

        return { registry, paramComparisons };
    }

    _resolveRootDir(language) {
        if (this.repos[language]) {
            return path.resolve(this.repos[language]);
        }
        const defaultRelative = DEFAULT_ROOTS[language];
        if (!defaultRelative) {
            throw new Error(`No default repo path for language: ${language}`);
        }
        return path.resolve(this.projectRoot, defaultRelative);
    }
}

module.exports = AlignmentReport;
