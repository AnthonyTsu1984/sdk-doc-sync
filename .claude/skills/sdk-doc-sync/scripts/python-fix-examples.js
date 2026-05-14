#!/usr/bin/env node
/**
 * Python SDK Example Fixer
 *
 * Replaces `<!-- TODO: Usage example -->` placeholders in Python SDK docs
 * with real examples extracted from repos/pymilvus/examples/*.py.
 *
 * Usage:
 *   node .claude/skills/sdk-doc-sync/scripts/python-fix-examples.js [--dry-run] [--method=name]
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const tokenFetcher = new larkTokenFetcher();
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DELAY_MS = 350;
const PYTHON_LANG_ID = 49; // Python language code in Feishu

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_METHOD = (args.find(a => a.startsWith('--method=')) || '').split('=')[1];

// ─── Feishu API helpers ───────────────────────────────────────────────────────

async function feishuAPI(method, endpoint, body) {
  const token = await tokenFetcher.token();
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${FEISHU_HOST}${endpoint}`, opts);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Feishu API error [${data.code}]: ${data.msg} — ${endpoint}`);
  return data.data;
}

async function delay(ms) { return new Promise(r => setTimeout(r, ms || DELAY_MS)); }

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

async function patchCodeBlock(docId, blockId, newCode) {
  return feishuAPI('PATCH', `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`, {
    requests: [{
      block_id: blockId,
      update_text_elements: {
        elements: [{ text_run: { content: newCode, text_element_style: {} } }],
      },
    }],
  });
}

// ─── Data: TODO example fixes ────────────────────────────────────────────────

const TODO_FIXES = [
  // ── MilvusClient (Client) ──
  {
    name: 'MilvusClient',
    docId: 'TUrSdmskuoGdFRxFT75c6xhinzc',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

# Verify the connection
collections = client.list_collections()
print(collections)`,
  },
  {
    name: 'close',
    docId: 'CWZGd48FJoFHXYx40NMcTd2FnKc',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

# Perform operations...

client.close()`,
  },
  {
    name: 'get_server_version',
    docId: 'QPBkdwjMvo6vWzxRQlhcJ21enEf',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

version = client.get_server_version()
print(f"server version: {version}")`,
  },

  // ── Collections ──
  {
    name: 'create_collection',
    docId: 'H7eOdq9hOo7so7xes5LchIVwnrb',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

# Quick setup with dimension only
client.create_collection(
    collection_name="my_collection",
    dimension=8,
    metric_type="L2"
)`,
  },
  {
    name: 'create_schema',
    docId: 'RxU7dBjGlop0e1xZShYcZ4qCnnh',
    example: `from pymilvus import MilvusClient, DataType

client = MilvusClient("http://localhost:19530")

schema = client.create_schema(enable_dynamic_field=True)
schema.add_field("id", DataType.INT64, is_primary=True)
schema.add_field("vector", DataType.FLOAT_VECTOR, dim=8)
schema.add_field("title", DataType.VARCHAR, max_length=64)

client.create_collection(
    collection_name="my_collection",
    schema=schema
)`,
  },
  {
    name: 'drop_collection',
    docId: 'HZByd7LqQoiorTxCgyrcu3VUnof',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.drop_collection(collection_name="my_collection")`,
  },
  {
    name: 'has_collection',
    docId: 'SSQ6dFGdxouy7hxRwCOcatnEn0e',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

has = client.has_collection(collection_name="my_collection")
print(has)  # True or False`,
  },
  {
    name: 'list_collections',
    docId: 'BHyidrVcyoPwxexHLrnceOSAnRe',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

collections = client.list_collections()
print(collections)`,
  },
  {
    name: 'describe_collection',
    docId: 'LXASdPs6KoRfCJx11A1cl2Ssngg',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

desc = client.describe_collection(collection_name="my_collection")
print(desc)`,
  },
  {
    name: 'rename_collection',
    docId: 'WR4qdjFUXog2JHxuJpMcWcVlnEf',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.rename_collection(
    old_name="my_collection",
    new_name="my_new_collection"
)`,
  },
  {
    name: 'alter_collection_properties',
    docId: 'Pl7Fd8C3zocPaZx3VrAcl54Dnkd',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.alter_collection_properties(
    collection_name="my_collection",
    properties={
        "mmap.enabled": True,
        "collection.ttl.seconds": 500,
    }
)`,
  },
  {
    name: 'drop_collection_properties',
    docId: 'WjNRdifU9o3xl5xG0W7ch4Fjnme',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.drop_collection_properties(
    collection_name="my_collection",
    property_keys=["mmap.enabled"]
)`,
  },
  {
    name: 'alter_collection_field',
    docId: 'G2jjdHvbBoko6BxBZj7csemWnFc',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.alter_collection_field(
    collection_name="my_collection",
    field_name="title",
    field_params={
        "mmap.enabled": True,
        "max_length": 2500,
    }
)`,
  },
  {
    name: 'get_collection_stats',
    docId: 'VfaldXzLUocBrJxffw6cJHPinlh',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

stats = client.get_collection_stats(collection_name="my_collection")
print(stats)`,
  },

  // ── Vector ──
  {
    name: 'insert',
    docId: 'QI87dhVnioL9JLxnNKxcM8jWnkh',
    example: `import numpy as np
from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

rng = np.random.default_rng(seed=19530)
data = [
    {"id": 1, "vector": rng.random((1, 8))[0], "color": "red"},
    {"id": 2, "vector": rng.random((1, 8))[0], "color": "green"},
    {"id": 3, "vector": rng.random((1, 8))[0], "color": "blue"},
]

result = client.insert(
    collection_name="my_collection",
    data=data
)
print(result)`,
  },
  {
    name: 'upsert',
    docId: 'UjjpdBwaooRDdlxFHScc6dKwnTg',
    example: `import numpy as np
from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

rng = np.random.default_rng(seed=19530)
data = {"id": 2, "vector": rng.random((1, 8))[0], "color": "yellow"}

result = client.upsert(
    collection_name="my_collection",
    data=data
)
print(result)`,
  },
  {
    name: 'delete',
    docId: 'DWLXdSCYnoPT4ExktRKceEqLnAd',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

# Delete by IDs
result = client.delete(
    collection_name="my_collection",
    ids=[6]
)
print(result)`,
  },
  {
    name: 'search',
    docId: 'N6afdOON2o3U0YxMAt7cMiBqnXg',
    example: `import numpy as np
from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

rng = np.random.default_rng(seed=19530)
vectors_to_search = rng.random((1, 8))

result = client.search(
    collection_name="my_collection",
    data=vectors_to_search,
    limit=3,
    output_fields=["id", "color"]
)
for hits in result:
    for hit in hits:
        print(f"hit: {hit}")`,
  },
  {
    name: 'query',
    docId: 'Edrcdw34jofMbNxK5HncdDT5n8e',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

# Query by IDs
results = client.query(
    collection_name="my_collection",
    ids=[2]
)
print(results)

# Query by filter expression
results = client.query(
    collection_name="my_collection",
    filter='color == "red"'
)
print(results)`,
  },
  {
    name: 'hybrid_search',
    docId: 'Iv1PdIVxYoDOMax47xDcLnbEnXb',
    example: `import numpy as np
from pymilvus import (
    MilvusClient,
    AnnSearchRequest,
    RRFRanker,
)

client = MilvusClient("http://localhost:19530")

rng = np.random.default_rng(seed=19530)

req1 = AnnSearchRequest(
    data=rng.random((1, 8)),
    anns_field="embeddings",
    param={"metric_type": "L2"},
    limit=5,
    expr="random > 0.5"
)

req2 = AnnSearchRequest(
    data=rng.random((1, 8)),
    anns_field="embeddings2",
    param={"metric_type": "L2"},
    limit=5,
    expr="random > 0.5"
)

result = client.hybrid_search(
    collection_name="my_collection",
    reqs=[req1, req2],
    ranker=RRFRanker(),
    limit=5,
    output_fields=["random"]
)
for hits in result:
    for hit in hits:
        print(f"hit: {hit}")`,
  },
  {
    name: 'get',
    docId: 'TEUDde2xbo0JT7xtVvtcF53Nnub',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

result = client.get(
    collection_name="my_collection",
    ids=[1, 2, 3],
    output_fields=["id", "color"]
)
print(result)`,
  },

  // ── Index ──
  {
    name: 'prepare_index_params',
    docId: 'CAzpdAw3wo4ZqrxhjTLcEGBBn1S',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

index_params = client.prepare_index_params()

index_params.add_index(
    field_name="embeddings",
    metric_type="L2"
)

index_params.add_index(
    field_name="title",
    index_type="Trie",
    index_name="my_trie"
)`,
  },
  {
    name: 'add_index',
    docId: 'SM7ld0ZsEoYLqaxVMZxcSH82n9f',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

index_params = client.prepare_index_params()
index_params.add_index(
    field_name="embeddings",
    metric_type="L2"
)
index_params.add_index(
    field_name="title",
    index_type="Trie",
    index_name="my_trie"
)`,
  },
  {
    name: 'create_index',
    docId: 'B3n3db0idoia02xXxJfcONK8nRh',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

index_params = client.prepare_index_params()
index_params.add_index(field_name="embeddings", metric_type="L2")

client.create_index(
    collection_name="my_collection",
    index_params=index_params
)`,
  },
  {
    name: 'list_indexes',
    docId: 'ZqmudJWyFonUKGxAxXncYrLZn2e',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

indexes = client.list_indexes(collection_name="my_collection")
print(indexes)`,
  },
  {
    name: 'describe_index',
    docId: 'WhsHdyIgyoFlsQxNJt9cFCTxnDe',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

index_info = client.describe_index(
    collection_name="my_collection",
    index_name="embeddings"
)
print(index_info)`,
  },
  {
    name: 'drop_index',
    docId: 'NPnQdZCJ7oF002xTntecdI2ini8',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.drop_index(
    collection_name="my_collection",
    index_name="my_trie"
)`,
  },
  {
    name: 'alter_index_properties',
    docId: 'TRFadKWOAofCVoxH3qYcdTvynHf',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.alter_index_properties(
    collection_name="my_collection",
    index_name="embeddings",
    properties={"mmap.enabled": True}
)`,
  },
  {
    name: 'drop_index_properties',
    docId: 'M2kXd5zWSoMIOnxXWamcgCkznih',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.drop_index_properties(
    collection_name="my_collection",
    index_name="embeddings",
    property_keys=["mmap.enabled"]
)`,
  },

  // ── Partitions ──
  {
    name: 'create_partition',
    docId: 'I6hvdlYUuoUaw3xWqSnce4Fin9g',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.create_partition(
    collection_name="my_collection",
    partition_name="partition_a"
)`,
  },
  {
    name: 'has_partition',
    docId: 'MxTAd0haboKnRrxQvoOckGghn1T',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

has = client.has_partition(
    collection_name="my_collection",
    partition_name="partition_a"
)
print(has)  # True or False`,
  },
  {
    name: 'list_partitions',
    docId: 'Dxgqdvlk5o2VScxqmL1ctc1Inqb',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

partitions = client.list_partitions(
    collection_name="my_collection"
)
print(partitions)`,
  },
  {
    name: 'drop_partition',
    docId: 'HkOFdhgbOoz1wlxJIgWcU7EonWc',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.drop_partition(
    collection_name="my_collection",
    partition_name="partition_a"
)`,
  },
  {
    name: 'load_partitions',
    docId: 'TMq5d6wFmoT8u3xwuruc8k6wnTg',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.load_partitions(
    collection_name="my_collection",
    partition_names=["partition_a", "partition_b"]
)`,
  },
  {
    name: 'release_partitions',
    docId: 'VblKdUEU4o4t31xcFiicIGtjn9g',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.release_partitions(
    collection_name="my_collection",
    partition_names=["partition_a"]
)`,
  },
  {
    name: 'get_partition_stats',
    docId: 'Jjbsd2I8doQ9pBxBp57ckRdZnZd',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

stats = client.get_partition_stats(
    collection_name="my_collection",
    partition_name="partition_a"
)
print(stats)`,
  },

  // ── Database ──
  {
    name: 'create_database',
    docId: 'S278drWUVoRZ5fx8XkfcWaZfnwh',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.create_database(
    db_name="my_database",
    properties={"key1": "value1"}
)`,
  },
  {
    name: 'describe_database',
    docId: 'LEaYdk179oZn0vxqa0lcn4mnnrg',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

db_info = client.describe_database(db_name="my_database")
print(db_info)`,
  },
  {
    name: 'list_databases',
    docId: 'FZuddXocNopEufxRFGdcbvkRnnb',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

databases = client.list_databases()
print(databases)`,
  },
  {
    name: 'alter_database_properties',
    docId: 'HCWBdorQdoONw2xaawacJWQkn1e',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.alter_database_properties(
    db_name="my_database",
    properties={"key": "value"}
)`,
  },
  {
    name: 'drop_database_properties',
    docId: 'AdSXdtNDsoTMnJx1QoGcSsnZnWd',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.drop_database_properties(
    db_name="my_database",
    property_keys=["key"]
)`,
  },
  {
    name: 'drop_database',
    docId: 'Vjd7dE5OyoGvYaxd7OCcubBWnLd',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.drop_database(db_name="my_database")`,
  },
  {
    name: 'using_database',
    docId: 'OCfid8DdPo1ga1x24JZcV92xnwd',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.using_database(db_name="my_database")`,
  },
  {
    name: 'use_database',
    docId: 'AglQd68yqoEn8Ixkn9ociyqKnMx',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.use_database(db_name="my_database")`,
  },

  // ── Management ──
  {
    name: 'flush',
    docId: 'JnPrdOiPyo2e5gxzzFycbnvwnSd',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.flush(collection_name="my_collection")`,
  },
  {
    name: 'compact',
    docId: 'JRNidzqX4o6VtkxVB5RcNvmHnnb',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

job_id = client.compact(collection_name="my_collection")
print(f"compaction job ID: {job_id}")`,
  },
  {
    name: 'get_compaction_state',
    docId: 'MSDVdu103obklexX8GvcW5cWnCf',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

job_id = client.compact(collection_name="my_collection")
state = client.get_compaction_state(job_id)
print(f"compaction state: {state}")`,
  },
  {
    name: 'load_collection',
    docId: 'YtiQdxTYzoCaYDxEMZcc8TEenQb',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.load_collection(collection_name="my_collection")`,
  },
  {
    name: 'release_collection',
    docId: 'PRR7dRfi8o1s61xFRovccAdRnHe',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.release_collection(collection_name="my_collection")`,
  },
  {
    name: 'get_load_state',
    docId: 'KEPYdKup1o3nHdxKbjvcQUzwnnd',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

state = client.get_load_state(collection_name="my_collection")
print(state)`,
  },
  {
    name: 'refresh_load',
    docId: 'X3NXdtC2koiAxyxhcUBcv38Wnsh',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.refresh_load(collection_name="my_collection")`,
  },
  {
    name: 'describe_replica',
    docId: 'UgvEdvGORoIQyQxA31mcAj9XnHf',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

replicas = client.describe_replica(collection_name="my_collection")
print(replicas)`,
  },
  {
    name: 'flush_all',
    docId: 'QejKdv2qKo97mQxEV0CcaSM5nLh',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.flush_all()`,
  },
  {
    name: 'get_flush_all_state',
    docId: 'G31wdmzVFo687JxZTAGctQlKnir',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

state = client.get_flush_all_state(flush_all_ts=flush_ts)
print(state)`,
  },
  {
    name: 'get_compaction_plans',
    docId: 'Qa8ZdRkOKocH60xujcLcOxuBnkh',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

job_id = client.compact(collection_name="my_collection")
plans = client.get_compaction_plans(job_id)
print(plans)`,
  },
  {
    name: 'optimize',
    docId: 'MhRidjHwYorxaexS8WXcaxWQnjd',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.optimize(
    collection_name="my_collection",
    compaction=True,
    indexing=True,
    gc=True
)`,
  },

  // ── Alias ──
  {
    name: 'create_alias',
    docId: 'Kqlodu0AWoefKvxczcxc1c36nlf',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.create_alias(
    collection_name="my_collection",
    alias="my_alias"
)`,
  },
  {
    name: 'list_aliases',
    docId: 'Cpynd2OFJoIXhLx3dQNct7Wgn6f',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

aliases = client.list_aliases(collection_name="my_collection")
print(aliases)`,
  },
  {
    name: 'describe_alias',
    docId: 'HN7nddgueo3scIxmPXAcpjkFnDf',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

alias_info = client.describe_alias(alias="my_alias")
print(alias_info)`,
  },
  {
    name: 'alter_alias',
    docId: 'CBc3d1mrdoYqmDxe4Kcc9zxAnzh',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.alter_alias(
    collection_name="my_other_collection",
    alias="my_alias"
)`,
  },
  {
    name: 'drop_alias',
    docId: 'FpWXdmIuforYz9xUCsqclyCXnLe',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.drop_alias(alias="my_alias")`,
  },

  // ── Authentication / RBAC ──
  {
    name: 'create_user',
    docId: 'BDupd28JqoNY9HxVOTfcv86enRe',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

client.create_user(user_name="my_user", password="P@ssw0rd")`,
  },
  {
    name: 'list_users',
    docId: 'EZ2YdBHoDoRTlxx91tscffm1nSb',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

users = client.list_users()
print(users)`,
  },
  {
    name: 'drop_user',
    docId: 'WtyZdeFKMoSv5exaYRxcPLCSndg',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

client.drop_user(user_name="my_user")`,
  },
  {
    name: 'describe_user',
    docId: 'Wz3HdtvPCoEquvxFY7PcDHxcnEe',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

user_info = client.describe_user(user_name="my_user")
print(user_info)`,
  },
  {
    name: 'update_password',
    docId: 'WGDod7Qehou4GWx4Co2cJ34VnKb',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

client.update_password(
    user_name="my_user",
    old_password="P@ssw0rd",
    new_password="NewP@ssw0rd"
)`,
  },
  {
    name: 'create_role',
    docId: 'OUz3drncZo1Er8xyITZcYz66nWE',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

client.create_role(role_name="my_role")`,
  },
  {
    name: 'list_roles',
    docId: 'MApVdDl17oU8OixzbMPcgceKnOh',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

roles = client.list_roles()
print(roles)`,
  },
  {
    name: 'describe_role',
    docId: 'JJz3dFrE2oJP3AxySWYcJlf4nMh',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

role_info = client.describe_role(role_name="my_role")
print(role_info)`,
  },
  {
    name: 'drop_role',
    docId: 'KUAXdm3o3opQPex8N69cMlPbnTh',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

client.drop_role(role_name="my_role")`,
  },
  {
    name: 'grant_privilege',
    docId: 'W39Wdr7S6ohrtfxI8r7cyTeInlb',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

client.grant_privilege(
    role_name="my_role",
    object_type="Collection",
    privilege="Search",
    object_name="my_collection"
)`,
  },
  {
    name: 'revoke_privilege',
    docId: 'LB90d4VGZogYIZxwCgpcSkgKnng',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

client.revoke_privilege(
    role_name="my_role",
    object_type="Collection",
    privilege="Search",
    object_name="my_collection"
)`,
  },
  {
    name: 'grant_role',
    docId: 'DsnpdZuDGo77TYxFuYvcDpOgnIf',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

client.grant_role(user_name="my_user", role_name="my_role")`,
  },
  {
    name: 'revoke_role',
    docId: 'JJOId59ePoMLefxz1ChcBZ6inOh',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

client.revoke_role(user_name="my_user", role_name="my_role")`,
  },
  {
    name: 'grant_privilege_v2',
    docId: 'EiTMdIbTgoc9vVxDHUQc1zPpnch',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

# Grant a custom privilege group
client.grant_privilege_v2(
    role_name="my_role",
    privilege="my_privilege_group",
    collection_name="*"
)

# Grant a built-in privilege group at cluster level
client.grant_privilege_v2(
    role_name="admin_role",
    privilege="ClusterAdmin",
    collection_name="*",
    db_name="*"
)`,
  },
  {
    name: 'revoke_privilege_v2',
    docId: 'WazKdTlcOoYoBWxIJEEc7gFMnfC',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

client.revoke_privilege_v2(
    role_name="my_role",
    privilege="my_privilege_group",
    collection_name="*"
)`,
  },
  {
    name: 'create_privilege_group',
    docId: 'HNJqdocBjo2zm9xcIVdchRvcnab',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

client.create_privilege_group(group_name="my_privilege_group")`,
  },
  {
    name: 'add_privileges_to_group',
    docId: 'MbTMdBf7Bow3k6xA4R4c7j1DnRd',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

client.add_privileges_to_group(
    group_name="my_privilege_group",
    privileges=["Search", "Query"]
)`,
  },
  {
    name: 'list_privilege_groups',
    docId: 'N6kjdex5Ao0lRqxPXBhcxq4AnNh',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

groups = client.list_privilege_groups()
print(groups)`,
  },
  {
    name: 'remove_privileges_from_group',
    docId: 'IGPAdBQ5Von3lFxv4uSc5dGDnAd',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

client.remove_privileges_from_group(
    group_name="my_privilege_group",
    privileges=["Search"]
)`,
  },
  {
    name: 'drop_privilege_group',
    docId: 'OxrMdOaVKoDUY5x2DlTcZO6GnHc',
    example: `from pymilvus import MilvusClient

client = MilvusClient(
    "http://localhost:19530",
    user="root",
    password="Milvus"
)

client.drop_privilege_group(group_name="my_privilege_group")`,
  },

  // ── Resource Group ──
  {
    name: 'create_resource_group',
    docId: 'Ierbd2hCHoA1YCxzx4ccYhvDnRb',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.create_resource_group(name="my_resource_group")`,
  },
  {
    name: 'update_resource_groups',
    docId: 'TJmCdUvGRoOLFAx55qVcqbWGnRs',
    example: `from pymilvus import MilvusClient
from pymilvus.client.types import ResourceGroupConfig
from pymilvus.client.constants import DEFAULT_RESOURCE_GROUP

client = MilvusClient("http://localhost:19530")

configs = {
    "my_resource_group": ResourceGroupConfig(
        requests={"node_num": 1},
        limits={"node_num": 5},
        transfer_from=[{"resource_group": DEFAULT_RESOURCE_GROUP}],
        transfer_to=[{"resource_group": DEFAULT_RESOURCE_GROUP}],
    ),
}

client.update_resource_groups(configs)`,
  },
  {
    name: 'describe_resource_group',
    docId: 'OcJXde1ppo9h5MxYcBJc5WTunob',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

result = client.describe_resource_group(name="my_resource_group")
print(result)`,
  },
  {
    name: 'list_resource_groups',
    docId: 'JD77dVcjhoI4vyxCchRcV4J1nhe',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

groups = client.list_resource_groups()
print(groups)`,
  },
  {
    name: 'transfer_replica',
    docId: 'JPkOda4UfoC5JlxUvlXc98IsnKf',
    example: `from pymilvus import MilvusClient
from pymilvus.client.constants import DEFAULT_RESOURCE_GROUP

client = MilvusClient("http://localhost:19530")

client.transfer_replica(
    source_group=DEFAULT_RESOURCE_GROUP,
    target_group="my_resource_group",
    collection_name="my_collection",
    num_replicas=1
)`,
  },
  {
    name: 'drop_resource_group',
    docId: 'AC81dpJgtoRwBRxRKwGcLbVinAe',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.drop_resource_group(name="my_resource_group")`,
  },

  // ── Iterators ──
  {
    name: 'query_iterator',
    docId: 'L6i8dmvsBogcmIxtORsc1Mu0nhg',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

iterator = client.query_iterator(
    collection_name="my_collection",
    filter="age >= 10 and age <= 25",
    batch_size=50,
    output_fields=["id", "age"]
)

while True:
    result = iterator.next()
    if len(result) == 0:
        iterator.close()
        break
    for row in result:
        print(row)`,
  },
  {
    name: 'search_iterator',
    docId: 'T9KhdDJQColJEuxZ7YOcV2zdnlb',
    example: `import numpy as np
from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

rng = np.random.default_rng(seed=19530)
vector = rng.random((1, 8), np.float32)

iterator = client.search_iterator(
    collection_name="my_collection",
    data=vector,
    batch_size=100,
    anns_field="vector"
)

while True:
    result = iterator.next()
    if len(result) == 0:
        iterator.close()
        break
    for hit in result:
        print(hit)`,
  },

  // ── Collections extra (truncate, add/alter/drop functions, add_field) ──
  {
    name: 'truncate_collection',
    docId: 'T2lWd4LMOoAkUCxa8wjcJVoinrf',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.truncate_collection(collection_name="my_collection")`,
  },
  {
    name: 'add_collection_field',
    docId: 'IquldHhyGo9s4IxF3cicOXGnnNf',
    example: `from pymilvus import MilvusClient, DataType

client = MilvusClient("http://localhost:19530")

client.add_collection_field(
    collection_name="my_collection",
    field_name="new_field",
    datatype=DataType.VARCHAR,
    max_length=128
)`,
  },
  {
    name: 'drop_collection_function',
    docId: 'F1mJdDLyzoMTrxxarPMcqPkqnqg',
    example: `from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

client.drop_collection_function(
    collection_name="my_collection",
    function_name="my_bm25_function"
)`,
  },
];

// ─── Fix helpers ─────────────────────────────────────────────────────────────

async function fixTodoExample(fix) {
  const blocks = await getDocBlocks(fix.docId);

  // Find all code blocks
  const codeBlocks = blocks.filter(b => b.block_type === 14);
  if (codeBlocks.length === 0) {
    console.log(`  SKIP ${fix.name}: no code blocks found`);
    return;
  }

  // Last code block = example
  const exampleBlock = codeBlocks[codeBlocks.length - 1];
  const currentText = (exampleBlock.code?.elements || []).map(e => e.text_run?.content || '').join('');

  if (!currentText.includes('TODO')) {
    console.log(`  SKIP ${fix.name}: no TODO found in last code block`);
    return;
  }

  console.log(`  UPDATE ${fix.name} (${fix.docId}): replacing TODO example`);
  if (DRY_RUN) {
    console.log('    [dry-run] would patch block', exampleBlock.block_id);
    console.log('    New example preview:', fix.example.substring(0, 80) + '...');
    return;
  }

  await patchCodeBlock(fix.docId, exampleBlock.block_id, fix.example);
  console.log(`  ✓ Updated ${fix.name}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Python SDK Example Fixer');
  console.log('========================\n');
  if (DRY_RUN) console.log('  *** DRY RUN MODE ***\n');
  if (ONLY_METHOD) console.log(`  Filtering to method: ${ONLY_METHOD}\n`);

  let todoList = TODO_FIXES;
  if (ONLY_METHOD) todoList = todoList.filter(f => f.name.toLowerCase() === ONLY_METHOD.toLowerCase());

  console.log(`Processing ${todoList.length} methods...\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;
  for (const fix of todoList) {
    try {
      await fixTodoExample(fix);
      updated++;
    } catch (err) {
      console.error(`  ERROR ${fix.name}:`, err.message);
      errors++;
    }
    await delay();
  }
  console.log(`\nDone: processed ${updated}, skipped ${skipped}, errors ${errors} / total ${todoList.length}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
