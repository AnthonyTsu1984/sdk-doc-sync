# SDK Alignment Report

Generated: 2026-03-04  
Baseline: Python MilvusClient — 93 methods, 203 parameters

## Method Coverage

| Interface | Category | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| CreateCollection | Collections | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | C++ requires full CollectionSchema; simple overload (name+dim) is CreateSimpleCollection. |
| CreateIndex | Management | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go/C++ use a single index object instead of index_params list. |
| Insert | Vector | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go uses Row/Column API (no direct data param). C++ uses row_data/column_data instead of data. |
| Upsert | Vector | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go uses Row/Column API. C++ uses row_data/column_data instead of data. |
| HybridSearch | Vector | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | REST path: /entities/advanced_search. Python reqs → Java: search_requests, Go: ann_requests, C++: requests. Java uses out_fields; Go uses reranker; C++ uses rerank. |
| Search | Vector | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go: vectors (not data), search_param (singular), partitions (not partition_names), ann_field. C++ uses ann_field, emb_list/emb_lists, output_field_names. Node uses expr (not filter). |
| Query | Vector | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go uses partitions (not partition_names) and i_ds (not ids). C++ uses output_field_names. |
| QueryIterator | Vector | ✓ | ✓ | ✓ | ✓ | ✓ | - | 5 | Streaming cursor pattern. Java uses expr (not filter). No REST equivalent. |
| SearchIterator | Vector | ✓ | ✓ | ✓ | ✓ | ✓ | - | 5 | Streaming cursor pattern. Java uses expr and vectors. Go uses ann_param, search_param (singular), partitions. No REST equivalent. |
| Get | Vector | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Java uses partition_name (singular); Go uses i_ds; C++: id_array; REST: id (singular). |
| Delete | Vector | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go uses expr (not filter) and int64_i_ds/string_i_ds (not ids) and partition (singular). |
| GetCollectionStats | Collections | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Node uses getCollectionStatistics(). |
| DescribeCollection | Collections | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| HasCollection | Collections | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| ListCollections | Collections | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| DropCollection | Collections | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| TruncateCollection | Collections | ✓ | - | - | - | - | - | 1 | Python-only. |
| RenameCollection | Collections | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Java/Node/REST use collection_name/new_collection_name; Python uses old_name/new_name. |
| Close | Client | ✓ | ✓ | - | ✓ | - | - | 3 | Node uses closeConnection(); C++ uses Disconnect(). |
| LoadCollection | Collections | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Java: num_replicas; Go: replica (singular); C++: replica_num. |
| ReleaseCollection | Collections | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| GetLoadState | Collections | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go/Node/C++ use partition_names (plural); Python uses partition_name (singular). |
| RefreshLoad | Management | ✓ | ✓ | ✓ | ✓ | - | ✓ | 5 | C++ not supported. |
| ListIndexes | Management | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| DropIndex | Management | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| DescribeIndex | Management | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| AlterIndexProperties | Management | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go uses property (singular) instead of properties. |
| DropIndexProperties | Management | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go uses keys; C++: key/keys; Node uses properties instead of property_keys. |
| AlterCollectionProperties | Collections | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go uses collection (not collection_name) and property (singular). |
| DropCollectionProperties | Collections | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go uses collection (not collection_name); C++: key/keys; Node: properties. |
| AlterCollectionField | Collections | ✓ | ✓ | - | - | - | ✓ | 3 | Go and Node not supported. Java uses properties instead of field_params. |
| AddCollectionField | Collections | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Python takes individual fields (field_name, data_type, desc); Java/Go/C++/Node/REST take a schema/field object. |
| AddCollectionFunction | Collections | ✓ | ✓ | ✓ | - | - | ✓ | 4 | Go and C++ not supported. |
| AlterCollectionFunction | Collections | ✓ | ✓ | ✓ | - | - | ✓ | 4 | Go and C++ not supported. |
| DropCollectionFunction | Collections | ✓ | ✓ | ✓ | - | - | ✓ | 4 | Go and C++ not supported. |
| CreatePartition | Partitions | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| DropPartition | Partitions | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| HasPartition | Partitions | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| ListPartitions | Partitions | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| LoadPartitions | Partitions | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| ReleasePartitions | Partitions | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| GetPartitionStats | Partitions | ✓ | ✓ | - | ✓ | - | ✓ | 4 |  |
| CreateUser | Authentication | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Node: username (no underscore); C++: name instead of user_name. |
| DropUser | Authentication | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Node: username; C++: name instead of user_name. |
| UpdatePassword | Authentication | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Java/REST use password for old_password. Node uses username/oldPassword/newPassword. C++: name. |
| ListUsers | Authentication | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| DescribeUser | Authentication | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Node: username; C++: name instead of user_name. |
| GrantRole | Authentication | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | C++ takes single name param. Node uses username/roleName (camelCase). |
| RevokeRole | Authentication | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | C++ takes single name param. Node uses username/roleName (camelCase). |
| CreateRole | Authentication | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | C++ uses name instead of role_name. Node uses roleName (camelCase). |
| DropRole | Authentication | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | C++ uses name. Node uses roleName (camelCase). Go drop not found in scan. |
| DescribeRole | Authentication | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | C++ uses name. Node uses roleName (camelCase). |
| ListRoles | Authentication | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| GrantPrivilege | Authentication | ✓ | ✓ | ✓ | ✓ | - | ✓ | 5 | Go uses privilege_name instead of privilege. C++ supports V2 API only. Node uses object/privilegeName. |
| RevokePrivilege | Authentication | ✓ | ✓ | ✓ | ✓ | - | ✓ | 5 | Go uses privilege_name instead of privilege. C++ supports V2 API only. Node uses object/privilegeName. |
| GrantPrivilegeV2 | Authentication | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go uses privilege_name. Node uses role (not role_name). |
| RevokePrivilegeV2 | Authentication | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go uses privilege_name. Node uses role (not role_name). |
| CreateAlias | Collections | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | REST uses alias_name instead of alias. |
| DropAlias | Collections | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | REST uses alias_name instead of alias. |
| AlterAlias | Collections | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | REST uses alias_name instead of alias. |
| DescribeAlias | Collections | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | REST uses alias_name instead of alias. |
| ListAliases | Collections | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| UseDatabase | Database | ✓ | ✓ | ✓ | ✓ | ✓ | - | 5 | REST uses per-request dbName parameter instead of connection-level state. Java/Node/Go use connection-level db setting. |
| CreateDatabase | Database | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Java uses database_name (consistent across all Java methods). Go uses property (singular). |
| DropDatabase | Database | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| ListDatabases | Database | ✓ | ✓ | ✓ | - | ✓ | ✓ | 5 |  |
| DescribeDatabase | Database | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| AlterDatabaseProperties | Database | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | REST path: /databases/alter. Java: database_name; Go: property (singular). |
| DropDatabaseProperties | Database | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Java: database_name; C++: key/keys; Node: properties instead of property_keys. |
| Flush | Management | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Python flushes single collection_name; Java/Node take collection_names (list); Go uses coll_name; C++ uses name/names. |
| Compact | Management | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | C++ uses clustering_compaction instead of is_clustering. |
| GetCompactionState | Management | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Java/Go/Node use compaction_id; C++ uses id. |
| GetServerVersion | Client | ✓ | ✓ | - | ✓ | ✓ | - | 4 | Node uses getVersion(). REST not supported. |
| CreatePrivilegeGroup | Authentication | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | C++ uses name; REST uses privilege_group_name instead of group_name. |
| DropPrivilegeGroup | Authentication | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | C++ uses name; REST uses privilege_group_name instead of group_name. |
| ListPrivilegeGroups | Authentication | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| AddPrivilegesToGroup | Authentication | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | C++ uses name; REST uses privilege_group_name instead of group_name. |
| RemovePrivilegesFromGroup | Authentication | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | C++ uses name; REST uses privilege_group_name instead of group_name. |
| CreateResourceGroup | ResourceGroup | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Java uses group_name instead of name. |
| UpdateResourceGroups | ResourceGroup | ✓ | ✓ | ✓ | - | ✓ | ✓ | 5 | REST path: /resource_groups/alter. Java/REST use resource_groups instead of configs. Python and Java only. |
| DropResourceGroup | ResourceGroup | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Java uses group_name instead of name. |
| DescribeResourceGroup | ResourceGroup | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Java uses group_name instead of name. |
| ListResourceGroups | ResourceGroup | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| TransferReplica | ResourceGroup | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Highly divergent naming: source_group → Java: source_group_name, Node: source_resource_group, REST: source_rg_name; target_group similar; num_replicas → Java: number_of_replicas, Go: replica_num, C++: num, Node: num_replica. |
| DescribeReplica | ResourceGroup | ✓ | - | - | ✓ | - | - | 2 | No REST equivalent. |
| RunAnalyzer | Client | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go uses different names: text (not texts), analyzer_name (singular), detail/hash/field (for with_detail/with_hash/field_name). REST uses text (singular). |
| UpdateReplicateConfiguration | Management | ✓ | ✓ | - | - | - | - | 2 | Python and Java only. |
| FlushAll | Management | ✓ | - | - | - | - | - | 1 | Python-only. |
| GetFlushAllState | Management | ✓ | - | - | - | - | - | 1 | Python-only. |
| ListLoadedSegments | Management | ✓ | - | - | - | - | - | 1 | Python-only. |
| ListPersistentSegments | Management | ✓ | - | - | - | ✓ | - | 2 | Python and C++ only. |
| GetCompactionPlans | Management | ✓ | ✓ | - | - | ✓ | - | 3 | Java uses compaction_id; C++ uses id. No REST equivalent. |
| Optimize | Management | ✓ | - | - | - | - | - | 1 | Python-only. |

## Parameter Coverage

### CreateCollection

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go: `name` |
| dimension | ✓ | ✓ | ✓ | - | - | ✓ | 4 |  |
| primary_field_name | ✓ | ✓ | ✓ | ✓ | - | ✓ | 5 | Go: `pk_field_name` |
| vector_field_name | ✓ | ✓ | ✓ | ✓ | - | ✓ | 5 |  |
| auto_id | ✓ | ✓ | ✓ | ✓ | - | ✓ | 5 |  |
| schema | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Go: `collection_schema`; Java: `collection_schema` |
| index_params | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go: `index_options`; C++: `index` |

### CreateIndex

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| index_params | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Go: `index`; C++: `index` |

### Insert

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | - | ✓ | ✓ | 4 |  |
| data | ✓ | ✓ | - | - | - | ✓ | 3 |  |
| partition_name | ✓ | ✓ | - | - | ✓ | ✓ | 4 |  |

### Upsert

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | - | ✓ | ✓ | 4 |  |
| data | ✓ | ✓ | - | - | - | ✓ | 3 |  |
| partition_name | ✓ | ✓ | - | - | ✓ | ✓ | 4 |  |

### HybridSearch

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | ✓ | ✓ | - | 4 |  |
| reqs | ✓ | ✓ | - | ✓ | ✓ | - | 4 | Go: `ann_requests`; Java: `search_requests`; C++: `requests` |
| ranker | ✓ | - | - | ✓ | ✓ | - | 3 | Go: `reranker`; C++: `rerank` |
| limit | ✓ | ✓ | - | ✓ | ✓ | - | 4 |  |
| output_fields | ✓ | ✓ | - | ✓ | ✓ | - | 4 | Java: `out_fields`; C++: `output_field_names` |
| partition_names | ✓ | ✓ | - | ✓ | ✓ | - | 4 | Go: `partitions` |

### Search

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| data | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go: `vectors`; C++: `vectors` |
| filter | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| limit | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| output_fields | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | C++: `output_field_names` |
| search_params | ✓ | ✓ | ✓ | ✓ | - | ✓ | 5 | Go: `search_param` |
| partition_names | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go: `partitions` |
| anns_field | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | C++: `ann_field` |
| ranker | ✓ | - | ✓ | - | ✓ | - | 3 | Node: `rerank` |
| highlighter | ✓ | ✓ | - | - | - | - | 2 |  |
| ids | ✓ | ✓ | ✓ | - | - | ✓ | 4 |  |

### Query

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 |  |
| filter | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 |  |
| output_fields | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | C++: `output_field_names` |
| ids | ✓ | ✓ | - | ✓ | - | - | 3 | Go: `i_ds` |
| partition_names | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Go: `partitions` |

### QueryIterator

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | ✓ | ✓ | - | 4 |  |
| batch_size | ✓ | ✓ | - | ✓ | - | - | 3 |  |
| limit | ✓ | ✓ | - | - | ✓ | - | 3 |  |
| filter | ✓ | ✓ | - | ✓ | ✓ | - | 4 | Java: `expr` |
| output_fields | ✓ | ✓ | - | ✓ | ✓ | - | 4 | C++: `output_field_names` |
| partition_names | ✓ | ✓ | - | ✓ | ✓ | - | 4 | Go: `partitions` |

### SearchIterator

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | ✓ | ✓ | - | 4 |  |
| data | ✓ | ✓ | - | ✓ | ✓ | - | 4 | Go: `vector`; Java: `vectors`; C++: `vectors` |
| batch_size | ✓ | ✓ | - | ✓ | - | - | 3 |  |
| filter | ✓ | ✓ | - | ✓ | ✓ | - | 4 | Java: `expr` |
| limit | ✓ | ✓ | - | - | ✓ | - | 3 |  |
| output_fields | ✓ | ✓ | - | ✓ | ✓ | - | 4 | C++: `output_field_names` |
| search_params | ✓ | - | - | ✓ | - | - | 2 | Go: `search_param` |
| partition_names | ✓ | ✓ | - | ✓ | ✓ | - | 4 | Go: `partitions` |
| anns_field | ✓ | - | - | ✓ | ✓ | - | 3 | C++: `ann_field` |
| round_decimal | ✓ | ✓ | - | - | ✓ | - | 3 |  |

### Get

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| ids | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go: `i_ds`; C++: `id_array`; REST: `id` |
| output_fields | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | C++: `output_field_names` |
| partition_names | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go: `partitions`; Java: `partition_name` |

### Delete

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 |  |
| ids | ✓ | ✓ | ✓ | - | ✓ | - | 4 | C++: `id_array` |
| filter | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go: `expr` |
| partition_name | ✓ | ✓ | - | - | ✓ | ✓ | 4 |  |

### GetCollectionStats

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | - | ✓ | ✓ | 4 |  |

### DescribeCollection

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Go: `name` |

### HasCollection

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go: `name` |

### DropCollection

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Go: `name` |

### TruncateCollection

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | - | - | - | - | - | 1 |  |

### RenameCollection

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| old_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Node: `collection_name`; Java: `collection_name`; C++: `collection_name`; REST: `collection_name` |
| new_name | ✓ | ✓ | ✓ | ✓ | - | ✓ | 5 | Node: `new_collection_name`; Java: `new_collection_name`; REST: `new_collection_name` |
| target_db | ✓ | - | ✓ | - | - | ✓ | 3 | Node: `new_db_name`; REST: `new_db_name` |

### LoadCollection

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 |  |

### ReleaseCollection

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 |  |

### GetLoadState

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| partition_name | ✓ | ✓ | - | - | ✓ | - | 3 |  |

### RefreshLoad

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | ✓ | ✓ | - | ✓ | 5 |  |

### ListIndexes

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 |  |
| field_name | ✓ | ✓ | - | ✓ | - | - | 3 |  |

### DropIndex

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 |  |
| index_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 |  |

### DescribeIndex

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| index_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |

### AlterIndexProperties

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 |  |
| index_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 |  |
| properties | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Go: `property` |

### DropIndexProperties

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| index_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| property_keys | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Go: `keys`; C++: `keys` |

### AlterCollectionProperties

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Go: `collection` |
| properties | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Go: `property` |

### DropCollectionProperties

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go: `collection` |
| property_keys | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | C++: `keys` |

### AlterCollectionField

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | - | - | ✓ | 3 |  |
| field_name | ✓ | ✓ | - | - | - | ✓ | 3 |  |
| field_params | ✓ | ✓ | - | - | - | ✓ | 3 | Java: `properties` |

### AddCollectionField

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| field_name | ✓ | - | - | - | - | - | 1 |  |
| data_type | ✓ | - | - | - | - | - | 1 |  |
| desc | ✓ | - | - | - | - | - | 1 |  |

### AddCollectionFunction

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | ✓ | - | - | ✓ | 4 |  |
| function | ✓ | - | ✓ | - | - | ✓ | 3 |  |

### AlterCollectionFunction

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | ✓ | - | - | ✓ | 4 |  |
| function_name | ✓ | - | ✓ | - | - | ✓ | 3 |  |
| function | ✓ | - | ✓ | - | - | ✓ | 3 |  |

### DropCollectionFunction

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | ✓ | - | - | ✓ | 4 |  |
| function_name | ✓ | ✓ | ✓ | - | - | ✓ | 4 |  |

### CreatePartition

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | - | ✓ | ✓ | 4 |  |
| partition_name | ✓ | ✓ | - | - | ✓ | ✓ | 4 |  |

### DropPartition

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | - | ✓ | ✓ | 4 |  |
| partition_name | ✓ | ✓ | - | - | ✓ | ✓ | 4 |  |

### HasPartition

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | - | ✓ | ✓ | 4 |  |
| partition_name | ✓ | ✓ | - | - | ✓ | ✓ | 4 |  |

### ListPartitions

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | - | ✓ | ✓ | 4 |  |

### LoadPartitions

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| partition_names | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go: `partitions_names` |

### ReleasePartitions

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| partition_names | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |

### GetPartitionStats

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | - | - | ✓ | 3 |  |
| partition_name | ✓ | ✓ | - | - | - | ✓ | 3 |  |

### CreateUser

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| user_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Node: `username`; C++: `name` |
| password | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |

### DropUser

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| user_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | C++: `name` |

### UpdatePassword

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| user_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | C++: `name` |
| old_password | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Java: `password`; C++: `password`; REST: `password` |
| new_password | ✓ | ✓ | - | ✓ | - | ✓ | 4 |  |
| reset_connection | ✓ | - | - | - | - | - | 1 |  |

### DescribeUser

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| user_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | C++: `name` |

### GrantRole

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| user_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | C++: `name` |
| role_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | C++: `name` |

### RevokeRole

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| user_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | C++: `name` |
| role_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | C++: `name` |

### CreateRole

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| role_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | C++: `name` |

### DropRole

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| role_name | ✓ | ✓ | - | - | ✓ | ✓ | 4 | C++: `name` |
| force_drop | ✓ | - | - | - | ✓ | - | 2 |  |

### DescribeRole

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| role_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | C++: `name` |

### GrantPrivilege

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| role_name | ✓ | ✓ | - | ✓ | - | ✓ | 4 |  |
| object_type | ✓ | ✓ | - | ✓ | - | ✓ | 4 |  |
| privilege | ✓ | ✓ | - | ✓ | - | ✓ | 4 | Go: `privilege_name` |
| object_name | ✓ | ✓ | - | ✓ | - | ✓ | 4 |  |
| db_name | ✓ | - | - | ✓ | - | - | 2 |  |

### RevokePrivilege

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| role_name | ✓ | ✓ | - | ✓ | - | ✓ | 4 |  |
| object_type | ✓ | ✓ | - | ✓ | - | ✓ | 4 |  |
| privilege | ✓ | ✓ | - | ✓ | - | ✓ | 4 | Go: `privilege_name` |
| object_name | ✓ | ✓ | - | ✓ | - | ✓ | 4 |  |
| db_name | ✓ | ✓ | - | ✓ | - | - | 3 |  |

### GrantPrivilegeV2

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| role_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | C++: `name` |
| privilege | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go: `privilege_name` |
| collection_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| db_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |

### RevokePrivilegeV2

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| role_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | C++: `name` |
| privilege | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go: `privilege_name` |
| collection_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| db_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |

### CreateAlias

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 |  |
| alias | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | REST: `alias_name` |

### DropAlias

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| alias | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | REST: `alias_name` |

### AlterAlias

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 |  |
| alias | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | REST: `alias_name` |

### DescribeAlias

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| alias | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | REST: `alias_name` |

### ListAliases

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 |  |

### UseDatabase

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| db_name | ✓ | - | - | - | ✓ | - | 2 |  |

### CreateDatabase

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| db_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Java: `database_name` |
| properties | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Go: `property` |

### DropDatabase

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| db_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Java: `database_name` |

### DescribeDatabase

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| db_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Java: `database_name` |

### AlterDatabaseProperties

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| db_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Java: `database_name` |
| properties | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Go: `property` |

### DropDatabaseProperties

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| db_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Java: `database_name` |
| property_keys | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | C++: `keys` |

### Flush

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | - | - | - | ✓ | ✓ | 3 | C++: `name` |

### Compact

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 |  |
| is_clustering | ✓ | ✓ | - | - | ✓ | ✓ | 4 | C++: `clustering_compaction` |
| is_l0 | ✓ | - | - | - | - | - | 1 |  |

### GetCompactionState

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| job_id | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Node: `compaction_id`; Go: `compaction_id`; Java: `compaction_id`; C++: `id` |

### GetServerVersion

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| detail | ✓ | - | - | - | - | - | 1 |  |

### CreatePrivilegeGroup

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| group_name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | C++: `name`; REST: `privilege_group_name` |

### DropPrivilegeGroup

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| group_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | C++: `name`; REST: `privilege_group_name` |

### AddPrivilegesToGroup

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| group_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | C++: `name`; REST: `privilege_group_name` |
| privileges | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |

### RemovePrivilegesFromGroup

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| group_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | C++: `name`; REST: `privilege_group_name` |
| privileges | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |

### CreateResourceGroup

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Java: `group_name` |

### UpdateResourceGroups

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| configs | ✓ | ✓ | - | - | - | ✓ | 3 | Java: `resource_groups`; REST: `resource_groups` |

### DropResourceGroup

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Java: `group_name` |

### DescribeResourceGroup

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| name | ✓ | ✓ | - | ✓ | ✓ | ✓ | 5 | Java: `group_name` |

### TransferReplica

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| source_group | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Node: `source_resource_group`; Java: `source_group_name`; REST: `source_rg_name` |
| target_group | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Node: `target_resource_group`; Java: `target_group_name`; REST: `target_rg_name` |
| collection_name | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 |  |
| num_replicas | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Node: `num_replica`; Go: `replica_num`; Java: `number_of_replicas`; C++: `num`; REST: `replica_num` |

### DescribeReplica

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | - | - | ✓ | - | - | 2 |  |

### RunAnalyzer

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| texts | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6 | Node: `text`; Go: `text`; REST: `text` |
| analyzer_params | ✓ | ✓ | ✓ | ✓ | - | ✓ | 5 |  |
| with_hash | ✓ | ✓ | ✓ | - | ✓ | ✓ | 5 |  |
| with_detail | ✓ | ✓ | ✓ | - | ✓ | ✓ | 5 |  |
| collection_name | ✓ | ✓ | - | - | ✓ | ✓ | 4 |  |
| field_name | ✓ | ✓ | - | - | ✓ | ✓ | 4 |  |
| analyzer_names | ✓ | ✓ | - | ✓ | - | ✓ | 4 | Go: `analyzer_name` |

### UpdateReplicateConfiguration

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| clusters | ✓ | - | - | - | - | - | 1 |  |
| cross_cluster_topology | ✓ | - | - | - | - | - | 1 |  |

### ListLoadedSegments

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | - | - | - | - | - | 1 |  |

### ListPersistentSegments

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | - | - | - | ✓ | - | 2 | C++: `name` |

### GetCompactionPlans

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| job_id | ✓ | ✓ | - | - | ✓ | - | 3 | Java: `compaction_id`; C++: `id` |

### Optimize

| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |
|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|
| collection_name | ✓ | - | - | - | - | - | 1 |  |
| target_size | ✓ | - | - | - | - | - | 1 |  |
| wait | ✓ | - | - | - | - | - | 1 |  |
