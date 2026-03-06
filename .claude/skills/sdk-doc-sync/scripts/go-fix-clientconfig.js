#!/usr/bin/env node
/**
 * Fix ClientConfig doc: change FIELDS → PARAMETERS and reformat parameter bullets
 * into the canonical format: **param** (*type*) - in bullet, then child paragraphs
 * for [REQUIRED] and description.
 *
 * Usage: node scripts/go-fix-clientconfig.js [--dry-run]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });
const fetch = require('node-fetch');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');

const DOC_ID = 'B7eadZ3KboNCSzxGyhDcGLCIn6e';
const FEISHU_HOST = process.env.FEISHU_HOST;
const DRY_RUN = process.argv.includes('--dry-run');

const tokenFetcher = new larkTokenFetcher();

// ── Parameter definitions ─────────────────────────────────────────────────────
// Each entry: { name, type, required, description (array of text segments) }
// Text segment: { text, bold?, italic?, code? }

function t(text, opts = {}) {
    return { text, ...opts };
}

const PARAMS = [
    {
        name: 'Address', type: 'string', required: true,
        desc: [
            t('The address of the Milvus server in host:port format (e.g., '),
            t('"localhost:19530"', { code: true }),
            t(') or as an HTTPS URL (e.g., '),
            t('"https://your-endpoint.zillizcloud.com"', { code: true }),
            t(').'),
        ],
    },
    {
        name: 'Username', type: 'string', required: false,
        desc: [t('The username for password-based authentication.')],
    },
    {
        name: 'Password', type: 'string', required: false,
        desc: [t('The password for password-based authentication.')],
    },
    {
        name: 'DBName', type: 'string', required: false,
        desc: [t('The name of the database to connect to. Uses the default database if not set.')],
    },
    {
        name: 'EnableTLSAuth', type: 'bool', required: false,
        desc: [
            t('Whether to enable TLS for the connection. Automatically set to '),
            t('true', { code: true }),
            t(' when the Address uses the '),
            t('https', { code: true }),
            t(' scheme.'),
        ],
    },
    {
        name: 'APIKey', type: 'string', required: false,
        desc: [t('An API key for token-based authentication, used for Zilliz Cloud connections.')],
    },
    {
        name: 'DialOptions', type: '[]grpc.DialOption', required: false,
        desc: [t('Additional gRPC dial options to customize the connection. Merged with the default options if provided.')],
    },
    {
        name: 'RetryRateLimit', type: '*RetryRateLimitOption', required: false,
        desc: [
            t('Configuration for automatic retry on rate-limit errors. '),
            t('RetryRateLimitOption', { code: true }),
            t(' has two fields: '),
            t('MaxRetry uint', { code: true }),
            t(' (maximum retry attempts, default 75) and '),
            t('MaxBackoff time.Duration', { code: true }),
            t(' (maximum backoff duration, default 3s). Uses sensible defaults if nil.'),
        ],
    },
    {
        name: 'DisableConn', type: 'bool', required: false,
        desc: [
            t('If '),
            t('true', { code: true }),
            t(', skips establishing the gRPC connection during initialization. Useful for testing or deferred connections.'),
        ],
    },
    {
        name: 'ServerVersion', type: 'string', required: false,
        desc: [t('The version string of the connected server. Populated automatically after connection.')],
    },
];

// ── Feishu block helpers ──────────────────────────────────────────────────────

function textRun(content, opts = {}) {
    return {
        text_run: {
            content,
            text_element_style: {
                bold: opts.bold || false,
                italic: opts.italic || false,
                inline_code: opts.code || false,
                strikethrough: false,
                underline: false,
            },
        },
    };
}

/** Elements for: **Name** (*type*) - */
function bulletElements(name, type) {
    return [
        textRun(name, { bold: true }),
        textRun(' ('),
        textRun(type, { italic: true }),
        textRun(') -'),
    ];
}

/** Elements for a description segment array */
function descElements(segments) {
    return segments.map(s => textRun(s.text, { bold: s.bold, italic: s.italic, code: s.code }));
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function api(method, endpoint, body = null) {
    const token = await tokenFetcher.token();
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${FEISHU_HOST}${endpoint}`, opts);
    const data = await res.json();
    if (data.code !== 0) throw new Error(`API error: ${data.msg} (code ${data.code})\n${JSON.stringify(data)}`);
    return data.data;
}

function delay(ms = 300) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    // 1. Fetch all blocks
    console.log('Fetching blocks...');
    const data = await api('GET', `/open-apis/docx/v1/documents/${DOC_ID}/blocks?page_size=100`);
    const blocks = data.items;

    const paragraphs = blocks.filter(b => b.block_type === 2);
    const bullets    = blocks.filter(b => b.block_type === 12);

    console.log(`  Found ${paragraphs.length} paragraphs, ${bullets.length} bullets`);

    if (bullets.length !== PARAMS.length) {
        throw new Error(`Expected ${PARAMS.length} bullets, found ${bullets.length}`);
    }

    // 2. Find FIELDS: paragraph and update to PARAMETERS:
    // The FIELDS paragraph is the one with bold "FIELDS:" text
    const fieldsBlock = paragraphs.find(b => {
        const elems = b.paragraph?.elements || b.text?.elements || [];
        return elems.some(e => (e.text_run || e.textRun)?.content?.includes('FIELDS'));
    });

    if (!fieldsBlock) {
        console.error('Could not find FIELDS: paragraph!');
        process.exit(1);
    }

    console.log(`\nFound FIELDS: paragraph: ${fieldsBlock.block_id}`);

    if (DRY_RUN) {
        console.log('[DRY RUN] Would update to PARAMETERS:');
    } else {
        await api('PATCH', `/open-apis/docx/v1/documents/${DOC_ID}/blocks/batch_update`, {
            requests: [{
                block_id: fieldsBlock.block_id,
                update_text_elements: {
                    elements: [textRun('PARAMETERS:', { bold: true })],
                },
            }],
        });
        console.log('  Updated FIELDS: → PARAMETERS:');
        await delay();
    }

    // 3. Update each bullet and add child paragraphs
    console.log('\nReformatting bullet blocks...');

    for (let i = 0; i < bullets.length; i++) {
        const bullet = bullets[i];
        const param = PARAMS[i];

        console.log(`\n  [${i + 1}] ${param.name} (*${param.type}*)`);

        if (DRY_RUN) {
            console.log(`    [DRY RUN] Would update bullet ${bullet.block_id}`);
            console.log(`    [DRY RUN] Would add ${param.required ? 2 : 1} child paragraph(s)`);
            continue;
        }

        // 3a. Update bullet to contain only **Name** (*type*) -
        await api('PATCH', `/open-apis/docx/v1/documents/${DOC_ID}/blocks/batch_update`, {
            requests: [{
                block_id: bullet.block_id,
                update_text_elements: {
                    elements: bulletElements(param.name, param.type),
                },
            }],
        });
        console.log(`    Updated bullet`);
        await delay();

        // 3b. Build child paragraphs
        const childBlocks = [];

        if (param.required) {
            childBlocks.push({
                block_type: 2,
                text: {
                    elements: [textRun('[REQUIRED]', { bold: true })],
                    style: { align: 1, folded: false },
                },
            });
        }

        childBlocks.push({
            block_type: 2,
            text: {
                elements: descElements(param.desc),
                style: { align: 1, folded: false },
            },
        });

        // 3c. Create child blocks inside the bullet
        await api('POST', `/open-apis/docx/v1/documents/${DOC_ID}/blocks/${bullet.block_id}/children`, {
            children: childBlocks,
            index: 0,
        });
        console.log(`    Added ${childBlocks.length} child paragraph(s)`);
        await delay();
    }

    console.log('\nDone!');
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
