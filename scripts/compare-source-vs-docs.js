/**
 * Compare v2.6.8 pymilvus source parameters against actual Feishu doc content.
 *
 * For each documented MilvusClient method:
 *   1. Get param list from source (via PythonScanner)
 *   2. Fetch the Feishu doc and parse the PARAMETERS section
 *   3. Report discrepancies (added/removed params)
 */
require('dotenv').config();

const PythonScanner = require('../src/sdk-doc-sync/scanners/python-scanner');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const FeishuToMarkdown = require('../src/feishu-to-markdown');

const PKG_DIR = './repos/pymilvus/pymilvus';
const BITABLE_TOKEN = 'J3Qzbv7AWazzivsv7vqcqlGCnFc';

/**
 * Extract parameter names from a Feishu doc's markdown content.
 * Looks for lines like: - **param_name** (*type*) -
 * Only within the PARAMETERS section.
 */
function extractDocParams(markdown) {
    const params = [];
    const lines = markdown.split('\n');
    let inParams = false;

    for (const line of lines) {
        // Start of PARAMETERS section
        if (/^\*\*PARAMETERS:?\*\*/.test(line.trim())) {
            inParams = true;
            continue;
        }
        // End of PARAMETERS section (next heading or section marker)
        if (inParams && /^(\*\*RETURN|##\s|---|\*\*EXCEPTIONS)/.test(line.trim())) {
            break;
        }
        if (inParams) {
            // Match bullet param lines: - **param_name** or - **\*\*kwargs**
            const m = line.match(/^-\s+\*\*\\?\*?\\?\*?(\w+)\*\*/);
            if (m) {
                params.push(m[1]);
            }
            // Also match **kwargs style
            const kw = line.match(/^-\s+\*\*\\?\*\\?\*kwargs\*\*/);
            if (kw) {
                params.push('kwargs');
            }
        }
    }
    return params;
}

/**
 * Extract parameter names from a code block in the Request Syntax section.
 * Looks for the function signature in the code block.
 */
function extractCodeParams(markdown) {
    const params = [];
    // Find the code block after Request Syntax
    const syntaxMatch = markdown.match(/## Request [Ss]yntax.*?\n```python\n([\s\S]*?)```/);
    if (!syntaxMatch) return params;

    const codeBlock = syntaxMatch[1];
    const lines = codeBlock.split('\n');
    for (const line of lines) {
        const trimmed = line.trim().replace(/,$/, '');
        // Match param lines like: param_name: type = default
        // or just: param_name,
        // Skip 'self' and the function def line
        if (trimmed.startsWith('def ') || trimmed === 'self,' || trimmed === 'self') continue;
        if (trimmed.startsWith(')')) continue;
        if (trimmed === '') continue;

        // Extract param name
        const m = trimmed.match(/^\*?\*?(\w+)/);
        if (m && m[1] !== 'kwargs') {
            params.push(m[1]);
        }
        if (trimmed.includes('**kwargs')) {
            params.push('kwargs');
        }
    }
    return params;
}

async function main() {
    // 1. Scan v2.6.8 source
    console.log('Scanning v2.6.8 pymilvus source...');
    const scanner = new PythonScanner({ rootDir: PKG_DIR, publicOnly: true });
    const symbols = await scanner.scan();

    // Build map of MilvusClient methods -> params
    const sourceMap = new Map();
    for (const sym of symbols) {
        if (sym.kind !== 'method') continue;
        if (sym.parentClass !== 'MilvusClient') continue;
        const params = (sym.params || [])
            .map(p => p.name)
            .filter(p => p !== 'self');
        sourceMap.set(sym.name, params);
    }
    console.log(`Found ${sourceMap.size} MilvusClient methods in source\n`);

    // 2. Fetch bitable records
    console.log('Fetching v2.6.x bitable records...');
    const bw = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const records = await bw.listRecords();

    // Filter to Function type with doc links
    const funcRecords = records.filter(r => {
        const type = r.fields['Type'];
        const docs = r.fields['Docs'];
        return type === 'Function' && docs && docs.link;
    });
    console.log(`Found ${funcRecords.length} Function records with doc links\n`);

    // Suppress get_markdown debug logging
    const origLog = console.log;
    const quietLog = (...args) => {
        const msg = args.join(' ');
        if (msg.includes('Fetching document:') || msg.includes('Converting document') ||
            msg.includes('page 1') || msg.includes('Unprocessed:') ||
            msg.includes('text 2') || msg.includes('heading') ||
            msg.includes('code 14') || msg.includes('only block') ||
            msg.includes('bullet 12') || msg.includes('Cannot find') ||
            msg.includes('callout') || msg.includes('divider') ||
            msg.includes('quote') || msg.includes('table')) {
            return;
        }
        origLog(...args);
    };

    // 3. Fetch each doc and compare
    const f2m = new FeishuToMarkdown({
        sourceType: 'drive',
        rootToken: 'dummy',
        baseToken: BITABLE_TOKEN,
    });

    const discrepancies = [];
    let checked = 0;
    let skipped = 0;

    for (const rec of funcRecords) {
        const docs = rec.fields['Docs'];
        const title = docs.text || '';
        const link = docs.link || '';

        // Extract method name from title (e.g., "compact()" -> "compact")
        const nameMatch = title.match(/^(\w+)\(\)$/);
        if (!nameMatch) {
            skipped++;
            continue;
        }
        const methodName = nameMatch[1];

        // Get the slug from bitable
        const slugField = rec.fields['Slug'];
        const slug = slugField?.value?.[0]?.text || '(no slug)';

        // Check if this method exists in source
        const sourceParams = sourceMap.get(methodName);
        if (!sourceParams) {
            skipped++;
            continue;
        }

        // Extract doc ID from link
        const docIdMatch = link.match(/\/docx\/([A-Za-z0-9]+)/);
        if (!docIdMatch) {
            skipped++;
            continue;
        }
        const docId = docIdMatch[1];

        // Fetch the doc
        checked++;
        process.stdout.write(`  [${checked}] ${slug} ... `);

        let markdown;
        try {
            console.log = quietLog;
            markdown = await f2m.get_markdown({ id: rec.record_id });
            console.log = origLog;
        } catch (err) {
            console.log = origLog;
            process.stdout.write(`ERROR: ${err.message}\n`);
            continue;
        }

        // Extract documented params (try both bullet section and code block)
        let docParams = extractDocParams(markdown);
        if (docParams.length === 0) {
            docParams = extractCodeParams(markdown);
        }

        // Compare
        const sourceNames = sourceParams.filter(p => p !== 'kwargs');
        const docNames = docParams.filter(p => p !== 'kwargs');

        const inSourceNotDoc = sourceNames.filter(p => !docNames.includes(p));
        const inDocNotSource = docNames.filter(p => !sourceNames.includes(p));

        // Check kwargs presence
        const sourceHasKwargs = sourceParams.includes('kwargs');
        const docHasKwargs = docParams.includes('kwargs');

        const kwargsOnly = inSourceNotDoc.length === 0 && inDocNotSource.length === 0 && sourceHasKwargs && !docHasKwargs;

        if (inSourceNotDoc.length > 0 || inDocNotSource.length > 0) {
            discrepancies.push({
                method: methodName,
                slug,
                recordId: rec.record_id,
                docId,
                inSourceNotDoc,
                inDocNotSource,
                missingKwargs: sourceHasKwargs && !docHasKwargs,
                sourceParams: sourceNames,
                docParams: docNames,
            });
            origLog('MISMATCH');
        } else if (kwargsOnly) {
            origLog('OK (kwargs only)');
        } else {
            origLog('OK');
        }

        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 100));
    }

    // 4. Report
    console.log(`\n${'='.repeat(70)}`);
    console.log(`  Source vs Docs Comparison: v2.6.8`);
    console.log(`  Checked: ${checked}, Skipped: ${skipped}, Mismatches: ${discrepancies.length}`);
    console.log(`${'='.repeat(70)}\n`);

    if (discrepancies.length === 0) {
        console.log('All documented methods match the source parameters.');
        return;
    }

    for (const d of discrepancies) {
        console.log(`── ${d.slug}  (${d.method}()) ──`);
        if (d.inSourceNotDoc.length > 0) {
            console.log(`   IN SOURCE, NOT IN DOC:  ${d.inSourceNotDoc.join(', ')}`);
        }
        if (d.inDocNotSource.length > 0) {
            console.log(`   IN DOC, NOT IN SOURCE:  ${d.inDocNotSource.join(', ')}`);
        }
        console.log(`   Source: [${d.sourceParams.join(', ')}]`);
        console.log(`   Doc:    [${d.docParams.join(', ')}]`);
        console.log();
    }
}

main().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});
