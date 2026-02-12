const fs = require('fs');
const path = require('path');
const { config } = require('./test.config');
const SdkDocSync = require('../src/sdk-doc-sync');

const SAMPLE_DIR = path.join(__dirname, '__fixtures__', 'e2e-python-sample');

function setup() {
    fs.mkdirSync(SAMPLE_DIR, { recursive: true });

    fs.writeFileSync(path.join(SAMPLE_DIR, 'client.py'), `
class TestClient:
    """A test client for e2e testing."""

    def __init__(self, uri: str = "http://localhost"):
        """Initialize TestClient."""
        self.uri = uri

    def do_something(self, data: list) -> dict:
        """Do something with data."""
        pass
`);
}

function teardown() {
    fs.rmSync(SAMPLE_DIR, { recursive: true, force: true });
}

async function testDryRun() {
    console.log('  Test: dry run (no API calls)');

    const sync = new SdkDocSync({
        sdkDir: SAMPLE_DIR,
        language: 'python',
        sdkName: 'test-sdk',
        sdkVersion: '0.0.1',
        rootToken: 'dummy',
        baseToken: 'dummy',
        dryRun: true,
        onProgress: (phase, msg) => console.log(`    [${phase}] ${msg}`),
    });

    const result = await sync.run();

    if (result.scanned.length === 0) throw new Error('No symbols scanned');
    console.log(`    Scanned: ${result.scanned.length} symbols`);
    console.log(`    Diff: ${result.diff.length} actions`);

    // All should be CREATE since no indexed docs in dry run
    const creates = result.diff.filter(a => a.type === 'CREATE');
    if (creates.length !== result.scanned.length) {
        throw new Error(`Expected all CREATE actions, got ${creates.length}/${result.scanned.length}`);
    }

    console.log('    PASS\n');
}

async function testFullPipeline() {
    console.log('  Test: full pipeline (requires Feishu API)');

    if (!config.hasIntegrationTokens()) {
        console.log('    Skipping — no integration tokens\n');
        return;
    }

    const sync = new SdkDocSync({
        sdkDir: SAMPLE_DIR,
        language: 'python',
        sdkName: 'test-sdk',
        sdkVersion: '0.0.1-e2e',
        sourceType: 'wiki',
        rootToken: config.integration.wikiRootToken,
        baseToken: config.integration.wikiBaseToken,
        onProgress: (phase, msg) => console.log(`    [${phase}] ${msg}`),
        approvalCallback: async (actions) => {
            // Auto-approve all for testing
            console.log(`    Auto-approving ${actions.length} actions`);
            return actions;
        },
    });

    const result = await sync.run();
    console.log(`    Results: ${result.results.length} executed`);

    const succeeded = result.results.filter(r => r.status === 'success').length;
    const failed = result.results.filter(r => r.status === 'error').length;
    console.log(`    Succeeded: ${succeeded}, Failed: ${failed}`);

    if (failed > 0) {
        for (const r of result.results.filter(r => r.status === 'error')) {
            console.log(`      ERROR: ${r.action.slug} — ${r.error}`);
        }
    }

    console.log('    PASS\n');
}

async function run() {
    console.log('SDK Doc Sync E2E Tests\n');

    setup();
    try {
        await testDryRun();
        await testFullPipeline();
        console.log('All SDK Doc Sync E2E tests passed!');
    } finally {
        teardown();
    }
}

run().catch(err => {
    teardown();
    console.error('FAIL:', err.message);
    process.exit(1);
});
