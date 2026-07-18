const BitableReader = require('./bitable-reader');
const TranslationDiff = require('./translation-diff');
const DocTranslator = require('./doc-translator');
const FeishuTranslator = require('./translators/feishu-translator');
const ClaudeTranslator = require('./translators/claude-translator');
const DeepLTranslator = require('./translators/deepl-translator');
const OllamaTranslator = require('./translators/ollama-translator');
const FeishuToMarkdown = require('../feishu-to-markdown');
const MarkdownToFeishu = require('../markdown-to-feishu');
const BitableWriter = require('../sdk-doc-sync/bitable-writer');

/**
 * FeishuDocTranslator - Main orchestrator for documentation translation
 */
class FeishuDocTranslator {
    constructor(options) {
        this.sourceBitable = options.sourceBitable;
        this.targetBitable = options.targetBitable;
        this.sourceTableId = options.sourceTableId || null;
        this.targetTableId = options.targetTableId || null;
        this.sourceRoot = options.sourceRoot;
        this.targetRoot = options.targetRoot;
        this.sourceLang = options.sourceLang || 'en';
        this.targetLang = options.targetLang || 'ja';
        this.driveType = options.driveType || 'wiki';
        this.translatorType = options.translatorType || 'claude';
        this.dryRun = options.dryRun || false;
        this.approvalCallback = options.approvalCallback || null;
        this.sourceDocumentReader = options.sourceDocumentReader || null;

        // Initialize components
        this.sourceReader = new BitableReader({ baseToken: this.sourceBitable, tableId: this.sourceTableId });
        this.targetReader = new BitableReader({ baseToken: this.targetBitable, tableId: this.targetTableId });
        this.targetWriter = new BitableWriter({ baseToken: this.targetBitable, tableId: this.targetTableId });
        this.diff = new TranslationDiff({ strict: true });

        // Initialize translator
        this.translator = options.translator || this._createTranslator();
        this.docTranslator = new DocTranslator({
            translator: this.translator,
            sourceLang: this.sourceLang,
            targetLang: this.targetLang,
        });

        // Initialize markdown converters
        this.sourceReader_md = new FeishuToMarkdown({
            sourceType: this.driveType,
            rootToken: this.sourceRoot,
            baseToken: this.sourceBitable,
        });

        this.targetWriter_md = new MarkdownToFeishu({
            sourceType: this.driveType,
            rootToken: this.targetRoot,
            baseToken: this.targetBitable,
        });

        // Cache for bitable records (to avoid repeated fetches during parent lookup)
        this._sourceRecordsCache = null;
        this._targetRecordsCache = null;
    }

    /**
     * Create translator based on type
     * @private
     */
    _createTranslator() {
        switch (this.translatorType) {
            case 'feishu':
                return new FeishuTranslator({
                    sourceLang: this.sourceLang,
                    targetLang: this.targetLang,
                });

            case 'claude':
                return new ClaudeTranslator({
                    sourceLang: this.sourceLang,
                    targetLang: this.targetLang,
                });

            case 'deepl':
                return new DeepLTranslator({
                    sourceLang: this.sourceLang,
                    targetLang: this.targetLang,
                });

            case 'ollama':
                return new OllamaTranslator({
                    sourceLang: this.sourceLang,
                    targetLang: this.targetLang,
                });

            default:
                throw new Error(`Unknown translator type: ${this.translatorType}. Supported: feishu, claude, deepl, ollama`);
        }
    }

    /**
     * Run the translation workflow
     */
    async run() {
        console.log('\n=== Feishu Doc Translator ===');
        console.log(`Source: ${this.sourceBitable} (${this.sourceLang})`);
        console.log(`Target: ${this.targetBitable} (${this.targetLang})`);
        console.log(`Translator: ${this.translatorType}`);
        console.log(`Drive type: ${this.driveType}`);
        console.log(`Dry run: ${this.dryRun}`);

        // Phase 1: Read bitables
        console.log('\n--- Phase 1: Reading bitables ---');
        const sourceRecords = await this.sourceReader.listRecords();
        const targetRecords = await this.targetReader.listRecords();

        // Cache for parent lookups
        this._sourceRecordsCache = sourceRecords;
        this._targetRecordsCache = targetRecords;

        console.log(`Source records: ${sourceRecords.length}`);
        console.log(`Target records: ${targetRecords.length}`);

        // Phase 2: Diff
        console.log('\n--- Phase 2: Computing diff ---');
        const actions = this.diff.diff(sourceRecords, targetRecords);
        const summary = this.diff.getSummary(actions);
        console.log('Diff summary:');
        console.log(`  NEW: ${summary.new}`);
        console.log(`  UPDATE: ${summary.update}`);
        console.log(`  SKIP: ${summary.skip}`);
        console.log(`  ORPHAN: ${summary.orphan}`);

        if (this.dryRun) {
            return { actions, summary };
        }

        // Filter to actionable items
        const actionable = this.diff.filterByType(actions, 'NEW', 'UPDATE');

        if (actionable.length === 0) {
            console.log('\nNo actions to perform.');
            return { actions, summary, results: [] };
        }

        // Phase 3: Approval
        console.log('\n--- Phase 3: Approval ---');
        const approved = this.approvalCallback
            ? await this.approvalCallback(actionable)
            : actionable;

        console.log(`Approved: ${approved.length} actions`);

        if (approved.length === 0) {
            console.log('\nNo approved actions. Exiting.');
            return { actions, summary, results: [] };
        }

        // Phase 4: Execute translations
        console.log('\n--- Phase 4: Executing translations ---');
        const results = [];
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < approved.length; i++) {
            const action = approved[i];
            console.log(`\n[${i + 1}/${approved.length}] ${action.type}: ${action.slug}`);

            try {
                if (action.type === 'NEW') {
                    await this._executeNew(action);
                    results.push({ action, status: 'success' });
                    successCount++;
                } else if (action.type === 'UPDATE') {
                    await this._executeUpdate(action);
                    results.push({ action, status: 'success' });
                    successCount++;
                }
            } catch (error) {
                console.error(`  ERROR: ${error.message}`);
                results.push({ action, status: 'error', error: error.message });
                errorCount++;
            }

            // Rate limiting: delay between actions
            if (i < approved.length - 1) {
                await this._delay(1000); // 1 second delay
            }
        }

        console.log(`\n--- Execution complete ---`);
        console.log(`Success: ${successCount}`);
        console.log(`Errors: ${errorCount}`);

        return { actions, summary, results };
    }

    /**
     * Execute NEW action: create translated document and bitable record
     * @private
     */
    async _executeNew(action) {
        const sourceRecord = action.source;

        // Fetch source document
        console.log(`  Fetching source: ${sourceRecord.metadata.link}`);
        const sourceMarkdown = await this._fetchSourceMarkdown(sourceRecord);

        if (!sourceMarkdown) {
            throw new Error('Failed to fetch source document');
        }

        // Translate
        console.log(`  Translating...`);
        const translatedMarkdown = await this.translator.translateMarkdown(sourceMarkdown);

        // Find target parent (wiki node or folder) if source has parent
        let targetParentNodeToken = this.targetRoot;
        let targetParentRecordId = null;

        if (sourceRecord.parent) {
            const targetParentInfo = await this._findTargetParent(sourceRecord.parent);
            if (targetParentInfo) {
                targetParentNodeToken = targetParentInfo.nodeToken;
                targetParentRecordId = targetParentInfo.recordId;
                console.log(`  Using parent: ${targetParentInfo.slug}`);
            } else {
                console.log(`  Warning: Parent not found in target, using root`);
            }
        }

        // Create target document with correct parent
        console.log(`  Creating target document...`);
        const createParams = {
            markdown_content: translatedMarkdown,
            title: sourceRecord.metadata.title,
        };

        if (this.driveType === 'wiki') {
            createParams.parent_node_token = targetParentNodeToken;
        } else {
            createParams.folder_token = targetParentNodeToken;
        }

        const result = await this.targetWriter_md.push_markdown(createParams);

        // Create target bitable record
        console.log(`  Creating bitable record...`);
        const recordFields = {
            title: sourceRecord.metadata.title,
            link: result.wiki_url || `https://zilliverse.feishu.cn/docx/${result.document_id}`,
            type: sourceRecord.metadata.type,
            addedSince: new Date().toISOString().split('T')[0],
        };

        if (targetParentRecordId) {
            recordFields.parentRecordId = targetParentRecordId;
        }

        await this.targetWriter.createRecord(recordFields);
        console.log(`  ✓ Created: ${result.wiki_url || result.document_url || result.document_id}`);
    }

    /**
     * Execute UPDATE action: update translated document
     * @private
     */
    async _executeUpdate(action) {
        const sourceRecord = action.source;
        const targetRecord = action.target;

        // Get existing target document ID
        const targetDocId = targetRecord.metadata.token;
        if (!targetDocId) {
            throw new Error('Target document ID not found in bitable record');
        }

        console.log(`  Target doc ID: ${targetDocId}`);

        // Fetch source document
        console.log(`  Fetching source: ${sourceRecord.metadata.link}`);
        const sourceMarkdown = await this._fetchSourceMarkdown(sourceRecord);

        if (!sourceMarkdown) {
            throw new Error('Failed to fetch source document');
        }

        // Translate
        console.log(`  Translating...`);
        const translatedMarkdown = await this.translator.translateMarkdown(sourceMarkdown);

        // Use push_markdown with document_id to update existing document
        // We need to add update support to push_markdown, so for now use update_document directly
        console.log(`  Converting to blocks...`);
        const { frontmatter, tokens } = await this.targetWriter_md.parse_markdown(translatedMarkdown);
        let blocks = await this.targetWriter_md.markdown_to_blocks(tokens);

        // Note: Accessing private method __process_image_blocks
        // TODO: Add a public update_markdown method to MarkdownToFeishu
        if (this.targetWriter_md.__process_image_blocks) {
            blocks = await this.targetWriter_md.__process_image_blocks(blocks, targetDocId);
        }

        // Update the existing document (deletes old blocks, creates new ones)
        console.log(`  Updating existing document content...`);
        await this.targetWriter_md.update_document({
            document_id: targetDocId,
            blocks: blocks,
        });

        // Update bitable record metadata
        console.log(`  Updating bitable record...`);
        await this.targetWriter.updateRecord(targetRecord.id, {
            title: sourceRecord.metadata.title,
            lastModified: new Date().toISOString().split('T')[0],
        });

        // Construct the wiki/doc URL for logging
        const docUrl = this.driveType === 'wiki'
            ? `${process.env.FEISHU_HOST}/wiki/${targetRecord.metadata.link.match(/\/wiki\/([^/?]+)/)?.[1]}`
            : `https://zilliverse.feishu.cn/docx/${targetDocId}`;

        console.log(`  ✓ Updated: ${docUrl}`);
    }

    /**
     * Find corresponding parent record in target bitable
     * @private
     */
    async _findTargetParent(sourceParentId) {
        // Use cached records if available
        const sourceRecords = this._sourceRecordsCache || await this.sourceReader.listRecords();
        const targetRecords = this._targetRecordsCache || await this.targetReader.listRecords();

        // Get source parent record to find its slug
        const sourceParent = sourceRecords.find(r => r.id === sourceParentId);

        if (!sourceParent) {
            console.log(`  Warning: Source parent ${sourceParentId} not found`);
            return null;
        }

        const parentSlug = sourceParent.metadata.slug;
        console.log(`  Looking for parent with slug: ${parentSlug}`);

        // Find matching record in target bitable by slug
        const targetParent = targetRecords.find(r =>
            r.metadata.slug === parentSlug ||
            r.metadata.slug.toLowerCase() === parentSlug.toLowerCase()
        );

        if (!targetParent) {
            console.log(`  Warning: No target parent found for slug: ${parentSlug}`);
            return null;
        }

        // Extract node token from wiki URL or use document token
        let nodeToken = null;
        if (targetParent.metadata.link) {
            if (this.driveType === 'wiki') {
                // Extract node_token from wiki URL
                // Format: https://example.feishu.cn/wiki/{node_token}
                const match = targetParent.metadata.link.match(/\/wiki\/([^/?]+)/);
                if (match) {
                    nodeToken = match[1];
                } else {
                    // If no wiki URL, use the document token
                    nodeToken = targetParent.metadata.token;
                }
            } else {
                // For drive, use folder token from the link
                nodeToken = targetParent.metadata.token;
            }
        }

        return {
            recordId: targetParent.id,
            nodeToken: nodeToken || this.targetRoot,
            slug: targetParent.metadata.slug,
        };
    }

    async _fetchSourceMarkdown(sourceRecord) {
        if (this.sourceDocumentReader) {
            return await this.sourceDocumentReader.readMarkdown(sourceRecord);
        }
        return await this.sourceReader_md.get_markdown({
            slug: sourceRecord.metadata.slug,
        });
    }

    /**
     * Delay helper
     * @private
     */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = FeishuDocTranslator;
