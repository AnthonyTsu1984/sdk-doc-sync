#!/usr/bin/env node
/**
 * Java SDK v3.0.x Documentation Update Script
 *
 * Drives the v3.0.x doc-sync delta against master HEAD 80b4f555.
 * v3.0.x bitable: AOFDbSmwma9XrNsLa8KcQgt9ngc (carry-forward from v2.6.x).
 * v3.0.x drive folder: C4Ckfsx5qlKHbnd5PVrcpxvTn2d (delta-only — only new/updated docs).
 *
 * Usage:
 *   node scripts/java-v30-update.js --phase=N [--dry-run] [--method=name]
 *
 * Phases:
 *   0    — Verify bitable and folder state, resolve UPDATE record IDs
 *   1    — Folders & VirtualNodes (lazy folder creation + bitable VN re-point/create)
 *   2    — UPDATE existing Function docs (clone v2.6 → v3.0/<Cat>/, edit, re-point)
 *   3    — CREATE 6 new MilvusClientV2 method docs
 *   4    — Post-actions (add-type-links, fix-leading-spaces, post-fix-links)
 *   all  — Run 0,1,2,3 (4 must be invoked separately for safety)
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');
const JavaScanner = require('../src/sdk-doc-sync/scanners/java-scanner');

// ============================================================
// Constants
// ============================================================

const BITABLE_TOKEN = 'AOFDbSmwma9XrNsLa8KcQgt9ngc';
const V30_FOLDER = 'C4Ckfsx5qlKHbnd5PVrcpxvTn2d';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const DELAY_MS = 500;

// Categories that the delta touches. Filled in by Phase 1.
// Keyed by category name for category folders (e.g., 'Collections')
// and by `${category}/${className}` for class-nested subfolders
// (e.g., 'Collections/CollectionSchema').
const FOLDER_TOKENS = {};

// VirtualNode bitable record IDs keyed by category title. Filled in by Phase 0.
const PARENT_RECORDS = {};

const tokenFetcher = new larkTokenFetcher();

// Resolves the FOLDER_TOKENS key for a method/class doc.
// Methods nested under a Class declare `parentClass: <ClassName>` and live
// inside `<Category>/<ClassName>/`. Class docs themselves follow v2.6.x
// convention: if a self-named subfolder exists for the class, the Class doc
// goes there too; otherwise it stays flat in the category folder.
function folderKeyFor(m) {
    if (m.parentClass) return `${m.category}/${m.parentClass}`;
    if (m.recordType === 'Class' && FOLDER_TOKENS[`${m.category}/${m.name}`]) {
        return `${m.category}/${m.name}`;
    }
    return m.category;
}

// ============================================================
// CLI
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_PHASE = args.find(a => a.startsWith('--phase='))?.split('=')[1] || '0';
const ONLY_METHOD = args.find(a => a.startsWith('--method='))?.split('=')[1];

// ============================================================
// Helpers
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

async function createFolder(name, parentFolderToken) {
    return feishuAPI('POST', '/open-apis/drive/v1/files/create_folder', {
        name,
        folder_token: parentFolderToken,
    });
}

async function listFolderChildren(folderToken) {
    const result = await feishuAPI('GET',
        `/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=200`);
    return result.files || [];
}

// Populate FOLDER_TOKENS from the v3.0.x drive — both top-level category
// folders and any class subfolders nested one level deep (e.g.,
// 'Collections/CollectionSchema').
async function populateFolderTokensFromDrive() {
    const top = await listFolderChildren(V30_FOLDER);
    for (const c of top) {
        if (c.type !== 'folder') continue;
        FOLDER_TOKENS[c.name] = c.token;
        const nested = await listFolderChildren(c.token);
        for (const n of nested) {
            if (n.type === 'folder') {
                FOLDER_TOKENS[`${c.name}/${n.name}`] = n.token;
            }
        }
    }
}

async function delay(ms = DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

// Fetch existing doc blocks; extract description, last code block as example, RETURNS prose
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
    if (codeBlocks.length >= 1) {
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

// Generate markdown for a method from scanner symbol + existing doc content
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
    if (docContent.returnsDescription) md += `${docContent.returnsDescription}\n\n`;

    md += `**EXCEPTIONS:**\n\n`;
    md += `- **MilvusClientException**\nThis exception will be raised when any error occurs during this operation.\n\n`;

    md += `## Example{#example}\n\n`;
    if (docContent.exampleCode) {
        md += `\`\`\`java\n${docContent.exampleCode}\n\`\`\`\n`;
    } else if (symbol.requestClass && symbol.params.length > 0) {
        const reqFields = symbol.params.slice(0, 3).map(p => `    .${p.name}(${_exampleValue(p)})`).join('\n');
        md += `\`\`\`java\n`;
        if (symbol.returnType && symbol.returnType !== 'void') {
            md += `${symbol.returnType} result = `;
        }
        md += `client.${symbol.name}(${symbol.requestClass}.builder()\n${reqFields}\n    .build());\n\`\`\`\n`;
    } else {
        md += `\`\`\`java\nclient.${symbol.name}();\n\`\`\`\n`;
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
    if (param.name === 'collectionId') return '1234567890L';
    if (param.name === 'collectionIds') return 'Arrays.asList(1234567890L, 1234567891L)';
    if (param.name === 'jobId') return '1234567890L';
    if (param.name === 'externalSource') return '"s3"';
    if (param.name === 'externalSpec') return 'externalSpec';
    if (param.name === 'externalField') return '"src_field"';
    if (param.name === 'option') return 'Map.of("key", "value")';
    if (param.name === 'name') return '"my_resource"';
    if (param.name === 'path') return '"/local/path/to/file"';
    if (param.type === 'String') return `"example"`;
    if (param.type === 'int' || param.type === 'long') return '10';
    if (param.type === 'boolean' || param.type === 'Boolean') return 'true';
    if (param.type === 'Long' || param.type === 'long') return '10L';
    if (param.type.startsWith('List')) return 'new ArrayList<>()';
    if (param.type.startsWith('Map')) return 'new HashMap<>()';
    if (param.type === 'JsonObject') return 'new JsonObject()';
    return 'null';
}

const PARAM_DESCRIPTIONS = {
    // Common
    collectionName: 'The name of the target collection.',
    databaseName: 'The name of the database. Defaults to the current database if not specified.',
    // v3.0 newcomers
    collectionId: 'The numeric ID of the collection. Use this when you need to identify a collection by ID instead of name.',
    collectionIds: 'A list of collection IDs to describe in batch.',
    externalSource: 'The external data source identifier (e.g., `"s3"`, `"oss"`).',
    externalSpec: 'A JSON object describing the external storage configuration. Fields depend on `externalSource` (typically include `endpoint`, `bucket`, `path`, credentials).',
    externalField: 'The name of the corresponding field in the external source. Used to map an external column to a Milvus field.',
    option: 'A map of additional client connection options as key-value pairs. Useful for forwarding cluster-specific configuration.',
    jobId: 'The job ID returned by `refreshExternalCollection`. Use this to query progress or identify a specific refresh job.',
    name: 'The unique name of the file resource.',
    path: 'The local filesystem path of the resource to upload.',
};

// Build {title → recordId} index by record Type
async function indexRecords(writer, type) {
    const allRecords = await writer.listRecords({ pageSize: 500 });
    const filtered = allRecords.filter(r => r.fields['Type'] === type);
    const map = new Map();
    for (const rec of filtered) {
        const docs = rec.fields['Docs'];
        const text = docs?.text || '';
        const link = docs?.link || '';
        const docIdMatch = link.match(/\/(?:docx|drive\/folder)\/([A-Za-z0-9]+)/);
        if (!map.has(text)) map.set(text, []);
        map.get(text).push({
            record_id: rec.record_id,
            title: text,
            link,
            docId: docIdMatch ? docIdMatch[1] : null,
        });
    }
    return { map, total: filtered.length, allRecords };
}

// ============================================================
// Phase 0: Verify
// ============================================================

const STEP2_METHODS = [
    // ============================================================
    // Phase 2b — nested-builder UPDATEs (executed 2026-05-02 onward)
    // The original Phase 2 (4 entries) is recorded in the plan's Executed delta block;
    // those entries are no longer regenerated here.
    // ============================================================
    {
        name: 'CollectionSchema',
        title: 'CollectionSchema',
        category: 'Collections',
        recordType: 'Class',
        markdown: `A **CollectionSchema** instance represents the schema of a collection. A schema sketches the structure of a collection.

\`\`\`java
io.milvus.v2.service.collection.request.CreateCollectionReq.CollectionSchema
\`\`\`

## Constructor{#constructor}

Constructs the schema of a collection by defining fields, data types, and other parameters.

\`\`\`java
CreateCollectionReq.CollectionSchema.builder()
    .fieldSchemaList(List<CreateCollectionReq.FieldSchema> fieldSchemaList)
    .structFields(List<CreateCollectionReq.StructFieldSchema> structFields)
    .enableDynamicField(boolean enableDynamicField)
    .functionList(List<CreateCollectionReq.Function> functionList)
    .externalSource(String externalSource)
    .externalSpec(JsonObject externalSpec)
    .build();
\`\`\`

**BUILDER METHODS:**

- \`fieldSchemaList(List<CreateCollectionReq.FieldSchema> fieldSchemaList)\` -
A list of **FieldSchema** objects that define the fields in the collection schema. A field schema represents and contains metadata for a single field, while **CollectionSchema** ties together a list of FieldSchema objects to define the full schema.
- \`structFields(List<CreateCollectionReq.StructFieldSchema> structFields)\` -
A list of struct fields (nested-object fields) for the schema. Use this when the collection contains fields whose values are themselves structured records.
- \`enableDynamicField(boolean enableDynamicField)\` -
When set to \`true\`, enables a hidden dynamic field (\`$meta\`) so inserts can carry arbitrary key-value attributes outside the declared schema. Default: \`false\`.
- \`functionList(List<CreateCollectionReq.Function> functionList)\` -
Attaches functions (e.g., BM25, JSON-path extraction) that derive values from existing fields at insert time. Each \`Function\` declares its inputs, outputs, and parameters.
- \`externalSource(String externalSource)\` -
Identifies the external source (e.g., a S3 bucket, a Lakehouse table) bound to this collection. Pairs with \`externalSpec\` to define an external collection that refreshes from outside Milvus.
- \`externalSpec(JsonObject externalSpec)\` -
Specification for the external source — typically JSON describing connection details and refresh policy. Used together with \`externalSource\`.

**RETURN TYPE:**

*CollectionSchema*

**RETURNS:**

A **CollectionSchema** object.

**EXCEPTIONS:**

- **MilvusClientExceptions**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`java
import io.milvus.v2.common.DataType;
import io.milvus.v2.service.collection.request.AddFieldReq;
import io.milvus.v2.service.collection.request.CreateCollectionReq;

// define a Collection Schema
CreateCollectionReq.CollectionSchema collectionSchema = client.createSchema();
// add two fields, id and vector
collectionSchema.addField(AddFieldReq.builder().fieldName("id").dataType(DataType.Int64).isPrimaryKey(Boolean.TRUE).autoID(Boolean.FALSE).description("id").build());
collectionSchema.addField(AddFieldReq.builder().fieldName("vector").dataType(DataType.FloatVector).dimension(dim).build());
\`\`\`

## Methods{#methods}

The following are the methods of the \`CollectionSchema\` class:
`,
    },
    {
        name: 'FieldSchema',
        title: 'FieldSchema',
        category: 'Collections',
        recordType: 'Class',
        markdown: `A **FieldSchema** instance defines the data type and related attributes of a specific field in a collection.

\`\`\`java
io.milvus.v2.service.collection.request.CreateCollectionReq.FieldSchema
\`\`\`

## Constructor{#constructor}

Constructs the schema of a field by defining the field name, data type, and other parameters.

\`\`\`java
CreateCollectionReq.FieldSchema.builder()
    .name(String name)
    .description(String description)
    .dataType(DataType dataType)
    .maxLength(Integer maxLength)
    .dimension(Integer dimension)
    .isPrimaryKey(Boolean isPrimaryKey)
    .isPartitionKey(Boolean isPartitionKey)
    .isClusteringKey(Boolean isClusteringKey)
    .autoID(Boolean autoID)
<include target="milvus">
    .elementType(DataType elementType)
    .maxCapacity(Integer maxCapacity)
</include>
    .isNullable(Boolean isNullable)
    .defaultValue(Object defaultValue)
    .enableAnalyzer(Boolean enableAnalyzer)
    .analyzerParams(Map<String, Object> analyzerParams)
    .enableMatch(Boolean enableMatch)
    .typeParams(Map<String, String> typeParams)
    .multiAnalyzerParams(Map<String, Object> multiAnalyzerParams)
    .externalField(String externalField)
    .build();
\`\`\`

**BUILDER METHODS:**

- \`name(String name)\` -
The name of the field.
- \`description(String description)\` -
The description of the field.
- \`dataType(DataType dataType)\` -
The data type of the field. You can choose from the following options when selecting a data type for different fields: primary key field — use **DataType.Int64** or **DataType.VarChar**; scalar fields — choose from **DataType.Bool**, **DataType.Int8**, **DataType.Int16**, **DataType.Int32**, **DataType.Int64**, **DataType.Float**, **DataType.Double**, **DataType.VarChar**, **DataType.JSON**, or **DataType.Array**; vector fields — select **DataType.BinaryVector** or **DataType.FloatVector**.
- \`maxLength(Integer maxLength)\` -
The maximum number of characters a value should contain. This is required if **dataType** of this field is set to **DataType.VarChar**.
- \`dimension(Integer dimension)\` -
The number of dimensions a value should have. This is required if **dataType** of this field is set to **DataType.FloatVector**.
- \`isPrimaryKey(Boolean isPrimaryKey)\` -
Whether the current field is the primary field. Setting this to **True** makes the current field the primary field.
- \`isPartitionKey(Boolean isPartitionKey)\` -
Whether the current field is the partition-key field. Setting this to **True** makes the current field the partition key.
- \`isClusteringKey(Boolean isClusteringKey)\` -
Whether the current field is the clustering key. The clustering key controls on-disk segment grouping to accelerate queries that filter on this field.
- \`autoID(Boolean autoID)\` -
Whether allows the primary field to automatically increment. Setting this to **True** makes the primary field automatically increment. In this case, the primary field should not be included in the data to insert to avoid errors. Set this parameter in the field with **isPrimaryKey** set to **True**.
- \`elementType(DataType elementType)\` -
The data type of elements in array fields. This is required if **dataType** of this field is set to **DataType.Array**. <include target="milvus">Available only in self-hosted Milvus.</include>
- \`maxCapacity(Integer maxCapacity)\` -
The maximum number of elements that an array field can contain. This is required if **dataType** of this field is set to **DataType.Array**. <include target="milvus">Available only in self-hosted Milvus.</include>
- \`isNullable(Boolean isNullable)\` -
Allows \`null\` values for this field. Default: \`false\`. For more information, refer to Nullable & Default.
- \`defaultValue(Object defaultValue)\` -
Sets a default value for the field used when the field is absent from an insert. The runtime type must match \`dataType\`.
- \`enableAnalyzer(Boolean enableAnalyzer)\` -
Whether to enable text analysis for the specified \`VARCHAR\` field. When set to \`true\`, Milvus uses a text analyzer that tokenizes and filters the text content of the field. Required for full-text search.
- \`analyzerParams(Map<String, Object> analyzerParams)\` -
Per-field analyzer configuration (tokenizer, filters) for \`DataType.VarChar\` fields. Used together with \`enableAnalyzer\`.
- \`enableMatch(Boolean enableMatch)\` -
Whether to enable keyword matching for the specified \`VARCHAR\` field. When \`true\`, Milvus creates an inverted index for the field, allowing for quick and efficient keyword lookups. \`enableMatch\` works in conjunction with \`enableAnalyzer\` to provide structured term-based text search.
- \`typeParams(Map<String, String> typeParams)\` -
Generic per-type parameters not surfaced as dedicated builder methods. Once specified, values here override the corresponding parameter values set above.
- \`multiAnalyzerParams(Map<String, Object> multiAnalyzerParams)\` -
A multi-language analyzer that allows you to configure multiple analyzers for a text field and store multilingual documents in this text field.
- \`externalField(String externalField)\` -
Maps this Milvus field to a column in the external source identified on the schema's \`externalSource\`. Used for external collections.

**RETURN TYPE:**

*FieldSchema*

**RETURNS:**

A **FieldSchema** object.

**EXCEPTIONS:**

- **MilvusClientExceptions**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`java
// define a id field with autoID set to false
CreateCollectionReq.FieldSchema fieldSchema = CreateCollectionReq.FieldSchema.builder()
        .name("id")
        .dataType(DataType.Int64)
        .isPrimaryKey(Boolean.TRUE)
        .autoID(Boolean.FALSE)
        .build();
\`\`\`
`,
    },
];

// Original Phase 2 entries (already executed 2026-05-02). Retained for historical reference only.
const STEP2_METHODS_EXECUTED = [
    { name: 'addField', title: 'addField()', category: 'Collections', parentClass: 'CollectionSchema', recordType: 'Function',
        markdown: `This operation adds a field to the schema of a collection.

\`\`\`java
public void addField(AddFieldReq addFieldReq)
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`java
CollectionSchema.addField(AddFieldReq.builder()
    .fieldName(String fieldName)
    .description(String description)
    .dataType(DataType dataType)
    .maxLength(Integer maxLength)
    .isPrimaryKey(Boolean isPrimaryKey)
    .isPartitionKey(Boolean isPartitionKey)
    .autoID(Boolean autoID)
    .dimension(int dimension)
    .elementType(DataType elementType)
    .maxCapacity(Integer maxCapacity)
    .isNullable(Boolean isNullable)
    .defaultValue(DataType dataType)
    .enableAnalyzer(Boolean enableAnalyzer)
    .enableMatch(Boolean enableMatch)
    .analyzerParams(Map<String, Object> analyzerParams)
    .typeParams(Map<String, String> typeParams)
    .multiAnalyzerParams(Map<String, Object> multiAnalyzerParams)
    .structFields(List<CreateCollectionReq.FieldSchema> structFields)
    .externalField(String externalField)
    .build()
)
\`\`\`

**BUILDER METHODS:**

- \`fieldName(String fieldName)\` -
The name of the field.
- \`description(String description)\` -
The description of the field.
- \`dataType(DataType dataType)\` -
The data type of the field.
You can choose from the following options when selecting a data type for different fields.
- \`maxLength(Integer maxLength)\` -
The maximum number of characters a value should contain.
This is required if **dataType** of this field is set to **DataType.VarChar**.
- \`isPrimaryKey(Boolean isPrimaryKey)\` -
Whether the current field is the primary field.
Setting this to **True** makes the current field the primary field.
- \`isPartitionKey(Boolean isPartitionKey)\` -
Whether the current field is the partitionKey field.
Setting this to **True** makes the current field the partition key.
- \`autoID(Boolean autoID)\` -
Whether allows the primary field to automatically increment.
Setting this to **True** makes the primary field automatically increment. In this case, the primary field should not be included in the data to insert to avoid errors.
Set this parameter in the field with **isPrimaryKey** set to **True**.
- \`dimension(int dimension)\` -
The dimensionality of a vector field. The value should be greater than 1 and is usually determined by the embedding model in use.
This is required if **dataType** of this field is set to **DataType.FloatVector**.
- \`elementType(DataType elementType)\` -
The data type of elements in array fields.
This is required if **dataType** of this field is set to **DataType.Array**.
- \`maxCapacity(Integer maxCapacity)\` -
The maximum number of elements that an array field can contain.
This is required if **dataType** of this field is set to **DataType.Array**.
- \`isNullable(Boolean isNullable)\` -
A Boolean parameter that specifies whether the field can accept null values.
For more information, refer to Nullable & Default.
- \`defaultValue(DataType dataType)\` -
Sets a default value for a specific field in a collection schema when creating it. This is particularly useful when you want certain fields to have an initial value even if no value is explicitly provided during data insertion.
- \`enableAnalyzer(Boolean enableAnalyzer)\` -
Whether to enable text analysis for the specified \`VARCHAR\` field. When set to \`true\`, it instructs Milvus to use a text analyzer, which tokenizes and filters the text content of the field.
- \`enableMatch(Boolean enableMatch)\` -
Whether to enable keyword matching for the specified \`VARCHAR\` field. When set to \`true\`, Milvus creates an inverted index for the field, allowing for quick and efficient keyword lookups. \`enableMatch\` works in conjunction with \`enableAnalyzer\` to provide structured term-based text search.
- \`analyzerParams(Map<String, Object> analyzerParams)\` -
Configures the analyzer for text processing, specifically for \`DataType.VarChar\` fields. This parameter configures tokenizer and filter settings, particularly for text fields used in keyword matching or full text search.
- \`typeParams(Map<String, String> typeParams)\` -
The parameters specific to the data type of the current field to add. For example, you can set \`maxLength\` for a \`VarChar\` field. Once specified, it overrides the corresponding parameter values specified above.
- \`multiAnalyzerParams(Map<String, Object> multiAnalyzerParams)\` -
A multi-language analyzer that allows you to configure multiple analyzers for a text field and store multilingual documents in this text field.
- \`structFields(List<CreateCollectionReq.FieldSchema> structFields)\` -
A list of fields in the Array of Structs field.
This is required if **dataType** of this field is set to **DataType.Array** and **elementType** of this field is set to **DataType.Struct**.
- \`externalField(String externalField)\` -
The name of an external field that this Milvus field maps to. Used together with \`externalSource\` and \`externalSpec\` on \`CollectionSchema\` to declare a collection backed by an external data source. The external field's values are pulled into this Milvus field on refresh.

**RETURNS:**

*void*

**EXCEPTIONS:**

- **MilvusClientException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`java
import io.milvus.v2.common.DataType;
import io.milvus.v2.service.collection.request.AddFieldReq;
import io.milvus.v2.service.collection.request.CreateCollectionReq;

CreateCollectionReq.CollectionSchema collectionSchema = client.createSchema();
// add two fields, id and vector
collectionSchema.addField(AddFieldReq.builder().fieldName("id").dataType(DataType.Int64).isPrimaryKey(Boolean.TRUE).autoID(Boolean.FALSE).description("id").build());
collectionSchema.addField(AddFieldReq.builder().fieldName("vector").dataType(DataType.FloatVector).dimension(128).build());
\`\`\`
`,
    },
    { name: 'describeCollection', title: 'describeCollection()', category: 'Collections', recordType: 'Function' },
    { name: 'batchDescribeCollection', title: 'batchDescribeCollection()', category: 'Collections', recordType: 'Function' },
    {
        name: 'ConnectConfig',
        title: 'ConnectConfig',
        category: 'Client',
        recordType: 'Class',
        markdown: `A ConnectConfig builder holds the connection configuration used when creating a \`MilvusClientV2\` instance. Use the builder pattern to configure all connection parameters, including authentication, TLS, timeouts, and keepalive settings.

\`\`\`java
ConnectConfig.builder()
    .uri(String uri)
    .token(String token)
    .username(String username)
    .password(String password)
    .dbName(String dbName)
    .connectTimeoutMs(long connectTimeoutMs)
    .keepAliveTimeMs(long keepAliveTimeMs)
    .keepAliveTimeoutMs(long keepAliveTimeoutMs)
    .keepAliveWithoutCalls(boolean keepAliveWithoutCalls)
    .rpcDeadlineMs(long rpcDeadlineMs)
    .secure(Boolean secure)
    .enablePrecheck(boolean enablePrecheck)
    .idleTimeoutMs(long idleTimeoutMs)
    .clientKeyPath(String clientKeyPath)
    .clientPemPath(String clientPemPath)
    .caPemPath(String caPemPath)
    .serverPemPath(String serverPemPath)
    .serverName(String serverName)
    .proxyAddress(String proxyAddress)
    .option(Map<String, String> option)
    .build()
\`\`\`

**BUILDER METHODS:**

- \`uri(String uri)\` -
**[REQUIRED]**
The server endpoint URI. Accepts \`http://host:port\` for a local Milvus instance or an HTTPS URL for Zilliz Cloud.
- \`token(String token)\` -
API key or \`"username:password"\` string for authentication. Use this for Zilliz Cloud API keys or as a shorthand for username/password auth. Default: \`null\`.
- \`username(String username)\` -
Username for authentication. Use together with \`password()\`. Ignored if \`token()\` is set. Default: \`null\`.
- \`password(String password)\` -
Password for authentication. Use together with \`username()\`. Default: \`null\`.
- \`dbName(String dbName)\` -
The default database name to use after connecting. Default: \`null\` (uses the server default).
- \`connectTimeoutMs(long connectTimeoutMs)\` -
Timeout in milliseconds to wait for the gRPC channel to reach the READY state during connection. Default: \`10000\`.
- \`keepAliveTimeMs(long keepAliveTimeMs)\` -
Interval in milliseconds between keepalive pings sent to the server. Default: \`10000\`.
- \`keepAliveTimeoutMs(long keepAliveTimeoutMs)\` -
Timeout in milliseconds to wait for a keepalive ping acknowledgement before closing the connection. Default: \`5000\`.
- \`keepAliveWithoutCalls(boolean keepAliveWithoutCalls)\` -
When \`true\`, keepalive pings are sent even when there are no active RPCs. Default: \`true\`.
- \`rpcDeadlineMs(long rpcDeadlineMs)\` -
Maximum duration in milliseconds allowed for a single RPC call. A value of \`0\` disables the deadline. Default: \`0\`.
- \`secure(Boolean secure)\` -
Enables TLS encryption. When the URI starts with \`https\`, TLS is always enabled regardless of this setting. Default: \`false\`.
- \`enablePrecheck(boolean enablePrecheck)\` -
When \`true\`, performs a connectivity check before returning the client. Default: \`false\`.
- \`idleTimeoutMs(long idleTimeoutMs)\` -
Time in milliseconds after which an idle connection is closed. Default: \`86400000\` (24 hours).
- \`clientKeyPath(String clientKeyPath)\` -
Path to the client private key file for mutual TLS (mTLS). Default: \`null\`.
- \`clientPemPath(String clientPemPath)\` -
Path to the client certificate file for mutual TLS (mTLS). Default: \`null\`.
- \`caPemPath(String caPemPath)\` -
Path to the CA certificate file for TLS verification. Default: \`null\`.
- \`serverPemPath(String serverPemPath)\` -
Path to the server certificate file for one-way TLS. Default: \`null\`.
- \`serverName(String serverName)\` -
The server name override for TLS certificate verification. Default: \`null\`.
- \`proxyAddress(String proxyAddress)\` -
HTTP proxy address for the gRPC connection. Default: \`null\`.
- \`option(Map<String, String> option)\` -
Arbitrary key-value pairs forwarded to the server in the \`ClientInfo.reserved\` field on connect. Useful for passing client-side metadata or feature flags that the server understands. Default: empty map.

## Example{#example}

\`\`\`java
import io.milvus.v2.client.ConnectConfig;
import io.milvus.v2.client.MilvusClientV2;

// Connect to a local Milvus instance
ConnectConfig config = ConnectConfig.builder()
    .uri("http://localhost:19530")
    .build();

// Connect to Zilliz Cloud with an API key
// ConnectConfig config = ConnectConfig.builder()
//     .uri("https://your-instance.zilliz.com")
//     .token("your-api-key")
//     .build();

MilvusClientV2 client = new MilvusClientV2(config);
\`\`\`
`,
    },
];

const VIRTUAL_NODE_TITLES = ['Collections', 'Management', 'Client', 'File Resources'];

async function phase0(writer) {
    console.log('\n═══ Phase 0: Verify v3.0.x bitable & drive state ═══\n');

    console.log('  Indexing bitable records…');
    const allRecords = await writer.listRecords({ pageSize: 500 });
    const funcRecords = allRecords.filter(r => r.fields['Type'] === 'Function');
    const vnRecords = allRecords.filter(r => r.fields['Type'] === 'VirtualNode');
    console.log(`    Total records:       ${allRecords.length}`);
    console.log(`    Function records:    ${funcRecords.length}`);
    console.log(`    VirtualNode records: ${vnRecords.length}`);
    console.log();

    if (allRecords.length < 100) {
        console.log(`  ⚠️ Bitable has only ${allRecords.length} records — expected >100 carry-forward. Aborting.`);
        process.exit(1);
    }

    // Function record title → record_id index
    const funcMap = new Map();
    for (const rec of funcRecords) {
        const text = rec.fields['Docs']?.text || '';
        const link = rec.fields['Docs']?.link || '';
        const docIdMatch = link.match(/\/docx\/([A-Za-z0-9]+)/);
        if (!funcMap.has(text)) funcMap.set(text, []);
        funcMap.get(text).push({
            record_id: rec.record_id,
            link,
            docId: docIdMatch ? docIdMatch[1] : null,
        });
    }

    // Class record title → record_id index (for ConnectConfig and similar)
    const classMap = new Map();
    for (const rec of allRecords.filter(r => r.fields['Type'] === 'Class')) {
        const text = rec.fields['Docs']?.text || '';
        const link = rec.fields['Docs']?.link || '';
        const docIdMatch = link.match(/\/docx\/([A-Za-z0-9]+)/);
        if (!classMap.has(text)) classMap.set(text, []);
        classMap.get(text).push({
            record_id: rec.record_id,
            link,
            docId: docIdMatch ? docIdMatch[1] : null,
        });
    }

    // VirtualNode title → record_id index (for parentRecordId resolution)
    console.log('  VirtualNode records found:');
    for (const rec of vnRecords) {
        const text = rec.fields['Docs']?.text || '';
        const link = rec.fields['Docs']?.link || '';
        PARENT_RECORDS[text] = rec.record_id;
        const linkSuffix = link ? link.replace('https://zilliverse.feishu.cn', '') : '(no link)';
        console.log(`    ${rec.record_id}  ${text.padEnd(28)} ${linkSuffix}`);
    }
    console.log();

    // Check VirtualNode coverage for the four target categories
    console.log('  VirtualNode coverage for Phase 1 targets:');
    for (const title of VIRTUAL_NODE_TITLES) {
        if (PARENT_RECORDS[title]) {
            console.log(`    ✅ ${title.padEnd(28)} ${PARENT_RECORDS[title]}`);
        } else {
            console.log(`    ➕ ${title.padEnd(28)} (will create in Phase 1)`);
        }
    }
    console.log();

    // Resolve UPDATE method record IDs
    console.log('  UPDATE method record IDs:');
    const updateResolutions = [];
    for (const m of STEP2_METHODS) {
        if (ONLY_METHOD && m.name !== ONLY_METHOD) continue;
        const sourceMap = m.recordType === 'Class' ? classMap : funcMap;
        const candidates = sourceMap.get(m.title) || [];
        let resolved = null;
        if (candidates.length > 0) {
            resolved = candidates[0];
        } else if (m.altTitles) {
            for (const alt of m.altTitles) {
                const altCands = sourceMap.get(alt) || [];
                if (altCands.length > 0) {
                    resolved = altCands[0];
                    m.title = alt;
                    break;
                }
            }
        }
        if (resolved) {
            console.log(`    ✅ ${m.title.padEnd(34)} record=${resolved.record_id}  doc=${resolved.docId || '?'}  type=${m.recordType}`);
            updateResolutions.push({ ...m, recordId: resolved.record_id, docId: resolved.docId });
        } else {
            console.log(`    ⚠️ ${m.title.padEnd(34)} (not found — UPDATE will be skipped)`);
        }
    }
    console.log();

    // Check drive folder
    console.log(`  Drive folder ${V30_FOLDER}:`);
    const children = await listFolderChildren(V30_FOLDER);
    console.log(`    ${children.length} child item(s)`);
    for (const c of children) {
        console.log(`    ${c.type.padEnd(6)} ${c.token}  ${c.name}`);
    }
    console.log();

    // Drop the resolutions onto the global STEP2 array so subsequent phases can reuse them
    global.__STEP2_RESOLUTIONS = updateResolutions;

    return { funcMap, vnRecords, updateResolutions, children };
}

// ============================================================
// Phase 1: Folders & VirtualNodes
// ============================================================

async function phase1(writer) {
    console.log('\n═══ Phase 1: Create v3.0.x category folders + re-point VirtualNodes ═══\n');

    const existingChildren = await listFolderChildren(V30_FOLDER);
    const existingByName = new Map(existingChildren.filter(c => c.type === 'folder').map(c => [c.name, c.token]));

    for (const cat of VIRTUAL_NODE_TITLES) {
        const existing = existingByName.get(cat);
        let folderToken = existing;
        if (existing) {
            console.log(`  ✅ ${cat.padEnd(28)} folder exists: ${existing}`);
        } else if (DRY_RUN) {
            folderToken = `<dry-run-${cat.toLowerCase().replace(/\s+/g, '-')}>`;
            console.log(`  [DRY RUN] would create folder ${cat.padEnd(20)} → ${folderToken}`);
        } else {
            const result = await createFolder(cat, V30_FOLDER);
            folderToken = result.token;
            console.log(`  ➕ ${cat.padEnd(28)} folder created: ${folderToken}`);
            await delay();
        }
        FOLDER_TOKENS[cat] = folderToken;

        const newFolderUrl = `${FEISHU_DOCX_HOST}/drive/folder/${folderToken}`;
        const vnRecordId = PARENT_RECORDS[cat];

        if (vnRecordId) {
            if (DRY_RUN) {
                console.log(`    [DRY RUN] would update VirtualNode ${vnRecordId} → ${newFolderUrl}`);
            } else {
                await writer.updateRecord(vnRecordId, {
                    title: cat,
                    link: newFolderUrl,
                    lastModified: 'v3.0.x',
                });
                console.log(`    Re-pointed VirtualNode ${vnRecordId} → ${newFolderUrl}`);
                await delay();
            }
        } else {
            // New VirtualNode (e.g., File Resources). Sits at the top level alongside
            // Collections/Management/Client (no parent record).
            if (DRY_RUN) {
                console.log(`    [DRY RUN] would create new top-level VirtualNode for ${cat}`);
            } else {
                const rec = await writer.createRecord({
                    title: cat,
                    link: newFolderUrl,
                    type: 'VirtualNode',
                    addedSince: 'v3.0.x',
                    targets: 'milvus-sdk-java',
                });
                PARENT_RECORDS[cat] = rec.record_id;
                console.log(`    Created VirtualNode ${rec.record_id} for ${cat}`);
                await delay();
            }
        }
    }
    console.log();

    // Second pass: lazily create class subfolders for any method whose
    // bitable parent is a Class record. Walks all STEP arrays — including
    // STEP2_METHODS_EXECUTED which is the historical record kept so future
    // re-runs and Class-doc placement (via folderKeyFor) stay correct.
    const classFolderPairs = new Map(); // key=`${cat}/${cls}` → { cat, cls }
    for (const m of [...STEP2_METHODS, ...STEP2_METHODS_EXECUTED, ...STEP3_METHODS]) {
        if (!m.parentClass) continue;
        const key = `${m.category}/${m.parentClass}`;
        if (!classFolderPairs.has(key)) classFolderPairs.set(key, { cat: m.category, cls: m.parentClass });
    }
    if (classFolderPairs.size > 0) {
        console.log(`  Class subfolders required: ${classFolderPairs.size}`);
        for (const [key, { cat, cls }] of classFolderPairs) {
            const parentToken = FOLDER_TOKENS[cat];
            if (!parentToken) {
                console.log(`    ❌ ${key}: parent category folder ${cat} missing — skipping`);
                continue;
            }
            const subChildren = await listFolderChildren(parentToken);
            const existingSub = subChildren.find(c => c.type === 'folder' && c.name === cls);
            if (existingSub) {
                FOLDER_TOKENS[key] = existingSub.token;
                console.log(`  ✅ ${key.padEnd(40)} folder exists: ${existingSub.token}`);
            } else if (DRY_RUN) {
                FOLDER_TOKENS[key] = `<dry-run-${cat.toLowerCase().replace(/\s+/g, '-')}-${cls.toLowerCase()}>`;
                console.log(`  [DRY RUN] would create class subfolder ${key} → ${FOLDER_TOKENS[key]}`);
            } else {
                const result = await createFolder(cls, parentToken);
                FOLDER_TOKENS[key] = result.token;
                console.log(`  ➕ ${key.padEnd(40)} folder created: ${result.token}`);
                await delay();
            }
        }
        console.log();
    }

    console.log('  Final FOLDER_TOKENS:');
    for (const [k, v] of Object.entries(FOLDER_TOKENS)) console.log(`    '${k}': '${v}',`);
    console.log('  Final PARENT_RECORDS for v3.0 categories:');
    for (const cat of VIRTUAL_NODE_TITLES) console.log(`    '${cat}': '${PARENT_RECORDS[cat] || '(none)'}',`);
}

// ============================================================
// Phase 2: UPDATE
// ============================================================

async function phase2(m2f, writer) {
    console.log('\n═══ Phase 2: UPDATE existing Function docs ═══\n');

    const resolutions = global.__STEP2_RESOLUTIONS || [];
    if (resolutions.length === 0) {
        console.log('  No resolutions from Phase 0. Re-run with --phase=0 first.');
        return;
    }

    console.log('  Scanning Java SDK source…');
    const scanner = new JavaScanner({
        rootDir: path.resolve(__dirname, '../../../../repos/milvus-sdk-java/sdk-core/src/main/java/io/milvus'),
        publicOnly: true,
    });
    const symbols = await scanner.scan();
    console.log(`  Scanned ${symbols.length} symbols\n`);

    for (const m of resolutions) {
        if (ONLY_METHOD && m.name !== ONLY_METHOD) continue;
        console.log(`  ${m.category}/${m.name}  (record=${m.recordId})`);

        let markdown;
        let summary;

        if (m.markdown) {
            // Hand-authored markdown literal (used for Class docs and any custom case).
            markdown = m.markdown;
            summary = `hand-authored markdown (${markdown.length} chars)`;
        } else {
            // Scanner-based regeneration (Function docs).
            const symbol = symbols.find(s => s.name === m.name);
            if (!symbol) {
                console.log(`    ⚠️ Symbol not found in scanner. Skipping.`);
                continue;
            }
            let docContent = { description: '', exampleCode: '', returnsDescription: '' };
            if (m.docId) {
                try {
                    docContent = await fetchDocContent(m.docId);
                    await delay(300);
                } catch (e) {
                    console.log(`    ⚠️ Could not fetch v2.6 doc ${m.docId}: ${e.message}`);
                }
            }
            markdown = generateMethodMarkdown(symbol, docContent);
            summary = `desc='${(docContent.description || '').substring(0, 60)}…' fields=${symbol.params.length}`;
        }

        const folderKey = folderKeyFor(m);
        const folderToken = FOLDER_TOKENS[folderKey];
        if (!folderToken) {
            console.log(`    ❌ No folder token for ${folderKey}. Run Phase 1 first.`);
            continue;
        }

        if (DRY_RUN) {
            console.log(`    [DRY RUN] would push to folder ${folderToken} and update record ${m.recordId}`);
            console.log(`    ${summary}`);
            continue;
        }

        const docResult = await m2f.push_markdown({
            markdown_content: markdown,
            title: m.title,
            folder_token: folderToken,
        });
        console.log(`    New doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);

        const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
        await writer.updateRecord(m.recordId, {
            title: m.title,
            link: docLink,
            lastModified: 'v3.0.x',
        });
        console.log(`    Record ${m.recordId} → ${docLink}`);
        await delay();
    }
}

// ============================================================
// Phase 3: CREATE
// ============================================================

const STEP3_METHODS = [
    {
        name: 'refreshExternalCollection',
        title: 'refreshExternalCollection()',
        category: 'Management',
        description: 'Triggers a refresh job that pulls data from an external source into a Milvus collection.',
        markdown: `Triggers a refresh job that pulls data from an external source into a Milvus collection. Returns a job ID that can be passed to \`getRefreshExternalCollectionProgress()\` to track progress.

\`\`\`java
public RefreshExternalCollectionResp refreshExternalCollection(RefreshExternalCollectionReq request)
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`java
refreshExternalCollection(RefreshExternalCollectionReq.builder()
    .databaseName(String databaseName)
    .collectionName(String collectionName)
    .externalSource(String externalSource)
    .externalSpec(JsonObject externalSpec)
    .build()
);
\`\`\`

**BUILDER METHODS:**

- \`databaseName(String databaseName)\` -
The name of the database. Defaults to the current database if not specified.
- \`collectionName(String collectionName)\` -
**[REQUIRED]**
The name of the collection to refresh.
- \`externalSource(String externalSource)\` -
The external data source identifier (e.g., \`"s3"\`, \`"oss"\`).
- \`externalSpec(JsonObject externalSpec)\` -
A JSON object describing the external storage configuration. Fields depend on \`externalSource\` (typically include \`endpoint\`, \`bucket\`, \`path\`, credentials).

**RETURNS:**

*RefreshExternalCollectionResp*

The response carries a single field:

- \`jobId\` (*long*) - The numeric ID of the newly started refresh job. Persist this value to query progress with \`getRefreshExternalCollectionProgress()\`.

**EXCEPTIONS:**

- **MilvusClientException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`java
import com.google.gson.JsonObject;
import io.milvus.v2.service.utility.request.RefreshExternalCollectionReq;
import io.milvus.v2.service.utility.response.RefreshExternalCollectionResp;

JsonObject spec = new JsonObject();
spec.addProperty("endpoint", "https://s3.amazonaws.com");
spec.addProperty("bucket", "my-bucket");
spec.addProperty("path", "data/snapshots/2026-05-01/");

RefreshExternalCollectionResp resp = client.refreshExternalCollection(
    RefreshExternalCollectionReq.builder()
        .collectionName("my_collection")
        .externalSource("s3")
        .externalSpec(spec)
        .build()
);
long jobId = resp.getJobId();
System.out.println("Started refresh job: " + jobId);
\`\`\`
`,
    },
    {
        name: 'getRefreshExternalCollectionProgress',
        title: 'getRefreshExternalCollectionProgress()',
        category: 'Management',
        description: 'Returns the progress and current state of a previously started external collection refresh job.',
        markdown: `Returns the progress and current state of a previously started external collection refresh job.

\`\`\`java
public GetRefreshExternalCollectionProgressResp getRefreshExternalCollectionProgress(GetRefreshExternalCollectionProgressReq request)
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`java
getRefreshExternalCollectionProgress(GetRefreshExternalCollectionProgressReq.builder()
    .jobId(long jobId)
    .build()
);
\`\`\`

**BUILDER METHODS:**

- \`jobId(long jobId)\` -
**[REQUIRED]**
The job ID returned by \`refreshExternalCollection()\`.

**RETURNS:**

*GetRefreshExternalCollectionProgressResp*

The response wraps a single \`RefreshExternalCollectionJobInfo\` accessible via \`getJobInfo()\`. Fields on the job info:

- \`jobId\` (*long*) - The job identifier.
- \`collectionName\` (*String*) - The target collection name.
- \`state\` (*String*) - The current job state (e.g., \`"PENDING"\`, \`"RUNNING"\`, \`"SUCCEEDED"\`, \`"FAILED"\`).
- \`progress\` (*int*) - The completion percentage (0–100).
- \`reason\` (*String*) - Failure reason if \`state\` is \`"FAILED"\`; empty otherwise.
- \`externalSource\` (*String*) - The external source used by the job.
- \`startTime\` (*long*) - The job start timestamp (epoch milliseconds).
- \`endTime\` (*long*) - The job end timestamp (epoch milliseconds), or 0 if still running.

**EXCEPTIONS:**

- **MilvusClientException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`java
import io.milvus.v2.service.utility.request.GetRefreshExternalCollectionProgressReq;
import io.milvus.v2.service.utility.response.GetRefreshExternalCollectionProgressResp;
import io.milvus.v2.service.utility.response.RefreshExternalCollectionJobInfo;

GetRefreshExternalCollectionProgressResp resp = client.getRefreshExternalCollectionProgress(
    GetRefreshExternalCollectionProgressReq.builder()
        .jobId(jobId)
        .build()
);
RefreshExternalCollectionJobInfo info = resp.getJobInfo();
System.out.println(info.getState() + " " + info.getProgress() + "%");
\`\`\`
`,
    },
    {
        name: 'listRefreshExternalCollectionJobs',
        title: 'listRefreshExternalCollectionJobs()',
        category: 'Management',
        description: 'Lists all external-collection refresh jobs, optionally filtered by collection name.',
        markdown: `Lists all external-collection refresh jobs, optionally filtered by collection name.

\`\`\`java
public ListRefreshExternalCollectionJobsResp listRefreshExternalCollectionJobs(ListRefreshExternalCollectionJobsReq request)
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`java
listRefreshExternalCollectionJobs(ListRefreshExternalCollectionJobsReq.builder()
    .databaseName(String databaseName)
    .collectionName(String collectionName)
    .build()
);
\`\`\`

**BUILDER METHODS:**

- \`databaseName(String databaseName)\` -
The name of the database. Defaults to the current database if not specified.
- \`collectionName(String collectionName)\` -
The collection name to filter by. If empty, jobs across all collections in the database are returned.

**RETURNS:**

*ListRefreshExternalCollectionJobsResp*

The response wraps \`List<RefreshExternalCollectionJobInfo>\` accessible via \`getJobs()\`. Each job info entry exposes \`jobId\`, \`collectionName\`, \`state\`, \`progress\`, \`reason\`, \`externalSource\`, \`startTime\`, and \`endTime\` — the same shape as the entry returned by \`getRefreshExternalCollectionProgress()\`.

**EXCEPTIONS:**

- **MilvusClientException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`java
import io.milvus.v2.service.utility.request.ListRefreshExternalCollectionJobsReq;
import io.milvus.v2.service.utility.response.ListRefreshExternalCollectionJobsResp;
import io.milvus.v2.service.utility.response.RefreshExternalCollectionJobInfo;

ListRefreshExternalCollectionJobsResp resp = client.listRefreshExternalCollectionJobs(
    ListRefreshExternalCollectionJobsReq.builder()
        .collectionName("my_collection")
        .build()
);
for (RefreshExternalCollectionJobInfo job : resp.getJobs()) {
    System.out.println(job.getJobId() + " " + job.getState());
}
\`\`\`
`,
    },
    {
        name: 'addFileResource',
        title: 'addFileResource()',
        category: 'File Resources',
        description: 'Uploads a local file as a named resource so it can be referenced by other Milvus operations.',
        markdown: `Uploads a local file as a named resource so it can be referenced by other Milvus operations (e.g., functions, analyzers). Names are unique per database — re-using a name overwrites the existing resource.

\`\`\`java
public void addFileResource(AddFileResourceReq request)
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`java
addFileResource(AddFileResourceReq.builder()
    .name(String name)
    .path(String path)
    .build()
);
\`\`\`

**BUILDER METHODS:**

- \`name(String name)\` -
**[REQUIRED]**
The unique name of the file resource.
- \`path(String path)\` -
**[REQUIRED]**
The local filesystem path of the file to upload.

**RETURNS:**

*void*

**EXCEPTIONS:**

- **MilvusClientException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`java
import io.milvus.v2.service.utility.request.AddFileResourceReq;

client.addFileResource(AddFileResourceReq.builder()
    .name("stopwords")
    .path("/data/stopwords-en.txt")
    .build());
\`\`\`
`,
    },
    {
        name: 'removeFileResource',
        title: 'removeFileResource()',
        category: 'File Resources',
        description: 'Removes a previously uploaded file resource by name.',
        markdown: `Removes a previously uploaded file resource by name. Removing a resource that is still referenced by an active function or analyzer fails with an error.

\`\`\`java
public void removeFileResource(RemoveFileResourceReq request)
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`java
removeFileResource(RemoveFileResourceReq.builder()
    .name(String name)
    .build()
);
\`\`\`

**BUILDER METHODS:**

- \`name(String name)\` -
**[REQUIRED]**
The name of the file resource to remove.

**RETURNS:**

*void*

**EXCEPTIONS:**

- **MilvusClientException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`java
import io.milvus.v2.service.utility.request.RemoveFileResourceReq;

client.removeFileResource(RemoveFileResourceReq.builder()
    .name("stopwords")
    .build());
\`\`\`
`,
    },
    {
        name: 'listFileResources',
        title: 'listFileResources()',
        category: 'File Resources',
        description: 'Lists all uploaded file resources in the current database.',
        markdown: `Lists all uploaded file resources in the current database.

\`\`\`java
public ListFileResourcesResp listFileResources(ListFileResourcesReq request)
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`java
listFileResources(ListFileResourcesReq.builder().build());
\`\`\`

This request takes no parameters.

**RETURNS:**

*ListFileResourcesResp*

The response wraps \`List<FileResourceInfo>\` accessible via \`getResources()\`. Each \`FileResourceInfo\` entry has:

- \`name\` (*String*) - The unique name of the resource.
- \`path\` (*String*) - The original local path that was uploaded.

**EXCEPTIONS:**

- **MilvusClientException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`java
import io.milvus.v2.service.utility.request.ListFileResourcesReq;
import io.milvus.v2.service.utility.response.ListFileResourcesResp;
import io.milvus.v2.service.utility.response.FileResourceInfo;

ListFileResourcesResp resp = client.listFileResources(
    ListFileResourcesReq.builder().build()
);
for (FileResourceInfo res : resp.getResources()) {
    System.out.println(res.getName() + " → " + res.getPath());
}
\`\`\`
`,
    },
];

async function phase3(m2f, writer) {
    console.log('\n═══ Phase 3: CREATE 6 new MilvusClientV2 method docs ═══\n');

    for (const m of STEP3_METHODS) {
        if (ONLY_METHOD && m.name !== ONLY_METHOD) continue;
        const folderKey = folderKeyFor(m);
        const folderToken = FOLDER_TOKENS[folderKey];
        const parentRecordId = PARENT_RECORDS[m.parentClass || m.category];
        if (!folderToken || !parentRecordId) {
            console.log(`  ❌ ${m.name}: missing folder/VN for ${folderKey}. Run Phase 1.`);
            continue;
        }
        console.log(`  ${m.category}/${m.name}`);

        if (DRY_RUN) {
            console.log(`    [DRY RUN] would push doc to ${folderToken} and create record under ${parentRecordId}`);
            continue;
        }

        const docResult = await m2f.push_markdown({
            markdown_content: m.markdown,
            title: m.title,
            folder_token: folderToken,
        });
        console.log(`    Doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);

        const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
        const record = await writer.createRecord({
            title: m.title,
            link: docLink,
            type: 'Function',
            addedSince: 'v3.0.x',
            description: m.description,
            targets: 'milvus-sdk-java',
            parentRecordId,
        });
        console.log(`    Record: ${record.record_id}`);
        await delay();
    }
}

// ============================================================
// Phase 4: post-actions
// ============================================================

async function phase4() {
    console.log('\n═══ Phase 4: Post-actions (run separately for safety) ═══\n');
    console.log('  Run these manually:');
    console.log(`    node .claude/skills/sdk-doc-sync/scripts/add-type-links.js --bitable ${BITABLE_TOKEN} --dry-run`);
    console.log(`    node .claude/skills/sdk-doc-sync/scripts/fix-leading-spaces.js --bitable ${BITABLE_TOKEN} --dry-run`);
    console.log(`    node .claude/skills/sdk-doc-sync/scripts/post-fix-links.js --bitable ${BITABLE_TOKEN} --dry-run`);
}

// ============================================================
// Main
// ============================================================

async function main() {
    if (DRY_RUN) console.log('  *** DRY RUN MODE ***\n');

    const m2f = new MarkdownToFeishu({ sourceType: 'drive' });
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    if (ONLY_PHASE === '0') {
        await phase0(writer);
    } else if (ONLY_PHASE === '1') {
        await phase0(writer);
        await phase1(writer);
    } else if (ONLY_PHASE === '2') {
        await phase0(writer);
        // Phase 2 needs FOLDER_TOKENS populated. In a fresh run, Phase 1 must run first.
        // If the folders already exist (re-run scenario), populate FOLDER_TOKENS from drive,
        // including class subfolders nested one level under each category folder.
        await populateFolderTokensFromDrive();
        await phase2(m2f, writer);
    } else if (ONLY_PHASE === '3') {
        await phase0(writer);
        await populateFolderTokensFromDrive();
        await phase3(m2f, writer);
    } else if (ONLY_PHASE === 'all') {
        await phase0(writer);
        await phase1(writer);
        await phase2(m2f, writer);
        await phase3(m2f, writer);
    } else if (ONLY_PHASE === '4') {
        await phase4();
    } else {
        console.log(`Unknown phase ${ONLY_PHASE}. Valid: 0, 1, 2, 3, 4, all`);
    }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
