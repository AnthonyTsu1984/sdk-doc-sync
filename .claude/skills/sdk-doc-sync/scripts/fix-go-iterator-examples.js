'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });
const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');
const tf = new larkTokenFetcher();

const FEISHU_HOST = 'https://open.feishu.cn';

async function feishuAPI(method, endpoint, body) {
  const token = await tf.token();
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(FEISHU_HOST + endpoint, opts);
  const data = await res.json();
  if (data.code !== 0) throw new Error('API [' + data.code + ']: ' + data.msg);
  return data.data;
}
async function delay() { return new Promise(r => setTimeout(r, 400)); }

async function getDocBlocks(docId) {
  const blocks = [];
  let pageToken = null;
  do {
    const url = '/open-apis/docx/v1/documents/' + docId + '/blocks' + (pageToken ? '?page_token=' + pageToken : '');
    const data = await feishuAPI('GET', url);
    blocks.push(...data.items);
    pageToken = data.has_more ? data.page_token : null;
  } while (pageToken);
  return blocks;
}

const FIXES = [
  {
    name: 'SearchIterator',
    docId: 'K6obdWvXyoNLbMxNkggc9JyMnPd',
    example: `import (
\t"context"
\t"fmt"
\t"io"

\t"github.com/milvus-io/milvus/client/v2/entity"
\t"github.com/milvus-io/milvus/client/v2/milvusclient"
)

ctx, cancel := context.WithCancel(context.Background())
defer cancel()

milvusAddr := "127.0.0.1:19530"

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: milvusAddr,
})
if err != nil {
\t// handle error
}

defer cli.Close(ctx)

queryVector := []float32{0.3580376395471989, -0.6023495712049978, 0.18414012509913835, -0.26286205330961354, 0.9029438446296592}

iter, err := cli.SearchIterator(ctx, milvusclient.NewSearchIteratorOption(
\t"quick_setup",
\tentity.FloatVector(queryVector),
).WithOutputFields("id", "color"))
if err != nil {
\t// handle error
}

for {
\tresultSet, err := iter.Next(ctx)
\tif err == io.EOF {
\t\tbreak
\t}
\tif err != nil {
\t\t// handle error
\t}
\tfor i := 0; i < resultSet.Len(); i++ {
\t\tfmt.Println(resultSet.IDs, resultSet.Scores)
\t}
}`,
  },
  {
    name: 'QueryIterator',
    docId: 'K5PAdhJwGoXdZQxrPJncXebGnwd',
    example: `import (
\t"context"
\t"fmt"
\t"io"

\t"github.com/milvus-io/milvus/client/v2/milvusclient"
)

ctx, cancel := context.WithCancel(context.Background())
defer cancel()

milvusAddr := "127.0.0.1:19530"

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: milvusAddr,
})
if err != nil {
\t// handle error
}

defer cli.Close(ctx)

iter, err := cli.QueryIterator(ctx, milvusclient.NewQueryIteratorOption("quick_setup").
\tWithFilter("color like \"red%\"").
\tWithOutputFields("id", "color"))
if err != nil {
\t// handle error
}

for {
\tresultSet, err := iter.Next(ctx)
\tif err == io.EOF {
\t\tbreak
\t}
\tif err != nil {
\t\t// handle error
\t}
\tfor i := 0; i < resultSet.Len(); i++ {
\t\tfmt.Println(resultSet.IDs)
\t}
}`,
  },
];

async function fixDoc(fix) {
  console.log('\n' + fix.name + ' (' + fix.docId + ')');
  const blocks = await getDocBlocks(fix.docId);

  // Find the last code block (example)
  const codeBlocks = blocks.filter(b => b.block_type === 14);
  if (codeBlocks.length === 0) { console.log('  ERROR: no code blocks'); return; }

  const exampleBlock = codeBlocks[codeBlocks.length - 1];
  const currentCode = (exampleBlock.code?.elements || []).map(e => e.text_run?.content || '').join('');
  console.log('  Current example starts with: ' + currentCode.substring(0, 60));

  await feishuAPI('PATCH', '/open-apis/docx/v1/documents/' + fix.docId + '/blocks/batch_update', {
    requests: [{
      block_id: exampleBlock.block_id,
      update_text_elements: {
        elements: [{ text_run: { content: fix.example, text_element_style: {} } }],
      },
    }],
  });
  console.log('  ✓ Example updated');
}

async function main() {
  for (const fix of FIXES) {
    await fixDoc(fix);
    await delay();
  }
  console.log('\nDone.');
}
main().catch(console.error);
