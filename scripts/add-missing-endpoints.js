#!/usr/bin/env node
/**
 * Add 16 missing endpoints to specs/openapi-milvus.json.
 *
 * Missing endpoints:
 * 1.  /v2/vectordb/collections/add_function
 * 2.  /v2/vectordb/collections/alter_function
 * 3.  /v2/vectordb/collections/drop_function
 * 4.  /v2/vectordb/databases/alter_properties
 * 5.  /v2/vectordb/privilege_groups/create
 * 6.  /v2/vectordb/privilege_groups/drop
 * 7.  /v2/vectordb/privilege_groups/list
 * 8.  /v2/vectordb/privilege_groups/add_privileges_to_group
 * 9.  /v2/vectordb/privilege_groups/remove_privileges_from_group
 * 10. /v2/vectordb/roles/grant_privilege_v2
 * 11. /v2/vectordb/roles/revoke_privilege_v2
 * 12. /v2/vectordb/entities/advanced_search
 * 13. /v2/vectordb/common/run_analyzer
 * 14. /v2/vectordb/quotacenter/describe
 * 15. /v2/vectordb/segments/describe
 * (15 paths — advanced_search delegates to hybrid_search so it shares schema)
 */

const fs = require('fs');
const path = require('path');

const SPEC_PATH = path.resolve(__dirname, '../specs/openapi-milvus.json');
const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));

// ─── Shared patterns ──────────────────────────────────────────────────────────
const AUTH_HEADER = { $ref: '#/components/parameters/AuthorizationHeader' };

const EMPTY_SUCCESS = {
    '200': {
        description: 'None',
        content: {
            'application/json': {
                schema: {
                    anyOf: [
                        { $ref: '#/components/schemas/EmptyResponse' },
                        { $ref: '#/components/schemas/ErrorResponse' },
                    ]
                },
                examples: {
                    '1': { summary: 'success', 'x-target-response': 'OPTION 1', value: { code: 0, data: {} } },
                    '2': { summary: 'failure', 'x-target-response': 'OPTION 2', value: { code: 800, message: 'not enough permission' } }
                }
            }
        }
    }
};

function collectionEndpoint(summary, zhSummary, description, zhDescription, tag, bodySchema, example) {
    return {
        post: {
            summary,
            deprecated: false,
            description,
            'x-i18n': {
                'zh-CN': { summary: zhSummary, description: zhDescription }
            },
            tags: [tag],
            parameters: [AUTH_HEADER],
            requestBody: {
                content: {
                    'application/json': {
                        schema: bodySchema,
                        example,
                    }
                }
            },
            responses: EMPTY_SUCCESS,
        }
    };
}

// ─── 1. /v2/vectordb/collections/add_function ────────────────────────────────
spec.paths['/v2/vectordb/collections/add_function'] = {
    post: {
        summary: 'Add Function to Collection',
        deprecated: false,
        description: 'This operation adds a function to the schema of an existing collection.',
        'x-i18n': { 'zh-CN': { summary: '向 Collection 添加 Function', description: '本接口将 Function 添加到现有 Collection 的 Schema 中。' } },
        tags: ['Collection Operations (V2)'],
        parameters: [AUTH_HEADER],
        requestBody: {
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            dbName: { type: 'string', description: 'The name of the database.', 'x-i18n': { 'zh-CN': { description: '数据库名称。' } } },
                            collectionName: { type: 'string', description: 'The name of the collection.', 'x-i18n': { 'zh-CN': { description: 'Collection 名称。' } } },
                            function: { $ref: '#/components/schemas/FunctionSchema' },
                        },
                        required: ['collectionName', 'function'],
                    },
                    example: {
                        collectionName: 'my_collection',
                        function: {
                            name: 'bm25_fn',
                            type: 'FunctionType.BM25',
                            inputFieldNames: ['text'],
                            outputFieldNames: ['sparse'],
                        }
                    }
                }
            }
        },
        responses: EMPTY_SUCCESS,
    }
};

// ─── 2. /v2/vectordb/collections/alter_function ──────────────────────────────
spec.paths['/v2/vectordb/collections/alter_function'] = {
    post: {
        summary: 'Alter Function in Collection',
        deprecated: false,
        description: 'This operation alters an existing function in the schema of a collection.',
        'x-i18n': { 'zh-CN': { summary: '修改 Collection 的 Function', description: '本接口修改 Collection Schema 中的现有 Function。' } },
        tags: ['Collection Operations (V2)'],
        parameters: [AUTH_HEADER],
        requestBody: {
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            dbName: { type: 'string', description: 'The name of the database.', 'x-i18n': { 'zh-CN': { description: '数据库名称。' } } },
                            collectionName: { type: 'string', description: 'The name of the collection.', 'x-i18n': { 'zh-CN': { description: 'Collection 名称。' } } },
                            functionName: { type: 'string', description: 'The name of the function to alter.', 'x-i18n': { 'zh-CN': { description: '待修改的 Function 名称。' } } },
                            function: { $ref: '#/components/schemas/FunctionSchema' },
                        },
                        required: ['collectionName', 'functionName', 'function'],
                    },
                    example: {
                        collectionName: 'my_collection',
                        functionName: 'bm25_fn',
                        function: {
                            name: 'bm25_fn',
                            type: 'FunctionType.BM25',
                            inputFieldNames: ['text'],
                            outputFieldNames: ['sparse'],
                        }
                    }
                }
            }
        },
        responses: EMPTY_SUCCESS,
    }
};

// ─── 3. /v2/vectordb/collections/drop_function ───────────────────────────────
spec.paths['/v2/vectordb/collections/drop_function'] = {
    post: {
        summary: 'Drop Function from Collection',
        deprecated: false,
        description: 'This operation drops a function from the schema of a collection.',
        'x-i18n': { 'zh-CN': { summary: '从 Collection 删除 Function', description: '本接口从 Collection Schema 中删除指定的 Function。' } },
        tags: ['Collection Operations (V2)'],
        parameters: [AUTH_HEADER],
        requestBody: {
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            dbName: { type: 'string', description: 'The name of the database.', 'x-i18n': { 'zh-CN': { description: '数据库名称。' } } },
                            collectionName: { type: 'string', description: 'The name of the collection.', 'x-i18n': { 'zh-CN': { description: 'Collection 名称。' } } },
                            FunctionName: { type: 'string', description: 'The name of the function to drop.', 'x-i18n': { 'zh-CN': { description: '待删除的 Function 名称。' } } },
                        },
                        required: ['collectionName', 'FunctionName'],
                    },
                    example: { collectionName: 'my_collection', FunctionName: 'bm25_fn' }
                }
            }
        },
        responses: EMPTY_SUCCESS,
    }
};

// ─── 4. /v2/vectordb/databases/alter_properties ──────────────────────────────
spec.paths['/v2/vectordb/databases/alter_properties'] = {
    post: {
        summary: 'Alter Database Properties',
        deprecated: false,
        description: 'This operation alters the properties of a database.',
        'x-i18n': { 'zh-CN': { summary: '修改数据库属性', description: '本接口修改指定数据库的属性。' } },
        tags: ['Database Operations (V2)'],
        parameters: [AUTH_HEADER],
        requestBody: {
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            dbName: { type: 'string', description: 'The name of the database to alter.', 'x-i18n': { 'zh-CN': { description: '待修改的数据库名称。' } } },
                            properties: {
                                type: 'object',
                                description: 'The properties to set on the database as key-value pairs.',
                                'x-i18n': { 'zh-CN': { description: '以键值对形式设置的数据库属性。' } },
                            },
                        },
                        required: ['dbName'],
                    },
                    example: { dbName: 'my_database', properties: { 'database.replica.number': '2' } }
                }
            }
        },
        responses: EMPTY_SUCCESS,
    }
};

// ─── 5-9. /v2/vectordb/privilege_groups/* ────────────────────────────────────
// Add tag first
const PRIV_TAG = 'Privilege Group Operations (V2)';
if (!spec.tags.find(t => t.name === PRIV_TAG)) {
    spec.tags.push({
        name: PRIV_TAG,
        description: 'Operations for managing privilege groups.',
        'x-i18n': { 'zh-CN': { description: '用于管理权限组的接口。' } },
    });
}

spec.paths['/v2/vectordb/privilege_groups/create'] = {
    post: {
        summary: 'Create Privilege Group',
        deprecated: false,
        description: 'This operation creates a privilege group with the specified privileges.',
        'x-i18n': { 'zh-CN': { summary: '创建权限组', description: '本接口创建包含指定权限的权限组。' } },
        tags: [PRIV_TAG],
        parameters: [AUTH_HEADER],
        requestBody: {
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            privilegeGroupName: { type: 'string', description: 'The name of the privilege group to create.', 'x-i18n': { 'zh-CN': { description: '待创建的权限组名称。' } } },
                            privileges: {
                                type: 'array', items: { type: 'string' },
                                description: 'A list of privilege names to include in the group.',
                                'x-i18n': { 'zh-CN': { description: '权限组中包含的权限名称列表。' } },
                            },
                        },
                        required: ['privilegeGroupName'],
                    },
                    example: { privilegeGroupName: 'my_priv_group', privileges: ['Insert', 'Search'] }
                }
            }
        },
        responses: EMPTY_SUCCESS,
    }
};

spec.paths['/v2/vectordb/privilege_groups/drop'] = {
    post: {
        summary: 'Drop Privilege Group',
        deprecated: false,
        description: 'This operation drops a privilege group.',
        'x-i18n': { 'zh-CN': { summary: '删除权限组', description: '本接口删除指定的权限组。' } },
        tags: [PRIV_TAG],
        parameters: [AUTH_HEADER],
        requestBody: {
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            privilegeGroupName: { type: 'string', description: 'The name of the privilege group to drop.', 'x-i18n': { 'zh-CN': { description: '待删除的权限组名称。' } } },
                        },
                        required: ['privilegeGroupName'],
                    },
                    example: { privilegeGroupName: 'my_priv_group' }
                }
            }
        },
        responses: EMPTY_SUCCESS,
    }
};

spec.paths['/v2/vectordb/privilege_groups/list'] = {
    post: {
        summary: 'List Privilege Groups',
        deprecated: false,
        description: 'This operation lists all privilege groups in the current database.',
        'x-i18n': { 'zh-CN': { summary: '列出权限组', description: '本接口列出当前数据库中的所有权限组。' } },
        tags: [PRIV_TAG],
        parameters: [AUTH_HEADER],
        requestBody: {
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            dbName: { type: 'string', description: 'The name of the database.', 'x-i18n': { 'zh-CN': { description: '数据库名称。' } } },
                        },
                    },
                    example: {}
                }
            }
        },
        responses: {
            '200': {
                description: 'None',
                content: {
                    'application/json': {
                        schema: {
                            anyOf: [
                                {
                                    type: 'object',
                                    properties: {
                                        code: { type: 'integer' },
                                        data: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    privilegeGroupName: { type: 'string' },
                                                    privileges: { type: 'array', items: { type: 'string' } },
                                                }
                                            }
                                        }
                                    }
                                },
                                { $ref: '#/components/schemas/ErrorResponse' }
                            ]
                        },
                        examples: {
                            '1': { summary: 'success', 'x-target-response': 'OPTION 1', value: { code: 0, data: [{ privilegeGroupName: 'my_priv_group', privileges: ['Insert', 'Search'] }] } },
                            '2': { summary: 'failure', 'x-target-response': 'OPTION 2', value: { code: 800, message: 'not enough permission' } }
                        }
                    }
                }
            }
        }
    }
};

spec.paths['/v2/vectordb/privilege_groups/add_privileges_to_group'] = {
    post: {
        summary: 'Add Privileges to Group',
        deprecated: false,
        description: 'This operation adds one or more privileges to an existing privilege group.',
        'x-i18n': { 'zh-CN': { summary: '向权限组添加权限', description: '本接口将一个或多个权限添加到现有权限组中。' } },
        tags: [PRIV_TAG],
        parameters: [AUTH_HEADER],
        requestBody: {
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            privilegeGroupName: { type: 'string', description: 'The name of the privilege group.', 'x-i18n': { 'zh-CN': { description: '权限组名称。' } } },
                            privileges: {
                                type: 'array', items: { type: 'string' },
                                description: 'A list of privilege names to add to the group.',
                                'x-i18n': { 'zh-CN': { description: '待添加到权限组的权限名称列表。' } },
                            },
                        },
                        required: ['privilegeGroupName', 'privileges'],
                    },
                    example: { privilegeGroupName: 'my_priv_group', privileges: ['Delete', 'Upsert'] }
                }
            }
        },
        responses: EMPTY_SUCCESS,
    }
};

spec.paths['/v2/vectordb/privilege_groups/remove_privileges_from_group'] = {
    post: {
        summary: 'Remove Privileges from Group',
        deprecated: false,
        description: 'This operation removes one or more privileges from a privilege group.',
        'x-i18n': { 'zh-CN': { summary: '从权限组移除权限', description: '本接口从权限组中移除一个或多个权限。' } },
        tags: [PRIV_TAG],
        parameters: [AUTH_HEADER],
        requestBody: {
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            privilegeGroupName: { type: 'string', description: 'The name of the privilege group.', 'x-i18n': { 'zh-CN': { description: '权限组名称。' } } },
                            privileges: {
                                type: 'array', items: { type: 'string' },
                                description: 'A list of privilege names to remove from the group.',
                                'x-i18n': { 'zh-CN': { description: '待从权限组中移除的权限名称列表。' } },
                            },
                        },
                        required: ['privilegeGroupName', 'privileges'],
                    },
                    example: { privilegeGroupName: 'my_priv_group', privileges: ['Delete'] }
                }
            }
        },
        responses: EMPTY_SUCCESS,
    }
};

// ─── 10-11. /v2/vectordb/roles/grant_privilege_v2 and revoke_privilege_v2 ────
const grantV2Schema = {
    type: 'object',
    properties: {
        roleName: { type: 'string', description: 'The name of the role.', 'x-i18n': { 'zh-CN': { description: '角色名称。' } } },
        privilege: { type: 'string', description: 'The privilege to grant or revoke.', 'x-i18n': { 'zh-CN': { description: '待授予或撤销的权限。' } } },
        dbName: { type: 'string', description: 'The name of the database to which the privilege applies. Use `*` for all databases.', 'x-i18n': { 'zh-CN': { description: '权限适用的数据库名称。使用 `*` 表示所有数据库。' } } },
        collectionName: { type: 'string', description: 'The name of the collection to which the privilege applies. Use `*` for all collections.', 'x-i18n': { 'zh-CN': { description: '权限适用的 Collection 名称。使用 `*` 表示所有 Collection。' } } },
    },
    required: ['roleName', 'privilege'],
};

spec.paths['/v2/vectordb/roles/grant_privilege_v2'] = {
    post: {
        summary: 'Grant Privilege To Role (V2)',
        deprecated: false,
        description: 'This operation grants a privilege to a role at the global, database, or collection level.',
        'x-i18n': { 'zh-CN': { summary: '授予角色权限（V2）', description: '本接口在全局、数据库或 Collection 级别将权限授予指定角色。' } },
        tags: ['Role Operations (V2)'],
        parameters: [AUTH_HEADER],
        requestBody: {
            content: {
                'application/json': {
                    schema: grantV2Schema,
                    example: { roleName: 'my_role', privilege: 'Insert', dbName: 'my_database', collectionName: 'my_collection' }
                }
            }
        },
        responses: EMPTY_SUCCESS,
    }
};

spec.paths['/v2/vectordb/roles/revoke_privilege_v2'] = {
    post: {
        summary: 'Revoke Privilege From Role (V2)',
        deprecated: false,
        description: 'This operation revokes a privilege from a role at the global, database, or collection level.',
        'x-i18n': { 'zh-CN': { summary: '撤销角色权限（V2）', description: '本接口在全局、数据库或 Collection 级别撤销指定角色的权限。' } },
        tags: ['Role Operations (V2)'],
        parameters: [AUTH_HEADER],
        requestBody: {
            content: {
                'application/json': {
                    schema: grantV2Schema,
                    example: { roleName: 'my_role', privilege: 'Insert', dbName: 'my_database', collectionName: 'my_collection' }
                }
            }
        },
        responses: EMPTY_SUCCESS,
    }
};

// ─── 12. /v2/vectordb/entities/advanced_search ───────────────────────────────
// backward-compatible alias for hybrid_search
spec.paths['/v2/vectordb/entities/advanced_search'] = {
    post: {
        summary: 'Advanced Search (Hybrid)',
        deprecated: true,
        description: 'This operation performs a hybrid search across multiple vector fields. This path is a backward-compatible alias for `/v2/vectordb/entities/hybrid_search`.',
        'x-i18n': { 'zh-CN': { summary: '高级搜索（混合）', description: '本接口在多个向量字段上执行混合搜索。该路径是 `/v2/vectordb/entities/hybrid_search` 的向后兼容别名。' } },
        tags: ['Vector Operations (V2)'],
        parameters: [AUTH_HEADER],
        requestBody: { $ref: '#/paths/~1v2~1vectordb~1entities~1hybrid_search/post/requestBody' },
        responses: { $ref: '#/paths/~1v2~1vectordb~1entities~1hybrid_search/post/responses' },
    }
};

// ─── 13. /v2/vectordb/common/run_analyzer ────────────────────────────────────
const COMMON_TAG = 'Common Operations (V2)';
if (!spec.tags.find(t => t.name === COMMON_TAG)) {
    spec.tags.push({
        name: COMMON_TAG,
        description: 'Common utility operations.',
        'x-i18n': { 'zh-CN': { description: '通用工具接口。' } },
    });
}

spec.paths['/v2/vectordb/common/run_analyzer'] = {
    post: {
        summary: 'Run Analyzer',
        deprecated: false,
        description: 'This operation runs an analyzer on the provided text and returns the tokenization result.',
        'x-i18n': { 'zh-CN': { summary: '运行分析器', description: '本接口对提供的文本运行分析器，并返回分词结果。' } },
        tags: [COMMON_TAG],
        parameters: [AUTH_HEADER],
        requestBody: {
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            dbName: { type: 'string', description: 'The name of the database.', 'x-i18n': { 'zh-CN': { description: '数据库名称。' } } },
                            text: { type: 'array', items: { type: 'string' }, description: 'A list of text strings to analyze.', 'x-i18n': { 'zh-CN': { description: '待分析的文本字符串列表。' } } },
                            analyzerParams: { type: 'string', description: 'The analyzer parameters as a JSON string.', 'x-i18n': { 'zh-CN': { description: '以 JSON 字符串形式表示的分析器参数。' } } },
                            withDetail: { type: 'boolean', description: 'Whether to return detailed token information.', 'x-i18n': { 'zh-CN': { description: '是否返回详细的词元信息。' } } },
                            withHash: { type: 'boolean', description: 'Whether to include hash values in the result.', 'x-i18n': { 'zh-CN': { description: '是否在结果中包含哈希值。' } } },
                            collectionName: { type: 'string', description: 'The name of the collection whose field analyzer to use.', 'x-i18n': { 'zh-CN': { description: '使用其字段分析器的 Collection 名称。' } } },
                            fieldName: { type: 'string', description: 'The name of the field whose analyzer to use.', 'x-i18n': { 'zh-CN': { description: '使用其分析器的字段名称。' } } },
                            analyzerNames: { type: 'array', items: { type: 'string' }, description: 'A list of analyzer names to use.', 'x-i18n': { 'zh-CN': { description: '待使用的分析器名称列表。' } } },
                        },
                        required: ['text'],
                    },
                    example: {
                        text: ['Hello world'],
                        analyzerParams: '{"type": "standard"}',
                        withDetail: false,
                    }
                }
            }
        },
        responses: {
            '200': {
                description: 'None',
                content: {
                    'application/json': {
                        schema: {
                            anyOf: [
                                {
                                    type: 'object',
                                    properties: {
                                        code: { type: 'integer' },
                                        data: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    tokens: { type: 'array', items: { type: 'string' } },
                                                }
                                            }
                                        }
                                    }
                                },
                                { $ref: '#/components/schemas/ErrorResponse' }
                            ]
                        },
                        examples: {
                            '1': { summary: 'success', 'x-target-response': 'OPTION 1', value: { code: 0, data: [{ tokens: ['hello', 'world'] }] } },
                            '2': { summary: 'failure', 'x-target-response': 'OPTION 2', value: { code: 800, message: 'not enough permission' } }
                        }
                    }
                }
            }
        }
    }
};

// ─── 14. /v2/vectordb/quotacenter/describe ───────────────────────────────────
const QUOTA_TAG = 'Quota Operations (V2)';
if (!spec.tags.find(t => t.name === QUOTA_TAG)) {
    spec.tags.push({
        name: QUOTA_TAG,
        description: 'Operations for querying quota metrics.',
        'x-i18n': { 'zh-CN': { description: '用于查询配额指标的接口。' } },
    });
}

spec.paths['/v2/vectordb/quotacenter/describe'] = {
    post: {
        summary: 'Describe Quota Metrics',
        deprecated: false,
        description: 'This operation returns quota and rate-limit metrics for the current Milvus instance.',
        'x-i18n': { 'zh-CN': { summary: '获取配额指标', description: '本接口返回当前 Milvus 实例的配额和速率限制指标。' } },
        tags: [QUOTA_TAG],
        parameters: [AUTH_HEADER],
        requestBody: {
            content: {
                'application/json': {
                    schema: { type: 'object', properties: {} },
                    example: {}
                }
            }
        },
        responses: {
            '200': {
                description: 'None',
                content: {
                    'application/json': {
                        schema: {
                            anyOf: [
                                {
                                    type: 'object',
                                    properties: {
                                        code: { type: 'integer' },
                                        data: { type: 'object', description: 'Quota metrics data.' }
                                    }
                                },
                                { $ref: '#/components/schemas/ErrorResponse' }
                            ]
                        },
                        examples: {
                            '1': { summary: 'success', 'x-target-response': 'OPTION 1', value: { code: 0, data: {} } },
                            '2': { summary: 'failure', 'x-target-response': 'OPTION 2', value: { code: 800, message: 'not enough permission' } }
                        }
                    }
                }
            }
        }
    }
};

// ─── 15. /v2/vectordb/segments/describe ─────────────────────────────────────
const SEGMENT_TAG = 'Segment Operations (V2)';
if (!spec.tags.find(t => t.name === SEGMENT_TAG)) {
    spec.tags.push({
        name: SEGMENT_TAG,
        description: 'Operations for querying segment information.',
        'x-i18n': { 'zh-CN': { description: '用于查询 Segment 信息的接口。' } },
    });
}

spec.paths['/v2/vectordb/segments/describe'] = {
    post: {
        summary: 'Describe Segments',
        deprecated: false,
        description: 'This operation returns detailed information about specified segments in a collection.',
        'x-i18n': { 'zh-CN': { summary: '查询 Segment 信息', description: '本接口返回 Collection 中指定 Segment 的详细信息。' } },
        tags: [SEGMENT_TAG],
        parameters: [AUTH_HEADER],
        requestBody: {
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        properties: {
                            dbName: { type: 'string', description: 'The name of the database.', 'x-i18n': { 'zh-CN': { description: '数据库名称。' } } },
                            collectionID: { type: 'integer', format: 'int64', description: 'The ID of the collection.', 'x-i18n': { 'zh-CN': { description: 'Collection 的 ID。' } } },
                            segmentIDs: { type: 'array', items: { type: 'integer', format: 'int64' }, description: 'A list of segment IDs to describe.', 'x-i18n': { 'zh-CN': { description: '待查询的 Segment ID 列表。' } } },
                        },
                    },
                    example: { collectionID: 1234567890, segmentIDs: [111, 222] }
                }
            }
        },
        responses: {
            '200': {
                description: 'None',
                content: {
                    'application/json': {
                        schema: {
                            anyOf: [
                                {
                                    type: 'object',
                                    properties: {
                                        code: { type: 'integer' },
                                        data: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    segmentID: { type: 'integer', format: 'int64' },
                                                    collectionID: { type: 'integer', format: 'int64' },
                                                    state: { type: 'string' },
                                                    numRows: { type: 'integer', format: 'int64' },
                                                }
                                            }
                                        }
                                    }
                                },
                                { $ref: '#/components/schemas/ErrorResponse' }
                            ]
                        },
                        examples: {
                            '1': { summary: 'success', 'x-target-response': 'OPTION 1', value: { code: 0, data: [{ segmentID: 111, state: 'Sealed', numRows: 5000 }] } },
                            '2': { summary: 'failure', 'x-target-response': 'OPTION 2', value: { code: 800, message: 'not enough permission' } }
                        }
                    }
                }
            }
        }
    }
};

// ─── Write output ─────────────────────────────────────────────────────────────
fs.writeFileSync(SPEC_PATH, JSON.stringify(spec, null, '\t') + '\n');

const totalPaths = Object.keys(spec.paths).length;
const totalTags = spec.tags.length;
console.log(`Done. Paths: ${totalPaths}, Tags: ${totalTags}`);
console.log('New paths added:');
[
    '/v2/vectordb/collections/add_function',
    '/v2/vectordb/collections/alter_function',
    '/v2/vectordb/collections/drop_function',
    '/v2/vectordb/databases/alter_properties',
    '/v2/vectordb/privilege_groups/create',
    '/v2/vectordb/privilege_groups/drop',
    '/v2/vectordb/privilege_groups/list',
    '/v2/vectordb/privilege_groups/add_privileges_to_group',
    '/v2/vectordb/privilege_groups/remove_privileges_from_group',
    '/v2/vectordb/roles/grant_privilege_v2',
    '/v2/vectordb/roles/revoke_privilege_v2',
    '/v2/vectordb/entities/advanced_search',
    '/v2/vectordb/common/run_analyzer',
    '/v2/vectordb/quotacenter/describe',
    '/v2/vectordb/segments/describe',
].forEach(p => console.log(' ', spec.paths[p] ? '✓' : '✗', p));
