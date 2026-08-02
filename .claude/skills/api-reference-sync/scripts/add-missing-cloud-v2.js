#!/usr/bin/env node
/**
 * add-missing-cloud-v2.js — Add missing open v2 control-plane paths to openapi-cloud.json
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const SPEC_PATH = path.join(ROOT, 'specs', 'openapi-cloud.json');
const MERGE     = path.join(ROOT, 'scripts', 'merge-openapi.js');

const dryRun = process.argv.includes('--dry-run');

const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));

function authParam() {
  return {
    name: 'Authorization',
    in: 'header',
    description: 'The authentication token should be an API key with appropriate privileges.',
    required: true,
    example: 'Bearer {{TOKEN}}',
    schema: { type: 'string' },
    'x-i18n': { 'zh-CN': { description: '认证令牌，应为具备适当权限的 API 密钥。' } }
  };
}

function acceptParam() {
  return {
    name: 'Accept',
    in: 'header',
    description: 'Use `application/json`.',
    required: false,
    example: 'application/json',
    schema: { type: 'string' },
    'x-i18n': { 'zh-CN': { description: '使用 `application/json`。' } }
  };
}

function pathParam(name, description, example) {
  return {
    name,
    in: 'path',
    description,
    required: true,
    example,
    schema: { type: 'string' },
    'x-i18n': { 'zh-CN': { description: description.replace(/ID of the/, '').replace(/whose/, '的').replace(/to/, '待') } }
  };
}

function successWrapper(dataProps, dataDesc, dataDescZh) {
  return {
    'x-tab-label': 'success',
    type: 'object',
    properties: {
      code: {
        type: 'integer',
        description: 'Response code.',
        'x-i18n': { 'zh-CN': { description: '响应码。' } }
      },
      data: {
        type: 'object',
        properties: dataProps,
        description: dataDesc,
        'x-i18n': { 'zh-CN': { description: dataDescZh } }
      }
    }
  };
}

function failureWrapper() {
  return {
    'x-tab-label': 'failure',
    type: 'object',
    properties: {
      code: {
        type: 'integer',
        description: 'Response code.',
        'x-i18n': { 'zh-CN': { description: '响应码。' } }
      },
      message: {
        type: 'string',
        description: 'Error message.',
        'x-i18n': { 'zh-CN': { description: '错误描述。' } }
      }
    },
    description: 'A failure response.',
    'x-i18n': { 'zh-CN': { description: '失败响应。' } },
    'x-i18n-langs': ['zh-CN']
  };
}

function response200(dataProps, dataDesc, dataDescZh, respDesc, respDescZh) {
  return {
    '200': {
      description: respDesc,
      'x-i18n': { 'zh-CN': { description: respDescZh } },
      content: {
        'application/json': {
          schema: {
            anyOf: [
              successWrapper(dataProps, dataDesc, dataDescZh),
              failureWrapper()
            ]
          }
        }
      }
    }
  };
}

// ─── New paths ───────────────────────────────────────────────────────────────

const newPaths = {

  // 1. POST /v2/clusters/createOnDemandCluster
  '/v2/clusters/createOnDemandCluster': {
    post: {
      summary: 'Create On-Demand Cluster',
      description: 'Creates an on-demand Query Cluster. If no VectorLake exists in the specified project and region, one is created transparently as part of the same workflow.',
      'x-i18n': {
        'zh-CN': {
          summary: '创建 On-Demand 集群',
          description: '本接口用于创建一个 On-Demand Query Cluster。如果指定项目和地域中不存在 VectorLake，则会自动创建一个。'
        }
      },
      tags: ['Cluster Operations (V2)'],
      parameters: [authParam(), acceptParam()],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                projectId: {
                  type: 'string',
                  description: 'ID of the project to which the cluster belongs.',
                  'x-i18n': { 'zh-CN': { description: '待创建集群所属项目 ID。' } }
                },
                regionId: {
                  type: 'string',
                  description: 'ID of the cloud region hosting the cluster.',
                  'x-i18n': { 'zh-CN': { description: '待创建集群所在云地域 ID。' } }
                },
                cuSize: {
                  type: 'integer',
                  description: 'Compute unit size. Must be >= 8.',
                  minimum: 8,
                  'x-i18n': { 'zh-CN': { description: '计算单元大小，必须大于等于 8。' } }
                },
                autoSuspend: {
                  type: 'integer',
                  description: 'Auto-suspend idle timeout in seconds. Must be >= 60.',
                  minimum: 60,
                  'x-i18n': { 'zh-CN': { description: '自动挂起空闲超时时间（秒），必须大于等于 60。' } }
                },
                maxQueryNodeCU: {
                  type: 'integer',
                  description: 'Maximum Query Node CU. Must be >= 1.',
                  minimum: 1,
                  'x-i18n': { 'zh-CN': { description: '最大 Query Node CU，必须大于等于 1。' } }
                },
                maxQueryNodeReplicas: {
                  type: 'integer',
                  description: 'Maximum Query Node replicas. Must be >= 1.',
                  minimum: 1,
                  'x-i18n': { 'zh-CN': { description: '最大 Query Node 副本数，必须大于等于 1。' } }
                },
                clusterName: {
                  type: 'string',
                  description: 'Display name of the Query Cluster. Max 64 characters.',
                  maxLength: 64,
                  'x-i18n': { 'zh-CN': { description: 'Query Cluster 显示名称，最多 64 个字符。' } }
                }
              },
              required: ['projectId', 'regionId', 'cuSize', 'clusterName']
            }
          }
        }
      },
      responses: response200(
        {
          clusterId: { type: 'string', description: 'ID of the created cluster.', 'x-i18n': { 'zh-CN': { description: '已创建集群的 ID。' } } }
        },
        'Response payload which contains the ID of the created cluster.',
        '响应载荷，包含已创建集群的 ID。',
        'Returns information about the created cluster.',
        '返回已创建集群的信息。'
      )
    }
  },

  // 2. GET /v2/clusters/{CLUSTER_ID}/metrics/export
  '/v2/clusters/{CLUSTER_ID}/metrics/export': {
    get: {
      summary: 'Export Cluster Metrics',
      description: 'Exports raw metrics for the specified cluster. The response is streamed directly from the metrics service preserving the original content type and encoding.',
      'x-i18n': {
        'zh-CN': {
          summary: '导出集群指标',
          description: '本接口用于导出指定集群的原始指标数据。响应直接从指标服务流式传输，保留原始内容类型和编码。'
        }
      },
      tags: ['Cluster Operations (V2)'],
      parameters: [
        pathParam('CLUSTER_ID', 'ID of the cluster whose metrics are to export.', 'inxx-xxxxxxxxxxxxxxx'),
        authParam(),
        acceptParam()
      ],
      responses: {
        '200': {
          description: 'Returns raw metrics data.',
          'x-i18n': { 'zh-CN': { description: '返回原始指标数据。' } },
          content: {
            'application/json': {
              schema: { type: 'string', description: 'Raw metrics data.' }
            },
            'text/plain': {
              schema: { type: 'string', description: 'Raw metrics data.' }
            }
          }
        }
      }
    }
  },

  // 3. POST /v2/vectordb/jobs/import/create
  '/v2/vectordb/jobs/import/create': {
    post: {
      summary: 'Create Import Job',
      description: 'Creates a data import job for the specified collection. You can import from object storage or a stage volume.',
      'x-i18n': {
        'zh-CN': {
          summary: '创建导入任务',
          description: '本接口用于为指定 Collection 创建数据导入任务。支持从对象存储或 Stage 卷导入。'
        }
      },
      tags: ['Extract, Load & Transform (V2)'],
      parameters: [authParam(), acceptParam()],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                clusterId: { type: 'string', description: 'ID of the cluster to import data into.', 'x-i18n': { 'zh-CN': { description: '待导入数据的目标集群 ID。' } } },
                projectId: { type: 'string', description: 'ID of the project to which the cluster belongs.', 'x-i18n': { 'zh-CN': { description: '集群所属项目 ID。' } } },
                regionId: { type: 'string', description: 'ID of the cloud region hosting the cluster.', 'x-i18n': { 'zh-CN': { description: '集群所在云地域 ID。' } } },
                dbName: { type: 'string', description: 'Name of the database.', 'x-i18n': { 'zh-CN': { description: '数据库名称。' } } },
                collectionName: { type: 'string', description: 'Name of the collection to import data into.', 'x-i18n': { 'zh-CN': { description: '待导入数据的 Collection 名称。' } } },
                partitionName: { type: 'string', description: 'Name of the partition.', 'x-i18n': { 'zh-CN': { description: '分区名称。' } } },
                objectUrl: { type: 'string', description: 'URL of the object to import.', 'x-i18n': { 'zh-CN': { description: '待导入对象的 URL。' } } },
                objectUrls: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'List of object URLs to import.', 'x-i18n': { 'zh-CN': { description: '待导入对象的 URL 列表。' } } },
                accessKey: { type: 'string', description: 'Access key for the object storage.', 'x-i18n': { 'zh-CN': { description: '对象存储的访问密钥。' } } },
                secretKey: { type: 'string', description: 'Secret key for the object storage.', 'x-i18n': { 'zh-CN': { description: '对象存储的私有密钥。' } } },
                token: { type: 'string', description: 'Security token for temporary credentials.', 'x-i18n': { 'zh-CN': { description: '临时凭证的安全令牌。' } } },
                options: { type: 'object', description: 'Additional import options.', 'x-i18n': { 'zh-CN': { description: '额外的导入选项。' } } },
                stageName: { type: 'string', description: 'Name of the stage volume to import from.', 'x-i18n': { 'zh-CN': { description: '待导入数据的 Stage 卷名称。' } } },
                volumeName: { type: 'string', description: 'Alias for stageName.', 'x-i18n': { 'zh-CN': { description: 'stageName 的别名。' } } },
                dataPaths: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Data paths within the stage.', 'x-i18n': { 'zh-CN': { description: 'Stage 内的数据路径。' } } }
              }
            }
          }
        }
      },
      responses: response200(
        { jobId: { type: 'string', description: 'ID of the created import job.', 'x-i18n': { 'zh-CN': { description: '已创建导入任务的 ID。' } } } },
        'Response payload which contains the ID of the created import job.',
        '响应载荷，包含已创建导入任务的 ID。',
        'Returns the ID of the created import job.',
        '返回已创建导入任务的 ID。'
      )
    }
  },

  // 4. POST /v2/vectordb/jobs/import/getProgress
  '/v2/vectordb/jobs/import/getProgress': {
    post: {
      summary: 'Get Import Job Progress',
      description: 'Gets the progress of a data import job by its ID.',
      'x-i18n': {
        'zh-CN': {
          summary: '获取导入任务进度',
          description: '本接口用于根据 ID 获取数据导入任务的进度。'
        }
      },
      tags: ['Extract, Load & Transform (V2)'],
      parameters: [authParam(), acceptParam()],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                clusterId: { type: 'string', description: 'ID of the cluster.', 'x-i18n': { 'zh-CN': { description: '集群 ID。' } } },
                projectId: { type: 'string', description: 'ID of the project.', 'x-i18n': { 'zh-CN': { description: '项目 ID。' } } },
                regionId: { type: 'string', description: 'ID of the cloud region.', 'x-i18n': { 'zh-CN': { description: '云地域 ID。' } } },
                jobId: { type: 'string', description: 'ID of the import job.', 'x-i18n': { 'zh-CN': { description: '导入任务 ID。' } } }
              }
            }
          }
        }
      },
      responses: response200(
        {
          jobId: { type: 'string', description: 'ID of the import job.', 'x-i18n': { 'zh-CN': { description: '导入任务 ID。' } } },
          collectionName: { type: 'string', description: 'Name of the collection.', 'x-i18n': { 'zh-CN': { description: 'Collection 名称。' } } },
          fileName: { type: 'string', description: 'Name of the imported file.', 'x-i18n': { 'zh-CN': { description: '导入的文件名称。' } } },
          fileSize: { type: 'integer', description: 'Size of the imported file in bytes.', 'x-i18n': { 'zh-CN': { description: '导入的文件大小（字节）。' } } },
          state: { type: 'string', description: 'State of the import job.', 'x-i18n': { 'zh-CN': { description: '导入任务状态。' } } },
          progress: { type: 'integer', description: 'Progress percentage.', 'x-i18n': { 'zh-CN': { description: '进度百分比。' } } },
          completeTime: { type: 'string', description: 'Time when the import completed.', 'x-i18n': { 'zh-CN': { description: '导入完成时间。' } } },
          reason: { type: 'string', description: 'Reason if the import failed.', 'x-i18n': { 'zh-CN': { description: '导入失败原因。' } } },
          totalRows: { type: 'integer', description: 'Total number of rows imported.', 'x-i18n': { 'zh-CN': { description: '导入的总行数。' } } },
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                fileName: { type: 'string', description: 'Name of the sub-task file.', 'x-i18n': { 'zh-CN': { description: '子任务文件名称。' } } },
                fileSize: { type: 'integer', description: 'Size of the sub-task file.', 'x-i18n': { 'zh-CN': { description: '子任务文件大小。' } } },
                state: { type: 'string', description: 'State of the sub-task.', 'x-i18n': { 'zh-CN': { description: '子任务状态。' } } },
                progress: { type: 'integer', description: 'Progress of the sub-task.', 'x-i18n': { 'zh-CN': { description: '子任务进度。' } } },
                completeTime: { type: 'string', description: 'Completion time of the sub-task.', 'x-i18n': { 'zh-CN': { description: '子任务完成时间。' } } },
                reason: { type: 'string', description: 'Failure reason of the sub-task.', 'x-i18n': { 'zh-CN': { description: '子任务失败原因。' } } },
                totalRows: { type: 'integer', description: 'Total rows of the sub-task.', 'x-i18n': { 'zh-CN': { description: '子任务总行数。' } } }
              }
            },
            description: 'Details of sub-tasks.',
            'x-i18n': { 'zh-CN': { description: '子任务详情。' } }
          }
        },
        'Response payload which contains the import job progress.',
        '响应载荷，包含导入任务进度。',
        'Returns the progress of the import job.',
        '返回导入任务的进度。'
      )
    }
  },

  // 5. POST /v2/vectordb/jobs/import/get_progress (alias)
  '/v2/vectordb/jobs/import/get_progress': {
    post: {
      summary: 'Get Import Job Progress',
      description: 'Alias of `/v2/vectordb/jobs/import/getProgress`. Gets the progress of a data import job by its ID.',
      'x-i18n': {
        'zh-CN': {
          summary: '获取导入任务进度',
          description: '`/v2/vectordb/jobs/import/getProgress` 的别名。本接口用于根据 ID 获取数据导入任务的进度。'
        }
      },
      tags: ['Extract, Load & Transform (V2)'],
      parameters: [authParam(), acceptParam()],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                clusterId: { type: 'string', description: 'ID of the cluster.', 'x-i18n': { 'zh-CN': { description: '集群 ID。' } } },
                projectId: { type: 'string', description: 'ID of the project.', 'x-i18n': { 'zh-CN': { description: '项目 ID。' } } },
                regionId: { type: 'string', description: 'ID of the cloud region.', 'x-i18n': { 'zh-CN': { description: '云地域 ID。' } } },
                jobId: { type: 'string', description: 'ID of the import job.', 'x-i18n': { 'zh-CN': { description: '导入任务 ID。' } } }
              }
            }
          }
        }
      },
      responses: response200(
        {
          jobId: { type: 'string', description: 'ID of the import job.', 'x-i18n': { 'zh-CN': { description: '导入任务 ID。' } } },
          collectionName: { type: 'string', description: 'Name of the collection.', 'x-i18n': { 'zh-CN': { description: 'Collection 名称。' } } },
          fileName: { type: 'string', description: 'Name of the imported file.', 'x-i18n': { 'zh-CN': { description: '导入的文件名称。' } } },
          fileSize: { type: 'integer', description: 'Size of the imported file in bytes.', 'x-i18n': { 'zh-CN': { description: '导入的文件大小（字节）。' } } },
          state: { type: 'string', description: 'State of the import job.', 'x-i18n': { 'zh-CN': { description: '导入任务状态。' } } },
          progress: { type: 'integer', description: 'Progress percentage.', 'x-i18n': { 'zh-CN': { description: '进度百分比。' } } },
          completeTime: { type: 'string', description: 'Time when the import completed.', 'x-i18n': { 'zh-CN': { description: '导入完成时间。' } } },
          reason: { type: 'string', description: 'Reason if the import failed.', 'x-i18n': { 'zh-CN': { description: '导入失败原因。' } } },
          totalRows: { type: 'integer', description: 'Total number of rows imported.', 'x-i18n': { 'zh-CN': { description: '导入的总行数。' } } },
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                fileName: { type: 'string', description: 'Name of the sub-task file.', 'x-i18n': { 'zh-CN': { description: '子任务文件名称。' } } },
                fileSize: { type: 'integer', description: 'Size of the sub-task file.', 'x-i18n': { 'zh-CN': { description: '子任务文件大小。' } } },
                state: { type: 'string', description: 'State of the sub-task.', 'x-i18n': { 'zh-CN': { description: '子任务状态。' } } },
                progress: { type: 'integer', description: 'Progress of the sub-task.', 'x-i18n': { 'zh-CN': { description: '子任务进度。' } } },
                completeTime: { type: 'string', description: 'Completion time of the sub-task.', 'x-i18n': { 'zh-CN': { description: '子任务完成时间。' } } },
                reason: { type: 'string', description: 'Failure reason of the sub-task.', 'x-i18n': { 'zh-CN': { description: '子任务失败原因。' } } },
                totalRows: { type: 'integer', description: 'Total rows of the sub-task.', 'x-i18n': { 'zh-CN': { description: '子任务总行数。' } } }
              }
            },
            description: 'Details of sub-tasks.',
            'x-i18n': { 'zh-CN': { description: '子任务详情。' } }
          }
        },
        'Response payload which contains the import job progress.',
        '响应载荷，包含导入任务进度。',
        'Returns the progress of the import job.',
        '返回导入任务的进度。'
      )
    }
  },

  // 6. POST /v2/vectordb/jobs/import/describe (alias)
  '/v2/vectordb/jobs/import/describe': {
    post: {
      summary: 'Get Import Job Progress',
      description: 'Alias of `/v2/vectordb/jobs/import/getProgress`. Gets the progress of a data import job by its ID.',
      'x-i18n': {
        'zh-CN': {
          summary: '获取导入任务进度',
          description: '`/v2/vectordb/jobs/import/getProgress` 的别名。本接口用于根据 ID 获取数据导入任务的进度。'
        }
      },
      tags: ['Extract, Load & Transform (V2)'],
      parameters: [authParam(), acceptParam()],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                clusterId: { type: 'string', description: 'ID of the cluster.', 'x-i18n': { 'zh-CN': { description: '集群 ID。' } } },
                projectId: { type: 'string', description: 'ID of the project.', 'x-i18n': { 'zh-CN': { description: '项目 ID。' } } },
                regionId: { type: 'string', description: 'ID of the cloud region.', 'x-i18n': { 'zh-CN': { description: '云地域 ID。' } } },
                jobId: { type: 'string', description: 'ID of the import job.', 'x-i18n': { 'zh-CN': { description: '导入任务 ID。' } } }
              }
            }
          }
        }
      },
      responses: response200(
        {
          jobId: { type: 'string', description: 'ID of the import job.', 'x-i18n': { 'zh-CN': { description: '导入任务 ID。' } } },
          collectionName: { type: 'string', description: 'Name of the collection.', 'x-i18n': { 'zh-CN': { description: 'Collection 名称。' } } },
          fileName: { type: 'string', description: 'Name of the imported file.', 'x-i18n': { 'zh-CN': { description: '导入的文件名称。' } } },
          fileSize: { type: 'integer', description: 'Size of the imported file in bytes.', 'x-i18n': { 'zh-CN': { description: '导入的文件大小（字节）。' } } },
          state: { type: 'string', description: 'State of the import job.', 'x-i18n': { 'zh-CN': { description: '导入任务状态。' } } },
          progress: { type: 'integer', description: 'Progress percentage.', 'x-i18n': { 'zh-CN': { description: '进度百分比。' } } },
          completeTime: { type: 'string', description: 'Time when the import completed.', 'x-i18n': { 'zh-CN': { description: '导入完成时间。' } } },
          reason: { type: 'string', description: 'Reason if the import failed.', 'x-i18n': { 'zh-CN': { description: '导入失败原因。' } } },
          totalRows: { type: 'integer', description: 'Total number of rows imported.', 'x-i18n': { 'zh-CN': { description: '导入的总行数。' } } },
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                fileName: { type: 'string', description: 'Name of the sub-task file.', 'x-i18n': { 'zh-CN': { description: '子任务文件名称。' } } },
                fileSize: { type: 'integer', description: 'Size of the sub-task file.', 'x-i18n': { 'zh-CN': { description: '子任务文件大小。' } } },
                state: { type: 'string', description: 'State of the sub-task.', 'x-i18n': { 'zh-CN': { description: '子任务状态。' } } },
                progress: { type: 'integer', description: 'Progress of the sub-task.', 'x-i18n': { 'zh-CN': { description: '子任务进度。' } } },
                completeTime: { type: 'string', description: 'Completion time of the sub-task.', 'x-i18n': { 'zh-CN': { description: '子任务完成时间。' } } },
                reason: { type: 'string', description: 'Failure reason of the sub-task.', 'x-i18n': { 'zh-CN': { description: '子任务失败原因。' } } },
                totalRows: { type: 'integer', description: 'Total rows of the sub-task.', 'x-i18n': { 'zh-CN': { description: '子任务总行数。' } } }
              }
            },
            description: 'Details of sub-tasks.',
            'x-i18n': { 'zh-CN': { description: '子任务详情。' } }
          }
        },
        'Response payload which contains the import job progress.',
        '响应载荷，包含导入任务进度。',
        'Returns the progress of the import job.',
        '返回导入任务的进度。'
      )
    }
  },

  // 7. POST /v2/vectordb/jobs/import/list
  '/v2/vectordb/jobs/import/list': {
    post: {
      summary: 'List Import Jobs',
      description: 'Lists all import jobs for the specified cluster.',
      'x-i18n': {
        'zh-CN': {
          summary: '列出导入任务',
          description: '本接口用于列出指定集群的所有导入任务。'
        }
      },
      tags: ['Extract, Load & Transform (V2)'],
      parameters: [authParam(), acceptParam()],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                clusterId: { type: 'string', description: 'ID of the cluster.', 'x-i18n': { 'zh-CN': { description: '集群 ID。' } } },
                projectId: { type: 'string', description: 'ID of the project.', 'x-i18n': { 'zh-CN': { description: '项目 ID。' } } },
                regionId: { type: 'string', description: 'ID of the cloud region.', 'x-i18n': { 'zh-CN': { description: '云地域 ID。' } } },
                dbName: { type: 'string', description: 'Name of the database.', 'x-i18n': { 'zh-CN': { description: '数据库名称。' } } },
                currentPage: { type: 'integer', description: 'Page number to return. Default is 1.', 'x-i18n': { 'zh-CN': { description: '返回的页码，默认为 1。' } } },
                pageSize: { type: 'integer', description: 'Number of items per page. Default is 10.', 'x-i18n': { 'zh-CN': { description: '每页返回的项目数量，默认为 10。' } } }
              }
            }
          }
        }
      },
      responses: response200(
        {
          records: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                collectionName: { type: 'string', description: 'Name of the collection.', 'x-i18n': { 'zh-CN': { description: 'Collection 名称。' } } },
                jobId: { type: 'string', description: 'ID of the import job.', 'x-i18n': { 'zh-CN': { description: '导入任务 ID。' } } },
                state: { type: 'string', description: 'State of the import job.', 'x-i18n': { 'zh-CN': { description: '导入任务状态。' } } }
              }
            },
            description: 'List of import jobs.',
            'x-i18n': { 'zh-CN': { description: '导入任务列表。' } }
          },
          count: { type: 'integer', description: 'Total number of import jobs.', 'x-i18n': { 'zh-CN': { description: '导入任务总数。' } } },
          currentPage: { type: 'integer', description: 'Current page number.', 'x-i18n': { 'zh-CN': { description: '当前页码。' } } },
          pageSize: { type: 'integer', description: 'Number of items per page.', 'x-i18n': { 'zh-CN': { description: '每页项目数量。' } } }
        },
        'Response payload which contains a list of import jobs.',
        '响应载荷，包含导入任务列表。',
        'Returns a list of import jobs.',
        '返回导入任务列表。'
      )
    }
  },

  // 8. GET /v2/invoices/{INVOICE_ID}/downloadPdf
  '/v2/invoices/{INVOICE_ID}/downloadPdf': {
    get: {
      summary: 'Download Invoice PDF',
      description: 'Downloads the PDF of the specified invoice.',
      'x-i18n': {
        'zh-CN': {
          summary: '下载发票 PDF',
          description: '本接口用于下载指定发票的 PDF 文件。'
        }
      },
      tags: ['Invoices (V2)'],
      parameters: [
        pathParam('INVOICE_ID', 'ID of the invoice to download.', 'inv-xxxxxxxxxxxxxxxxxx'),
        authParam(),
        acceptParam()
      ],
      responses: response200(
        { url: { type: 'string', description: 'URL of the invoice PDF.', 'x-i18n': { 'zh-CN': { description: '发票 PDF 的下载链接。' } } } },
        'Response payload which contains the invoice PDF URL.',
        '响应载荷，包含发票 PDF 下载链接。',
        'Returns the URL of the invoice PDF.',
        '返回发票 PDF 的下载链接。'
      )
    }
  },

  // 9. POST /v2/projects/{projectId}/regions
  '/v2/projects/{projectId}/regions': {
    post: {
      summary: 'Add Project Regions',
      description: 'Adds one or more cloud regions to the specified project.',
      'x-i18n': {
        'zh-CN': {
          summary: '添加项目可用地域',
          description: '本接口用于为指定项目添加一个或多个云地域。'
        }
      },
      tags: ['Project Operations (V2)'],
      parameters: [
        pathParam('projectId', 'ID of the project to which the regions are to add.', 'proj-xxxxxxxxxxxxxxxxxxxxxxx'),
        authParam(),
        acceptParam()
      ],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                regions: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Region IDs to add.',
                  'x-i18n': { 'zh-CN': { description: '要添加的地域 ID 列表。' } }
                }
              },
              required: ['regions']
            }
          }
        }
      },
      responses: response200(
        {
          regions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Updated list of region IDs for the project.',
            'x-i18n': { 'zh-CN': { description: '项目更新后的地域 ID 列表。' } }
          }
        },
        'Response payload which contains the updated list of region IDs.',
        '响应载荷，包含更新后的地域 ID 列表。',
        'Returns the updated list of region IDs.',
        '返回更新后的地域 ID 列表。'
      )
    }
  },

  // 10. PATCH /v2/projects/{projectId}/plan
  '/v2/projects/{projectId}/plan': {
    patch: {
      summary: 'Update Project Plan',
      description: 'Updates the subscription plan of the specified project.',
      'x-i18n': {
        'zh-CN': {
          summary: '更新项目订阅计划',
          description: '本接口用于更新指定项目的订阅计划。'
        }
      },
      tags: ['Project Operations (V2)'],
      parameters: [
        pathParam('projectId', 'ID of the project whose plan is to update.', 'proj-xxxxxxxxxxxxxxxxxxxxxxx'),
        authParam(),
        acceptParam()
      ],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                plan: {
                  type: 'string',
                  description: 'The subscription plan. Possible values: `Standard`, `Enterprise`, `BusinessCritical`.',
                  enum: ['Standard', 'Enterprise', 'BusinessCritical'],
                  'x-i18n': { 'zh-CN': { description: '订阅计划。可选值：`Standard`、`Enterprise`、`BusinessCritical`。' } }
                }
              },
              required: ['plan']
            }
          }
        }
      },
      responses: response200(
        { projectId: { type: 'string', description: 'ID of the updated project.', 'x-i18n': { 'zh-CN': { description: '已更新项目的 ID。' } } } },
        'Response payload which contains the ID of the updated project.',
        '响应载荷，包含已更新项目的 ID。',
        'Returns the ID of the updated project.',
        '返回已更新项目的 ID。'
      )
    }
  },

  // 11. POST /v2/migrations/startByRemote
  '/v2/migrations/startByRemote': {
    post: {
      summary: 'Migrate from Remote',
      description: 'Starts a migration from a remote bucket to the specified cluster.',
      'x-i18n': {
        'zh-CN': {
          summary: '从远端迁移',
          description: '本接口用于从远端存储桶迁移数据到指定集群。'
        }
      },
      tags: ['Cloud Migration (V2)'],
      parameters: [authParam(), acceptParam()],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                source: {
                  type: 'object',
                  description: 'Source storage configuration.',
                  'x-i18n': { 'zh-CN': { description: '源存储配置。' } },
                  properties: {
                    cloud: { type: 'string', description: 'Cloud provider.', 'x-i18n': { 'zh-CN': { description: '云提供商。' } } },
                    region: { type: 'string', description: 'Cloud region.', 'x-i18n': { 'zh-CN': { description: '云地域。' } } },
                    bucketName: { type: 'string', description: 'Name of the source bucket.', 'x-i18n': { 'zh-CN': { description: '源存储桶名称。' } } },
                    path: { type: 'string', description: 'Path within the source bucket.', 'x-i18n': { 'zh-CN': { description: '源存储桶内的路径。' } } },
                    objectUrl: { type: 'string', description: 'Object URL.', 'x-i18n': { 'zh-CN': { description: '对象 URL。' } } },
                    accessKey: { type: 'string', description: 'Access key.', 'x-i18n': { 'zh-CN': { description: '访问密钥。' } } },
                    secretKey: { type: 'string', description: 'Secret key.', 'x-i18n': { 'zh-CN': { description: '私有密钥。' } } },
                    token: { type: 'string', description: 'Security token.', 'x-i18n': { 'zh-CN': { description: '安全令牌。' } } },
                    stageName: { type: 'string', description: 'Stage name.', 'x-i18n': { 'zh-CN': { description: 'Stage 名称。' } } },
                    dataPath: { type: 'string', description: 'Data path.', 'x-i18n': { 'zh-CN': { description: '数据路径。' } } }
                  }
                },
                destination: {
                  type: 'object',
                  description: 'Destination cluster configuration.',
                  'x-i18n': { 'zh-CN': { description: '目标集群配置。' } },
                  properties: {
                    clusterId: { type: 'string', description: 'ID of the destination cluster.', 'x-i18n': { 'zh-CN': { description: '目标集群 ID。' } } }
                  }
                }
              }
            }
          }
        }
      },
      responses: response200(
        { jobId: { type: 'string', description: 'ID of the created migration job.', 'x-i18n': { 'zh-CN': { description: '已创建迁移任务的 ID。' } } } },
        'Response payload which contains the ID of the created migration job.',
        '响应载荷，包含已创建迁移任务的 ID。',
        'Returns the ID of the created migration job.',
        '返回已创建迁移任务的 ID。'
      )
    }
  },

  // 12. GET /v2/volumes/{VOLUME_NAME}
  '/v2/volumes/{VOLUME_NAME}': {
    get: {
      summary: 'Describe Volume',
      description: 'Describes a volume in detail.',
      'x-i18n': {
        'zh-CN': {
          summary: '查看存储卷详情',
          description: '本接口用于查看指定存储卷的详细信息。'
        }
      },
      tags: ['Volume Operations (V2)'],
      parameters: [
        pathParam('VOLUME_NAME', 'Name of the volume to describe.', 'my-volume'),
        authParam(),
        acceptParam()
      ],
      responses: response200(
        {
          volumeName: { type: 'string', description: 'Name of the volume.', 'x-i18n': { 'zh-CN': { description: '存储卷名称。' } } },
          endpoint: { type: 'string', description: 'Endpoint of the volume.', 'x-i18n': { 'zh-CN': { description: '存储卷端点。' } } },
          cloud: { type: 'string', description: 'Cloud provider.', 'x-i18n': { 'zh-CN': { description: '云提供商。' } } },
          region: { type: 'string', description: 'Cloud region.', 'x-i18n': { 'zh-CN': { description: '云地域。' } } },
          bucketName: { type: 'string', description: 'Name of the bucket.', 'x-i18n': { 'zh-CN': { description: '存储桶名称。' } } },
          remotePath: { type: 'string', description: 'Remote path of the volume.', 'x-i18n': { 'zh-CN': { description: '存储卷的远程路径。' } } },
          volumePrefix: { type: 'string', description: 'Prefix of the volume.', 'x-i18n': { 'zh-CN': { description: '存储卷前缀。' } } }
        },
        'Response payload which contains volume details.',
        '响应载荷，包含存储卷详情。',
        'Returns details of the specified volume.',
        '返回指定存储卷的详细信息。'
      )
    }
  },

  // 13. POST /v2/volumes/apply
  '/v2/volumes/apply': {
    post: {
      summary: 'Apply Volume',
      description: 'Applies a volume configuration, creating a temporary stage if no stage name is provided.',
      'x-i18n': {
        'zh-CN': {
          summary: '应用存储卷',
          description: '本接口用于应用存储卷配置。如果未提供存储卷名称，则会创建一个临时 Stage。'
        }
      },
      tags: ['Volume Operations (V2)'],
      parameters: [authParam(), acceptParam()],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                volumeName: { type: 'string', description: 'Name of the volume.', 'x-i18n': { 'zh-CN': { description: '存储卷名称。' } } },
                projectId: { type: 'string', description: 'ID of the project.', 'x-i18n': { 'zh-CN': { description: '项目 ID。' } } },
                regionId: { type: 'string', description: 'ID of the cloud region.', 'x-i18n': { 'zh-CN': { description: '云地域 ID。' } } },
                clusterId: { type: 'string', description: 'ID of the cluster.', 'x-i18n': { 'zh-CN': { description: '集群 ID。' } } },
                path: { type: 'string', description: 'Path within the volume.', 'x-i18n': { 'zh-CN': { description: '存储卷内的路径。' } } }
              }
            }
          }
        }
      },
      responses: response200(
        {
          endpoint: { type: 'string', description: 'Endpoint of the volume.', 'x-i18n': { 'zh-CN': { description: '存储卷端点。' } } },
          cloud: { type: 'string', description: 'Cloud provider.', 'x-i18n': { 'zh-CN': { description: '云提供商。' } } },
          region: { type: 'string', description: 'Cloud region.', 'x-i18n': { 'zh-CN': { description: '云地域。' } } },
          bucketName: { type: 'string', description: 'Name of the bucket.', 'x-i18n': { 'zh-CN': { description: '存储桶名称。' } } },
          remotePath: { type: 'string', description: 'Remote path of the volume.', 'x-i18n': { 'zh-CN': { description: '存储卷的远程路径。' } } },
          volumeName: { type: 'string', description: 'Name of the volume.', 'x-i18n': { 'zh-CN': { description: '存储卷名称。' } } },
          volumePrefix: { type: 'string', description: 'Prefix of the volume.', 'x-i18n': { 'zh-CN': { description: '存储卷前缀。' } } },
          credentials: {
            type: 'object',
            description: 'Temporary credentials for accessing the volume.',
            'x-i18n': { 'zh-CN': { description: '访问存储卷的临时凭证。' } },
            properties: {
              tmpAK: { type: 'string', description: 'Temporary access key.', 'x-i18n': { 'zh-CN': { description: '临时访问密钥。' } } },
              tmpSK: { type: 'string', description: 'Temporary secret key.', 'x-i18n': { 'zh-CN': { description: '临时私有密钥。' } } },
              sessionToken: { type: 'string', description: 'Session token.', 'x-i18n': { 'zh-CN': { description: '会话令牌。' } } },
              expireTime: { type: 'string', description: 'Expiration time of the credentials.', 'x-i18n': { 'zh-CN': { description: '凭证过期时间。' } } }
            }
          }
        },
        'Response payload which contains the applied volume details.',
        '响应载荷，包含已应用存储卷的详细信息。',
        'Returns details of the applied volume.',
        '返回已应用存储卷的详细信息。'
      )
    }
  }

};

// ─── Inject ────────────────────────────────────────────────────────────────────

let added = 0;
let methodsAdded = 0;
for (const [p, obj] of Object.entries(newPaths)) {
  if (spec.paths[p]) {
    // Path exists — add missing methods
    for (const [method, def] of Object.entries(obj)) {
      if (spec.paths[p][method]) {
        console.log(`  [EXISTS] ${method.toUpperCase()} ${p}`);
      } else {
        spec.paths[p][method] = def;
        console.log(`  + ${method.toUpperCase()} ${p}`);
        methodsAdded++;
      }
    }
    continue;
  }
  spec.paths[p] = obj;
  console.log(`  + ${p}`);
  added++;
}

const totalChanges = added + methodsAdded;
console.log(`\nAdded ${added} new path(s) and ${methodsAdded} new method(s).`);

if (!dryRun && totalChanges > 0) {
  fs.writeFileSync(SPEC_PATH, JSON.stringify(spec, null, 2) + '\n');
  console.log(`Wrote ${SPEC_PATH}`);
  require('child_process').execSync(`node "${MERGE}"`, { stdio: 'inherit' });
} else if (dryRun) {
  console.log('[dry-run] No files written.');
}
