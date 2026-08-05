#!/usr/bin/env node
/**
 * Zilliz CLI Documentation Fetch & Diff Script
 *
 * Fetches current CLI doc pages, generates scaffold versions, and reports
 * identical, different, fetch-only, scanner-only, and failed documents.
 */

'use strict';

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const FeishuToMarkdown = require('../src/feishu-to-markdown');
const ZillizCliScanner = require('../src/sdk-doc-sync/scanners/zilliz-cli-scanner');
const DocGenerator = require('../src/sdk-doc-sync/doc-generator');

const DEFAULT_BITABLE_TOKEN = 'OAK4bJaNuac501sX6Y1cS3OGnzf';
const DEFAULT_SDK_DIR = path.resolve(__dirname, '../../../../repos/zilliz-cloud/vdc/zilliz-cli');
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '../../../../tmp/cli-docs');
const DEFAULT_DELAY_MS = 600;

function parseArgs(argv = process.argv.slice(2)) {
    const options = {
        listOnly: false,
        resource: null,
        method: null,
        baseToken: DEFAULT_BITABLE_TOKEN,
        tableId: null,
        sdkDir: DEFAULT_SDK_DIR,
        sdkVersion: 'v0.1.x',
        outputDir: DEFAULT_OUTPUT_DIR,
    };
    for (const arg of argv) {
        if (arg === '--list-only') options.listOnly = true;
        else if (arg.startsWith('--resource=')) options.resource = arg.slice('--resource='.length);
        else if (arg.startsWith('--method=')) options.method = arg.slice('--method='.length);
        else if (arg.startsWith('--base-token=')) options.baseToken = arg.slice('--base-token='.length);
        else if (arg.startsWith('--table-id=')) options.tableId = arg.slice('--table-id='.length);
        else if (arg.startsWith('--sdk-dir=')) options.sdkDir = arg.slice('--sdk-dir='.length);
        else if (arg.startsWith('--sdk-version=')) options.sdkVersion = arg.slice('--sdk-version='.length);
        else if (arg.startsWith('--output-dir=')) options.outputDir = arg.slice('--output-dir='.length);
        else throw new Error(`Unknown argument: ${arg}`);
    }
    return options;
}

function delay(ms = DEFAULT_DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

function slugForSymbol(symbol) {
    return `${symbol.parentClass}-${symbol.name}`;
}

function normalizeMarkdown(value) {
    return String(value || '').replace(/^---[\s\S]*?---\n\n/, '').trim().replace(/\r\n/g, '\n');
}

function groupByResource(allDocs) {
    const parentMap = {};
    for (const doc of allDocs.filter(d => d.metadata.type === 'VirtualNode')) {
        parentMap[doc.id] = doc.metadata.title;
    }

    const byResource = {};
    for (const doc of allDocs.filter(d => d.metadata.type === 'Function')) {
        const resource = parentMap[doc.parent] || doc.metadata.slug?.split('-')[0] || 'Unknown';
        if (!byResource[resource]) byResource[resource] = [];
        byResource[resource].push(doc);
    }
    return byResource;
}

async function runCliFetchAndDiff({
    listOnly = false,
    resource = null,
    method = null,
    baseToken = DEFAULT_BITABLE_TOKEN,
    tableId = null,
    sdkDir = DEFAULT_SDK_DIR,
    sdkVersion = 'v0.1.x',
    outputDir = DEFAULT_OUTPUT_DIR,
    indexReader = null,
    documentReader = null,
    scanner = null,
    generator = null,
    mkdir = (dir) => fs.mkdirSync(dir, { recursive: true }),
    writeFile = (file, content) => fs.writeFileSync(file, content, 'utf8'),
    log = console.log,
    delay: wait = delay,
} = {}) {
    const reader = indexReader || new FeishuToMarkdown({
        sourceType: 'drive',
        baseToken,
        tableId,
    });
    const readDocuments = reader.listDocuments
        ? () => reader.listDocuments()
        : () => reader.list_documents();
    const docReader = documentReader || {
        readMarkdown: (doc) => reader.get_markdown({ id: doc.id }),
    };
    const sourceScanner = scanner || new ZillizCliScanner({ rootDir: sdkDir });
    const docGenerator = generator || new DocGenerator({
        sdkName: 'Zilliz CLI',
        sdkVersion,
        targets: ['Zilliz CLI'],
        language: 'zilliz-cli',
    });

    log('=== Step 1: Fetching bitable records ===\n');
    const allDocs = await readDocuments();
    const byResource = groupByResource(allDocs);
    const fnDocs = Object.values(byResource).flat();
    log(`  Total records: ${allDocs.length}`);
    log(`  Function records: ${fnDocs.length}\n`);

    for (const [name, docs] of Object.entries(byResource).sort()) {
        log(`    ${name} (${docs.length}): ${docs.map(d => d.metadata.title).join(', ')}`);
    }

    if (listOnly) {
        return {
            totalRecords: allDocs.length,
            functionRecords: fnDocs.length,
            results: [],
            identical: 0,
            different: 0,
            fetchOnly: 0,
            scannerOnly: 0,
            failed: 0,
        };
    }

    log('\n=== Step 2: Scanning CLI source ===\n');
    const symbols = await sourceScanner.scan();
    const symbolMap = new Map(symbols.map((symbol) => [slugForSymbol(symbol), symbol]));
    const seenSymbols = new Set();
    log(`  Scanned ${symbols.length} symbols\n`);

    log('=== Step 3: Fetching docs & generating diffs ===\n');
    mkdir(outputDir);

    const results = [];
    for (const [resourceName, docs] of Object.entries(byResource).sort()) {
        if (resource && resourceName !== resource) continue;
        for (const doc of docs) {
            if (method && doc.metadata.title !== method) continue;
            const slug = doc.metadata.slug || `${resourceName}-${doc.metadata.title}`;
            const docDir = path.join(outputDir, slug);
            mkdir(docDir);
            try {
                const markdown = await docReader.readMarkdown(doc);
                const body = normalizeMarkdown(markdown);
                writeFile(path.join(docDir, 'feishu.md'), body);

                const symbol = symbolMap.get(slug);
                if (!symbol) {
                    results.push({ slug, status: 'fetch-only' });
                    log(`  FETCH-ONLY ${slug}`);
                } else {
                    seenSymbols.add(slug);
                    const generated = normalizeMarkdown(docGenerator.generate(symbol));
                    writeFile(path.join(docDir, 'generated.md'), generated);
                    const status = body === generated ? 'identical' : 'different';
                    results.push({ slug, status });
                    log(`  ${status === 'identical' ? 'SAME' : 'DIFF'} ${slug}`);
                }
                await wait();
            } catch (error) {
                results.push({ slug, status: 'failed', error: error.message });
                log(`  ERROR ${slug}: ${error.message}`);
            }
        }
    }

    for (const [slug] of symbolMap) {
        if (!seenSymbols.has(slug)) {
            results.push({ slug, status: 'scanner-only' });
        }
    }

    const summary = {
        totalRecords: allDocs.length,
        functionRecords: fnDocs.length,
        results,
        identical: results.filter((entry) => entry.status === 'identical').length,
        different: results.filter((entry) => entry.status === 'different').length,
        fetchOnly: results.filter((entry) => entry.status === 'fetch-only').length,
        scannerOnly: results.filter((entry) => entry.status === 'scanner-only').length,
        failed: results.filter((entry) => entry.status === 'failed').length,
    };

    log('\n=== Summary ===\n');
    log(`  Identical: ${summary.identical}`);
    log(`  Different: ${summary.different}`);
    log(`  Fetch-only: ${summary.fetchOnly}`);
    log(`  Scanner-only: ${summary.scannerOnly}`);
    log(`  Failed: ${summary.failed}`);
    return summary;
}

async function main() {
    const options = parseArgs();
    await runCliFetchAndDiff(options);
}

if (require.main === module) {
    main().catch(err => { console.error('FATAL:', err); process.exit(1); });
}

module.exports = { parseArgs, runCliFetchAndDiff };
