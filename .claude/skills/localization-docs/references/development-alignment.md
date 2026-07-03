# Development Alignment Reference

Use this file when aligning the Global `Development` table to the Chinese `开发指南` table.

## Table Pair

| Role | Base token | Table ID | Wiki root |
|---|---|---|---|
| Global source | `Ac7xbs2k1ad7bjsCXr0ccHe9nMh` | `tblWv7PjNDsexddH` | `OUWXw5c4gia34ZkQUcEcMFbWn6s` |
| Chinese target | `I6YUb1M0JajHrqsJGcLcZNh7neP` | `tblYpqCgevikMomb` | `XyeFwdx6kiK9A6kq3yIcLNdEnDd` |

## Status Snapshot

Last full metadata pass:

- Chinese table total: `178` records.
- Full-table verification after fill: `0` Chinese records with missing required metadata.
- Updated fields only: `Slug`, `Labels`, `Placement Type`, `Targets`, `Keywords`, `Progress`, `Notebook`, `Beta`.
- No document links or wiki content were changed during the metadata fill.

## Required Metadata

For every row:

- `Slug`
- `Labels`
- `Placement Type`

For canonical rows:

- `Targets`
- `Keywords`
- `Progress`
- `Notebook`
- `Beta`

Section rows intentionally do not require canonical-only metadata.

## Matching Strategy

1. Match target rows by exact `Slug` if present.
2. Match by exact title when Global and Chinese titles are the same.
3. For translated titles, use the override table below.
4. If a row is still unmapped, match by parent section and order only after checking the parent section slug.
5. Preserve target `Docs` links and parent links unless the user explicitly asks to move or recreate docs.
6. Fill only blank metadata fields unless the user explicitly asks for a re-sync/overwrite.

## Chinese SaaS Exceptions

Do not add or align these Global-only docs to Chinese SaaS:

- `OpenAI`
- `Voyage AI`
- `Cohere`
- `Cohere Ranker`
- `Voyage AI Ranker`
- `Integrate with AWS S3`
- `Integrate with Google Cloud Storage`
- `Integrate with Azure Blob Storage`

Chinese-specific valid equivalents:

| Chinese target title | Target slug | Notes |
|---|---|---|
| `硅基流动` | `siliconflow` | Chinese SaaS text embedding provider equivalent. |
| `硅基流动 Ranker` | `siliconflow-model-ranker` | Chinese SaaS model-ranker equivalent. |
| `阿里云对象存储` | `integrate-with-alibaba-cloud-oss` | Chinese SaaS storage integration. |
| `Amazon S3` | `integrate-with-amazon-s3-cn` | Chinese SaaS storage integration. |

## Created Localized Docs

| Global title | Chinese title | Chinese wiki URL | Target slug |
|---|---|---|---|
| `Connect to Serving Clusters` | `连接到 Serving 集群` | `https://zilliverse.feishu.cn/wiki/BPy2wUkRkiVfDjkdIB7cKiYSnud` | `connect-to-serving-cluster` |
| `Connect for On-Demand Search` | `连接按需搜索` | `https://zilliverse.feishu.cn/wiki/Mj2bw4KFYikkOJkLCOtcDQn0nph` | `connect-for-on-demand-search` |

## Title Overrides

Use these mappings before order-based matching.

| Chinese title | Global title |
|---|---|
| `搜索与查询` | `Search & Query` |
| `向量索引` | `Vector Index` |
| `标量索引` | `Scalar Index` |
| `插入与删除` | `Insert & Delete` |
| `数据导入` | `Data Import` |
| `数据导出` | `Data Export` |
| `Analyzer 概述` | `Analyzer Overview` |
| `内置 Analyzer 参考` | `Built-in Analyzers` |
| `分词器参考` | `Tokenizers` |
| `过滤器参考` | `Analyzer Filters` |
| `多语言 Analyzer` | `Multi-language Analyzers` |
| `最佳实践：如何选择合适的 Analyzer` | `Choose the Right Analyzer for Your Use Case` |
| `管理文件资源` | `Manage File Resources` |
| `Function 概述` | `Function Overview` |
| `Text Embedding Function` | `Text Embedding Functions` |
| `Reranking Function` | `Reranking Functions` |
| `Hybrid Search Reranker` | `Hybrid Search Rerankers` |
| `Rule-based Reranker` | `Rule-based Rerankers` |
| `Model Reranker` | `Model-based Rerankers` |
| `Decay Reranker` | `Decay Rankers` |
| `Decay Ranker 概述` | `Decay Ranker Overview` |
| `高斯衰减` | `Gaussian Decay` |
| `指数衰减` | `Exponential Decay` |
| `线性衰减` | `Linear Decay` |
| `教程：实现基于时间的排序` | `Tutorial: Implement Time-based Ranking` |
| `使用 Iterator 导出数据` | `Export Data Using Iterators` |
| `支持的对象存储` | `Storage Options` |
| `支持的数据格式` | `Format Options` |
| `转换数据` | `Convert Your Data` |
| `导入数据` | `Import Data` |
| `数据导入指南` | `Data Import Hands-On` |
| `从 Parquet 文件中导入（推荐）` | `Import from a Parquet File` |
| `从 JSON/JSON Lines 文件中导入` | `Import from a JSON/JSON Lines File` |
| `从 NumPy 文件中导入` | `Import from NumPy Files` |
| `使用 BulkWriter` | `Use BulkWriter` |
| `通过 Web 控制台导入` | `Import Data (Console)` |
| `通过 RESTful API 导入` | `Import Data (RESTful API)` |
| `通过 SDK 导入` | `Import Data (SDK)` |
| `插入 Entity` | `Insert Entities` |
| `Upsert Entity` | `Upsert Entities` |
| `统计 Entity 数量` | `Count Entities` |
| `删除 Entity` | `Delete Entities` |
| `AUTOINDEX` | `AUTOINDEX Explained` |
| `调整索引构建级别` | `Tune Index Build Level` |
| `了解 Schema` | `Schema Explained` |
| `主键与 AutoID` | `Primary Field & AutoID` |
| `稠密向量` | `Dense Vector` |
| `Binary 向量` | `Binary Vector` |
| `稀疏向量` | `Sparse Vector` |
| `VarChar 类型` | `VarChar Field` |
| `Text 类型` | `Text Field` |
| `布尔与数值类型` | `Boolean & Number` |
| `JSON 类型` | `JSON Field` |
| `JSON 概述` | `JSON Field Overview` |
| `JSON 索引` | `JSON Indexing` |
| `Array 类型` | `Array Field` |
| `Geometry 类型` | `Geometry Field` |
| `TIMESTAMPTZ 类型` | `TIMESTAMPTZ Field` |
| `Nullable 属性` | `Nullable Fields` |
| `默认值` | `Default Values` |
| `修改字段设置` | `Alter Collection Field` |
| `修改 Collection Schema` | `Alter Collection Schema` |
| `最佳实践` | `Best Practices for Schema Design` |
| `Schema 设计指南` | `Data Model Design for Search` |
| `使用 Struct Array 进行 Schema 设计` | `Data Model Design with an Array of Structs` |
| `StructArray 概述` | `StructArray Overview` |
| `创建 StructArray Field` | `Create a StructArray Field` |
| `StructArray 限制` | `StructArray Limits` |
| `向 StructArray Field 插入数据` | `Insert Data into StructArray Fields` |
| `为 StructArray Field 创建 Index` | `Index StructArray Fields` |
| `了解 Collection` | `Collection Explained` |
| `创建 Collection` | `Create a Collection` |
| `创建 External Collection` | `Create an External Collection` |
| `查看 Collection` | `View Collections` |
| `修改 Collection` | `Modify Collection` |
| `设置 Collection 生存时间` | `Set Collection TTL` |
| `使用大 TopK` | `Use Large TopK` |
| `Load 和 Release` | `Load & Release` |
| `管理 Partition` | `Manage Partitions` |
| `管理 Alias` | `Manage Aliases` |
| `删除 Collection` | `Drop Collection` |
| `在控制台管理 Collection` | `Manage Collection on Console` |
| `管理 Collection (控制台)` | `Manage Collections (Console)` |
| `管理 External Collection` | `Manage External Collections (Console)` |
| `External Collection 限制` | `External Collection Limits` |
| `按需计算中的 Database` | `Database for On-Demand Search` |
| `Serving 集群中的 Database` | `Database in Serving Clusters` |
| `管理 Snapshot` | `Manage Snapshots` |
| `基本 Vector Search` | `Basic Vector Search` |
| `召回调优` | `Tune Recall Rate` |
| `多向量混合搜索` | `Multi-Vector Hybrid Search` |
| `过滤表达式` | `Filtering` |
| `过滤表达式概览` | `Filtering Explained` |
| `基本操作符` | `Basic Operators` |
| `模式匹配` | `Pattern Matching` |
| `过滤表达式模板` | `Filter Templating` |
| `JSON 操作符` | `JSON Operators` |
| `ARRAY 操作符` | `ARRAY Operators` |
| `StructArray 操作符` | `StructArray Operators` |
| `随机采样` | `Random Sampling` |
| `使用 StructArray 搜索` | `Search with StructArray` |
| `使用 StructArray 进行 Basic Vector Search` | `Basic Vector Search with StructArray` |
| `使用 StructArray 进行 Filtered Search` | `Filtered Search with StructArray` |
| `使用 StructArray 进行 Range Search` | `Range Search with StructArray` |
| `使用 StructArray 进行 Grouping Search` | `Grouping Search with StructArray` |
| `使用 StructArray 进行 Hybrid Search` | `Hybrid Search with StructArray` |
| `使用 EmbeddingList 搜索：ColBERT 和 ColPali` | `Search with EmbeddingLists: ColBERT and ColPali` |
| `Elasticsearch 查询语句转换` | `Elasticsearch Queries to Milvus` |
| `使用 Partition Key` | `Use Partition Key` |
| `使用 mmap` | `Use mmap` |
| `一致性水平` | `Consistency Level` |
| `相似度类型` | `Metric Types` |
| `按需 DQL 操作` | `On-Demand DQL Operations` |

## Verification Commands

Inspect all records, not just a view:

```bash
lark-cli base +record-list --base-token Ac7xbs2k1ad7bjsCXr0ccHe9nMh --table-id tblWv7PjNDsexddH --limit 500 --as user --format json
lark-cli base +record-list --base-token I6YUb1M0JajHrqsJGcLcZNh7neP --table-id tblYpqCgevikMomb --limit 500 --as user --format json
```

When checking completeness, count missing target metadata across the full target table, not the visible view.
