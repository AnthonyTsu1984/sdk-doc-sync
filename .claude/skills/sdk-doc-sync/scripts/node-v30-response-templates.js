/**
 * Hand-authored response detail sections for v3.0.x Node SDK methods.
 *
 * Keyed by Slug (e.g. 'Collections-batchDescribeCollections').
 * Each value is the markdown to insert AFTER the request-side **PARAMETERS:** block
 * and BEFORE the `## Example` heading.
 *
 * Format mirrors the canonical `describeRole` doc:
 * https://zilliverse.feishu.cn/docx/ItZPd1o4uoodqtx1sxIcq38hn7e
 *
 * Authoring rules:
 * - Inline "RETURNS" line as bold-italic paragraph (NOT a `## Returns` heading).
 * - TS code block immediately after.
 * - Second `**PARAMETERS:**` paragraph followed by typed bullets.
 * - NO `**EXCEPTIONS:**` block.
 * - For nested types: inline 1–2 levels; refer to other docs by name in plain text
 *   (e.g. "refer to the `describeCollection()` doc."). NEVER use markdown links
 *   inside bullet descriptions — Feishu schema mismatch silently drops content.
 * - Append `RES_STATUS_BULLET` to responses that extend `resStatusResponse`
 *   (skip for GetVersionResponse, CheckHealthResponse).
 */

const RES_STATUS_BULLET = `- **ResStatus**
A **ResStatus** object.
  - **code** (*number*) -
  A code that indicates the operation result. It remains **0** if this operation succeeds.
  - **error_code** (*string* | *number*) -
  An error code that indicates an occurred error. It remains **Success** if this operation succeeds.
  - **reason** (*string*) -
  The reason that indicates the reason for the reported error. It remains an empty string if this operation succeeds.`;

function makeReturnsHeader(typeName) {
    return `**RETURNS** *Promise<${typeName}>*

This method returns a promise that resolves to a **${typeName}** object.`;
}

const responseSections = {
    // ── Authentication ──────────────────────────────────────────────────────

    'Authentication-listUsers': `${makeReturnsHeader('ListCredUsersResponse')}

\`\`\`typescript
{
    usernames: string[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **usernames** (*string[]*) -
A list of usernames that exist in the current Milvus instance.

${RES_STATUS_BULLET}`,

    'Authentication-describeRole': `${makeReturnsHeader('SelectRoleResponse')}

\`\`\`typescript
{
    results: RoleResult[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **results** (*RoleResult[]*) -
A list of **RoleResult** objects. For \`describeRole()\`, this list contains a single entry describing the requested role.
  - **role** (*RoleEntity*) -
  A **RoleEntity** object describing the role.
    - **name** (*string*) -
    The role name.
  - **users** (*User[]*) -
  A list of users that hold this role.
    - **name** (*string*) -
    The username.
  - **entities** (*GrantEntity[]*) -
  A list of grants attached to this role. Each entry includes the granted privilege, the target object, and the user who granted it.
    - **role** (*RoleEntity*) -
    The role to which the privilege is granted.
    - **object** (*ObjectEntity*) -
    The object type the privilege applies to (for example, **Collection**, **Global**, **User**).
    - **object_name** (*string*) -
    The specific object name to which the privilege applies. Use \`*\` for all objects.
    - **grantor** (*Grantor*) -
    The principal that granted this privilege.
      - **user** (*User*) -
      The user who granted the privilege.
      - **privilege** (*PrivilegeEntity*) -
      The privilege that was granted.
    - **db_name** (*string*) -
    The database the grant applies to. Use \`*\` for all databases.

${RES_STATUS_BULLET}`,

    'Authentication-listRoles': `${makeReturnsHeader('SelectRoleResponse')}

\`\`\`typescript
{
    results: RoleResult[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **results** (*RoleResult[]*) -
A list of **RoleResult** objects, one per role defined in the current Milvus instance. For the full **RoleResult** field reference, refer to the \`describeRole()\` doc.

${RES_STATUS_BULLET}`,

    'Authentication-describeUser': `${makeReturnsHeader('SelectUserResponse')}

\`\`\`typescript
{
    results: UserResult[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **results** (*UserResult[]*) -
A list of **UserResult** objects. For \`describeUser()\`, this list contains a single entry describing the requested user.
  - **user** (*User*) -
  A **User** object identifying the user.
    - **name** (*string*) -
    The username.
  - **roles** (*RoleEntity[]*) -
  A list of roles assigned to this user.
    - **name** (*string*) -
    The role name.

${RES_STATUS_BULLET}`,

    'Authentication-listGrants': `${makeReturnsHeader('SelectGrantResponse')}

\`\`\`typescript
{
    entities: GrantEntity[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **entities** (*GrantEntity[]*) -
A list of grants attached to the requested role. Each entry pairs a privilege with the target object and the principal that granted it. For the full **GrantEntity** field reference, refer to the \`describeRole()\` doc.

${RES_STATUS_BULLET}`,

    'Authentication-hasRole': `${makeReturnsHeader('HasRoleResponse')}

\`\`\`typescript
{
    hasRole: boolean,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **hasRole** (*boolean*) -
A boolean that indicates whether the requested role exists. It is **true** when the role exists and **false** when it does not.

${RES_STATUS_BULLET}`,

    'Authentication-listPrivilegeGroups': `${makeReturnsHeader('ListPrivilegeGroupsResponse')}

\`\`\`typescript
{
    privilege_groups: PrivelegeGroup[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **privilege_groups** (*PrivelegeGroup[]*) -
A list of privilege groups defined in the current Milvus instance.
  - **group_name** (*string*) -
  The name of the privilege group.
  - **privileges** (*PrivilegeEntity[]*) -
  The privileges contained in the group.
    - **name** (*string*) -
    The privilege name (for example, **Insert**, **Search**, **CreateCollection**).

${RES_STATUS_BULLET}`,

    'Authentication-backupRBAC': `${makeReturnsHeader('BackupRBACResponse')}

\`\`\`typescript
{
    RBAC_meta: RBACMeta,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **RBAC_meta** (*RBACMeta*) -
A snapshot of all RBAC metadata in the current Milvus instance. Pass this value to \`restoreRBAC()\` to recreate the same users, roles, grants, and privilege groups in another instance.
  - **users** (*User[]*) -
  All users defined in the instance.
  - **roles** (*RoleEntity[]*) -
  All roles defined in the instance.
  - **grants** (*GrantEntity[]*) -
  All grants attached to the instance's roles. For the full **GrantEntity** field reference, refer to the \`describeRole()\` doc.
  - **privilege_groups** (*PrivelegeGroup[]*) -
  All privilege groups defined in the instance. For the full **PrivelegeGroup** field reference, refer to the \`listPrivilegeGroups()\` doc.

${RES_STATUS_BULLET}`,

    // ── Collections ─────────────────────────────────────────────────────────

    'Collections-hasCollection': `${makeReturnsHeader('BoolResponse')}

\`\`\`typescript
{
    value: boolean,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **value** (*boolean*) -
A boolean that indicates whether the requested collection exists. It is **true** when the collection exists and **false** when it does not.

${RES_STATUS_BULLET}`,

    'Collections-describeCollection': `${makeReturnsHeader('DescribeCollectionResponse')}

\`\`\`typescript
{
    schema: CollectionSchema,
    collectionID: string,
    collection_name: string,
    consistency_level: string,
    aliases: string[],
    properties: KeyValuePair[],
    created_timestamp: string,
    created_utc_timestamp: string,
    shards_num: number,
    num_partitions: string,
    db_name: string,
    functions: FunctionObject[],
    update_timestamp_str: string,
    update_timestamp: number,
    anns_fields: Record<string, FieldSchema>,
    scalar_fields: Record<string, FieldSchema>,
    function_fields: Record<string, FieldSchema>,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **schema** (*CollectionSchema*) -
The schema of the collection.
  - **name** (*string*) -
  The collection name.
  - **description** (*string*) -
  An optional description of the collection.
  - **enable_dynamic_field** (*boolean*) -
  Whether the dynamic field is enabled. When **true**, fields not declared in the schema are stored in a hidden \`$meta\` JSON field.
  - **autoID** (*boolean*) -
  Whether the primary key is automatically generated by Milvus.
  - **fields** (*FieldSchema[]*) -
  All scalar and vector fields declared on the collection. For the full **FieldSchema** field reference, refer to the \`FieldSchema\` class doc.
  - **functions** (*FunctionObject[]*) -
  Doc-in / doc-out functions attached to the collection (for example, the BM25 sparse-vector function).
- **collectionID** (*string*) -
The internal collection ID assigned by Milvus.
- **collection_name** (*string*) -
The collection name.
- **consistency_level** (*string*) -
The default consistency level for queries against this collection. Possible values are **Strong**, **Session**, **Bounded**, **Eventually**, and **Customized**.
- **aliases** (*string[]*) -
A list of aliases that point to this collection.
- **properties** (*KeyValuePair[]*) -
Collection-level properties (for example, **mmap.enabled**, **collection.ttl.seconds**) declared at creation or set via \`alterCollectionProperties()\`.
- **created_timestamp** (*string*) -
The hybrid timestamp at which the collection was created.
- **created_utc_timestamp** (*string*) -
The UTC timestamp, in milliseconds, at which the collection was created.
- **shards_num** (*number*) -
The number of shards configured on the collection.
- **num_partitions** (*string*) -
The number of partitions configured on the collection. This value is meaningful only when a partition key field is declared.
- **db_name** (*string*) -
The database that owns this collection.
- **functions** (*FunctionObject[]*) -
A flattened list of doc-in / doc-out functions attached to the collection.
- **update_timestamp_str** (*string*) -
The hybrid timestamp at which the collection was last updated, formatted as a string.
- **update_timestamp** (*number*) -
The numeric form of the last-update timestamp.
- **anns_fields** (*Record<string, FieldSchema>*) -
A mapping from vector-field name to its **FieldSchema**, covering all vector fields declared on the collection.
- **scalar_fields** (*Record<string, FieldSchema>*) -
A mapping from scalar-field name to its **FieldSchema**, covering all scalar fields declared on the collection.
- **function_fields** (*Record<string, FieldSchema>*) -
A mapping from function-output-field name to its **FieldSchema**.

${RES_STATUS_BULLET}`,

    'Collections-batchDescribeCollections': `${makeReturnsHeader('BatchDescribeCollectionResponse')}

\`\`\`typescript
{
    responses: DescribeCollectionResponse[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **responses** (*DescribeCollectionResponse[]*) -
An array containing the schema and metadata for every requested collection. Entries appear in the same order as the input collection names. For the full **DescribeCollectionResponse** field reference, refer to the \`describeCollection()\` doc.

${RES_STATUS_BULLET}`,

    'Collections-getCollectionStatistics': `${makeReturnsHeader('StatisticsResponse')}

\`\`\`typescript
{
    stats: KeyValuePair[],
    data: { [x: string]: any },
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **stats** (*KeyValuePair[]*) -
The raw statistics list returned by Milvus. Each entry has a **key** (for example, **row_count**) and a **value** as a string.
- **data** (*Record<string, any>*) -
A flattened, key-indexed view of **stats** for convenience. For example, \`data.row_count\` returns the row count as a string.

${RES_STATUS_BULLET}`,

    'Collections-describeAlias': `${makeReturnsHeader('DescribeAliasResponse')}

\`\`\`typescript
{
    db_name: string,
    alias: string,
    collection: string,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **db_name** (*string*) -
The database that owns the alias.
- **alias** (*string*) -
The alias name.
- **collection** (*string*) -
The collection name to which the alias currently points.

${RES_STATUS_BULLET}`,

    'Collections-listAliases': `${makeReturnsHeader('ListAliasesResponse')}

\`\`\`typescript
{
    db_name: string,
    aliases: string[],
    collection_name: string,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **db_name** (*string*) -
The database that owns the listed aliases.
- **aliases** (*string[]*) -
A list of all aliases that point to the requested collection.
- **collection_name** (*string*) -
The collection name to which the listed aliases point.

${RES_STATUS_BULLET}`,

    'Collections-listCollections': `${makeReturnsHeader('ShowCollectionsResponse')}

\`\`\`typescript
{
    data: CollectionData[],
    created_timestamps: string[],
    created_utc_timestamps: string[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **data** (*CollectionData[]*) -
A list of collection data objects. Each entry contains the collection name, ID, timestamp, and loaded percentage.
- **created_timestamps** (*string[]*) -
A list of hybrid timestamps indicating when each collection was created.
- **created_utc_timestamps** (*string[]*) -
A list of UTC timestamps indicating when each collection was created.

${RES_STATUS_BULLET}`,

    // ── Snapshot ────────────────────────────────────────────────────────────

    'Snapshot-listSnapshots': `${makeReturnsHeader('ListSnapshotsResponse')}

\`\`\`typescript
{
    snapshots: string[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **snapshots** (*string[]*) -
A list of snapshot names that currently exist for the requested collection.

${RES_STATUS_BULLET}`,

    'Snapshot-describeSnapshot': `${makeReturnsHeader('DescribeSnapshotResponse')}

\`\`\`typescript
{
    name: string,
    description: string,
    collection_name: string,
    partition_names: string[],
    create_ts: string,
    s3_location: string,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **name** (*string*) -
The snapshot name.
- **description** (*string*) -
The description supplied at snapshot creation, or an empty string if none was provided.
- **collection_name** (*string*) -
The collection that owns the snapshot.
- **partition_names** (*string[]*) -
The partition names captured by the snapshot.
- **create_ts** (*string*) -
The hybrid timestamp at which the snapshot was created.
- **s3_location** (*string*) -
The object-store URI where the snapshot data is persisted.

${RES_STATUS_BULLET}`,

    'Snapshot-restoreSnapshot': `${makeReturnsHeader('RestoreSnapshotResponse')}

\`\`\`typescript
{
    job_id: string,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **job_id** (*string*) -
The identifier of the asynchronous restore job. Pass this value to \`getRestoreSnapshotState()\` to poll for completion.

${RES_STATUS_BULLET}`,

    'Snapshot-getRestoreSnapshotState': `${makeReturnsHeader('GetRestoreSnapshotStateResponse')}

\`\`\`typescript
{
    info: RestoreSnapshotJobInfo,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **info** (*RestoreSnapshotJobInfo*) -
The current state of the restore job.
  - **job_id** (*string*) -
  The job identifier.
  - **snapshot_name** (*string*) -
  The snapshot being restored.
  - **db_name** (*string*) -
  The target database.
  - **collection_name** (*string*) -
  The target collection name.
  - **state** (*RestoreSnapshotState*) -
  The current job state. Possible values are **RestoreSnapshotNone**, **RestoreSnapshotPending**, **RestoreSnapshotExecuting**, **RestoreSnapshotCompleted**, and **RestoreSnapshotFailed**.
  - **progress** (*number*) -
  The completion percentage as an integer between **0** and **100**.
  - **reason** (*string*) -
  The failure reason when **state** is **RestoreSnapshotFailed**, otherwise an empty string.
  - **start_time** (*string*) -
  The time at which the job started.
  - **time_cost** (*string*) -
  The total elapsed time since the job started.

${RES_STATUS_BULLET}`,

    'Snapshot-listRestoreSnapshotJobs': `${makeReturnsHeader('ListRestoreSnapshotJobsResponse')}

\`\`\`typescript
{
    jobs: RestoreSnapshotJobInfo[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **jobs** (*RestoreSnapshotJobInfo[]*) -
A list of restore jobs that match the requested database and collection filters. For the full **RestoreSnapshotJobInfo** field reference, refer to the \`getRestoreSnapshotState()\` doc.

${RES_STATUS_BULLET}`,

    'Snapshot-pinSnapshotData': `${makeReturnsHeader('PinSnapshotDataResponse')}

\`\`\`typescript
{
    pin_id: string,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **pin_id** (*string*) -
The identifier of the pin lease. Pass this value to \`unpinSnapshotData()\` to release the pin before its TTL expires.

${RES_STATUS_BULLET}`,

    // ── Vector ──────────────────────────────────────────────────────────────

    'Vector-insert': `${makeReturnsHeader('MutationResult')}

\`\`\`typescript
{
    succ_index: number[],
    err_index: number[],
    acknowledged: boolean,
    insert_cnt: string,
    delete_cnt: string,
    upsert_cnt: string,
    timestamp: string,
    IDs: { int_id?: { data: number[] }, str_id?: { data: string[] }, id_field: 'int_id' | 'str_id' },
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **succ_index** (*number[]*) -
The zero-based positions in the input data of rows that were successfully inserted.
- **err_index** (*number[]*) -
The zero-based positions of rows that were rejected. When all rows succeed, this list is empty.
- **acknowledged** (*boolean*) -
Whether the write was acknowledged by Milvus.
- **insert_cnt** (*string*) -
The number of rows inserted, formatted as a string.
- **delete_cnt** (*string*) -
The number of rows deleted by this operation. For \`insert()\` this remains **"0"**.
- **upsert_cnt** (*string*) -
The number of rows upserted by this operation. For \`insert()\` this remains **"0"**.
- **timestamp** (*string*) -
The hybrid timestamp at which the write became visible. Use this value for time-travel queries.
- **IDs** (*StringArrayId* | *NumberArrayId*) -
The primary keys assigned to the inserted rows. For autoID collections, Milvus generates these values; otherwise, they echo the input keys.
  - **int_id** (*{ data: number[] }*) -
  Set when the primary key is an integer field.
  - **str_id** (*{ data: string[] }*) -
  Set when the primary key is a VARCHAR field.
  - **id_field** (*'int_id' | 'str_id'*) -
  Indicates which of the two id arrays carries the values.

${RES_STATUS_BULLET}`,

    'Vector-upsert': `${makeReturnsHeader('MutationResult')}

\`\`\`typescript
{
    succ_index: number[],
    err_index: number[],
    acknowledged: boolean,
    insert_cnt: string,
    delete_cnt: string,
    upsert_cnt: string,
    timestamp: string,
    IDs: { int_id?: { data: number[] }, str_id?: { data: string[] }, id_field: 'int_id' | 'str_id' },
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **succ_index** (*number[]*) -
The zero-based positions in the input data of rows that were successfully upserted.
- **err_index** (*number[]*) -
The zero-based positions of rows that were rejected. When all rows succeed, this list is empty.
- **acknowledged** (*boolean*) -
Whether the write was acknowledged by Milvus.
- **insert_cnt** (*string*) -
The number of rows newly inserted by this operation, formatted as a string.
- **delete_cnt** (*string*) -
The number of rows logically deleted to make room for replacements.
- **upsert_cnt** (*string*) -
The total number of rows upserted by this operation.
- **timestamp** (*string*) -
The hybrid timestamp at which the write became visible.
- **IDs** (*StringArrayId* | *NumberArrayId*) -
The primary keys carried in the upserted rows. For the full field reference, refer to the \`insert()\` doc.

${RES_STATUS_BULLET}`,

    'Vector-delete': `${makeReturnsHeader('MutationResult')}

\`\`\`typescript
{
    succ_index: number[],
    err_index: number[],
    acknowledged: boolean,
    insert_cnt: string,
    delete_cnt: string,
    upsert_cnt: string,
    timestamp: string,
    IDs: { int_id?: { data: number[] }, str_id?: { data: string[] }, id_field: 'int_id' | 'str_id' },
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **succ_index** (*number[]*) -
The zero-based positions of input IDs that matched a row and were marked deleted.
- **err_index** (*number[]*) -
The zero-based positions of input IDs that did not match any row.
- **acknowledged** (*boolean*) -
Whether the delete was acknowledged by Milvus.
- **insert_cnt** (*string*) -
Always **"0"** for \`delete()\`.
- **delete_cnt** (*string*) -
The number of rows logically deleted by this operation.
- **upsert_cnt** (*string*) -
Always **"0"** for \`delete()\`.
- **timestamp** (*string*) -
The hybrid timestamp at which the delete became visible.
- **IDs** (*StringArrayId* | *NumberArrayId*) -
The primary keys that were targeted by this delete. For the full field reference, refer to the \`insert()\` doc.

${RES_STATUS_BULLET}`,

    'Vector-search': `${makeReturnsHeader('SearchResults<T>')}

\`\`\`typescript
{
    results: SearchResultData[] | SearchResultData[][],
    recalls: number[],
    session_ts: number,
    collection_name: string,
    all_search_count?: number,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **results** (*SearchResultData[]* | *SearchResultData[][]*) -
The hits returned for each query vector. When a single query vector is supplied, this is a flat **SearchResultData[]**. When a batch of query vectors is supplied, this is a nested **SearchResultData[][]** with one inner list per query.
  - **id** (*string*) -
  The primary key of the matched row.
  - **score** (*number*) -
  The similarity score, scaled by the configured metric type.
  - **offset** (*number* | *string*) -
  The zero-based offset of this hit within its query group.
  - **group_by_field_values** (*Record<string, FieldData>*) -
  Set when **group_by_field** was supplied; carries the values of the grouping field for the hit.
  - **highlight** (*HighlightResult*) -
  Set when a **highlighter** was supplied on the request; carries the highlighted fragments for matching fields.
  - **<output_field>** (*FieldData*) -
  Each requested **output_fields** entry is added as a key on the hit, carrying the value from the matched row.
- **recalls** (*number[]*) -
The estimated recall score for each query, when the search engine produced one.
- **session_ts** (*number*) -
The session timestamp Milvus used to evaluate the search.
- **collection_name** (*string*) -
The collection that was searched.
- **all_search_count** (*number*) -
Optional. Set when the search reports the total candidate count examined.

${RES_STATUS_BULLET}`,

    'Vector-query': `${makeReturnsHeader('QueryResults')}

\`\`\`typescript
{
    data: Record<string, any>[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **data** (*Record<string, any>[]*) -
The matched rows. Each entry is keyed by field name and carries the value for every requested **output_fields** entry plus the primary key. When **enable_dynamic_field** is **true** on the collection, dynamic-field values appear inline alongside declared fields.

${RES_STATUS_BULLET}`,

    'Vector-count': `${makeReturnsHeader('CountResult')}

\`\`\`typescript
{
    data: number,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **data** (*number*) -
The number of rows in the collection that match the supplied filter expression. When no expression is supplied, this is the total row count.

${RES_STATUS_BULLET}`,

    'Vector-get': `${makeReturnsHeader('QueryResults')}

\`\`\`typescript
{
    data: Record<string, any>[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **data** (*Record<string, any>[]*) -
The rows whose primary keys match the supplied **ids**. Each entry is keyed by field name and carries the value for every requested **output_fields** entry plus the primary key.

${RES_STATUS_BULLET}`,

    'Vector-bulkInsert': `${makeReturnsHeader('ImportResponse')}

\`\`\`typescript
{
    tasks: number[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **tasks** (*number[]*) -
The identifiers of the asynchronous import tasks dispatched to the data nodes. Pass these values to \`listImportTasks()\` to poll for completion.

${RES_STATUS_BULLET}`,

    // ── Management ──────────────────────────────────────────────────────────

    'Management-compact': `${makeReturnsHeader('CompactionResponse')}

\`\`\`typescript
{
    compactionID: string,
    compactionPlanCount: number,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **compactionID** (*string*) -
The identifier of the compaction operation. Pass this value to \`getCompactionState()\` or \`getCompactionStateWithPlans()\` to poll progress.
- **compactionPlanCount** (*number*) -
The number of compaction plans generated for this operation.

${RES_STATUS_BULLET}`,

    'Management-getCompactionState': `${makeReturnsHeader('GetCompactionStateResponse')}

\`\`\`typescript
{
    state: CompactionState,
    executingPlanNo: string,
    timeoutPlanNo: string,
    completedPlanNo: string,
    failedPlanNo: string,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **state** (*CompactionState*) -
The aggregate state of the compaction. Possible values are **UndefiedState**, **Executing**, and **Completed**.
- **executingPlanNo** (*string*) -
The number of plans still executing.
- **timeoutPlanNo** (*string*) -
The number of plans that timed out.
- **completedPlanNo** (*string*) -
The number of plans that completed successfully.
- **failedPlanNo** (*string*) -
The number of plans that failed.

${RES_STATUS_BULLET}`,

    'Management-getCompactionStateWithPlans': `${makeReturnsHeader('GetCompactionPlansResponse')}

\`\`\`typescript
{
    state: CompactionState,
    mergeInfos: { sources: string[], target: string }[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **state** (*CompactionState*) -
The aggregate state of the compaction. Possible values are **UndefiedState**, **Executing**, and **Completed**.
- **mergeInfos** (*{ sources: string[], target: string }[]*) -
A list of merge plans dispatched by the compaction.
  - **sources** (*string[]*) -
  The segment IDs being merged.
  - **target** (*string*) -
  The new segment ID produced by the merge.

${RES_STATUS_BULLET}`,

    'Management-getReplicas': `${makeReturnsHeader('ReplicasResponse')}

\`\`\`typescript
{
    replicas: ReplicaInfo[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **replicas** (*ReplicaInfo[]*) -
A list of replicas currently serving the requested collection.
  - **replicaID** (*string*) -
  The replica identifier.
  - **collectionID** (*string*) -
  The collection identifier.
  - **partition_ids** (*string[]*) -
  The partition identifiers covered by this replica.
  - **shard_replicas** (*ShardReplica[]*) -
  Per-shard leader and node assignment information.
    - **leaderID** (*string*) -
    The query node ID acting as the shard leader.
    - **leader_addr** (*string*) -
    The address of the leader query node.
    - **dm_channel_name** (*string*) -
    The DML channel served by this shard.
    - **node_ids** (*string[]*) -
    The query node IDs that hold this shard's data.
  - **node_ids** (*string[]*) -
  The query node IDs that participate in this replica.
  - **resource_group_name** (*string*) -
  The resource group that owns this replica's nodes.
  - **num_outbound_node** (*Record<string, number>*) -
  The count of outbound nodes per resource group, used during rebalancing.

${RES_STATUS_BULLET}`,

    'Management-getLoadingProgress': `${makeReturnsHeader('GetLoadingProgressResponse')}

\`\`\`typescript
{
    progress: string,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **progress** (*string*) -
The completion percentage of the load operation as an integer between **"0"** and **"100"**. The collection is fully loaded once this value reaches **"100"**.

${RES_STATUS_BULLET}`,

    'Management-getLoadState': `${makeReturnsHeader('GetLoadStateResponse')}

\`\`\`typescript
{
    state: LoadState,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **state** (*LoadState*) -
The current load state. Possible values are **LoadStateNotExist**, **LoadStateNotLoad**, **LoadStateLoading**, and **LoadStateLoaded**.

${RES_STATUS_BULLET}`,

    'Management-describeIndex': `${makeReturnsHeader('DescribeIndexResponse')}

\`\`\`typescript
{
    index_descriptions: IndexDescription[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **index_descriptions** (*IndexDescription[]*) -
A list of index descriptions for the requested collection. When **field_name** or **index_name** is supplied, the list contains only the matching entry.
  - **index_name** (*string*) -
  The index name.
  - **indexID** (*number*) -
  The internal index identifier.
  - **params** (*KeyValuePair[]*) -
  The index parameters captured at creation (for example, **index_type**, **metric_type**, **params**).
  - **field_name** (*string*) -
  The field on which the index is built.
  - **indexed_rows** (*string*) -
  The number of rows that have been indexed so far.
  - **total_rows** (*string*) -
  The total number of rows the index covers.
  - **state** (*string*) -
  The build state of the index. Possible values are **IndexStateNone**, **Unissued**, **InProgress**, **Finished**, and **Failed**.
  - **index_state_fail_reason** (*string*) -
  The failure reason when **state** is **Failed**, otherwise an empty string.
  - **pending_index_rows** (*string*) -
  The number of rows still waiting to be indexed.

${RES_STATUS_BULLET}`,

    'Management-listIndexes': `${makeReturnsHeader('ListIndexResponse')}

\`\`\`typescript
{
    indexes: string[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **indexes** (*string[]*) -
A list of index names defined on the requested collection.

${RES_STATUS_BULLET}`,

    'Management-getIndexState': `${makeReturnsHeader('GetIndexStateResponse')}

\`\`\`typescript
{
    state: IndexState,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **state** (*IndexState*) -
The current build state of the index. Possible values are **IndexStateNone**, **Unissued**, **InProgress**, **Finished**, and **Failed**.

${RES_STATUS_BULLET}`,

    'Management-getIndexBuildProgress': `${makeReturnsHeader('GetIndexBuildProgressResponse')}

\`\`\`typescript
{
    indexed_rows: number,
    total_rows: number,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **indexed_rows** (*number*) -
The number of rows that have been indexed so far.
- **total_rows** (*number*) -
The total number of rows the index covers. The build is complete when **indexed_rows** equals **total_rows**.

${RES_STATUS_BULLET}`,

    'Management-flush': `${makeReturnsHeader('FlushResult')}

\`\`\`typescript
{
    coll_segIDs: Record<string, { data: number[] }>,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **coll_segIDs** (*Record<string, { data: number[] }>*) -
A mapping from collection name to the segment IDs that were sealed by this flush. Use the returned IDs with \`getFlushState()\` to confirm persistence.

${RES_STATUS_BULLET}`,

    'Management-flushSync': `${makeReturnsHeader('GetFlushStateResponse')}

\`\`\`typescript
{
    flushed: boolean,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **flushed** (*boolean*) -
Whether all targeted segments are flushed to persistent storage. Because \`flushSync()\` blocks until the flush completes, this value is **true** on success.

${RES_STATUS_BULLET}`,

    'Management-getFlushState': `${makeReturnsHeader('GetFlushStateResponse')}

\`\`\`typescript
{
    flushed: boolean,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **flushed** (*boolean*) -
Whether all targeted segments are flushed to persistent storage. It is **true** when every requested segment ID is sealed and persisted, otherwise **false**.

${RES_STATUS_BULLET}`,

    'Management-flushAll': `${makeReturnsHeader('FlushAllResponse')}

\`\`\`typescript
{
    flush_all_ts: number,
    flush_all_tss: Record<string, number>,
    flush_all_msgs: Record<string, any>,
    cluster_info: FlushClusterInfo,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **flush_all_ts** (*number*) -
A single hybrid timestamp identifying the flush. Deprecated; prefer **flush_all_tss** for multi-cluster deployments.
- **flush_all_tss** (*Record<string, number>*) -
A mapping from cluster ID to the hybrid timestamp at which the flush completed in that cluster.
- **flush_all_msgs** (*Record<string, any>*) -
A mapping from physical channel name to flush metadata used by the storage layer.
- **cluster_info** (*FlushClusterInfo*) -
The cluster topology that participated in the flush.
  - **cluster_id** (*string*) -
  The cluster identifier.
  - **cchannel** (*string*) -
  The control channel name.
  - **pchannels** (*string[]*) -
  The physical channels covered by the flush.

${RES_STATUS_BULLET}`,

    'Management-flushAllSync': `${makeReturnsHeader('GetFlushAllStateResponse')}

\`\`\`typescript
{
    flushed: boolean,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **flushed** (*boolean*) -
Whether the flush-all operation has fully completed. Because \`flushAllSync()\` blocks until completion, this value is **true** on success.

${RES_STATUS_BULLET}`,

    'Management-getFlushAllState': `${makeReturnsHeader('GetFlushAllStateResponse')}

\`\`\`typescript
{
    flushed: boolean,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **flushed** (*boolean*) -
Whether the flush-all operation identified by the supplied timestamps has fully completed. It is **true** when every channel reaches the requested flush timestamp, otherwise **false**.

${RES_STATUS_BULLET}`,

    'Vector-getMetric': `${makeReturnsHeader('GetMetricsResponse')}

\`\`\`typescript
{
    response: any,
    component_name: string,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **response** (*any*) -
The metrics payload returned by the targeted component. The shape depends on the requested **metric_type** (for example, **system_info**, **system_statistics**, **system_log**); parse this value as JSON.
- **component_name** (*string*) -
The component that produced the metrics (for example, **rootcoord**, **querynode**, **datanode**).

${RES_STATUS_BULLET}`,

    'Management-getQuerySegmentInfo': `${makeReturnsHeader('GetQuerySegmentInfoResponse')}

\`\`\`typescript
{
    infos: QuerySegmentInfo[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **infos** (*QuerySegmentInfo[]*) -
A list of segment-level descriptors for the segments currently held by query nodes.
  - **segmentID** (*number*) -
  The segment identifier.
  - **collectionID** (*number*) -
  The collection that owns the segment.
  - **partitionID** (*number*) -
  The partition that owns the segment.
  - **mem_size** (*number*) -
  The in-memory footprint of the segment in bytes.
  - **num_rows** (*number*) -
  The number of rows in the segment.
  - **index_name** (*string*) -
  The index loaded over this segment, when one exists.
  - **indexID** (*number*) -
  The internal identifier of the loaded index.
  - **state** (*SegmentState*) -
  The segment state. Possible values are **SegmentStateNone**, **NotExist**, **Growing**, **Sealed**, **Flushed**, **Flushing**, **Dropped**, and **Importing**.
  - **nodeIds** (*number[]*) -
  The query nodes that hold this segment.
  - **level** (*SegmentLevel*) -
  The segment level. Possible values are **Legacy**, **L0**, **L1**, and **L2**.
  - **is_sorted** (*boolean*) -
  Whether the segment data is sorted by primary key.
  - **storage_version** (*number*) -
  The storage format version of the segment.

${RES_STATUS_BULLET}`,

    'Management-getPersistentSegmentInfo': `${makeReturnsHeader('GePersistentSegmentInfoResponse')}

\`\`\`typescript
{
    infos: PersistentSegmentInfo[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **infos** (*PersistentSegmentInfo[]*) -
A list of segment-level descriptors for segments persisted to object storage.
  - **segmentID** (*number*) -
  The segment identifier.
  - **collectionID** (*number*) -
  The collection that owns the segment.
  - **partitionID** (*number*) -
  The partition that owns the segment.
  - **num_rows** (*number*) -
  The number of rows in the segment.
  - **state** (*SegmentState*) -
  The segment state. For the full list of possible values, refer to the \`getQuerySegmentInfo()\` doc.
  - **level** (*SegmentLevel*) -
  The segment level. Possible values are **Legacy**, **L0**, **L1**, and **L2**.
  - **is_sorted** (*boolean*) -
  Whether the segment data is sorted by primary key.
  - **storage_version** (*number*) -
  The storage format version of the segment.

${RES_STATUS_BULLET}`,

    'Vector-listImportTasks': `${makeReturnsHeader('ListImportTasksResponse')}

\`\`\`typescript
{
    tasks: GetImportStateResponse[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **tasks** (*GetImportStateResponse[]*) -
A list of import-task descriptors. Each entry carries the task's state, row count, segment IDs, and creation timestamp.
  - **state** (*ImportState*) -
  The task state. Possible values are **ImportPending**, **ImportFailed**, **ImportStarted**, **ImportPersisted**, **ImportCompleted**, and **ImportFailedAndCleaned**.
  - **row_count** (*number*) -
  The number of rows imported by the task.
  - **id_list** (*number[]*) -
  The auto-generated primary keys assigned to imported rows, when available.
  - **infos** (*KeyValuePair[]*) -
  Diagnostic key-value pairs (for example, **failed_reason**).
  - **id** (*number*) -
  The task identifier.
  - **collection_id** (*number*) -
  The collection that received the import.
  - **segment_ids** (*number[]*) -
  The segment IDs produced by the task.
  - **create_ts** (*number*) -
  The creation timestamp of the task.

${RES_STATUS_BULLET}`,

    'Collections-refreshExternalCollection': `${makeReturnsHeader('RefreshExternalCollectionResponse')}

\`\`\`typescript
{
    job_id: string,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **job_id** (*string*) -
The identifier of the asynchronous refresh job. Pass this value to \`getRefreshExternalCollectionProgress()\` to poll for completion.

${RES_STATUS_BULLET}`,

    'Collections-getRefreshExternalCollectionProgress': `${makeReturnsHeader('GetRefreshExternalCollectionProgressResponse')}

\`\`\`typescript
{
    job_info: RefreshExternalCollectionJobInfo,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **job_info** (*RefreshExternalCollectionJobInfo*) -
The current state of the refresh job.
  - **job_id** (*string*) -
  The job identifier.
  - **collection_name** (*string*) -
  The external collection being refreshed.
  - **state** (*RefreshExternalCollectionState*) -
  The current job state. Possible values are **RefreshPending**, **RefreshInProgress**, **RefreshCompleted**, and **RefreshFailed**.
  - **progress** (*string*) -
  The completion percentage as an integer between **"0"** and **"100"**.
  - **reason** (*string*) -
  The failure reason when **state** is **RefreshFailed**, otherwise an empty string.
  - **external_source** (*string*) -
  The external source path captured by the job.
  - **start_time** (*string*) -
  The time at which the job started.
  - **end_time** (*string*) -
  The time at which the job ended, or an empty string when the job is still running.

${RES_STATUS_BULLET}`,

    'Collections-listRefreshExternalCollectionJobs': `${makeReturnsHeader('ListRefreshExternalCollectionJobsResponse')}

\`\`\`typescript
{
    jobs: RefreshExternalCollectionJobInfo[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **jobs** (*RefreshExternalCollectionJobInfo[]*) -
A list of refresh jobs that match the requested database and collection filters. For the full **RefreshExternalCollectionJobInfo** field reference, refer to the \`getRefreshExternalCollectionProgress()\` doc.

${RES_STATUS_BULLET}`,

    // ── Partitions ──────────────────────────────────────────────────────────

    'Partitions-hasPartition': `${makeReturnsHeader('BoolResponse')}

\`\`\`typescript
{
    value: boolean,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **value** (*boolean*) -
A boolean that indicates whether the requested partition exists in the collection. It is **true** when the partition exists and **false** when it does not.

${RES_STATUS_BULLET}`,

    'Partitions-listPartitions': `${makeReturnsHeader('ShowPartitionsResponse')}

\`\`\`typescript
{
    partition_names: string[],
    partitionIDs: number[],
    data: PartitionData[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **partition_names** (*string[]*) -
A list of partition names defined on the collection.
- **partitionIDs** (*number[]*) -
The internal identifiers of the partitions, in the same order as **partition_names**.
- **data** (*PartitionData[]*) -
A flattened, per-partition view that bundles the name, identifier, creation timestamp, and load percentage.
  - **name** (*string*) -
  The partition name.
  - **id** (*string*) -
  The partition identifier.
  - **timestamp** (*string*) -
  The creation timestamp of the partition.
  - **loadedPercentage** (*string*) -
  The percentage of the partition that is currently loaded into memory.

${RES_STATUS_BULLET}`,

    'Partitions-getPartitionStatistics': `${makeReturnsHeader('StatisticsResponse')}

\`\`\`typescript
{
    stats: KeyValuePair[],
    data: { [x: string]: any },
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **stats** (*KeyValuePair[]*) -
The raw statistics list returned by Milvus. Each entry has a **key** (for example, **row_count**) and a **value** as a string.
- **data** (*Record<string, any>*) -
A flattened, key-indexed view of **stats** for convenience. For example, \`data.row_count\` returns the partition row count as a string.

${RES_STATUS_BULLET}`,

    // ── ResourceGroup ───────────────────────────────────────────────────────

    'ResourceGroup-listResourceGroups': `${makeReturnsHeader('ListResourceGroupsResponse')}

\`\`\`typescript
{
    resource_groups: string[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **resource_groups** (*string[]*) -
A list of resource group names defined in the current Milvus instance. The default resource group is named **__default_resource_group**.

${RES_STATUS_BULLET}`,

    'ResourceGroup-describeResourceGroup': `${makeReturnsHeader('DescribeResourceGroupResponse')}

\`\`\`typescript
{
    resource_group: ResourceGroup,
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **resource_group** (*ResourceGroup*) -
The resource group descriptor.
  - **name** (*string*) -
  The resource group name.
  - **capacity** (*number*) -
  The maximum number of nodes the group can hold.
  - **num_available_node** (*number*) -
  The number of nodes currently available in the group.
  - **num_loaded_replica** (*Record<string, number>*) -
  A mapping from collection name to the number of replicas this group serves for that collection.
  - **num_outgoing_node** (*Record<string, number>*) -
  A mapping from resource group name to the number of nodes this group is sending out during rebalancing.
  - **num_incoming_node** (*Record<string, number>*) -
  A mapping from resource group name to the number of nodes this group is receiving during rebalancing.
  - **config** (*ResourceGroupConfig*) -
  The capacity, transfer policy, and node-filter configuration of the group.
    - **requests** (*{ node_num: number }*) -
    The minimum number of nodes the group must have. Missing nodes are pulled from groups listed in **transfer_from**.
    - **limits** (*{ node_num: number }*) -
    The maximum number of nodes the group can hold. Excess nodes are pushed to groups listed in **transfer_to**.
    - **transfer_from** (*{ resource_group: string }[]*) -
    Source groups, in priority order, from which to pull missing nodes.
    - **transfer_to** (*{ resource_group: string }[]*) -
    Target groups, in priority order, to which excess nodes are pushed.
    - **node_filter** (*{ node_labels: KeyValuePair[] }*) -
    Required node labels; only nodes that match all labels are admitted to the group.
  - **nodes** (*NodeInfo[]*) -
  Optional. The current member nodes of the group, with their IDs, addresses, and hostnames.

${RES_STATUS_BULLET}`,

    // ── Database ────────────────────────────────────────────────────────────

    'Database-listDatabases': `${makeReturnsHeader('ListDatabasesResponse')}

\`\`\`typescript
{
    db_names: string[],
    db_ids: string[],
    created_timestamp: string[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **db_names** (*string[]*) -
A list of database names defined in the current Milvus instance.
- **db_ids** (*string[]*) -
The internal database identifiers, in the same order as **db_names**.
- **created_timestamp** (*string[]*) -
The creation timestamps of the databases, in the same order as **db_names**.

${RES_STATUS_BULLET}`,

    'Database-describeDatabase': `${makeReturnsHeader('DescribeDatabaseResponse')}

\`\`\`typescript
{
    db_name: string,
    dbID: number,
    created_timestamp: number,
    properties: KeyValuePair[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **db_name** (*string*) -
The database name.
- **dbID** (*number*) -
The internal database identifier.
- **created_timestamp** (*number*) -
The creation timestamp of the database, in milliseconds.
- **properties** (*KeyValuePair[]*) -
Database-level properties (for example, **database.replica.number**, **database.resource_groups**) declared at creation or set via \`alterDatabaseProperties()\`.

${RES_STATUS_BULLET}`,

    // ── Client ──────────────────────────────────────────────────────────────

    'Client-getVersion': `${makeReturnsHeader('GetVersionResponse')}

\`\`\`typescript
{
    version: string
}
\`\`\`

**PARAMETERS:**

- **version** (*string*) -
The semantic version of the Milvus server (for example, **"v3.0.0"**).`,

    'Client-checkHealth': `${makeReturnsHeader('CheckHealthResponse')}

\`\`\`typescript
{
    isHealthy: boolean,
    reasons: string[]
}
\`\`\`

**PARAMETERS:**

- **isHealthy** (*boolean*) -
A boolean that indicates whether all critical components of the Milvus deployment are healthy.
- **reasons** (*string[]*) -
When **isHealthy** is **false**, a list of human-readable reasons explaining which components are unhealthy. The list is empty when **isHealthy** is **true**.`,

    'Collections-runAnalyzer': `${makeReturnsHeader('RunAnalyzerResponse')}

\`\`\`typescript
{
    results: AnalyzerResult[],
    status:  ResStatus
}
\`\`\`

**PARAMETERS:**

- **results** (*AnalyzerResult[]*) -
The tokenization output. When **text** is a single string, this list has one entry; when **text** is an array, the entries align with the input order.
  - **tokens** (*AnalyzerToken[]*) -
  The tokens produced by the analyzer.
    - **token** (*string*) -
    The token text.
    - **start_offset** (*number*) -
    The zero-based character offset where the token begins in the input.
    - **end_offset** (*number*) -
    The zero-based character offset immediately after the token.
    - **position** (*number*) -
    The token position in the stream, used by phrase queries.
    - **position_length** (*number*) -
    The number of stream positions the token spans.
    - **hash** (*number*) -
    The token hash, populated when the request set **with_hash** to **true**.

${RES_STATUS_BULLET}`,
};

module.exports = { responseSections, RES_STATUS_BULLET, makeReturnsHeader };
