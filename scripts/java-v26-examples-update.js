#!/usr/bin/env node
/**
 * Java SDK v2.6.x Examples Update Script
 *
 * Updates 7 method docs with real examples extracted from the Java SDK repository.
 * Each example is hardcoded (not dynamically parsed) for reliability.
 *
 * Usage:
 *   node scripts/java-v26-examples-update.js [--dry-run] [--method=name] [--list]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const fetch = require('node-fetch');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');
const JavaScanner = require('../src/sdk-doc-sync/scanners/java-scanner');

// ============================================================
// Constants
// ============================================================

const BITABLE_TOKEN = 'Sbtcbm660abngWsXryKct5nOn2e';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const DELAY_MS = 500;

const FOLDER_TOKENS = {
    Collections: 'LkxXfcSA7lKXqEdu8mpcHI8Fnqd',
    Management: 'ALDZfPYy3lNm8ZdotPecBX7rnNd',
    Vector: 'XkwkfO0XUlwfQzd6cficDg8enoh',
    Volume: 'OOcKfRAVdlXgf4dqW0sc9Zl2nyg',
};

const tokenFetcher = new larkTokenFetcher();

// ============================================================
// CLI
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIST_ONLY = args.includes('--list');
const ONLY_METHOD = args.find(a => a.startsWith('--method='))?.split('=')[1];

// ============================================================
// Helpers (copied from java-v26-update.js for self-containment)
// ============================================================

async function feishuAPI(method, endpoint, body = null) {
    const token = await tokenFetcher.token();
    const opts = {
        method,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${token}`,
        },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${FEISHU_HOST}${endpoint}`, opts);
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Feishu API error: ${data.msg} (code ${data.code})`);
    return data.data;
}

async function delay(ms = DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

async function deleteDoc(docToken) {
    return feishuAPI('DELETE', `/open-apis/drive/v1/files/${docToken}?type=docx`);
}

async function fetchDocContent(docId) {
    const blocks = [];
    let pageToken = null;
    do {
        const url = `/open-apis/docx/v1/documents/${docId}/blocks${pageToken ? `?page_token=${pageToken}` : ''}`;
        const data = await feishuAPI('GET', url);
        blocks.push(...data.items);
        pageToken = data.has_more ? data.page_token : null;
    } while (pageToken);

    function elementsToText(elements, opts = {}) {
        if (!elements) return '';
        return elements.map(e => {
            const text = e.text_run?.content || '';
            if (!text) return '';
            const style = e.text_run?.text_element_style || {};
            if (opts.markdown) {
                if (style.inline_code) return `\`${text}\``;
                if (style.bold && style.italic) return `***${text}***`;
                if (style.bold) return `**${text}**`;
                if (style.italic) return `*${text}*`;
            }
            return text;
        }).join('');
    }

    let description = '';
    for (const b of blocks) {
        if (b.block_type === 2 && b.text?.elements) {
            const text = elementsToText(b.text.elements);
            if (text.trim() && !text.startsWith('**')) {
                description = elementsToText(b.text.elements, { markdown: true });
                break;
            }
        }
    }

    const codeBlocks = blocks.filter(b => b.block_type === 14);
    let exampleCode = '';
    if (codeBlocks.length >= 3) {
        const last = codeBlocks[codeBlocks.length - 1];
        exampleCode = elementsToText(last.code?.elements);
    }

    let returnsDescription = '';
    let foundReturns = false;
    for (const b of blocks) {
        if (b.block_type === 2 && b.text?.elements) {
            const raw = elementsToText(b.text.elements);
            if (raw.startsWith('RETURNS:') || raw.trim() === 'RETURNS:') {
                foundReturns = true;
                continue;
            }
            if (foundReturns && raw.trim()) {
                returnsDescription = elementsToText(b.text.elements, { markdown: true });
                break;
            }
        }
        if (b.block_type === 4) foundReturns = false;
    }

    return { description, exampleCode, returnsDescription };
}

// ============================================================
// PARAM_DESCRIPTIONS (copied from java-v26-update.js)
// ============================================================

const PARAM_DESCRIPTIONS = {
    collectionName: 'The name of the target collection.',
    databaseName: 'The name of the database. Defaults to the current database if not specified.',
    partitionName: 'The name of the target partition.',
    partitionNames: 'A list of partition names to target.',
    outputFields: 'A list of field names to include in the output.',
    outFields: 'A list of field names to include in the output.',
    filter: 'A boolean expression to filter results.',
    expr: 'A boolean expression to filter results.',
    ids: 'A list of primary key values to identify specific entities.',
    data: 'A list of data rows to insert/upsert as JSON objects.',
    topK: 'The number of top results to return.',
    limit: 'The maximum number of results to return.',
    offset: 'The number of results to skip before returning.',
    consistencyLevel: 'The consistency level for the operation.',
    ignoreGrowing: 'Whether to ignore growing segments during the operation.',
    timezone: 'The timezone string for time-related filters.',
    filterTemplateValues: 'A map of template variable values for parameterized filters.',
    roundDecimal: 'The number of decimal places for distance/score rounding.',
    searchParams: 'Additional search parameters as key-value pairs.',
    params: 'Additional search parameters as a JSON string.',
    queryParams: 'Additional query parameters as key-value pairs.',
    groupByFieldName: 'The field name to group search results by.',
    groupSize: 'The number of results to return per group.',
    strictGroupSize: 'Whether to strictly enforce the group size.',
    functionScore: 'A FunctionScore object for custom scoring.',
    highlighter: 'A Highlighter object for text highlighting in search results.',
    vectors: 'A list of vectors to search with.',
    vectorFieldName: 'The name of the vector field to search.',
    annsField: 'The name of the vector field for approximate nearest neighbor search.',
    numReplicas: 'The number of replicas to load.',
    async: 'Whether to run the operation asynchronously.',
    sync: 'Whether to wait synchronously until the operation completes.',
    timeout: 'The timeout duration in milliseconds.',
    refresh: 'Whether to refresh load to include new fields.',
    loadFields: 'A list of specific field names to load.',
    skipLoadDynamicField: 'Whether to skip loading the dynamic field.',
    resourceGroups: 'A list of resource group names for load balancing.',
    indexParams: 'A list of IndexParam objects defining the index configuration.',
    fieldName: 'The name of the target field.',
    indexName: 'The name of the target index.',
    timestamp: 'A timestamp for time-travel queries.',
    alias: 'The alias name.',
    collectionNames: 'A list of collection names.',
    waitFlushedTimeoutMs: 'The timeout in milliseconds to wait for flush completion.',
    isClustering: 'Whether to perform clustering compaction.',
    description: 'A description of the collection.',
    dimension: 'The dimension of the vector field.',
    primaryFieldName: 'The name of the primary key field.',
    idType: 'The data type of the primary key field.',
    maxLength: 'The maximum length for varchar fields.',
    metricType: 'The metric type for vector similarity.',
    autoID: 'Whether to auto-generate primary key values.',
    enableDynamicField: 'Whether to enable the dynamic field.',
    numShards: 'The number of shards for the collection.',
    collectionSchema: 'A CollectionSchema object defining the collection structure.',
    numPartitions: 'The number of partitions for the collection.',
    properties: 'A map of collection properties.',
    propertyKeys: 'A list of property key names to drop.',
    newCollectionName: 'The new name for the collection.',
    searchRequests: 'A list of AnnSearchReq objects for hybrid search.',
    batchSize: 'The batch size for iterator operations.',
    reduceStopForBest: 'Whether to stop iteration when the best result is found.',
    texts: 'A list of text strings to analyze.',
    analyzerParams: 'A map of analyzer parameters.',
    withDetail: 'Whether to include detailed token information.',
    withHash: 'Whether to include hash values in the output.',
    analyzerNames: 'A list of analyzer names to use.',
    partialUpdate: 'Whether to allow partial field updates during upsert.',
    guaranteeTimestamp: 'A timestamp guaranteeing that all operations before it are visible.',
    gracefulTime: 'The graceful time in milliseconds for consistency.',
};

// ============================================================
// generateMethodMarkdown (copied from java-v26-update.js)
// ============================================================

function generateMethodMarkdown(symbol, docContent) {
    const desc = docContent.description || `Performs the ${symbol.name} operation.`;
    let md = `${desc}\n\n`;

    md += `\`\`\`java\n${symbol.signature}\n\`\`\`\n\n`;

    if (symbol.requestClass && symbol.params.length > 0) {
        md += `## Request Syntax{#request-syntax}\n\n`;
        const fields = symbol.params.map(p => `    .${p.name}(${p.type} ${p.name})`).join('\n');
        md += `\`\`\`java\n${symbol.name}(${symbol.requestClass}.builder()\n${fields}\n    .build()\n);\n\`\`\`\n\n`;

        md += `**BUILDER METHODS:**\n\n`;
        for (const p of symbol.params) {
            const paramDesc = PARAM_DESCRIPTIONS[p.name] || '';
            const defaultNote = p.default ? ` Defaults to \`${p.default}\`.` : '';
            md += `- \`${p.name}(${p.type} ${p.name})\` -\n${paramDesc}${defaultNote}\n`;
        }
        md += '\n';
    }

    md += `**RETURNS:**\n\n`;
    md += `*${symbol.returnType || 'void'}*\n\n`;
    if (docContent.returnsDescription) {
        md += `${docContent.returnsDescription}\n\n`;
    }

    md += `**EXCEPTIONS:**\n\n`;
    md += `- **MilvusClientException**\nThis exception will be raised when any error occurs during this operation.\n\n`;

    md += `## Example{#example}\n\n`;
    if (docContent.exampleCode) {
        md += `\`\`\`java\n${docContent.exampleCode}\n\`\`\`\n`;
    } else {
        if (symbol.requestClass && symbol.params.length > 0) {
            const reqFields = symbol.params.slice(0, 3).map(p => `    .${p.name}(${_exampleValue(p)})`).join('\n');
            md += `\`\`\`java\n`;
            if (symbol.returnType && symbol.returnType !== 'void') {
                md += `${symbol.returnType} result = `;
            }
            md += `client.${symbol.name}(${symbol.requestClass}.builder()\n${reqFields}\n    .build());\n\`\`\`\n`;
        } else {
            md += `\`\`\`java\nclient.${symbol.name}();\n\`\`\`\n`;
        }
    }

    return md;
}

function _exampleValue(param) {
    if (param.name === 'collectionName' || param.name === 'collectionNames') return '"my_collection"';
    if (param.name === 'databaseName') return '"default"';
    if (param.name === 'partitionName' || param.name === 'partitionNames') return 'Arrays.asList("partition1")';
    if (param.name === 'alias') return '"my_alias"';
    if (param.name === 'filter' || param.name === 'expr') return '"id > 0"';
    if (param.name === 'outputFields' || param.name === 'outFields') return 'Arrays.asList("id", "vector")';
    if (param.type === 'String') return `"example"`;
    if (param.type === 'int' || param.type === 'long') return '10';
    if (param.type === 'boolean' || param.type === 'Boolean') return 'true';
    if (param.type === 'Long') return '10L';
    if (param.type.startsWith('List')) return 'new ArrayList<>()';
    if (param.type.startsWith('Map')) return 'new HashMap<>()';
    return 'null';
}

// ============================================================
// Example snippets (extracted from SDK repo example files)
// ============================================================

const EXAMPLES = {
    // From CDCExample.java:60-91
    updateReplicateConfiguration: `import io.milvus.v2.service.cdc.request.CrossClusterTopology;
import io.milvus.v2.service.cdc.request.MilvusCluster;
import io.milvus.v2.service.cdc.request.ReplicateConfiguration;
import io.milvus.v2.service.cdc.request.UpdateReplicateConfigurationReq;

import java.util.ArrayList;

// Define source and target Milvus clusters
MilvusCluster sourceCluster = MilvusCluster.builder()
        .clusterId("upstream-cluster")
        .uri("http://192.168.1.1:19530")
        .pchannels(pchannelList)
        .build();
MilvusCluster targetCluster = MilvusCluster.builder()
        .clusterId("downstream-cluster")
        .uri("http://192.168.1.2:19530")
        .pchannels(pchannelList)
        .build();

// Define cross-cluster replication topology
CrossClusterTopology topology = CrossClusterTopology.builder()
        .sourceClusterId("upstream-cluster")
        .targetClusterId("downstream-cluster")
        .build();

// Build and apply replication configuration
ReplicateConfiguration configuration = ReplicateConfiguration.builder()
        .clusters(new ArrayList<MilvusCluster>() {{
            add(sourceCluster);
            add(targetCluster);
        }})
        .crossClusterTopologies(new ArrayList<CrossClusterTopology>() {{
            add(topology);
        }})
        .build();

client.updateReplicateConfiguration(
    UpdateReplicateConfigurationReq.builder()
        .replicateConfiguration(configuration)
        .build()
);`,

    // From AddFieldExample.java:127-133
    addCollectionField: `import io.milvus.v2.service.collection.request.AddCollectionFieldReq;
import io.milvus.v2.common.DataType;

// Add a nullable VarChar field to an existing collection.
// The new field must be nullable so that existing rows get null values.
client.addCollectionField(AddCollectionFieldReq.builder()
        .collectionName("my_collection")
        .fieldName("text")
        .dataType(DataType.VarChar)
        .maxLength(100)
        .isNullable(true)
        .build());`,

    // From RankerExample.java:203-228 — DecayRanker + FunctionScore
    search: `import io.milvus.v2.service.vector.request.SearchReq;
import io.milvus.v2.service.vector.request.FunctionScore;
import io.milvus.v2.service.vector.request.data.EmbeddedText;
import io.milvus.v2.service.vector.request.ranker.DecayRanker;
import io.milvus.v2.service.vector.response.SearchResp;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

// Build a DecayRanker to rerank results by field value proximity
DecayRanker decay = DecayRanker.builder()
        .name("birth_year_decay")
        .inputFieldNames(Collections.singletonList("birth_year"))
        .function("linear")
        .origin(1900)
        .scale(50)
        .offset(0)
        .decay(0.1)
        .build();

// Search with FunctionScore for reranking
SearchResp searchResp = client.search(SearchReq.builder()
        .collectionName("my_collection")
        .data(Collections.singletonList(new EmbeddedText("Albert Darwin")))
        .limit(100)
        .outputFields(Arrays.asList("birth_year", "lifespan"))
        .functionScore(FunctionScore.builder()
                .addFunction(decay)
                .build())
        .build());

List<List<SearchResp.SearchResult>> searchResults = searchResp.getSearchResults();
for (List<SearchResp.SearchResult> results : searchResults) {
    for (SearchResp.SearchResult result : results) {
        System.out.println(result);
    }
}`,

    // From HybridSearchExample.java:191-226 — WeightedRanker via FunctionScore
    hybridSearch: `import io.milvus.v2.service.vector.request.AnnSearchReq;
import io.milvus.v2.service.vector.request.HybridSearchReq;
import io.milvus.v2.service.vector.request.FunctionScore;
import io.milvus.v2.service.vector.request.ranker.WeightedRanker;
import io.milvus.v2.service.vector.response.SearchResp;
import io.milvus.v2.common.ConsistencyLevel;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

// Build ANN search requests for multiple vector fields
List<AnnSearchReq> searchRequests = new ArrayList<>();
searchRequests.add(AnnSearchReq.builder()
        .vectorFieldName("float_vector")
        .vectors(floatVectors)
        .params("{\\"nprobe\\": 10}")
        .limit(10)
        .build());
searchRequests.add(AnnSearchReq.builder()
        .vectorFieldName("binary_vector")
        .vectors(binaryVectors)
        .limit(50)
        .build());
searchRequests.add(AnnSearchReq.builder()
        .vectorFieldName("sparse_vector")
        .vectors(sparseVectors)
        .limit(100)
        .build());

// Hybrid search with WeightedRanker via FunctionScore
SearchResp searchResp = client.hybridSearch(HybridSearchReq.builder()
        .collectionName("my_collection")
        .searchRequests(searchRequests)
        .functionScore(FunctionScore.builder()
                .addFunction(WeightedRanker.builder()
                        .weights(Arrays.asList(0.2f, 0.5f, 0.6f))
                        .build())
                .build())
        .limit(5)
        .consistencyLevel(ConsistencyLevel.BOUNDED)
        .build());

List<List<SearchResp.SearchResult>> searchResults = searchResp.getSearchResults();
for (List<SearchResp.SearchResult> results : searchResults) {
    for (SearchResp.SearchResult result : results) {
        System.out.println(result);
    }
}`,

    // From IteratorExample.java:136-161 — full iterator loop
    queryIterator: `import io.milvus.orm.iterator.QueryIterator;
import io.milvus.response.QueryResultsWrapper;
import io.milvus.v2.service.vector.request.QueryIteratorReq;
import io.milvus.v2.common.ConsistencyLevel;

import java.util.Arrays;
import java.util.List;

// Create a query iterator to retrieve results in batches
QueryIterator queryIterator = client.queryIterator(QueryIteratorReq.builder()
        .collectionName("my_collection")
        .expr("userID < 3000")
        .outputFields(Arrays.asList("userID", "userAge"))
        .batchSize(100)
        .offset(0)
        .limit(10000)
        .consistencyLevel(ConsistencyLevel.BOUNDED)
        .build());

// Iterate through all results
int counter = 0;
while (true) {
    List<QueryResultsWrapper.RowRecord> res = queryIterator.next();
    if (res.isEmpty()) {
        queryIterator.close();
        break;
    }
    for (QueryResultsWrapper.RowRecord record : res) {
        System.out.println(record);
        counter++;
    }
}
System.out.printf("%d query results returned%n", counter);`,

    // From IteratorExample.java:245-274 — V2 iterator with SearchResp.SearchResult
    searchIteratorV2: `import io.milvus.orm.iterator.SearchIteratorV2;
import io.milvus.v2.service.vector.request.SearchIteratorReqV2;
import io.milvus.v2.service.vector.request.data.FloatVec;
import io.milvus.v2.service.vector.response.SearchResp;
import io.milvus.v2.common.ConsistencyLevel;
import io.milvus.v2.common.IndexParam;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;

// Create a SearchIteratorV2 for paginated vector search.
// V2 is recommended over V1: 20-30% faster with better recall.
SearchIteratorV2 searchIterator = client.searchIteratorV2(SearchIteratorReqV2.builder()
        .collectionName("my_collection")
        .outputFields(Arrays.asList("userAge"))
        .batchSize(50)
        .vectorFieldName("userFace")
        .vectors(Collections.singletonList(new FloatVec(queryVector)))
        .filter("userAge > 10 && userAge < 20")
        .searchParams(new HashMap<>())
        .limit(120)
        .metricType(IndexParam.MetricType.L2)
        .consistencyLevel(ConsistencyLevel.BOUNDED)
        .build());

// Iterate through search results
int counter = 0;
while (true) {
    List<SearchResp.SearchResult> res = searchIterator.next();
    if (res.isEmpty()) {
        searchIterator.close();
        break;
    }
    for (SearchResp.SearchResult result : res) {
        System.out.println(result);
        counter++;
    }
}
System.out.printf("%d search results returned%n", counter);`,

    // From VolumeFileManagerExample.java:33-57
    shutdownGracefully: `import io.milvus.bulkwriter.VolumeFileManager;
import io.milvus.bulkwriter.VolumeFileManagerParam;
import io.milvus.bulkwriter.common.clientenum.ConnectType;
import io.milvus.bulkwriter.model.UploadFilesResult;
import io.milvus.bulkwriter.request.volume.UploadFilesRequest;

// Initialize VolumeFileManager
VolumeFileManagerParam param = VolumeFileManagerParam.newBuilder()
        .withCloudEndpoint("https://api.cloud.zilliz.com")
        .withApiKey("your_api_key")
        .withVolumeName("your_volume_name")
        .withConnectType(ConnectType.AUTO)
        .build();
VolumeFileManager manager = new VolumeFileManager(param);

// Upload files asynchronously
UploadFilesRequest request = UploadFilesRequest.builder()
        .sourceFilePath("/path/to/data/")
        .targetVolumePath("data/")
        .build();
UploadFilesResult result = manager.uploadFilesAsync(request).get();

// Gracefully shut down the manager when done
manager.shutdownGracefully();`,
};

// ============================================================
// Method definitions
// ============================================================

const METHODS = [
    // ── Step 1 method (template-based) ──────────────────────────
    {
        name: 'updateReplicateConfiguration',
        title: 'updateReplicateConfiguration()',
        category: 'Management',
        recordId: 'recvaIFBkB4wSr',
        useScanner: false,
        exampleCode: EXAMPLES.updateReplicateConfiguration,
        buildMarkdown: (description, exampleCode) => {
            const desc = description || 'Updates replication configuration across Milvus clusters. This is used to set up cross-cluster data replication by defining cluster connections and replication topology.';
            return `${desc}

\`\`\`java
public UpdateReplicateConfigurationResp updateReplicateConfiguration(UpdateReplicateConfigurationReq request)
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`java
updateReplicateConfiguration(UpdateReplicateConfigurationReq.builder()
    .replicateConfiguration(ReplicateConfiguration config)
    .build()
);
\`\`\`

**BUILDER METHODS:**

- \`replicateConfiguration(ReplicateConfiguration config)\` -
**[REQUIRED]**
The replication configuration containing cluster definitions and topology.

**RETURNS:**

*UpdateReplicateConfigurationResp*

**EXCEPTIONS:**

- **MilvusClientException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`java
${exampleCode}
\`\`\`
`;
        },
    },
    // ── Step 2 methods (scanner-based) ──────────────────────────
    {
        name: 'addCollectionField',
        title: 'addCollectionField()',
        category: 'Collections',
        recordId: 'recuOVj8WjrvAa',
        useScanner: true,
        exampleCode: EXAMPLES.addCollectionField,
    },
    {
        name: 'search',
        title: 'search()',
        category: 'Vector',
        recordId: 'recu4ONkT0iCgs',
        useScanner: true,
        exampleCode: EXAMPLES.search,
    },
    {
        name: 'hybridSearch',
        title: 'hybridSearch()',
        category: 'Vector',
        recordId: 'recuiMpJyRPYQc',
        useScanner: true,
        exampleCode: EXAMPLES.hybridSearch,
    },
    {
        name: 'queryIterator',
        title: 'queryIterator()',
        category: 'Vector',
        recordId: 'recuiMpOnO5f6C',
        useScanner: true,
        exampleCode: EXAMPLES.queryIterator,
    },
    {
        name: 'searchIteratorV2',
        title: 'SearchIteratorV2()',
        category: 'Vector',
        recordId: 'recuLEyiR2x13A',
        useScanner: true,
        exampleCode: EXAMPLES.searchIteratorV2,
    },
    // ── Step 3 method (template-based) ──────────────────────────
    {
        name: 'shutdownGracefully',
        title: 'shutdownGracefully()',
        category: 'Volume',
        recordId: 'recvaIN1YfWuD0',
        useScanner: false,
        exampleCode: EXAMPLES.shutdownGracefully,
        buildMarkdown: (description, exampleCode) => {
            const desc = description || 'Gracefully shuts down the internal executor service of the VolumeFileManager, allowing pending upload tasks to complete before termination.';
            return `${desc}

\`\`\`java
public void shutdownGracefully()
\`\`\`

**RETURNS:**

*void*

**EXCEPTIONS:**

- **MilvusClientException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`java
${exampleCode}
\`\`\`
`;
        },
    },
];

// ============================================================
// Main
// ============================================================

function lookupCurrentDocId(allRecords, recordId) {
    const rec = allRecords.find(r => r.record_id === recordId);
    if (!rec) return null;
    const link = rec.fields['Docs']?.link || '';
    const match = link.match(/\/docx\/([A-Za-z0-9]+)/);
    return match ? match[1] : null;
}

async function main() {
    console.log('Java SDK v2.6.x Examples Update');
    console.log('================================\n');

    if (LIST_ONLY) {
        console.log('Methods to update:\n');
        for (const m of METHODS) {
            console.log(`  ${m.category}/${m.name} (record: ${m.recordId}, scanner: ${m.useScanner})`);
        }
        console.log(`\nTotal: ${METHODS.length} methods`);
        return;
    }

    if (DRY_RUN) console.log('  *** DRY RUN MODE ***\n');

    const m2f = new MarkdownToFeishu({ sourceType: 'drive' });
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    // Index all bitable records to find current docIds
    console.log('Indexing bitable records...');
    const allRecords = await writer.listRecords({ pageSize: 500 });
    console.log(`  ${allRecords.length} records indexed\n`);

    // Scan Java SDK if any scanner-based methods are targeted
    const needsScanner = METHODS.some(m => m.useScanner && (!ONLY_METHOD || m.name === ONLY_METHOD));
    let symbols = null;
    if (needsScanner) {
        console.log('Scanning Java SDK source...');
        const scanner = new JavaScanner({
            rootDir: path.resolve(__dirname, '../repos/milvus-sdk-java/sdk-core/src/main/java/io/milvus'),
            publicOnly: true,
        });
        symbols = await scanner.scan();
        console.log(`  ${symbols.length} symbols scanned\n`);
    }

    // Process each method
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const method of METHODS) {
        if (ONLY_METHOD && method.name !== ONLY_METHOD) continue;

        console.log(`\n─── ${method.category}/${method.name} (record: ${method.recordId}) ───`);

        // 1. Find current docId from bitable
        const currentDocId = lookupCurrentDocId(allRecords, method.recordId);
        if (!currentDocId) {
            console.log('  ⚠️ No docId found in bitable record, skipping');
            skipped++;
            continue;
        }
        console.log(`  Current doc: ${currentDocId}`);

        // 2. Fetch existing doc content
        let docContent = { description: '', exampleCode: '', returnsDescription: '' };
        try {
            docContent = await fetchDocContent(currentDocId);
            await delay(300);
        } catch (e) {
            console.log(`  ⚠️ Could not fetch existing doc: ${e.message}`);
        }

        // 3. Build new markdown
        let markdown;
        if (method.useScanner) {
            const symbol = symbols.find(s => s.name === method.name);
            if (!symbol) {
                console.log(`  ⚠️ Symbol '${method.name}' not found in scanner, skipping`);
                skipped++;
                continue;
            }
            console.log(`  Scanner: ${symbol.params.length} params, returns ${symbol.returnType}`);
            markdown = generateMethodMarkdown(symbol, {
                description: docContent.description,
                exampleCode: method.exampleCode,
                returnsDescription: docContent.returnsDescription,
            });
        } else {
            markdown = method.buildMarkdown(docContent.description, method.exampleCode);
        }

        // 4. Show diff in dry-run mode
        if (DRY_RUN) {
            console.log(`  [DRY RUN] Would update '${method.title}'`);
            console.log(`  Description: ${(docContent.description || '(none)').substring(0, 80)}...`);
            console.log(`  Old example: ${(docContent.exampleCode || '(none)').substring(0, 60)}...`);
            console.log(`  New example: ${method.exampleCode.substring(0, 60)}...`);
            continue;
        }

        // 5. Push new doc
        const folderToken = FOLDER_TOKENS[method.category];
        if (!folderToken) {
            console.log(`  ❌ No folder token for category '${method.category}'`);
            failed++;
            continue;
        }

        let docResult;
        try {
            docResult = await m2f.push_markdown({
                markdown_content: markdown,
                title: method.title,
                folder_token: folderToken,
            });
            console.log(`  New doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);
        } catch (e) {
            console.log(`  ❌ Push failed: ${e.message}`);
            failed++;
            continue;
        }

        // 6. Update bitable record
        try {
            const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
            await writer.updateRecord(method.recordId, {
                title: method.title,
                link: docLink,
                lastModified: 'v2.6.x',
            });
            console.log(`  Record ${method.recordId} → ${docLink}`);
        } catch (e) {
            console.log(`  ❌ Bitable update failed: ${e.message}`);
            console.log(`  ⚠️ New doc ${docResult.document_id} is now orphaned!`);
            failed++;
            continue;
        }

        // 7. Delete old doc (only if both push and bitable update succeeded)
        try {
            await deleteDoc(currentDocId);
            console.log(`  Deleted old doc: ${currentDocId}`);
        } catch (e) {
            console.log(`  ⚠️ Could not delete old doc ${currentDocId}: ${e.message}`);
        }

        updated++;
        await delay();
    }

    console.log(`\n================================`);
    console.log(`Done: ${updated} updated, ${skipped} skipped, ${failed} failed`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
