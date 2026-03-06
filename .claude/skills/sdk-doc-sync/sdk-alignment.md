# SDK Alignment Bitable

A cross-SDK parameter coverage matrix (Python as baseline, 6 SDKs × 93 methods).

**Bitable:** https://zilliverse.feishu.cn/base/IIY3bzFqca7li9s3JSFcIr88nxh?table=tbl1oHGX1R6HWnvO
**Rebuild:** `node .claude/skills/sdk-doc-sync/scripts/rebuild-alignment-bitable.js [--dry-run]`
**Markdown output:** `docs/sdk-alignment.md`

## Structure

- **Method rows** (top-level): Interface, Category, Python/Java/Node/Go/C++/REST (✓/-), SDK Count, Remarks
- **Param rows** (children): same + Parameter field, `父记录` → method record_id

## Key Cross-SDK Naming Conventions

**Pervasive patterns:**
- **Java** always uses `database_name` (not `db_name`) and `collection_schema` (not `schema`)
- **Go** uses `name` in single-arg collection methods; `collection` in alter*/drop* property methods; `property` (singular) for properties; `partitions` for `partition_names`; `privilege_name` for `privilege`; `search_param` (singular)
- **C++** uses `name` for roles, users, groups; `ann_field` for `anns_field`; `output_field_names` for `output_fields`; `id_array` for `ids`
- **Node** uses camelCase for auth params: `username`, `roleName`, `oldPassword`, `newPassword`; `object` for `object_type`; `privilegeName` for `privilege`
- **REST** uses `alias_name` for `alias`; `privilege_group_name` for `group_name`; `id` (singular) for `ids`

**Structural differences (param names can't map 1:1):**
- `CreateIndex`: Go/C++ use single `index` object; Python/Java/REST use `index_params` list
- `Insert/Upsert`: Go uses Row/Column API (no `data`); C++ uses `row_data`/`column_data`
- `HybridSearch`: Python `reqs` → Java: `search_requests`, Go: `ann_requests`, C++: `requests`
- `RenameCollection`: Java/Node/REST use `collection_name`/`new_collection_name` (not `old_name`/`new_name`)
- `Flush`: Python single `collection_name`; Java/Node list `collection_names`; Go `coll_name`
- `TransferReplica`: highly divergent — `source_group`/`target_group`/`num_replicas` all named differently per SDK
- `RunAnalyzer`: Go uses `text`/`detail`/`hash`/`field`/`analyzer_name` (singular) instead of Python names
- `UpdatePassword`: Java/REST use `password` for old password; Node uses `oldPassword`

**Python-only methods:** TruncateCollection, FlushAll, GetFlushAllState, ListLoadedSegments, Optimize

## Updating the Rebuild Script

The script is at `scripts/rebuild-alignment-bitable.js`. To add new aliases when a naming discrepancy is found:
1. Add to `PARAM_ALIASES`: `python_name: ['python_name', 'alias1', 'alias2']` — matched aliases appear in Remarks
2. Add to `METHOD_REMARKS` for structural differences that can't be expressed as a param alias
3. Run `node .claude/skills/sdk-doc-sync/scripts/rebuild-alignment-bitable.js --dry-run` to verify, then without `--dry-run`
