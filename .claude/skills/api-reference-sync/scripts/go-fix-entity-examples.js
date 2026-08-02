#!/usr/bin/env node
/**
 * Go SDK Entity/Enum Example Fixer
 *
 * Two actions:
 * 1. OUTPUT types: remove the Example section entirely (heading2 + code block)
 * 2. INPUT types: replace // TODO with a real usage example
 *
 * Usage:
 *   node scripts/go-fix-entity-examples.js [--dry-run]
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });
const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const tokenFetcher = new larkTokenFetcher();
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DELAY_MS = 350;

const DRY_RUN = process.argv.includes('--dry-run');

async function feishuAPI(method, endpoint, body) {
  const token = await tokenFetcher.token();
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${FEISHU_HOST}${endpoint}`, opts);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Feishu API [${data.code}]: ${data.msg} — ${endpoint}`);
  return data.data;
}

async function delay() { return new Promise(r => setTimeout(r, DELAY_MS)); }

async function getDocBlocks(docId) {
  const blocks = [];
  let pageToken = null;
  do {
    const url = `/open-apis/docx/v1/documents/${docId}/blocks${pageToken ? `?page_token=${pageToken}` : ''}`;
    const data = await feishuAPI('GET', url);
    blocks.push(...data.items);
    pageToken = data.has_more ? data.page_token : null;
  } while (pageToken);
  return blocks;
}

function blockText(b) {
  const elems = (b.text || b.heading2 || b.bullet || b.code || {}).elements || [];
  return elems.map(e => e.text_run?.content || '').join('');
}

// ─── Output-only docs: remove Example section ─────────────────────────────────

const OUTPUT_DOCS = [
  { name: 'Collection',          docId: 'GiPadtBkjodLtQx18bCcAtG1nDg' },
  { name: 'ResourceGroup',       docId: 'O38pdGna6oBPM5xN6Ngcbhs9nhf' },
  { name: 'Alias',               docId: 'GwIxdz90jojeBNx965VcTJHnnFd' },
  { name: 'IndexDescription',    docId: 'Wyvhd3725onAmAxegk1caOHonQg' },
  { name: 'CreateIndexTask',     docId: 'Y0IAdifhVoYQVAxiZEdcjIS0nog' },
  { name: 'LoadTask',            docId: 'U9w7dQeEBom2UBxJZM1cJAIYniL' },
  { name: 'FlushTask',           docId: 'BPXDdgDPzoaDTixPJLncvFZ0nig' },
  { name: 'LoadState',           docId: 'XWSAdFkdDoaDPnxOtkEcuFETngL' },
  { name: 'CompactionState',     docId: 'StsddnE0ho6w73xxaGucPja3nMc' },
  { name: 'Segment',             docId: 'QWRidEpUAo3sk3xh1shchxbunWg' },
  { name: 'Index',               docId: 'ERQodkjAzotUQ3xKvA8c6jmLn3e' },
  { name: 'ResultSet',           docId: 'CCWrdPlSao0pOTx9oIgcA64Nnjd' },
  { name: 'InsertResult',        docId: 'EqKvdT96PoSVzzxyEF7civIgnDh' },
  { name: 'DeleteResult',        docId: 'Gh4ydrMIBopZekxncUFcrJctnBl' },
  { name: 'UpsertResult',        docId: 'KlfGdGLbxo7zfNxin91cgFxWnQO' },
  { name: 'User',                docId: 'FCnndgcaworiHGxozvocjrZonIj' },
  { name: 'Role',                docId: 'MUdZdTFeDoEtcwxBCOycaHyanr7' },
  { name: 'RBACMeta',            docId: 'GyCrdXyvzobrrAxzFRbcRTlSnUb' },
  { name: 'PrivilegeGroup',      docId: 'IPv6dB9pdoGXeRxdoL4c70pWnmg' },
  { name: 'Database',            docId: 'KXgNdgTrWoglBsxXTjvcIwnpnqh' },
];

// ─── Input docs: replace TODO with real example ───────────────────────────────

const INPUT_DOCS = [
  {
    name: 'Schema',
    docId: 'SfI4d1i4roSMZ5xd18vc7ewAnPc',
    example: `import (
    "github.com/milvus-io/milvus/client/v2/entity"
)

schema := entity.NewSchema().
    WithName("my_collection").
    WithField(entity.NewField().
        WithName("id").
        WithDataType(entity.FieldTypeInt64).
        WithIsPrimaryKey(true)).
    WithField(entity.NewField().
        WithName("embedding").
        WithDataType(entity.FieldTypeFloatVector).
        WithDim(768))`,
  },
  {
    name: 'Field',
    docId: 'LPVNd0HPDoH0ZsxylIncj8egnTd',
    example: `import (
    "github.com/milvus-io/milvus/client/v2/entity"
)

// Primary key field
pkField := entity.NewField().
    WithName("id").
    WithDataType(entity.FieldTypeInt64).
    WithIsPrimaryKey(true)

// Vector field
vectorField := entity.NewField().
    WithName("embedding").
    WithDataType(entity.FieldTypeFloatVector).
    WithDim(768)

// Scalar field with max length
varcharField := entity.NewField().
    WithName("category").
    WithDataType(entity.FieldTypeVarChar).
    WithMaxLength(256)`,
  },
  {
    name: 'FieldType',
    docId: 'Xq9Ydn3OJoYrHmxMVOLcMn9onHc',
    example: `import (
    "github.com/milvus-io/milvus/client/v2/entity"
)

// Use FieldType when defining collection fields
vectorField := entity.NewField().
    WithName("embedding").
    WithDataType(entity.FieldTypeFloatVector).
    WithDim(768)

pkField := entity.NewField().
    WithName("id").
    WithDataType(entity.FieldTypeInt64).
    WithIsPrimaryKey(true)

varcharField := entity.NewField().
    WithName("category").
    WithDataType(entity.FieldTypeVarChar).
    WithMaxLength(256)`,
  },
  {
    name: 'Function',
    docId: 'G4dTdejt8otbQWxUqvucwKnBnYg',
    example: `import (
    "github.com/milvus-io/milvus/client/v2/entity"
)

// Define a BM25 text embedding function on a VarChar field
fn := entity.NewFunction().
    WithName("bm25_fn").
    WithFunctionType(entity.FunctionTypeBM25).
    WithInputFields("text").
    WithOutputFields("sparse_vector")

schema := entity.NewSchema().
    WithName("my_collection").
    WithField(entity.NewField().WithName("id").WithDataType(entity.FieldTypeInt64).WithIsPrimaryKey(true)).
    WithField(entity.NewField().WithName("text").WithDataType(entity.FieldTypeVarChar).WithMaxLength(1000).WithEnableAnalyzer(true)).
    WithField(entity.NewField().WithName("sparse_vector").WithDataType(entity.FieldTypeSparseVector)).
    WithFunction(fn)`,
  },
  {
    name: 'ConsistencyLevel',
    docId: 'CBg7dbZZ7oxxvJx1eV4cJXWGnbe',
    example: `import (
    "context"
    "fmt"

    "github.com/milvus-io/milvus/client/v2/entity"
    "github.com/milvus-io/milvus/client/v2/milvusclient"
)

ctx, cancel := context.WithCancel(context.Background())
defer cancel()

milvusAddr := "127.0.0.1:19530"

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
    Address: milvusAddr,
})
if err != nil {
    // handle error
}

defer cli.Close(ctx)

// Use ConsistencyLevel in search to control read freshness
queryVector := []float32{0.1, 0.2, 0.3, 0.4, 0.5}
results, err := cli.Search(ctx, milvusclient.NewSearchOption(
    "my_collection", 10, []entity.Vector{entity.FloatVector(queryVector)},
).WithConsistencyLevel(entity.ClStrong))
if err != nil {
    // handle error
}
fmt.Println(results)`,
  },
  {
    name: 'IndexType',
    docId: 'GppedViHro8TJMxQCZ3cJRKRnHg',
    example: `import (
    "context"

    "github.com/milvus-io/milvus/client/v2/index"
    "github.com/milvus-io/milvus/client/v2/milvusclient"
)

ctx, cancel := context.WithCancel(context.Background())
defer cancel()

milvusAddr := "127.0.0.1:19530"

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
    Address: milvusAddr,
})
if err != nil {
    // handle error
}

defer cli.Close(ctx)

// Create an HNSW index on a float vector field
hnswIndex := index.NewHNSWIndex(index.MetricTypeL2, 16, 200)
_, err = cli.CreateIndex(ctx, milvusclient.NewCreateIndexOption(
    "my_collection", "embedding", hnswIndex))
if err != nil {
    // handle error
}

// Create an IVF_FLAT index
ivfIndex := index.NewIvfFlatIndex(index.MetricTypeL2, 128)
_, err = cli.CreateIndex(ctx, milvusclient.NewCreateIndexOption(
    "my_collection", "embedding2", ivfIndex))
if err != nil {
    // handle error
}`,
  },
  {
    name: 'MetricType',
    docId: 'Hl6adortyo5I2nxdGx8cEDJ8noe',
    example: `import (
    "context"

    "github.com/milvus-io/milvus/client/v2/index"
    "github.com/milvus-io/milvus/client/v2/milvusclient"
)

ctx, cancel := context.WithCancel(context.Background())
defer cancel()

milvusAddr := "127.0.0.1:19530"

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
    Address: milvusAddr,
})
if err != nil {
    // handle error
}

defer cli.Close(ctx)

// Use MetricType when creating an index
// L2 (Euclidean distance) for float vectors
hnswIndex := index.NewHNSWIndex(index.MetricTypeL2, 16, 200)
_, err = cli.CreateIndex(ctx, milvusclient.NewCreateIndexOption(
    "my_collection", "embedding", hnswIndex))
if err != nil {
    // handle error
}

// IP (Inner Product) for normalized vectors
ipIndex := index.NewHNSWIndex(index.MetricTypeIP, 16, 200)
_, err = cli.CreateIndex(ctx, milvusclient.NewCreateIndexOption(
    "my_collection", "normalized_embedding", ipIndex))
if err != nil {
    // handle error
}`,
  },
  {
    name: 'AnnParam',
    docId: 'XV3adWSVho0zgfx6CZDc30GAnMc',
    example: `import (
    "context"
    "fmt"

    "github.com/milvus-io/milvus/client/v2/entity"
    "github.com/milvus-io/milvus/client/v2/index"
    "github.com/milvus-io/milvus/client/v2/milvusclient"
)

ctx, cancel := context.WithCancel(context.Background())
defer cancel()

milvusAddr := "127.0.0.1:19530"

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
    Address: milvusAddr,
})
if err != nil {
    // handle error
}

defer cli.Close(ctx)

queryVector := []float32{0.3580376395471989, -0.6023495712049978, 0.18414012509913835, -0.26286205330961354, 0.9029438446296592}

// Create AnnParam for HNSW search (ef controls recall vs speed)
annParam := index.NewHNSWAnnParam(64) // ef = 64

results, err := cli.Search(ctx, milvusclient.NewSearchOption(
    "my_collection", 10, []entity.Vector{entity.FloatVector(queryVector)},
).WithAnnParam(annParam))
if err != nil {
    // handle error
}
fmt.Println(results)`,
  },
  {
    name: 'ResourceGroupConfig',
    docId: 'IM6xdWbdLo7l9dxR40kcfjfSnVb',
    example: `import (
    "context"

    "github.com/milvus-io/milvus/client/v2/entity"
    "github.com/milvus-io/milvus/client/v2/milvusclient"
)

ctx, cancel := context.WithCancel(context.Background())
defer cancel()

milvusAddr := "127.0.0.1:19530"

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
    Address: milvusAddr,
})
if err != nil {
    // handle error
}

defer cli.Close(ctx)

// Create a resource group with a fixed node allocation
cfg := &entity.ResourceGroupConfig{
    Requests: &entity.ResourceGroupLimit{NodeNum: 2},
    Limits:   &entity.ResourceGroupLimit{NodeNum: 4},
}

err = cli.CreateResourceGroup(ctx, milvusclient.NewCreateResourceGroupOption("my_rg").
    WithConfig(cfg))
if err != nil {
    // handle error
}`,
  },
];

// ─── Delete Example section (heading2 + code block) ──────────────────────────

async function removeExampleSection(docId, name) {
  const blocks = await getDocBlocks(docId);
  const rootBlock = blocks.find(b => b.block_type === 1);
  const children = rootBlock.children || [];

  // Find the Example heading (heading2 with text starting "Example")
  const exampleHeading = blocks.find(b =>
    b.block_type === 4 && blockText(b).startsWith('Example')
  );
  if (!exampleHeading) {
    console.log(`  ${name}: SKIP (no Example heading found)`);
    return;
  }

  const headingIdx = children.indexOf(exampleHeading.block_id);
  if (headingIdx === -1) {
    console.log(`  ${name}: SKIP (heading not in root children)`);
    return;
  }

  // Find how many blocks to delete: heading + code block(s) immediately after
  // Look ahead: delete heading + any code blocks that follow
  let endIdx = headingIdx + 1;
  while (endIdx < children.length) {
    const nextBlock = blocks.find(b => b.block_id === children[endIdx]);
    if (!nextBlock || nextBlock.block_type !== 14) break;
    endIdx++;
  }

  const count = endIdx - headingIdx;
  console.log(`  ${name}: removing ${count} block(s) at child idx ${headingIdx}`);
  if (DRY_RUN) return;

  await feishuAPI(
    'DELETE',
    `/open-apis/docx/v1/documents/${docId}/blocks/${rootBlock.block_id}/children/batch_delete`,
    { start_index: headingIdx, end_index: endIdx },
  );
  console.log(`  ${name}: ✓ Example section removed`);
}

// ─── Replace TODO code with real example ─────────────────────────────────────

async function replaceExample(docId, name, example) {
  const blocks = await getDocBlocks(docId);
  const codeBlocks = blocks.filter(b => b.block_type === 14);
  if (codeBlocks.length === 0) {
    console.log(`  ${name}: SKIP (no code block found)`);
    return;
  }
  const last = codeBlocks[codeBlocks.length - 1];
  const current = (last.code?.elements || []).map(e => e.text_run?.content || '').join('');
  if (!current.includes('// TODO:')) {
    console.log(`  ${name}: SKIP (no TODO in last code block)`);
    return;
  }
  console.log(`  ${name}: replacing TODO example`);
  if (DRY_RUN) return;

  await feishuAPI('PATCH', `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`, {
    requests: [{
      block_id: last.block_id,
      update_text_elements: {
        elements: [{ text_run: { content: example, text_element_style: {} } }],
      },
    }],
  });
  console.log(`  ${name}: ✓ Example updated`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Go SDK Entity Example Fixer');
  console.log('============================\n');
  if (DRY_RUN) console.log('*** DRY RUN ***\n');

  console.log('--- Removing Example sections from output-only types ---');
  for (const doc of OUTPUT_DOCS) {
    try { await removeExampleSection(doc.docId, doc.name); }
    catch (err) { console.error(`  ${doc.name}: ERROR ${err.message}`); }
    await delay();
  }

  console.log('\n--- Replacing TODO examples in input types ---');
  for (const doc of INPUT_DOCS) {
    try { await replaceExample(doc.docId, doc.name, doc.example); }
    catch (err) { console.error(`  ${doc.name}: ERROR ${err.message}`); }
    await delay();
  }

  console.log('\nDone.');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
