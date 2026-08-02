const fs = require('fs');
const path = require('path');

const specPath = path.resolve(__dirname, '..', 'specs', 'openapi-milvus.json');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

// 1. Add externalField to FieldSchema
spec.components.schemas.FieldSchema.properties.externalField = {
  type: 'string',
  description: 'The name of the corresponding column in the external source. Required when creating an external collection.',
  'x-i18n': {
    'zh-CN': {
      description: '外部数据源中对应列的名称。创建外部集合时必填。'
    }
  }
};

// 2. Extract CollectionSchema from CustomSetupCollection.schema
const collectionSchemaDef = {
  type: 'object',
  description: 'The schema is responsible for organizing data in the target collection. A valid schema should have multiple fields, which must include a primary key, a vector field, and several scalar fields.',
  'x-i18n': {
    'zh-CN': {
      description: 'Schema 决定了 Collection 中数据的组织方式。一个有效的 Schema 应包含多个字段，其中必须包含主键字段、向量字段以及多个标量字段。'
    }
  },
  properties: {
    autoID: spec.components.schemas.CustomSetupCollection.properties.schema.properties.autoID,
    enableDynamicField: spec.components.schemas.CustomSetupCollection.properties.schema.properties.enableDynamicField,
    fields: spec.components.schemas.CustomSetupCollection.properties.schema.properties.fields,
    functions: spec.components.schemas.CustomSetupCollection.properties.schema.properties.functions,
    externalSource: {
      type: 'string',
      description: 'The external data source identifier (e.g., "mysql"). Required when creating an external collection.',
      'x-i18n': {
        'zh-CN': {
          description: '外部数据源标识符（例如 "mysql"）。创建外部集合时必填。'
        }
      }
    },
    externalSpec: {
      type: 'string',
      description: 'A JSON-encoded string describing the connection parameters for the external source. Required when creating an external collection.',
      'x-i18n': {
        'zh-CN': {
          description: '描述外部数据源连接参数的 JSON 字符串。创建外部集合时必填。'
        }
      }
    }
  }
};

// Insert CollectionSchema before CustomSetupCollection
const schemaEntries = Object.entries(spec.components.schemas);
const customIndex = schemaEntries.findIndex(([k]) => k === 'CustomSetupCollection');
schemaEntries.splice(customIndex, 0, ['CollectionSchema', collectionSchemaDef]);

// 3. Replace CustomSetupCollection.schema inline object with $ref
schemaEntries[customIndex + 1][1].properties.schema = {
  description: 'The schema is responsible for organizing data in the target collection. A valid schema should have multiple fields, which must include a primary key, a vector field, and several scalar fields. Setting this parameter means that `dimension`, `idType`, `autoID`, `primaryFieldName`, and `vectorFieldName` will be ignored.',
  'x-i18n': {
    'zh-CN': {
      description: 'Schema 决定了 Collection 中数据的组织方式。一个有效的 Schema 应包含多个字段，其中必须包含主键字段、向量字段以及多个标量字段。设置本参数时，`dimension`、 `idType`、`autoID`、`primaryFieldName`、`vectorFieldName` 等参数将被忽略。'
    }
  },
  allOf: [
    { '$ref': '#/components/schemas/CollectionSchema' }
  ]
};

// 4. Create ExternalSetupCollection
const externalSetupCollection = {
  'x-tab-label': 'external setup',
  type: 'object',
  properties: {
    dbName: schemaEntries[customIndex + 1][1].properties.dbName,
    collectionName: schemaEntries[customIndex + 1][1].properties.collectionName,
    schema: {
      description: 'The schema for an external collection. Must include fields with externalField mappings, plus externalSource and externalSpec.',
      'x-i18n': {
        'zh-CN': {
          description: '外部集合的 Schema。必须包含带有 externalField 映射的字段，以及 externalSource 和 externalSpec。'
        }
      },
      allOf: [
        { '$ref': '#/components/schemas/CollectionSchema' }
      ],
      required: ['externalSource', 'externalSpec']
    },
    indexParams: schemaEntries[customIndex + 1][1].properties.indexParams,
    params: schemaEntries[customIndex + 1][1].properties.params,
    description: schemaEntries[customIndex + 1][1].properties.description
  }
};

// Insert ExternalSetupCollection after CustomSetupCollection
schemaEntries.splice(customIndex + 2, 0, ['ExternalSetupCollection', externalSetupCollection]);

// 5. Update CreateCollectionRequest.oneOf
const createCollectionReq = schemaEntries.find(([k]) => k === 'CreateCollectionRequest')[1];
createCollectionReq.oneOf.push({ '$ref': '#/components/schemas/ExternalSetupCollection' });

spec.components.schemas = Object.fromEntries(schemaEntries);

// 6. Add new path schemas
spec.components.schemas.RefreshExternalCollectionRequest = {
  type: 'object',
  properties: {
    dbName: {
      type: 'string',
      description: 'The name of the database.',
      'x-i18n': {
        'zh-CN': { description: '数据库名称。' }
      }
    },
    collectionName: {
      type: 'string',
      description: 'The name of the collection to refresh.',
      'x-i18n': {
        'zh-CN': { description: '待刷新 Collection 的名称。' }
      }
    },
    externalSource: {
      type: 'string',
      description: 'The external data source identifier.',
      'x-i18n': {
        'zh-CN': { description: '外部数据源标识符。' }
      }
    },
    externalSpec: {
      type: 'string',
      description: 'A JSON-encoded string describing the connection parameters for the external source.',
      'x-i18n': {
        'zh-CN': { description: '描述外部数据源连接参数的 JSON 字符串。' }
      }
    }
  },
  required: ['collectionName']
};

spec.components.schemas.RefreshExternalCollectionProgressRequest = {
  type: 'object',
  properties: {
    jobId: {
      type: 'integer',
      description: 'The ID of the external collection refresh job.',
      'x-i18n': {
        'zh-CN': { description: '外部集合刷新任务 ID。' }
      }
    }
  },
  required: ['jobId']
};

spec.components.schemas.RefreshExternalCollectionJobInfo = {
  type: 'object',
  properties: {
    jobId: {
      type: 'integer',
      description: 'The ID of the job.',
      'x-i18n': {
        'zh-CN': { description: '任务 ID。' }
      }
    },
    collectionName: {
      type: 'string',
      description: 'The name of the target collection.',
      'x-i18n': {
        'zh-CN': { description: '目标 Collection 名称。' }
      }
    },
    state: {
      type: 'string',
      description: 'The current state of the job.',
      'x-i18n': {
        'zh-CN': { description: '任务当前状态。' }
      }
    },
    progress: {
      type: 'integer',
      description: 'The progress percentage of the job.',
      'x-i18n': {
        'zh-CN': { description: '任务进度百分比。' }
      }
    },
    externalSource: {
      type: 'string',
      description: 'The external data source identifier.',
      'x-i18n': {
        'zh-CN': { description: '外部数据源标识符。' }
      }
    },
    startTime: {
      type: 'integer',
      description: 'The Unix timestamp when the job started.',
      'x-i18n': {
        'zh-CN': { description: '任务开始时间的 Unix 时间戳。' }
      }
    },
    endTime: {
      type: 'integer',
      description: 'The Unix timestamp when the job ended.',
      'x-i18n': {
        'zh-CN': { description: '任务结束时间的 Unix 时间戳。' }
      }
    },
    reason: {
      type: 'string',
      description: 'The reason if the job failed.',
      'x-i18n': {
        'zh-CN': { description: '任务失败的原因。' }
      }
    }
  }
};

// 7. Add new paths
const externalTag = 'External Collection Operations (V2)';

spec.paths['/v2/vectordb/jobs/external_collection/refresh'] = {
  post: {
    summary: 'Refreshes an external collection',
    deprecated: false,
    description: 'This operation triggers a refresh job for an external collection.',
    'x-i18n': {
      'zh-CN': {
        summary: '刷新外部集合',
        description: '本接口可为外部集合触发刷新任务。'
      }
    },
    tags: [externalTag],
    parameters: [
      { '$ref': '#/components/parameters/AuthorizationHeader' }
    ],
    requestBody: {
      content: {
        'application/json': {
          schema: { '$ref': '#/components/schemas/RefreshExternalCollectionRequest' }
        }
      }
    },
    responses: {
      '200': {
        description: 'Returns the job ID.',
        'x-i18n': {
          'zh-CN': { description: '返回任务 ID。' }
        },
        content: {
          'application/json': {
            schema: {
              anyOf: [
                { '$ref': '#/components/schemas/EmptyResponse' },
                { '$ref': '#/components/schemas/ErrorResponse' }
              ]
            }
          }
        }
      }
    }
  }
};

spec.paths['/v2/vectordb/jobs/external_collection/describe'] = {
  post: {
    summary: 'Describes an external collection refresh job',
    deprecated: false,
    description: 'This operation returns the details of a specific external collection refresh job.',
    'x-i18n': {
      'zh-CN': {
        summary: '查看外部集合刷新任务详情',
        description: '本接口可返回指定外部集合刷新任务的详细信息。'
      }
    },
    tags: [externalTag],
    parameters: [
      { '$ref': '#/components/parameters/AuthorizationHeader' }
    ],
    requestBody: {
      content: {
        'application/json': {
          schema: { '$ref': '#/components/schemas/RefreshExternalCollectionProgressRequest' }
        }
      }
    },
    responses: {
      '200': {
        description: 'Returns the job details.',
        'x-i18n': {
          'zh-CN': { description: '返回任务详情。' }
        },
        content: {
          'application/json': {
            schema: {
              anyOf: [
                { '$ref': '#/components/schemas/EmptyResponse' },
                { '$ref': '#/components/schemas/ErrorResponse' }
              ]
            }
          }
        }
      }
    }
  }
};

spec.paths['/v2/vectordb/jobs/external_collection/list'] = {
  post: {
    summary: 'Lists external collection refresh jobs',
    deprecated: false,
    description: 'This operation lists all external collection refresh jobs.',
    'x-i18n': {
      'zh-CN': {
        summary: '查看外部集合刷新任务列表',
        description: '本接口可列出所有外部集合刷新任务。'
      }
    },
    tags: [externalTag],
    parameters: [
      { '$ref': '#/components/parameters/AuthorizationHeader' }
    ],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              dbName: {
                type: 'string',
                description: 'The name of the database.',
                'x-i18n': {
                  'zh-CN': { description: '数据库名称。' }
                }
              },
              collectionName: {
                type: 'string',
                description: 'The name of the collection.',
                'x-i18n': {
                  'zh-CN': { description: 'Collection 名称。' }
                }
              }
            }
          }
        }
      }
    },
    responses: {
      '200': {
        description: 'Returns a list of job records.',
        'x-i18n': {
          'zh-CN': { description: '返回任务记录列表。' }
        },
        content: {
          'application/json': {
            schema: {
              anyOf: [
                { '$ref': '#/components/schemas/EmptyResponse' },
                { '$ref': '#/components/schemas/ErrorResponse' }
              ]
            }
          }
        }
      }
    }
  }
};

// 8. Add example for external setup to /v2/vectordb/collections/create
const createPath = spec.paths['/v2/vectordb/collections/create'];
if (createPath && createPath.post && createPath.post.requestBody && createPath.post.requestBody.content && createPath.post.requestBody.content['application/json']) {
  createPath.post.requestBody.content['application/json'].examples['6'] = {
    summary: 'External setup',
    'x-target-request': 'OPTION 3',
    value: {
      collectionName: 'external_demo',
      schema: {
        externalSource: 'mysql',
        externalSpec: '{"host":"localhost","port":3306}',
        fields: [
          { fieldName: 'my_id', dataType: 'Int64', isPrimary: true },
          { fieldName: 'my_vector', dataType: 'FloatVector', elementTypeParams: { dim: '5' } },
          { fieldName: 'price', dataType: 'Float', externalField: 'unit_price' }
        ]
      }
    }
  };
}

// 9. Also add external example to response examples if any
if (createPath && createPath.post && createPath.post.responses && createPath.post.responses['200'] && createPath.post.responses['200'].content && createPath.post.responses['200'].content['application/json']) {
  const respExamples = createPath.post.responses['200'].content['application/json'].examples;
  if (respExamples) {
    respExamples['3'] = {
      summary: 'success',
      'x-target-response': 'OPTION 3',
      value: {
        code: 0,
        data: {}
      }
    };
  }
}

fs.writeFileSync(specPath, JSON.stringify(spec, null, '\t') + '\n');
console.log('Patched openapi-milvus.json successfully.');
