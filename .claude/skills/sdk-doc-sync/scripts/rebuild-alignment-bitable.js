#!/usr/bin/env node
/**
 * Rebuild the SDK alignment bitable from scratch using live scanner data.
 *
 * Bitable: https://zilliverse.feishu.cn/base/IIY3bzFqca7li9s3JSFcIr88nxh?table=tbl1oHGX1R6HWnvO
 * Usage:
 *   node scripts/rebuild-alignment-bitable.js [--dry-run]
 *
 * Structure produced:
 *   Method rows (top-level): Interface, Category, Python/Java/Node/Go/C++/REST, SDK Count, Remarks
 *   Param rows (child):      same fields + Parameter, 父记录 → method record_id, Remarks
 *
 * Baseline: Python MilvusClient public methods and their params.
 * Java:  builder fields (camelCase → snake_case)
 * Node:  TypeScript interface fields (snake_case normalized + known aliases)
 * Go:    constructor params + optionMethods (strip With/Add → snake_case)
 * C++:   argName (already snake_case)
 * REST:  openapi-milvus.json request body properties (camelCase → snake_case)
 */
'use strict';

const fs   = require('fs');
const path = require('path');

require('dotenv').config();

const fetch            = require('node-fetch');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');
const PythonScanner    = require('../../../../src/sdk-doc-sync/scanners/python-scanner');
const JavaScanner      = require('../../../../src/sdk-doc-sync/scanners/java-scanner');
const NodeScanner      = require('../../../../src/sdk-doc-sync/scanners/node-scanner');
const CppScanner       = require('../../../../src/sdk-doc-sync/scanners/cpp-scanner');
const GoScanner        = require('../../../../src/sdk-doc-sync/scanners/go-scanner');

const BASE_TOKEN   = 'IIY3bzFqca7li9s3JSFcIr88nxh';
const TABLE_ID     = 'tbl1oHGX1R6HWnvO';
const FEISHU_HOST  = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DRY_RUN      = process.argv.includes('--dry-run');
const NODE_TYPES   = path.resolve('repos/milvus-sdk-node/milvus/types');
const OPENAPI_SPEC = path.resolve('specs/openapi-milvus.json');
const MD_OUT       = path.resolve('docs/sdk-alignment.md');

// ─── Category map ─────────────────────────────────────────────────────────────

const CATEGORY = {
  create_collection: 'Collections', describe_collection: 'Collections',
  has_collection: 'Collections',    list_collections: 'Collections',
  drop_collection: 'Collections',   rename_collection: 'Collections',
  truncate_collection: 'Collections', get_collection_stats: 'Collections',
  load_collection: 'Collections',   release_collection: 'Collections',
  get_load_state: 'Collections',    alter_collection_properties: 'Collections',
  drop_collection_properties: 'Collections', alter_collection_field: 'Collections',
  add_collection_field: 'Collections', add_collection_function: 'Collections',
  alter_collection_function: 'Collections', drop_collection_function: 'Collections',
  create_alias: 'Collections',  drop_alias: 'Collections',
  alter_alias: 'Collections',   describe_alias: 'Collections',
  list_aliases: 'Collections',

  insert: 'Vector', upsert: 'Vector', search: 'Vector',
  hybrid_search: 'Vector', query: 'Vector', query_iterator: 'Vector',
  search_iterator: 'Vector', get: 'Vector', delete: 'Vector',

  create_index: 'Management', drop_index: 'Management',
  describe_index: 'Management', list_indexes: 'Management',
  alter_index_properties: 'Management', drop_index_properties: 'Management',
  flush: 'Management', flush_all: 'Management', compact: 'Management',
  get_compaction_state: 'Management', get_compaction_plans: 'Management',
  get_flush_all_state: 'Management', list_loaded_segments: 'Management',
  list_persistent_segments: 'Management', optimize: 'Management',
  refresh_load: 'Management', update_replicate_configuration: 'Management',

  create_partition: 'Partitions', drop_partition: 'Partitions',
  has_partition: 'Partitions',   list_partitions: 'Partitions',
  load_partitions: 'Partitions', release_partitions: 'Partitions',
  get_partition_stats: 'Partitions',

  create_user: 'Authentication', drop_user: 'Authentication',
  update_password: 'Authentication', list_users: 'Authentication',
  describe_user: 'Authentication', grant_role: 'Authentication',
  revoke_role: 'Authentication', create_role: 'Authentication',
  drop_role: 'Authentication', describe_role: 'Authentication',
  list_roles: 'Authentication', grant_privilege: 'Authentication',
  revoke_privilege: 'Authentication', grant_privilege_v2: 'Authentication',
  revoke_privilege_v2: 'Authentication', create_privilege_group: 'Authentication',
  drop_privilege_group: 'Authentication', list_privilege_groups: 'Authentication',
  add_privileges_to_group: 'Authentication', remove_privileges_from_group: 'Authentication',

  create_database: 'Database', drop_database: 'Database',
  list_databases: 'Database',  describe_database: 'Database',
  alter_database_properties: 'Database', drop_database_properties: 'Database',
  use_database: 'Database',

  create_resource_group: 'ResourceGroup', update_resource_groups: 'ResourceGroup',
  drop_resource_group: 'ResourceGroup',   describe_resource_group: 'ResourceGroup',
  list_resource_groups: 'ResourceGroup',  transfer_replica: 'ResourceGroup',
  describe_replica: 'ResourceGroup',

  close: 'Client', get_server_version: 'Client', run_analyzer: 'Client',
};

// Params always skipped from Python baseline
const SKIP_PARAMS = new Set([
  'self','timeout','context','kwargs','using','call_options',
  'callbacks','future','_future_timeout',
]);

// Param aliases: Python name → alternative names used across SDKs.
// Values may be checked against any SDK's param set.
// Where an alias matches, paramMatchResult() records it in the Remarks column.
const PARAM_ALIASES = {
  // ── Collection / entity identifiers ─────────────────────────────────────────
  collection_name:    ['collection_name', 'name', 'collection'],
  // Go uses 'name' in single-param methods (Describe/Has/Drop/Load…);
  // Go uses 'collection' in AlterCollectionProperties / DropCollectionProperties

  // ── Database identifiers ─────────────────────────────────────────────────────
  db_name:            ['db_name', 'database_name'],
  // Java always uses database_name; all other SDKs use db_name

  // ── Schema / shape ───────────────────────────────────────────────────────────
  schema:             ['schema', 'collection_schema'],    // Java/Go constructor
  dimension:          ['dimension', 'dim'],               // Go constructor uses 'dim'
  primary_field_name: ['primary_field_name', 'pk_field_name'], // Go WithPKFieldName
  num_shards:         ['num_shards', 'shard_num', 'shards_num'],

  // ── Index ─────────────────────────────────────────────────────────────────────
  index_params:       ['index_params', 'index_options', 'index'],
  // Go uses 'index_options' in CreateCollection; Go/C++ use 'index' in CreateIndex

  // ── Collection properties ─────────────────────────────────────────────────────
  properties:         ['properties', 'property'],         // Go uses singular 'property'
  property_keys:      ['property_keys', 'keys', 'key'],  // Go: 'keys'; C++: 'key'/'keys'; Node: 'properties'
  field_params:       ['field_params', 'properties'],     // Java uses 'properties' in AlterCollectionField

  // ── Rename collection ─────────────────────────────────────────────────────────
  old_name:           ['old_name', 'collection_name'],          // Java/Node/REST
  new_name:           ['new_name', 'new_collection_name'],      // Java/Node/REST
  target_db:          ['target_db', 'new_db_name'],             // Node/REST

  // ── Alias ────────────────────────────────────────────────────────────────────
  alias:              ['alias', 'alias_name'],            // REST uses alias_name

  // ── Load / partition ─────────────────────────────────────────────────────────
  partition_names:    ['partition_names', 'partitions', 'partition_name', 'partitions_names'],
  // Go uses 'partitions' in Search/Query; GetLoadState uses singular;
  // Go LoadPartitions uses 'partitions_names' (SDK typo)

  // ── Search / filter / output ─────────────────────────────────────────────────
  filter:             ['filter', 'expr'],
  // Older SDKs and Java iterators use 'expr'; newer use 'filter'
  output_fields:      ['output_fields', 'output_field_names', 'out_fields', 'output_field'],
  // C++ uses output_field_names; Java HybridSearch uses out_fields; C++ singular uses output_field
  anns_field:         ['anns_field', 'ann_field'],        // C++ uses ann_field
  search_params:      ['search_params', 'search_param'],  // Go uses singular search_param
  data:               ['data', 'vectors', 'vector'],      // Go/C++ use vectors/vector for search
  ids:                ['ids', 'id', 'id_array', 'i_ds'],
  // REST: 'id' (singular); C++: 'id_array'; Go scanner: 'i_ds' (IDs → i_ds)

  // ── HybridSearch ─────────────────────────────────────────────────────────────
  reqs:               ['reqs', 'search_requests', 'ann_requests', 'requests'],
  // Java: search_requests; Go: ann_requests; C++: requests
  ranker:             ['ranker', 'reranker', 'rerank'],
  // Go: reranker; C++: rerank

  // ── Compaction / flush ────────────────────────────────────────────────────────
  job_id:             ['job_id', 'compaction_id', 'id'],  // Java/Go: compaction_id; C++: id
  collection_names:   ['collection_names', 'collection_name', 'coll_name', 'names', 'name'],
  // Python flush takes single collection_name; Java/Node take list collection_names;
  // Go uses coll_name; C++ uses name/names
  is_clustering:      ['is_clustering', 'clustering_compaction'], // C++ uses clustering_compaction
  configs:            ['configs', 'resource_groups'],     // Java/REST: resource_groups

  // ── Auth — user ───────────────────────────────────────────────────────────────
  user_name:          ['user_name', 'username', 'name'],
  // Node: username (no underscore); C++: name
  old_password:       ['old_password', 'oldPassword', 'password'],
  // Java/REST: use 'password' for the old password field; Node: oldPassword
  new_password:       ['new_password', 'newPassword'],    // Node: newPassword (camelCase)

  // ── Auth — roles ──────────────────────────────────────────────────────────────
  role_name:          ['role_name', 'name'],              // C++ uses 'name' for roles

  // ── Auth — RBAC ───────────────────────────────────────────────────────────────
  object_type:        ['object_type', 'object'],          // Node uses 'object'
  privilege:          ['privilege', 'privilege_name'],    // Go uses privilege_name

  // ── Privilege groups ──────────────────────────────────────────────────────────
  group_name:         ['group_name', 'name', 'privilege_group_name'],
  // C++: name; REST: privilege_group_name

  // ── Resource groups ───────────────────────────────────────────────────────────
  name:               ['name', 'group_name'],             // Java uses group_name for resource group name
  source_group:       ['source_group', 'source_group_name', 'source_resource_group', 'source_rg_name'],
  target_group:       ['target_group', 'target_group_name', 'target_resource_group', 'target_rg_name'],
  num_replicas:       ['num_replicas', 'number_of_replicas', 'replica_num', 'num', 'num_replica', 'replica_number'],

  // ── RunAnalyzer ───────────────────────────────────────────────────────────────
  texts:              ['texts', 'text'],                  // Go/Node/REST use singular 'text'
  analyzer_names:     ['analyzer_names', 'analyzer_name'], // Go uses singular
};

// ─── Curated method-level remarks ─────────────────────────────────────────────
// These capture structural differences and support gaps that can't be expressed
// as per-param aliases. Per-param alias mismatches are auto-generated separately.

const METHOD_REMARKS = {
  // ── Collections ──────────────────────────────────────────────────────────────
  CreateCollection:            'C++ requires full CollectionSchema; simple overload (name+dim) is CreateSimpleCollection.',
  TruncateCollection:          'Python-only.',
  RenameCollection:            'Java/Node/REST use collection_name/new_collection_name; Python uses old_name/new_name.',
  LoadCollection:              'Java: num_replicas; Go: replica (singular); C++: replica_num.',
  GetLoadState:                'Go/Node/C++ use partition_names (plural); Python uses partition_name (singular).',
  AlterCollectionProperties:   'Go uses collection (not collection_name) and property (singular).',
  DropCollectionProperties:    'Go uses collection (not collection_name); C++: key/keys; Node: properties.',
  AlterCollectionField:        'Go and Node not supported. Java uses properties instead of field_params.',
  AddCollectionField:          'Python takes individual fields (field_name, data_type, desc); Java/Go/C++/Node/REST take a schema/field object.',
  AddCollectionFunction:       'Go and C++ not supported.',
  AlterCollectionFunction:     'Go and C++ not supported.',
  DropCollectionFunction:      'Go and C++ not supported.',

  // ── Aliases ───────────────────────────────────────────────────────────────────
  CreateAlias:                 'REST uses alias_name instead of alias.',
  DropAlias:                   'REST uses alias_name instead of alias.',
  AlterAlias:                  'REST uses alias_name instead of alias.',
  DescribeAlias:               'REST uses alias_name instead of alias.',

  // ── Vector operations ─────────────────────────────────────────────────────────
  Insert:                      'Go uses Row/Column API (no direct data param). C++ uses row_data/column_data instead of data.',
  Upsert:                      'Go uses Row/Column API. C++ uses row_data/column_data instead of data.',
  Search:                      'Go: vectors (not data), search_param (singular), partitions (not partition_names), ann_field. C++ uses ann_field, emb_list/emb_lists, output_field_names. Node uses expr (not filter).',
  HybridSearch:                'REST path: /entities/advanced_search. Python reqs → Java: search_requests, Go: ann_requests, C++: requests. Java uses out_fields; Go uses reranker; C++ uses rerank.',
  Query:                       'Go uses partitions (not partition_names) and i_ds (not ids). C++ uses output_field_names.',
  QueryIterator:               'Streaming cursor pattern. Java uses expr (not filter). No REST equivalent.',
  SearchIterator:              'Streaming cursor pattern. Java uses expr and vectors. Go uses ann_param, search_param (singular), partitions. No REST equivalent.',
  Delete:                      'Go uses expr (not filter) and int64_i_ds/string_i_ds (not ids) and partition (singular).',
  Get:                         'Java uses partition_name (singular); Go uses i_ds; C++: id_array; REST: id (singular).',

  // ── Management ───────────────────────────────────────────────────────────────
  CreateIndex:                 'Go/C++ use a single index object instead of index_params list.',
  AlterIndexProperties:        'Go uses property (singular) instead of properties.',
  DropIndexProperties:         'Go uses keys; C++: key/keys; Node uses properties instead of property_keys.',
  Flush:                       'Python flushes single collection_name; Java/Node take collection_names (list); Go uses coll_name; C++ uses name/names.',
  Compact:                     'C++ uses clustering_compaction instead of is_clustering.',
  GetCompactionState:          'Java/Go/Node use compaction_id; C++ uses id.',
  GetCompactionPlans:          'Java uses compaction_id; C++ uses id. No REST equivalent.',
  RefreshLoad:                 'C++ not supported.',
  UpdateReplicateConfiguration:'Python and Java only.',
  FlushAll:                    'Python-only.',
  GetFlushAllState:            'Python-only.',
  ListLoadedSegments:          'Python-only.',
  ListPersistentSegments:      'Python and C++ only.',
  Optimize:                    'Python-only.',

  // ── Authentication — users ────────────────────────────────────────────────────
  CreateUser:                  'Node: username (no underscore); C++: name instead of user_name.',
  DropUser:                    'Node: username; C++: name instead of user_name.',
  UpdatePassword:              'Java/REST use password for old_password. Node uses username/oldPassword/newPassword. C++: name.',
  DescribeUser:                'Node: username; C++: name instead of user_name.',
  GrantRole:                   'C++ takes single name param. Node uses username/roleName (camelCase).',
  RevokeRole:                  'C++ takes single name param. Node uses username/roleName (camelCase).',

  // ── Authentication — roles ────────────────────────────────────────────────────
  CreateRole:                  'C++ uses name instead of role_name. Node uses roleName (camelCase).',
  DropRole:                    'C++ uses name. Node uses roleName (camelCase). Go drop not found in scan.',
  DescribeRole:                'C++ uses name. Node uses roleName (camelCase).',
  GrantPrivilege:              'Go uses privilege_name instead of privilege. C++ supports V2 API only. Node uses object/privilegeName.',
  RevokePrivilege:             'Go uses privilege_name instead of privilege. C++ supports V2 API only. Node uses object/privilegeName.',
  GrantPrivilegeV2:            'Go uses privilege_name. Node uses role (not role_name).',
  RevokePrivilegeV2:           'Go uses privilege_name. Node uses role (not role_name).',

  // ── Privilege groups ──────────────────────────────────────────────────────────
  CreatePrivilegeGroup:        'C++ uses name; REST uses privilege_group_name instead of group_name.',
  DropPrivilegeGroup:          'C++ uses name; REST uses privilege_group_name instead of group_name.',
  AddPrivilegesToGroup:        'C++ uses name; REST uses privilege_group_name instead of group_name.',
  RemovePrivilegesFromGroup:   'C++ uses name; REST uses privilege_group_name instead of group_name.',

  // ── Database ──────────────────────────────────────────────────────────────────
  CreateDatabase:              'Java uses database_name (consistent across all Java methods). Go uses property (singular).',
  AlterDatabaseProperties:     'REST path: /databases/alter. Java: database_name; Go: property (singular).',
  DropDatabaseProperties:      'Java: database_name; C++: key/keys; Node: properties instead of property_keys.',
  UseDatabase:                 'REST uses per-request dbName parameter instead of connection-level state. Java/Node/Go use connection-level db setting.',

  // ── Resource groups ───────────────────────────────────────────────────────────
  CreateResourceGroup:         'Java uses group_name instead of name.',
  DropResourceGroup:           'Java uses group_name instead of name.',
  DescribeResourceGroup:       'Java uses group_name instead of name.',
  UpdateResourceGroups:        'REST path: /resource_groups/alter. Java/REST use resource_groups instead of configs. Python and Java only.',
  TransferReplica:             'Highly divergent naming: source_group → Java: source_group_name, Node: source_resource_group, REST: source_rg_name; target_group similar; num_replicas → Java: number_of_replicas, Go: replica_num, C++: num, Node: num_replica.',
  DescribeReplica:             'No REST equivalent.',

  // ── Client ────────────────────────────────────────────────────────────────────
  Close:                       'Node uses closeConnection(); C++ uses Disconnect().',
  GetServerVersion:            'Node uses getVersion(). REST not supported.',
  GetCollectionStats:          'Node uses getCollectionStatistics().',
  RunAnalyzer:                 'Go uses different names: text (not texts), analyzer_name (singular), detail/hash/field (for with_detail/with_hash/field_name). REST uses text (singular).',
};

// ─── REST path map ─────────────────────────────────────────────────────────────

const PYTHON_TO_REST = {
  create_collection:            '/v2/vectordb/collections/create',
  describe_collection:          '/v2/vectordb/collections/describe',
  has_collection:               '/v2/vectordb/collections/has',
  list_collections:             '/v2/vectordb/collections/list',
  drop_collection:              '/v2/vectordb/collections/drop',
  rename_collection:            '/v2/vectordb/collections/rename',
  get_collection_stats:         '/v2/vectordb/collections/get_stats',
  load_collection:              '/v2/vectordb/collections/load',
  release_collection:           '/v2/vectordb/collections/release',
  get_load_state:               '/v2/vectordb/collections/get_load_state',
  refresh_load:                 '/v2/vectordb/collections/refresh_load',
  alter_collection_properties:  '/v2/vectordb/collections/alter_properties',
  drop_collection_properties:   '/v2/vectordb/collections/drop_properties',
  alter_collection_field:       '/v2/vectordb/collections/fields/alter_properties',
  add_collection_field:         '/v2/vectordb/collections/fields/add',
  add_collection_function:      '/v2/vectordb/collections/add_function',
  alter_collection_function:    '/v2/vectordb/collections/alter_function',
  drop_collection_function:     '/v2/vectordb/collections/drop_function',
  create_alias:                 '/v2/vectordb/aliases/create',
  drop_alias:                   '/v2/vectordb/aliases/drop',
  alter_alias:                  '/v2/vectordb/aliases/alter',
  describe_alias:               '/v2/vectordb/aliases/describe',
  list_aliases:                 '/v2/vectordb/aliases/list',
  flush:                        '/v2/vectordb/collections/flush',
  compact:                      '/v2/vectordb/collections/compact',
  get_compaction_state:         '/v2/vectordb/collections/get_compaction_state',
  insert:                       '/v2/vectordb/entities/insert',
  upsert:                       '/v2/vectordb/entities/upsert',
  search:                       '/v2/vectordb/entities/search',
  hybrid_search:                '/v2/vectordb/entities/advanced_search',
  query:                        '/v2/vectordb/entities/query',
  get:                          '/v2/vectordb/entities/get',
  delete:                       '/v2/vectordb/entities/delete',
  create_index:                 '/v2/vectordb/indexes/create',
  drop_index:                   '/v2/vectordb/indexes/drop',
  describe_index:               '/v2/vectordb/indexes/describe',
  list_indexes:                 '/v2/vectordb/indexes/list',
  alter_index_properties:       '/v2/vectordb/indexes/alter_properties',
  drop_index_properties:        '/v2/vectordb/indexes/drop_properties',
  create_partition:             '/v2/vectordb/partitions/create',
  drop_partition:               '/v2/vectordb/partitions/drop',
  has_partition:                '/v2/vectordb/partitions/has',
  list_partitions:              '/v2/vectordb/partitions/list',
  load_partitions:              '/v2/vectordb/partitions/load',
  release_partitions:           '/v2/vectordb/partitions/release',
  get_partition_stats:          '/v2/vectordb/partitions/get_stats',
  create_user:                  '/v2/vectordb/users/create',
  drop_user:                    '/v2/vectordb/users/drop',
  update_password:              '/v2/vectordb/users/update_password',
  list_users:                   '/v2/vectordb/users/list',
  describe_user:                '/v2/vectordb/users/describe',
  grant_role:                   '/v2/vectordb/users/grant_role',
  revoke_role:                  '/v2/vectordb/users/revoke_role',
  create_role:                  '/v2/vectordb/roles/create',
  drop_role:                    '/v2/vectordb/roles/drop',
  describe_role:                '/v2/vectordb/roles/describe',
  list_roles:                   '/v2/vectordb/roles/list',
  grant_privilege:              '/v2/vectordb/roles/grant_privilege',
  revoke_privilege:             '/v2/vectordb/roles/revoke_privilege',
  grant_privilege_v2:           '/v2/vectordb/roles/grant_privilege_v2',
  revoke_privilege_v2:          '/v2/vectordb/roles/revoke_privilege_v2',
  create_privilege_group:       '/v2/vectordb/privilege_groups/create',
  drop_privilege_group:         '/v2/vectordb/privilege_groups/drop',
  list_privilege_groups:        '/v2/vectordb/privilege_groups/list',
  add_privileges_to_group:      '/v2/vectordb/privilege_groups/add_privileges_to_group',
  remove_privileges_from_group: '/v2/vectordb/privilege_groups/remove_privileges_from_group',
  create_database:              '/v2/vectordb/databases/create',
  drop_database:                '/v2/vectordb/databases/drop',
  list_databases:               '/v2/vectordb/databases/list',
  describe_database:            '/v2/vectordb/databases/describe',
  alter_database_properties:    '/v2/vectordb/databases/alter',
  drop_database_properties:     '/v2/vectordb/databases/drop_properties',
  create_resource_group:        '/v2/vectordb/resource_groups/create',
  update_resource_groups:       '/v2/vectordb/resource_groups/alter',
  drop_resource_group:          '/v2/vectordb/resource_groups/drop',
  describe_resource_group:      '/v2/vectordb/resource_groups/describe',
  list_resource_groups:         '/v2/vectordb/resource_groups/list',
  transfer_replica:             '/v2/vectordb/resource_groups/transfer_replica',
  run_analyzer:                 '/v2/vectordb/common/run_analyzer',
};

// ─── Utility ──────────────────────────────────────────────────────────────────

function toPascalCase(snake) {
  return snake.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join('');
}

function toSnakeCase(str) {
  return str
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function stripWithAdd(name) {
  if (name.startsWith('With')) return name.slice(4);
  if (name.startsWith('Add'))  return name.slice(3);
  return name;
}

// Returns { match: bool, alias: string|null }
// alias is set when matched via a non-identity alias entry
function paramMatchResult(pyParam, sdkParamSet) {
  if (sdkParamSet.has(pyParam)) return { match: true, alias: null };
  const aliases = PARAM_ALIASES[pyParam] || [];
  for (const a of aliases) {
    if (a !== pyParam && sdkParamSet.has(a)) return { match: true, alias: a };
  }
  return { match: false, alias: null };
}

const delay = ms => new Promise(r => setTimeout(r, ms));

// ─── Node TypeScript interface parser ─────────────────────────────────────────

function parseNodeTypes() {
  if (!fs.existsSync(NODE_TYPES)) return {};
  const typeMap = {};

  for (const file of fs.readdirSync(NODE_TYPES).filter(f => f.endsWith('.ts'))) {
    const src   = fs.readFileSync(path.join(NODE_TYPES, file), 'utf8');
    const lines = src.split('\n');
    let i = 0;
    while (i < lines.length) {
      const hm = lines[i].match(/export\s+interface\s+(\w+)(?:\s+extends\s+([\w\s,<>]+?))?\s*\{/);
      if (hm) {
        const name    = hm[1];
        const parents = hm[2]
          ? hm[2].split(',').map(s => s.trim().replace(/<.*>/, '')).filter(Boolean)
          : [];
        const fields = new Set();
        i++;
        while (i < lines.length && !lines[i].match(/^}\s*$/)) {
          const fm = lines[i].match(/^\s+([a-zA-Z_]\w*)\??\s*:/);
          if (fm) fields.add(fm[1]);
          i++;
        }
        typeMap[name] = { fields, parents };
      } else {
        const tm = lines[i].match(/export\s+type\s+(\w+)\s*=\s*(.+);/);
        if (tm) {
          const refs = (tm[2].match(/\b([A-Z]\w+)\b/g) || []).filter(r => r !== 'Omit');
          typeMap[tm[1]] = { fields: new Set(), parents: refs };
        }
        i++;
      }
    }
  }
  return typeMap;
}

function resolveTypeFields(typeMap, name, visited = new Set()) {
  if (!name || visited.has(name) || !typeMap[name]) return new Set();
  visited.add(name);
  const { fields, parents } = typeMap[name];
  const all = new Set(fields);
  for (const p of parents) for (const f of resolveTypeFields(typeMap, p, visited)) all.add(f);
  return all;
}

function getNodeParams(typeMap, methodName) {
  const pascal     = toPascalCase(methodName);
  const candidates = [`${pascal}Req`, `${pascal}Request`, `${pascal}ReqV2`];
  if (methodName === 'createCollection') candidates.push('CreateColReq', 'CreateColWithSchemaAndIndexParamsReq');
  if (methodName === 'search')           candidates.push('SearchReq', 'SearchSimpleReq');
  if (methodName === 'hybridSearch')     candidates.push('HybridSearchReq');
  if (methodName === 'query')            candidates.push('QueryReq', 'QuerySimpleReq');

  const all = new Set();
  for (const c of candidates) {
    for (const f of resolveTypeFields(typeMap, c)) {
      all.add(f);
      // Also add snake_case version so camelCase fields (roleName, username…) match
      all.add(toSnakeCase(f));
    }
  }
  return all;
}

// ─── REST schema parser ───────────────────────────────────────────────────────

function buildRestMap() {
  if (!fs.existsSync(OPENAPI_SPEC)) return {};
  const spec       = JSON.parse(fs.readFileSync(OPENAPI_SPEC, 'utf8'));
  const components = spec.components || {};

  function resolveFields(schema, depth = 0) {
    if (depth > 4 || !schema) return new Set();
    const fields = new Set();
    if (schema.$ref) {
      const s = components.schemas && components.schemas[schema.$ref.split('/').pop()];
      if (s) for (const f of resolveFields(s, depth + 1)) fields.add(f);
    }
    if (schema.properties) for (const k of Object.keys(schema.properties)) { if (!k.startsWith('x-')) fields.add(k); }
    for (const key of ['allOf','oneOf','anyOf']) {
      if (schema[key]) for (const s of schema[key]) for (const f of resolveFields(s, depth + 1)) fields.add(f);
    }
    return fields;
  }

  const map = {};
  for (const [pyName, restPath] of Object.entries(PYTHON_TO_REST)) {
    const entry = spec.paths[restPath];
    if (!entry) continue;
    const schema    = entry.post?.requestBody?.content?.['application/json']?.schema;
    const rawFields = resolveFields(schema);
    const fields    = new Set();
    for (const f of rawFields) fields.add(toSnakeCase(f));
    map[pyName] = fields;
  }
  return map;
}

// ─── SDK method & param maps ───────────────────────────────────────────────────

function buildJavaMap(javaSyms) {
  const methods = {};
  for (const s of javaSyms.filter(s => s.kind === 'method')) {
    const key = toPascalCase(s.name);
    if (!methods[key]) methods[key] = new Set();
    for (const p of (s.params || [])) {
      if (p.name && !p.name.startsWith('#')) methods[key].add(toSnakeCase(p.name));
    }
  }
  return methods;
}

function buildGoMap(goSyms) {
  const methods = {};
  for (const s of goSyms.filter(s => s.kind === 'method')) {
    if (!methods[s.name]) methods[s.name] = new Set();
    for (const p of (s.params || []))        methods[s.name].add(toSnakeCase(p.name));
    for (const opt of (s.optionMethods || [])) methods[s.name].add(toSnakeCase(stripWithAdd(opt.name)));
  }
  return methods;
}

function buildCppMap(cppSyms) {
  const methods = {};
  for (const s of cppSyms.filter(s => s.kind === 'method')) {
    if (!methods[s.name]) methods[s.name] = new Set();
    for (const p of (s.params || [])) {
      const name = p.argName || toSnakeCase(stripWithAdd(p.name));
      if (name) methods[s.name].add(name);
    }
  }
  return methods;
}

function buildNodeMap(nodeSyms, typeMap) {
  const methods = {};
  for (const s of nodeSyms.filter(s => s.kind === 'Function' || s.kind === 'method')) {
    methods[toPascalCase(s.name)] = getNodeParams(typeMap, s.name);
  }
  return methods;
}

// ─── Bitable batch API ─────────────────────────────────────────────────────────

const tf = new larkTokenFetcher();

async function apiHeaders() {
  const token = await tf.token();
  return { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` };
}

async function ensureField(fieldName, type) {
  const headers  = await apiHeaders();
  const url      = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${BASE_TOKEN}/tables/${TABLE_ID}/fields`;
  const listData = await (await fetch(url, { method: 'GET', headers })).json();
  if (listData.code !== 0) throw new Error(`list fields: ${listData.msg}`);
  if ((listData.data.items || []).some(f => f.field_name === fieldName)) {
    console.log(`  Field "${fieldName}" already exists`); return;
  }
  const data = await (await fetch(url, { method: 'POST', headers, body: JSON.stringify({ field_name: fieldName, type }) })).json();
  if (data.code !== 0) throw new Error(`create field "${fieldName}": ${data.msg}`);
  console.log(`  Created field "${fieldName}" (type ${type})`);
}

async function batchDelete(recordIds) {
  for (let i = 0; i < recordIds.length; i += 500) {
    const chunk = recordIds.slice(i, i + 500);
    const url   = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${BASE_TOKEN}/tables/${TABLE_ID}/records/batch_delete`;
    const data  = await (await fetch(url, { method: 'POST', headers: await apiHeaders(), body: JSON.stringify({ records: chunk }) })).json();
    if (data.code !== 0) throw new Error(`batch_delete: ${data.msg}`);
    console.log(`  Deleted ${chunk.length} records`);
    await delay(300);
  }
}

async function batchCreate(records) {
  const created = [];
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500);
    const url   = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${BASE_TOKEN}/tables/${TABLE_ID}/records/batch_create`;
    const data  = await (await fetch(url, { method: 'POST', headers: await apiHeaders(), body: JSON.stringify({ records: chunk.map(r => ({ fields: r })) }) })).json();
    if (data.code !== 0) throw new Error(`batch_create: ${data.msg}`);
    created.push(...data.data.records);
    console.log(`  Created ${chunk.length} records`);
    await delay(300);
  }
  return created;
}

// ─── Markdown table writer ────────────────────────────────────────────────────

function writeMarkdown(methodRows, paramRows) {
  const lines = [
    '# SDK Alignment Report',
    '',
    `Generated: ${new Date().toISOString().slice(0, 10)}  `,
    `Baseline: Python MilvusClient — ${methodRows.length} methods, ${paramRows.length} parameters`,
    '',
    '## Method Coverage',
    '',
    '| Interface | Category | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |',
    '|-----------|----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|',
  ];

  for (const r of methodRows) {
    lines.push(
      `| ${r.Interface} | ${r.Category} | ${r.Python} | ${r.Java} | ${r.Node} | ${r.Go} | ${r['C++']} | ${r.REST} | ${r['SDK Count']} | ${(r.Remarks || '').replace(/\|/g, '\\|')} |`
    );
  }

  lines.push('', '## Parameter Coverage', '');

  // Group param rows by Interface
  const byMethod = {};
  for (const r of paramRows) {
    if (!byMethod[r.Interface]) byMethod[r.Interface] = [];
    byMethod[r.Interface].push(r);
  }

  for (const [iface, params] of Object.entries(byMethod)) {
    lines.push(`### ${iface}`, '');
    lines.push('| Parameter | Python | Java | Node | Go | C++ | REST | SDK Count | Remarks |');
    lines.push('|-----------|:------:|:----:|:----:|:--:|:---:|:----:|:---------:|---------|');
    for (const r of params) {
      lines.push(
        `| ${r.Parameter} | ${r.Python} | ${r.Java} | ${r.Node} | ${r.Go} | ${r['C++']} | ${r.REST} | ${r['SDK Count']} | ${(r.Remarks || '').replace(/\|/g, '\\|')} |`
      );
    }
    lines.push('');
  }

  fs.mkdirSync(path.dirname(MD_OUT), { recursive: true });
  fs.writeFileSync(MD_OUT, lines.join('\n'));
  console.log(`Markdown written to ${MD_OUT}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Scanning all SDKs...');
  const [pySyms, javaSyms, nodeSyms, cppSyms, goSyms] = await Promise.all([
    new PythonScanner({ rootDir: 'repos/pymilvus/pymilvus', publicOnly: true }).scan(),
    new JavaScanner({ rootDir: 'repos/milvus-sdk-java/sdk-core/src/main/java/io/milvus' }).scan(),
    new NodeScanner({ rootDir: 'repos/milvus-sdk-node' }).scan(),
    new CppScanner({ rootDir: 'repos/milvus-sdk-cpp' }).scan(),
    new GoScanner({ rootDir: 'repos/milvus-sdk-go' }).scan(),
  ]);
  console.log(`Scanned: py=${pySyms.length} java=${javaSyms.length} node=${nodeSyms.length} cpp=${cppSyms.length} go=${goSyms.length}`);

  const nodeTypeMap = parseNodeTypes();
  console.log(`Node types parsed: ${Object.keys(nodeTypeMap).length} interfaces`);

  const javaMap = buildJavaMap(javaSyms);
  const goMap   = buildGoMap(goSyms);
  const cppMap  = buildCppMap(cppSyms);
  const nodeMap = buildNodeMap(nodeSyms, nodeTypeMap);
  const restMap = buildRestMap();

  const javaMethods = new Set(Object.keys(javaMap));
  const goMethods   = new Set(Object.keys(goMap));
  const cppMethods  = new Set(Object.keys(cppMap));
  const nodeMethods = new Set(Object.keys(nodeMap));
  const restMethods = new Set(Object.keys(restMap));
  console.log(`REST paths matched: ${restMethods.size}`);

  const pyMethods = pySyms.filter(s =>
    s.kind === 'method' && s.parentClass === 'MilvusClient' &&
    !s.name.startsWith('_') && s.name !== 'using_database'
  );
  console.log(`Python baseline methods: ${pyMethods.length}`);

  const methodRows = [];
  const paramRows  = [];

  for (const m of pyMethods) {
    const snake    = m.name;
    const canon    = toPascalCase(snake);
    const category = CATEGORY[snake] || 'Collections';

    const pyParams = (m.params || [])
      .filter(p => p.name && !SKIP_PARAMS.has(p.name) && !p.name.startsWith('#'))
      .map(p => p.name);

    const hasJava = javaMethods.has(canon);
    const hasGo   = goMethods.has(canon);
    const hasCpp  = cppMethods.has(canon);
    const hasNode = nodeMethods.has(canon);
    const hasRest = restMethods.has(snake);

    const sdkCount = [true, hasJava, hasNode, hasGo, hasCpp, hasRest].filter(Boolean).length;

    methodRows.push({
      _key:      canon,
      Interface: canon,
      Category:  category,
      Python:    '✓',
      Java:      hasJava ? '✓' : '-',
      Node:      hasNode ? '✓' : '-',
      Go:        hasGo   ? '✓' : '-',
      'C++':     hasCpp  ? '✓' : '-',
      REST:      hasRest ? '✓' : '-',
      'SDK Count': sdkCount,
      Remarks:   METHOD_REMARKS[canon] || '',
    });

    const jParams = javaMap[canon] || new Set();
    const gParams = goMap[canon]   || new Set();
    const cParams = cppMap[canon]  || new Set();
    const nParams = nodeMap[canon] || new Set();
    const rParams = restMap[snake] || new Set();

    for (const param of pyParams) {
      const jRes = hasJava ? paramMatchResult(param, jParams) : { match: false, alias: null };
      const gRes = hasGo   ? paramMatchResult(param, gParams) : { match: false, alias: null };
      const cRes = hasCpp  ? paramMatchResult(param, cParams) : { match: false, alias: null };
      const nRes = hasNode ? paramMatchResult(param, nParams) : { match: false, alias: null };
      const rRes = hasRest ? paramMatchResult(param, rParams) : { match: false, alias: null };

      const paramCount = [true, jRes.match, nRes.match, gRes.match, cRes.match, rRes.match].filter(Boolean).length;

      // Auto-generate remarks from alias matches
      const remarkParts = [];
      if (nRes.alias) remarkParts.push(`Node: \`${nRes.alias}\``);
      if (gRes.alias) remarkParts.push(`Go: \`${gRes.alias}\``);
      if (jRes.alias) remarkParts.push(`Java: \`${jRes.alias}\``);
      if (cRes.alias) remarkParts.push(`C++: \`${cRes.alias}\``);
      if (rRes.alias) remarkParts.push(`REST: \`${rRes.alias}\``);

      paramRows.push({
        _parentKey: canon,
        Interface:  canon,
        Category:   category,
        Parameter:  param,
        Python:     '✓',
        Java:       jRes.match ? '✓' : '-',
        Node:       nRes.match ? '✓' : '-',
        Go:         gRes.match ? '✓' : '-',
        'C++':      cRes.match ? '✓' : '-',
        REST:       rRes.match ? '✓' : '-',
        'SDK Count': paramCount,
        Remarks:    remarkParts.join('; '),
      });
    }
  }

  console.log(`\nBuild summary:`);
  console.log(`  Method rows:  ${methodRows.length}`);
  console.log(`  Param rows:   ${paramRows.length}`);
  console.log(`  Total:        ${methodRows.length + paramRows.length}`);

  // Always write markdown (even in dry-run for review)
  writeMarkdown(methodRows, paramRows);

  if (DRY_RUN) {
    console.log('\n[dry-run] Sample method rows:');
    methodRows.slice(0, 3).forEach(r => { const {_key,...f}=r; console.log(' ', JSON.stringify(f)); });
    console.log('[dry-run] Sample param rows (with remarks):');
    paramRows.filter(r => r.Remarks).slice(0, 5).forEach(r => { const {_parentKey,...f}=r; console.log(' ', JSON.stringify(f)); });
    return;
  }

  console.log('\nEnsuring fields exist...');
  await ensureField('REST', 3);     // SingleSelect
  await ensureField('Remarks', 1);  // Text

  console.log('\nFetching existing records...');
  const listUrl  = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${BASE_TOKEN}/tables/${TABLE_ID}/records?page_size=500`;
  const listData = await (await fetch(listUrl, { method: 'GET', headers: await apiHeaders() })).json();
  if (listData.code !== 0) throw new Error(`list records: ${listData.msg}`);
  const existing = listData.data.items || [];
  console.log(`  Found ${existing.length} existing records`);

  if (existing.length > 0) {
    console.log('Deleting all existing records...');
    await batchDelete(existing.map(r => r.record_id));
  }

  console.log('\nCreating method rows...');
  const methodFields  = methodRows.map(({ _key, ...f }) => f);
  const createdMethods = await batchCreate(methodFields);

  const canonToId = {};
  for (let i = 0; i < methodRows.length; i++) {
    canonToId[methodRows[i]._key] = createdMethods[i].record_id;
  }

  console.log('\nCreating param rows...');
  const paramFields = paramRows.map(({ _parentKey, ...f }) => {
    const parentId = canonToId[_parentKey];
    if (parentId) f['父记录'] = [parentId];
    return f;
  });
  await batchCreate(paramFields);

  console.log('\nDone.');
  console.log(`Created ${methodRows.length} method rows + ${paramRows.length} param rows`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
