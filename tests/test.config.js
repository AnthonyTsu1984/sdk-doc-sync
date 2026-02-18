/**
 * Test Configuration
 *
 * Centralizes all environment variables and test settings.
 * Tests import from here instead of reading process.env directly.
 *
 * Setup:
 *   Copy the variables below into your .env file and fill in values.
 *   Unit and offline tests work without any configuration.
 *   Integration tests require valid Feishu tokens.
 *
 * Required .env variables for integration tests:
 *   ROOT_TOKEN       - Drive folder token or Wiki parent node token
 *   BASE_TOKEN       - Base token for API authentication context
 *
 * Optional .env variables:
 *   TEST_DOCUMENT_ID - Existing document ID for patch/append tests
 *   TEST_UPLOAD      - Set to "true" to enable actual Feishu uploads
 *   WIKI_SPACE_ID    - Wiki space ID (for wiki-mode tests)
 *   FEISHU_HOST      - Feishu API host (default: https://open.feishu.cn)
 *   APP_ID           - Feishu app ID
 *   APP_SECRET       - Feishu app secret
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const config = {
    // Feishu API credentials (from .env)
    appId: process.env.APP_ID,
    appSecret: process.env.APP_SECRET,
    feishuHost: process.env.FEISHU_HOST || 'https://open.feishu.cn',

    // Tokens for Drive mode
    rootToken: process.env.ROOT_TOKEN || 'CSzVfDgfAlne87dDj3vcnR3nnsg',
    baseToken: process.env.BASE_TOKEN || 'XmndbkxkQaigA8soRiCcTT41nMd',

    // Wiki mode
    wikiSpaceId: process.env.WIKI_SPACE_ID || '',

    // Test-specific
    testDocumentId: process.env.TEST_DOCUMENT_ID || 'recu1vL7rq1jvb',
    testUpload: process.env.TEST_UPLOAD === 'true',

    // Tokens used by integration tests (previously hardcoded)
    // Override these in .env if the defaults no longer work
    integration: {
        wikiRootToken: process.env.WIKI_ROOT_TOKEN || 'KSvxw0h8LiXtIdkpAnCcrl7cnio',
        wikiBaseToken: process.env.WIKI_BASE_TOKEN || 'LkxfbrY6sa5jQ4sHquEcMqOsnCe',
        roundtripRootToken: process.env.ROUNDTRIP_ROOT_TOKEN || 'OUWXw5c4gia34ZkQUcEcMFbWn6s',
        roundtripBaseToken: process.env.ROUNDTRIP_BASE_TOKEN || 'PnsobATKVayIDFs6hhQcChlGnje',
        testDocId: process.env.INTEGRATION_DOC_ID || 'recu1vL7rq1jvb',
    },

    /**
     * Check if required tokens are available for a given test category
     */
    hasTokens() {
        return !!(this.rootToken && this.baseToken);
    },

    hasIntegrationTokens() {
        return !!(this.integration.wikiRootToken && this.integration.wikiBaseToken);
    },

    /**
     * Create a MarkdownToFeishu instance with standard config
     */
    createM2F(overrides = {}) {
        const MarkdownToFeishu = require('../src/markdown-to-feishu');
        return new MarkdownToFeishu({
            sourceType: overrides.sourceType || 'drive',
            rootToken: overrides.rootToken || this.rootToken || 'dummy',
            baseToken: overrides.baseToken || this.baseToken || 'dummy',
            ...(overrides.document_id && { document_id: overrides.document_id }),
        });
    },

    /**
     * Create a FeishuToMarkdown instance with standard config
     */
    createF2M(overrides = {}) {
        const FeishuToMarkdown = require('../src/feishu-to-markdown');
        return new FeishuToMarkdown({
            sourceType: overrides.sourceType || 'wiki',
            rootToken: overrides.rootToken || this.integration.wikiRootToken,
            baseToken: overrides.baseToken || this.integration.wikiBaseToken,
        });
    },
};

/**
 * Test registry - categorizes all tests for the batch runner
 *
 * Categories:
 *   unit        - Pure logic tests, no env vars needed, no API calls
 *   offline     - Parse/convert tests, need constructor but no API calls
 *   integration - Make real Feishu API calls, need valid tokens
 */
const tests = [
    // Unit tests (always runnable)
    {
        name: 'patch-logic',
        file: 'test-patch-logic.js',
        category: 'unit',
        description: 'Block matching, similarity, type equivalence, preserve logic',
    },
    {
        name: 'python-scanner',
        file: 'test-python-scanner.js',
        category: 'unit',
        description: 'Python source code scanner for SDK symbols',
    },
    {
        name: 'doc-generator',
        file: 'test-doc-generator.js',
        category: 'unit',
        description: 'Markdown doc generation from scanned symbols',
    },
    {
        name: 'diff-engine',
        file: 'test-diff-engine.js',
        category: 'unit',
        description: 'Diff engine comparing scanned symbols vs KB index',
    },
    {
        name: 'bitable-fields',
        file: 'test-bitable-fields.js',
        category: 'unit',
        description: 'BitableWriter._formatFields field formatting conventions',
    },
    {
        name: 'java-scanner',
        file: 'test-java-scanner.js',
        category: 'unit',
        description: 'Java source code scanner for SDK symbols',
    },
    {
        name: 'cpp-scanner',
        file: 'test-cpp-scanner.js',
        category: 'unit',
        description: 'C++ source code scanner for SDK symbols',
    },

    // Offline tests (parse/convert only, no API calls)
    {
        name: 'image-blocks',
        file: 'test-image-blocks.js',
        category: 'offline',
        description: 'Image block creation with _metadata and needs_upload',
    },
    {
        name: 'equations',
        file: 'test-equations.js',
        category: 'offline',
        description: 'Inline and block equation parsing',
    },
    {
        name: 'markdown-to-feishu',
        file: 'test-markdown-to-feishu.js',
        category: 'offline',
        description: 'Full markdown-to-blocks conversion pipeline',
    },
    {
        name: 'supademo',
        file: 'test-supademo.js',
        category: 'offline',
        description: 'Supademo component parsing and add_ons block creation',
    },
    {
        name: 'example',
        file: 'test-example.js',
        category: 'offline',
        description: 'Convert example.md to Feishu blocks',
    },
    {
        name: 'list-blocks',
        file: 'test-list-blocks.js',
        category: 'offline',
        description: 'List block creation: tight vs loose lists and nested children',
    },
    {
        name: 'grid-parser',
        file: 'grid-parser.test.js',
        category: 'offline',
        description: 'Grid JSX component round-trip conversion',
    },
    {
        name: 'tabs-parser',
        file: 'tabs-parser.test.js',
        category: 'offline',
        description: 'Tabs JSX component round-trip conversion',
    },
    {
        name: 'metadata-preservation',
        file: 'metadata-preservation.test.js',
        category: 'offline',
        description: 'Board and iframe metadata preservation via HTML comments',
    },
    {
        name: 'sheet-preservation',
        file: 'sheet-preservation.test.js',
        category: 'offline',
        description: 'Sheet vs table block type distinction',
    },
    {
        name: 'roundtrip-simple',
        file: 'test-roundtrip-simple.js',
        category: 'offline',
        description: 'Simple round-trip: markdown → blocks → validate all types',
    },

    // Integration tests (require Feishu API access)
    {
        name: 'feishu-to-markdown',
        file: 'test-feishu-to-markdown.js',
        category: 'integration',
        description: 'Read Feishu wiki document and convert to markdown',
    },
    {
        name: 'integration-simple',
        file: 'test-integration-simple.js',
        category: 'integration',
        description: 'Simple read -> modify -> update workflow',
    },
    {
        name: 'integration-roundtrip',
        file: 'test-integration-roundtrip.js',
        category: 'integration',
        description: 'Full round-trip: read -> modify -> patch -> verify',
    },
    {
        name: 'patch-direct',
        file: 'test-patch-direct.js',
        category: 'integration',
        description: 'Patch existing document (needs TEST_DOCUMENT_ID)',
    },
    {
        name: 'append-position',
        file: 'test-append-position.js',
        category: 'integration',
        description: 'Verify append strategy adds content at end (needs TEST_DOCUMENT_ID)',
    },
    {
        name: 'patch-document',
        file: 'test-patch-document.js',
        category: 'integration',
        description: 'Create wiki node and test patch_document',
    },
    {
        name: 'wiki-creation',
        file: 'test-wiki-creation.js',
        category: 'integration',
        description: 'Create documents in Drive and Wiki',
    },
    {
        name: 'bitable-writer',
        file: 'test-bitable-writer.js',
        category: 'integration',
        description: 'Bitable record CRUD operations',
    },
    {
        name: 'sdk-doc-sync-e2e',
        file: 'test-sdk-doc-sync-e2e.js',
        category: 'integration',
        description: 'End-to-end SDK doc sync pipeline',
    },
    {
        name: 'roundtrip-comprehensive',
        file: 'test-roundtrip-comprehensive.js',
        category: 'integration',
        description: 'Comprehensive round-trip: Feishu → Markdown → Feishu',
    },
];

module.exports = { config, tests };
