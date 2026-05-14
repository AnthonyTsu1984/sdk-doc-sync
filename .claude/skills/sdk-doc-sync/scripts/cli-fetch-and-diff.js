#!/usr/bin/env node
/**
 * Zilliz CLI Documentation Fetch & Diff Script
 *
 * Fetches current CLI doc pages from Feishu, generates scaffold versions,
 * and produces a side-by-side comparison to identify manual adjustments.
 *
 * Usage:
 *   node .claude/skills/sdk-doc-sync/scripts/cli-fetch-and-diff.js [--resource=Name] [--method=name] [--list-only]
 *
 * Options:
 *   --list-only     Just list all Function records (no fetching)
 *   --resource=X    Only fetch docs for resource X (e.g., Cluster, Vector)
 *   --method=X      Only fetch doc for method X (e.g., list, search)
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fs = require('fs');
const FeishuToMarkdown = require('../src/feishu-to-markdown');
const ZillizCliScanner = require('../src/sdk-doc-sync/scanners/zilliz-cli-scanner');
const DocGenerator = require('../src/sdk-doc-sync/doc-generator');

const BITABLE_TOKEN = 'OAK4bJaNuac501sX6Y1cS3OGnzf';
const SDK_DIR = path.resolve(__dirname, '../../../../repos/zilliz-cloud/vdc/zilliz-cli');
const OUTPUT_DIR = path.resolve(__dirname, '../../../../tmp/cli-docs');

const args = process.argv.slice(2);
const LIST_ONLY = args.includes('--list-only');
const ONLY_RESOURCE = args.find(a => a.startsWith('--resource='))?.split('=')[1];
const ONLY_METHOD = args.find(a => a.startsWith('--method='))?.split('=')[1];
const DELAY_MS = 600;

function delay(ms = DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

async function main() {
    // 1. List all records from bitable
    console.log('=== Step 1: Fetching bitable records ===\n');
    const f2m = new FeishuToMarkdown({
        sourceType: 'drive',
        baseToken: BITABLE_TOKEN,
    });
    const allDocs = await f2m.list_documents();
    const fnDocs = allDocs.filter(d => d.metadata.type === 'Function');

    console.log(`  Total records: ${allDocs.length}`);
    console.log(`  Function records: ${fnDocs.length}\n`);

    // Group by parent to show resource grouping
    const parentMap = {};
    const vnDocs = allDocs.filter(d => d.metadata.type === 'VirtualNode');
    for (const vn of vnDocs) {
        parentMap[vn.id] = vn.metadata.title;
    }

    const byResource = {};
    for (const doc of fnDocs) {
        const resource = parentMap[doc.parent] || 'Unknown';
        if (!byResource[resource]) byResource[resource] = [];
        byResource[resource].push(doc);
    }

    console.log('  Commands by resource:');
    for (const [resource, docs] of Object.entries(byResource).sort()) {
        console.log(`    ${resource} (${docs.length}): ${docs.map(d => d.metadata.title).join(', ')}`);
    }

    if (LIST_ONLY) {
        console.log('\n  --list-only mode, stopping here.');
        return;
    }

    // 2. Scan CLI source to get generated scaffolds
    console.log('\n=== Step 2: Scanning CLI source ===\n');
    const scanner = new ZillizCliScanner({ rootDir: SDK_DIR });
    const symbols = await scanner.scan();
    console.log(`  Scanned ${symbols.length} symbols\n`);

    const generator = new DocGenerator({
        sdkName: 'Zilliz CLI',
        sdkVersion: 'v0.1.x',
        targets: ['Zilliz CLI'],
        language: 'zilliz-cli',
    });

    // Build slug → symbol map
    const symbolMap = {};
    for (const sym of symbols) {
        const slug = `${sym.parentClass}-${sym.name}`;
        symbolMap[slug] = sym;
    }

    // 3. Fetch each doc and compare
    console.log('=== Step 3: Fetching docs & generating diffs ===\n');
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    let fetched = 0;
    let diffCount = 0;
    const diffs = [];

    for (const [resource, docs] of Object.entries(byResource).sort()) {
        if (ONLY_RESOURCE && resource !== ONLY_RESOURCE) continue;

        for (const doc of docs) {
            if (ONLY_METHOD && doc.metadata.title !== ONLY_METHOD) continue;

            const slug = `${resource}-${doc.metadata.title}`;
            const docDir = path.join(OUTPUT_DIR, slug);
            fs.mkdirSync(docDir, { recursive: true });

            // Fetch from Feishu
            try {
                const markdown = await f2m.get_markdown({ id: doc.id });
                if (!markdown) {
                    console.log(`  SKIP ${slug} — no markdown returned`);
                    continue;
                }

                // Strip front matter for comparison
                const body = markdown.replace(/^---[\s\S]*?---\n\n/, '');
                fs.writeFileSync(path.join(docDir, 'feishu.md'), body);
                fetched++;

                // Generate scaffold
                const sym = symbolMap[slug];
                if (sym) {
                    const generated = generator.generate(sym);
                    fs.writeFileSync(path.join(docDir, 'generated.md'), generated);

                    // Simple diff: compare normalized content
                    const normFeishu = body.trim().replace(/\r\n/g, '\n');
                    const normGenerated = generated.trim().replace(/\r\n/g, '\n');

                    if (normFeishu !== normGenerated) {
                        diffCount++;
                        diffs.push({ slug, resource, method: doc.metadata.title });
                        console.log(`  DIFF ${slug}`);
                    } else {
                        console.log(`  SAME ${slug}`);
                    }
                } else {
                    console.log(`  FETCH-ONLY ${slug} (no matching scanner symbol)`);
                }

                await delay();
            } catch (err) {
                console.error(`  ERROR ${slug}: ${err.message}`);
            }
        }
    }

    // 4. Summary
    console.log(`\n=== Summary ===\n`);
    console.log(`  Fetched: ${fetched}`);
    console.log(`  With diffs: ${diffCount}`);
    console.log(`  Identical: ${fetched - diffCount}`);

    if (diffs.length > 0) {
        console.log(`\n  Modified docs:`);
        for (const d of diffs) {
            console.log(`    - ${d.slug}`);
        }
        console.log(`\n  Diff files saved to: ${OUTPUT_DIR}`);
        console.log(`  Compare with: diff tmp/cli-docs/{slug}/feishu.md tmp/cli-docs/{slug}/generated.md`);
    }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
