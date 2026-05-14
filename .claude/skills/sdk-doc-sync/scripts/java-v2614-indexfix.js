#!/usr/bin/env node
/**
 * Fix Java v2.6.14 IndexType and IndexParam docs.
 *
 * Step 1: Update IndexType — add IVF_RABITQ(13) and AISAQ(14), which were
 *         missing from the standalone enum doc.
 *
 * Step 2: Update IndexParam — replace inline MetricType/IndexType bullet
 *         lists with references to the separate enum docs.
 *
 * Usage:
 *   node scripts/java-v2614-indexfix.js --step=1|2 [--dry-run]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const BITABLE_TOKEN = 'Sbtcbm660abngWsXryKct5nOn2e';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const COLLECTIONS_FOLDER = 'LkxXfcSA7lKXqEdu8mpcHI8Fnqd';
const DELAY_MS = 500;

// Known record and doc IDs
const INDEXTYPE_RECORD = 'recuF7EzscZqTl';
const INDEXTYPE_OLD_DOC = 'SVbSdttVjoTGJrxdLiIcr9VLnPg';
const INDEXPARAM_RECORD = 'recuF7Ez9HFADU';
const INDEXPARAM_OLD_DOC = 'HgsbdSAZBo4MlYxEKeick8N0nsG'; // doc from java-v2614-update.js step 1

// MetricType doc (unchanged, just referenced)
const METRICTYPE_DOC_LINK = `${FEISHU_DOCX_HOST}/docx/GEcrdVWnboOetOx08RrcRHVhn3g`;

const tokenFetcher = new larkTokenFetcher();
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_STEP = args.find(a => a.startsWith('--step='))?.split('=')[1];

if (!ONLY_STEP) {
    console.error('Usage: node scripts/java-v2614-indexfix.js --step=1|2 [--dry-run]');
    process.exit(1);
}

async function feishuAPI(method, endpoint, body = null) {
    const token = await tokenFetcher.token();
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Bearer ${token}` },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${FEISHU_HOST}${endpoint}`, opts);
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Feishu API error: ${data.msg} (code ${data.code})`);
    return data.data;
}

async function delay(ms = DELAY_MS) { return new Promise(r => setTimeout(r, ms)); }

// ── Step 1: Update IndexType enum doc ─────────────────────────────────────

// Full IndexType doc — matches existing structure exactly, adds IVF_RABITQ + AISAQ
const INDEXTYPE_MARKDOWN = `This is an enumeration that provides the following constants.

## Constants{#constants}

### FLAT(1){#flat}

Sets the index type to FLAT.

### IVF_FLAT(2){#ivf_flat}

Sets the index type to IVF_FLAT.

### IVF_SQ8(3){#ivf_sq8}

Sets the index type to IVF_SQ8.

### IVF_PQ(4){#ivf_pq}

Sets the index type to IVF_PQ.

### HNSW(5){#hnsw}

Sets the index type to HNSW.

### HNSW_SQ(6){#hnsw_sq}

Sets the index type to HNSW.

### HNSW_PQ{#hnsw_pq}

Sets the index type to HNSW_PQ.

### HNSW_PRQ{#hnsw_prq}

Sets the index type to HNSW_PRQ.

### DISKANN(10){#diskann}

Sets the index type to DISKANN.

### AUTOINDEX(11){#autoindex}

Sets the index type to AUTOINDEX.

### SCANN(12){#scann}

Sets the index type to SCANN.

### IVF_RABITQ(13){#ivf_rabitq}

Sets the index type to IVF_RABITQ. This applies to dense float vectors.

### AISAQ(14){#aisaq}

Sets the index type to AISAQ. This applies to dense float vectors on GPU.

### GPU_IVF_FLAT(50){#gpu_ivf_flat}

Sets the index type to GPU_IVF_FLAT. This applies to GPU indexes only.

### GPU_IVF_PQ(51){#gpu_ivf_pq}

Sets the index type to GPU_IVF_PQ. This applies to GPU indexes only.

### GPU_BRUTE_FORCE(52){#gpu_brute_force}

Sets the index type to GPU_BRUTE_FORCE. This applies to GPU indexes only.

### GPU_CAGRA(53){#gpu_cagra}

Sets the index type to GPU_CAGRA. This applies to GPU indexes only.

### BIN_FLAT(80){#bin_flat}

Sets the index type to BIN_FLAT. This applies to binary vectors only.

### BIN_IVF_FLAT(81){#bin_ivf_flat}

Sets the index type to BIN_IVF_FLAT. This applies to binary vectors only.

### MINHASH_LSH(82){#minhash_lsh}

Sets the index type to MINHASH_LSH. This applies to binary vectors only.

### TRIE("Trie", 100){#trie}

Sets the index type to TRIE. This applies to VarChar fields only.

### NGRAM(101){#ngram}

Sets the index type to NGRAM. This applies to VarChar fields and JSON Path indexes.

### RTREE(120){#rtree}

Sets the index type to RTREE. This applies to geometry fields only.

### STL_SORT(200){#stl_sort}

Sets the index type to SLT_SORT. This applies to fields of numeric types only.

### INVERTED(201){#inverted}

Sets the index type to INVERTED. This applies to all scalar fields except JSON fields.

### BITMAP(202){#bitmap}

Sets the index type to BITMAP. This applies to all scalar fields except JSON, FLOAT, and DOUBLE fields.

### SPARSE_INVERTED_INDEX{#sparse_inverted_index}

Sets the index type to SPARSE_INVERTED_INDEX. This applies to sparse vectors only.

### SPARSE_WAND{#sparse_wand}

Sets the index type to SPARSE_WAND. This applies to sparse vectors only.

### EMB_LIST_HNSW{#emb_list_hnsw}

Sets the index type to EMB_LIST_HNSW. This applies to an Array of Structs field.
`;

async function step1(m2f, writer) {
    console.log('\n═══ Step 1: Update IndexType — add IVF_RABITQ + AISAQ ═══\n');

    if (DRY_RUN) {
        console.log('  [DRY RUN] Would update IndexType doc');
        console.log('  New constants added after SCANN(12):');
        console.log('    IVF_RABITQ(13) — Sets the index type to IVF_RABITQ. This applies to dense float vectors.');
        console.log('    AISAQ(14)      — Sets the index type to AISAQ. This applies to dense float vectors on GPU.');
        return;
    }

    // Push updated IndexType doc
    console.log('  Pushing updated IndexType doc...');
    const docResult = await m2f.push_markdown({
        markdown_content: INDEXTYPE_MARKDOWN,
        title: 'IndexType',
        folder_token: COLLECTIONS_FOLDER,
    });
    const newDocId = docResult.document_id;
    const newDocLink = `${FEISHU_DOCX_HOST}/docx/${newDocId}`;
    console.log(`  New doc: ${newDocId} (${docResult.blocks_created} blocks)`);

    // Update bitable record
    await delay();
    await writer.updateRecord(INDEXTYPE_RECORD, { title: 'IndexType', link: newDocLink, lastModified: 'v2.6.14' });
    console.log(`  Record ${INDEXTYPE_RECORD} updated`);

    // Delete old doc
    await delay();
    try {
        await feishuAPI('DELETE', `/open-apis/drive/v1/files/${INDEXTYPE_OLD_DOC}?type=docx`);
        console.log(`  Deleted old doc ${INDEXTYPE_OLD_DOC}`);
    } catch (e) {
        console.log(`  Warning: could not delete old doc: ${e.message}`);
    }

    console.log(`\n  ✅ IndexType updated. New link: ${newDocLink}`);

    // Return the new link so step 2 can use it
    return newDocLink;
}

// ── Step 2: Update IndexParam — reference MetricType/IndexType docs ────────

function buildIndexParamMarkdown(indexTypeDocLink) {
    return `IndexParam defines the parameters for configuring an index on a collection field.

\`\`\`java
IndexParam.builder()
    .fieldName(String fieldName)
    .indexType(IndexType indexType)
    .metricType(MetricType metricType)
    .extraParams(Map<String, Object> extraParams)
    .build()
\`\`\`

**BUILDER METHODS:**

- \`fieldName(String fieldName)\` -
The name of the field to index.
- \`indexType(IndexType indexType)\` -
The type of index to build on the field. For available index types, refer to IndexType.
- \`metricType(MetricType metricType)\` -
The metric type for vector similarity measurement. For available metric types, refer to MetricType.
- \`extraParams(Map<String, Object> extraParams)\` -
Additional index-specific parameters as key-value pairs. For example, \`{"M": 16, "efConstruction": 256}\` for HNSW indexes.

**RETURNS:**

*IndexParam*

**EXCEPTIONS:**

*MilvusClientException*

This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`java
import io.milvus.v2.common.IndexParam;

IndexParam indexParam = IndexParam.builder()
    .fieldName("vector")
    .indexType(IndexParam.IndexType.HNSW)
    .metricType(IndexParam.MetricType.COSINE)
    .extraParams(Map.of("M", 16, "efConstruction", 256))
    .build();
\`\`\`
`;
}

async function step2(m2f, writer, indexTypeDocLink) {
    console.log('\n═══ Step 2: Update IndexParam — reference MetricType/IndexType ═══\n');

    const markdown = buildIndexParamMarkdown(indexTypeDocLink);

    if (DRY_RUN) {
        console.log('  [DRY RUN] Would update IndexParam doc');
        console.log('  Inline MetricType/IndexType enum lists → replaced with references to separate docs');
        console.log(`  IndexType doc link: ${indexTypeDocLink || '(will be set by step 1)'}`);
        console.log(`  MetricType doc link: ${METRICTYPE_DOC_LINK}`);
        console.log('\n  Markdown preview:');
        console.log(markdown.slice(0, 500) + '...');
        return;
    }

    // Push new IndexParam doc
    console.log('  Pushing updated IndexParam doc...');
    const docResult = await m2f.push_markdown({
        markdown_content: markdown,
        title: 'IndexParam',
        folder_token: COLLECTIONS_FOLDER,
    });
    const newDocId = docResult.document_id;
    const newDocLink = `${FEISHU_DOCX_HOST}/docx/${newDocId}`;
    console.log(`  New doc: ${newDocId} (${docResult.blocks_created} blocks)`);

    // Update bitable record
    await delay();
    await writer.updateRecord(INDEXPARAM_RECORD, {
        title: 'IndexParam',
        link: newDocLink,
        lastModified: 'v2.6.14',
    });
    console.log(`  Record ${INDEXPARAM_RECORD} updated`);

    // Delete old doc
    await delay();
    try {
        await feishuAPI('DELETE', `/open-apis/drive/v1/files/${INDEXPARAM_OLD_DOC}?type=docx`);
        console.log(`  Deleted old doc ${INDEXPARAM_OLD_DOC}`);
    } catch (e) {
        console.log(`  Warning: could not delete old doc: ${e.message}`);
    }

    console.log(`\n  ✅ IndexParam updated. New link: ${newDocLink}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
    if (DRY_RUN) console.log('*** DRY RUN MODE ***\n');

    const m2f = new MarkdownToFeishu({ sourceType: 'drive' });
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    if (ONLY_STEP === '1') {
        await step1(m2f, writer);
    } else if (ONLY_STEP === '2') {
        // step 2 doesn't need the new IndexType link at runtime —
        // it just says "refer to IndexType" in prose (no hyperlink).
        await step2(m2f, writer, null);
    } else if (ONLY_STEP === '1+2') {
        // Run both in sequence; pass the new IndexType link to step 2
        const indexTypeLink = await step1(m2f, writer);
        await delay(1000);
        await step2(m2f, writer, indexTypeLink);
    } else {
        console.log(`Step "${ONLY_STEP}" not implemented. Available: 1, 2, 1+2`);
    }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
