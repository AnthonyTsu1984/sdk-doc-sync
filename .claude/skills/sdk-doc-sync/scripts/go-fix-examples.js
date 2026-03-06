#!/usr/bin/env node
/**
 * Go SDK Example Fixer
 *
 * Two types of fixes:
 * 1. Replace `// TODO: ... usage example` placeholders with real Go examples
 * 2. Add missing Request Syntax sections for Insert, Upsert, and simple partition/collection methods
 *
 * Usage:
 *   node scripts/go-fix-examples.js [--dry-run] [--method=name]
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');

const tokenFetcher = new larkTokenFetcher();
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DELAY_MS = 350;
const GO_LANG_ID = 22; // Go language code in Feishu

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_METHOD = (args.find(a => a.startsWith('--method=')) || '').split('=')[1];

// ─── Feishu API helpers ───────────────────────────────────────────────────────

async function feishuAPI(method, endpoint, body) {
  const token = await tokenFetcher.token();
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${FEISHU_HOST}${endpoint}`, opts);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Feishu API error [${data.code}]: ${data.msg} — ${endpoint}`);
  return data.data;
}

async function delay(ms) { return new Promise(r => setTimeout(r, ms || DELAY_MS)); }

async function getDocBlocks(docId) {
  const blocks = [];
  let pageToken = null;
  do {
    const url = `/open-apis/docx/v1/documents/${docId}/blocks${pageToken ? `?page_token=${pageToken}` : ''}`;
    const data = await feishuAPI('GET', url);
    blocks.push(...data.items);
    pageToken = data.has_more ? data.page_token : null;
  } while (pageToken);
  return blocks;
}

/** Patch a code block's text content. */
async function patchCodeBlock(docId, blockId, newCode) {
  return feishuAPI('PATCH', `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`, {
    requests: [{
      block_id: blockId,
      update_text_elements: {
        elements: [{ text_run: { content: newCode, text_element_style: {} } }],
      },
    }],
  });
}

/** Insert blocks as children of parentBlockId at position index. */
async function insertChildren(docId, parentBlockId, children, index) {
  return feishuAPI(
    'POST',
    `/open-apis/docx/v1/documents/${docId}/blocks/${parentBlockId}/children`,
    { children, index },
  );
}

// ─── Block builders ──────────────────────────────────────────────────────────

function makeHeading2(text) {
  return {
    block_type: 4,
    heading2: {
      elements: [{ text_run: { content: text, text_element_style: {} } }],
      style: {},
    },
  };
}

function makeCodeBlock(code, langId) {
  return {
    block_type: 14,
    code: {
      style: { language: langId || GO_LANG_ID, wrap: false },
      elements: [{ text_run: { content: code, text_element_style: {} } }],
    },
  };
}

function makeBoldParagraph(text) {
  return {
    block_type: 2,
    text: {
      elements: [{ text_run: { content: text, text_element_style: { bold: true } } }],
      style: {},
    },
  };
}

/** Bullet item with optional inline_code first span. */
function makeBullet(parts) {
  // parts: array of {text, code?, bold?}
  return {
    block_type: 12,
    bullet: {
      elements: parts.map(p => ({
        text_run: {
          content: p.text,
          text_element_style: {
            ...(p.code ? { inline_code: true } : {}),
            ...(p.bold ? { bold: true } : {}),
          },
        },
      })),
      style: {},
    },
  };
}

function makeParam(name, type, required, description) {
  const parts = [
    { text: name, bold: true },
    { text: ' (' },
    { text: type, code: true },
    { text: ') — ' },
  ];
  if (required) parts.push({ text: '[REQUIRED] ', bold: true });
  parts.push({ text: description });
  return makeBullet(parts);
}

function makeOptionMethod(signature, description) {
  return makeBullet([
    { text: signature, code: true },
    { text: ' — ' + description },
  ]);
}

// ─── Data: TODO example fixes ────────────────────────────────────────────────

const TODO_FIXES = [
  // ── Client ──
  {
    name: 'New',
    docId: 'NvlZd3VOpoMrsoxmavQckdAOnQg',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

// Connect to a local Milvus server
cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\tlog.Fatal("failed to create client:", err)
}
defer cli.Close(ctx)

collections, err := cli.ListCollections(ctx, milvusclient.NewListCollectionOption())
if err != nil {
\tlog.Fatal("failed to list collections:", err)
}
fmt.Println(collections)`,
  },
  {
    name: 'Close',
    docId: 'UN5Yd5ojPoTYrJxAtYzcgFs9nYe',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\tlog.Fatal("failed to create client:", err)
}

err = cli.Close(ctx)
if err != nil {
\tlog.Fatal("failed to close client:", err)
}`,
  },
  {
    name: 'GetServerVersion',
    docId: 'TUYsd2ko4oAlB4xa9nxc6rhRnpc',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\tlog.Fatal("failed to create client:", err)
}
defer cli.Close(ctx)

version, err := cli.GetServerVersion(ctx, milvusclient.NewGetServerVersionOption())
if err != nil {
\tlog.Fatal("failed to get server version:", err)
}
fmt.Println(version)`,
  },

  // ── Collection extras ──
  {
    name: 'HasCollection',
    docId: 'JfRidhpQRo2tZFxrL87cNODunWc',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

milvusAddr := "127.0.0.1:19530"

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: milvusAddr,
})
if err != nil {
\tlog.Fatal("failed to connect to milvus server: ", err.Error())
}
defer cli.Close(ctx)

has, err := cli.HasCollection(ctx, milvusclient.NewHasCollectionOption("quick_setup"))
if err != nil {
\t// handle error
}
fmt.Println(has)`,
  },
  {
    name: 'DropCollectionProperties',
    docId: 'Zyf1dXoBIo83V2xWHiKcXUEAnMc',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

milvusAddr := "127.0.0.1:19530"

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: milvusAddr,
})
if err != nil {
\tlog.Fatal("failed to connect to milvus server: ", err.Error())
}
defer cli.Close(ctx)

err = cli.DropCollectionProperties(ctx, milvusclient.NewDropCollectionPropertiesOption("my_collection", common.CollectionTTLConfigKey))
if err != nil {
\t// handle error
}`,
  },
  {
    name: 'AlterCollectionFieldProperty',
    docId: 'MIyedieIBo43Yrxee0lcY3cUn8b',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

milvusAddr := "127.0.0.1:19530"

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: milvusAddr,
})
if err != nil {
\tlog.Fatal("failed to connect to milvus server: ", err.Error())
}
defer cli.Close(ctx)

err = cli.AlterCollectionFieldProperty(ctx, milvusclient.NewAlterCollectionFieldPropertiesOption("my_collection", "my_vector").
\tWithProperty("mmap.enabled", true))
if err != nil {
\t// handle error
}`,
  },
  {
    name: 'GetCollectionStats',
    docId: 'L4CvdyBIVoFsMNx546qcBqrOnJd',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

milvusAddr := "127.0.0.1:19530"

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: milvusAddr,
})
if err != nil {
\tlog.Fatal("failed to connect to milvus server: ", err.Error())
}
defer cli.Close(ctx)

stats, err := cli.GetCollectionStats(ctx, milvusclient.NewGetCollectionStatsOption("quick_setup"))
if err != nil {
\t// handle error
}
fmt.Println(stats)`,
  },

  // ── Database ──
  {
    name: 'ListDatabase',
    docId: 'SV1KdmQUCoLh3nxArLzc9v6In1e',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle err
}
defer cli.Close(ctx)

dbs, err := cli.ListDatabase(ctx, milvusclient.NewListDatabaseOption())
if err != nil {
\t// handle err
}
fmt.Println(dbs)`,
  },
  {
    name: 'DropDatabase',
    docId: 'FfZ6dqEk2o9Cn3xFAgTckLhsnS6',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle err
}
defer cli.Close(ctx)

err = cli.DropDatabase(ctx, milvusclient.NewDropDatabaseOption("test_db"))
if err != nil {
\t// handle err
}`,
  },
  {
    name: 'UseDatabase',
    docId: 'GbIAdIuWsoumzoxHWpOcVjVbnle',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle err
}
defer cli.Close(ctx)

err = cli.UseDatabase(ctx, milvusclient.NewUseDatabaseOption("my_database"))
if err != nil {
\t// handle err
}`,
  },
  {
    name: 'AlterDatabaseProperties',
    docId: 'TxGQdsN2noPbRixebWycWSe0nYt',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle err
}
defer cli.Close(ctx)

err = cli.AlterDatabaseProperties(ctx, milvusclient.NewAlterDatabasePropertiesOption("my_database").
\tWithProperty(common.DatabaseReplicaNumber, 2))
if err != nil {
\t// handle err
}`,
  },
  {
    name: 'DropDatabaseProperties',
    docId: 'Le2bdLZXCoKVXXxF2kgcuDt2neh',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle err
}
defer cli.Close(ctx)

err = cli.DropDatabaseProperties(ctx, milvusclient.NewDropDatabasePropertiesOption("my_database", common.DatabaseReplicaNumber))
if err != nil {
\t// handle err
}`,
  },

  // ── Management extras ──
  {
    name: 'GetPersistentSegmentInfo',
    docId: 'Vg1EdO7a3oF3qcxhm18cGYJWn1c',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\tlog.Fatal("failed to connect to milvus server: ", err.Error())
}
defer cli.Close(ctx)

segments, err := cli.GetPersistentSegmentInfo(ctx, milvusclient.NewGetPersistentSegmentInfoOption("quick_setup"))
if err != nil {
\t// handle error
}
fmt.Println(segments)`,
  },
  {
    name: 'AlterIndexProperties',
    docId: 'XzLnd1w4uo2RM0xS8UWc5K6in1R',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: milvusAddr,
})
if err != nil {
\t// handle err
}
defer cli.Close(ctx)

err = cli.AlterIndexProperties(ctx, milvusclient.NewAlterIndexPropertiesOption("my_collection", "my_index").
\tWithProperty("mmap.enabled", true))
if err != nil {
\t// handle err
}`,
  },
  {
    name: 'DropIndexProperties',
    docId: 'VuYydaf7loMiRAxkB3scXzA1nPb',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: milvusAddr,
})
if err != nil {
\t// handle err
}
defer cli.Close(ctx)

err = cli.DropIndexProperties(ctx, milvusclient.NewDropIndexPropertiesOption("my_collection", "my_index", "mmap.enabled"))
if err != nil {
\t// handle err
}`,
  },

  // ── RBAC ──
  {
    name: 'CreateUser',
    docId: 'Liv8dqreJo6t26xf3UWcC8ePnpe',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

err = cli.CreateUser(ctx, milvusclient.NewCreateUserOption("my_user", "P@ssw0rd"))
if err != nil {
\t// handle error
}`,
  },
  {
    name: 'UpdatePassword',
    docId: 'GKDQd15KkoiLPSxs8UYcFUamnIg',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

err = cli.UpdatePassword(ctx, milvusclient.NewUpdatePasswordOption("my_user", "P@ssw0rd", "NewP@ssw0rd"))
if err != nil {
\t// handle error
}`,
  },
  {
    name: 'DropUser',
    docId: 'QM8QdP63jofHxkxwxSEcXVXZnKX',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

err = cli.DropUser(ctx, milvusclient.NewDropUserOption("my_user"))
if err != nil {
\t// handle error
}`,
  },
  {
    name: 'ListUsers',
    docId: 'S3Vndkuxco3965xyea6cN406nWc',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

users, err := cli.ListUsers(ctx, milvusclient.NewListUserOption())
if err != nil {
\t// handle error
}
fmt.Println(users)`,
  },
  {
    name: 'DescribeUser',
    docId: 'EbOodxkWBoRvwAxzJOkcsM6lnic',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

user, err := cli.DescribeUser(ctx, milvusclient.NewDescribeUserOption("my_user"))
if err != nil {
\t// handle error
}
fmt.Println(user)`,
  },
  {
    name: 'CreateRole',
    docId: 'NMsddLaMUoGUxexlFIScnY0Knpg',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

err = cli.CreateRole(ctx, milvusclient.NewCreateRoleOption("my_role"))
if err != nil {
\t// handle error
}`,
  },
  {
    name: 'DropRole',
    docId: 'ZSgwd9v1kott9AxEBSecPqbGn5c',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

err = cli.DropRole(ctx, milvusclient.NewDropRoleOption("my_role"))
if err != nil {
\t// handle error
}`,
  },
  {
    name: 'GrantRole',
    docId: 'OPfXdP02ZoeDIUxhBUOcU3vBngb',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

err = cli.GrantRole(ctx, milvusclient.NewGrantRoleOption("my_user", "my_role"))
if err != nil {
\t// handle error
}`,
  },
  {
    name: 'RevokeRole',
    docId: 'PKWMdOpDkoIXhFxDsgrc8oQVnIf',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

err = cli.RevokeRole(ctx, milvusclient.NewRevokeRoleOption("my_user", "my_role"))
if err != nil {
\t// handle error
}`,
  },
  {
    name: 'ListRoles',
    docId: 'QSmmdf6jgoi8rFxzDnzcqr3cnMe',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

roles, err := cli.ListRoles(ctx, milvusclient.NewListRoleOption())
if err != nil {
\t// handle error
}
fmt.Println(roles)`,
  },
  {
    name: 'DescribeRole',
    docId: 'EAs8dmRIuoMvW5xXLHdcDw2Gn0d',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

role, err := cli.DescribeRole(ctx, milvusclient.NewDescribeRoleOption("my_role"))
if err != nil {
\t// handle error
}
fmt.Println(role)`,
  },
  {
    name: 'RevokePrivilege',
    docId: 'ICTcdWz4tocOuCxJ0SXcTEconzc',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

err = cli.RevokePrivilege(ctx, milvusclient.NewRevokePrivilegeOption("my_role", "Collection", "Search", "quick_setup"))
if err != nil {
\t// handle error
}`,
  },
  {
    name: 'CreatePrivilegeGroup',
    docId: 'DtPRdNBBeoCPXDxXc2qcLXv8nob',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

err = cli.CreatePrivilegeGroup(ctx, milvusclient.NewCreatePrivilegeGroupOption("my_priv_group"))
if err != nil {
\t// handle error
}`,
  },
  {
    name: 'DropPrivilegeGroup',
    docId: 'AgrvdHGCLokFr4xuZeVcn7Sunwb',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

err = cli.DropPrivilegeGroup(ctx, milvusclient.NewDropPrivilegeGroupOption("my_priv_group"))
if err != nil {
\t// handle error
}`,
  },
  {
    name: 'ListPrivilegeGroups',
    docId: 'H34hdV2rxodn9Pxy2Jyc8sBun9t',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

groups, err := cli.ListPrivilegeGroups(ctx, milvusclient.NewListPrivilegeGroupsOption())
if err != nil {
\t// handle error
}
fmt.Println(groups)`,
  },
  {
    name: 'AddPrivilegesToGroup',
    docId: 'QudZd1mXdosbIhxUHhGcjrF2nOd',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

err = cli.AddPrivilegesToGroup(ctx, milvusclient.NewAddPrivilegesToGroupOption("my_priv_group", "Search", "Query"))
if err != nil {
\t// handle error
}`,
  },
  {
    name: 'RemovePrivilegesFromGroup',
    docId: 'AIejdbhxOoG18Uxh2jBcjHX1nwd',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

err = cli.RemovePrivilegesFromGroup(ctx, milvusclient.NewRemovePrivilegesFromGroupOption("my_priv_group", "Search"))
if err != nil {
\t// handle error
}`,
  },
  {
    name: 'RevokePrivilegeV2',
    docId: 'StUJd0OCho7PKcxWOU7cPNzhn0d',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

err = cli.RevokePrivilegeV2(ctx, milvusclient.NewRevokePrivilegeV2Option("my_role", "Search", "quick_setup"))
if err != nil {
\t// handle error
}`,
  },
  {
    name: 'BackupRBAC',
    docId: 'Iz1ZdJDWVo0uoUxQjlPcIbS2nMo',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

backup, err := cli.BackupRBAC(ctx, milvusclient.NewBackupRBACOption())
if err != nil {
\t// handle error
}
fmt.Println(backup)`,
  },
  {
    name: 'RestoreRBAC',
    docId: 'YYvkdK6o5ovGGsxVyEtcEGXnn6b',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

// First back up the RBAC metadata
backup, err := cli.BackupRBAC(ctx, milvusclient.NewBackupRBACOption())
if err != nil {
\t// handle error
}

// Restore the RBAC metadata from backup
err = cli.RestoreRBAC(ctx, milvusclient.NewRestoreRBACOption(backup))
if err != nil {
\t// handle error
}`,
  },

  // ── Partitions ──
  {
    name: 'GetPartitionStats',
    docId: 'Z835dscn3oM3sGxnDlacgndBn9o',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

milvusAddr := "127.0.0.1:19530"

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: milvusAddr,
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

stats, err := cli.GetPartitionStats(ctx, milvusclient.NewGetPartitionStatsOption("quick_setup", "partitionA"))
if err != nil {
\t// handle error
}
fmt.Println(stats)`,
  },

  // ── Resource group ──
  {
    name: 'DescribeReplica',
    docId: 'VxpfdYbXWoK0QSxNqi7cFgJ4nhh',
    example: `ctx, cancel := context.WithCancel(context.Background())
defer cancel()

cli, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
\tAddress: "localhost:19530",
})
if err != nil {
\t// handle error
}
defer cli.Close(ctx)

replica, err := cli.DescribeReplica(ctx, milvusclient.NewDescribeReplicaOption("quick_setup"))
if err != nil {
\t// handle error
}
fmt.Println(replica)`,
  },
];

// ─── Data: missing Request Syntax sections ───────────────────────────────────

// For docs that are totally missing a Request Syntax section.
// `blocks` are inserted AFTER the function signature code block (first code block in the doc).
const REQUEST_SYNTAX_FIXES = [
  {
    name: 'Insert',
    docId: 'T6S4dcpZ7oeKD6xeTofc2mn9nrb',
    syntaxCode: `option := milvusclient.NewColumnBasedInsertOption(collName).
\tWithInt64Column(colName, data).
\tWithVarcharColumn(colName, data).
\tWithFloatVectorColumn(colName, dim, data).
\tWithBinaryVectorColumn(colName, dim, data).
\tWithBoolColumn(colName, data).
\tWithPartition(partitionName)

// Alternative (row-based):
// option := milvusclient.NewRowBasedInsertOption(collName, rows...)

result, err := client.Insert(ctx, option)`,
    params: [
      makeParam('collName', 'string', true, 'The name of the target collection.'),
    ],
    optionMethods: [
      makeOptionMethod('WithColumns(columns ...column.Column)', 'Inserts arbitrary typed columns.'),
      makeOptionMethod('WithBoolColumn(colName string, data []bool)', 'Inserts a column of boolean values.'),
      makeOptionMethod('WithInt8Column(colName string, data []int8)', 'Inserts a column of int8 values.'),
      makeOptionMethod('WithInt16Column(colName string, data []int16)', 'Inserts a column of int16 values.'),
      makeOptionMethod('WithInt32Column(colName string, data []int32)', 'Inserts a column of int32 values.'),
      makeOptionMethod('WithInt64Column(colName string, data []int64)', 'Inserts a column of int64 values.'),
      makeOptionMethod('WithVarcharColumn(colName string, data []string)', 'Inserts a column of string values.'),
      makeOptionMethod('WithFloatVectorColumn(colName string, dim int, data [][]float32)', 'Inserts a column of float32 dense vectors.'),
      makeOptionMethod('WithFloat16VectorColumn(colName string, dim int, data [][]float32)', 'Inserts a column of float16 vectors (converted from float32).'),
      makeOptionMethod('WithBFloat16VectorColumn(colName string, dim int, data [][]float32)', 'Inserts a column of bfloat16 vectors (converted from float32).'),
      makeOptionMethod('WithBinaryVectorColumn(colName string, dim int, data [][]byte)', 'Inserts a column of binary vectors.'),
      makeOptionMethod('WithInt8VectorColumn(colName string, dim int, data [][]int8)', 'Inserts a column of int8 vectors.'),
      makeOptionMethod('WithPartition(partitionName string)', 'Targets a specific partition for the insert operation.'),
    ],
  },
  {
    name: 'Upsert',
    docId: 'O1oidP1nEoZmlrxzGRRc30mjn5d',
    syntaxCode: `option := milvusclient.NewColumnBasedInsertOption(collName).
\tWithInt64Column(colName, data).
\tWithVarcharColumn(colName, data).
\tWithFloatVectorColumn(colName, dim, data).
\tWithBinaryVectorColumn(colName, dim, data).
\tWithBoolColumn(colName, data).
\tWithPartition(partitionName).
\tWithPartialUpdate(partialUpdate)

// Alternative (row-based):
// option := milvusclient.NewRowBasedInsertOption(collName, rows...)

result, err := client.Upsert(ctx, option)`,
    params: [
      makeParam('collName', 'string', true, 'The name of the target collection.'),
    ],
    optionMethods: [
      makeOptionMethod('WithColumns(columns ...column.Column)', 'Inserts arbitrary typed columns.'),
      makeOptionMethod('WithBoolColumn(colName string, data []bool)', 'Inserts a column of boolean values.'),
      makeOptionMethod('WithInt8Column(colName string, data []int8)', 'Inserts a column of int8 values.'),
      makeOptionMethod('WithInt16Column(colName string, data []int16)', 'Inserts a column of int16 values.'),
      makeOptionMethod('WithInt32Column(colName string, data []int32)', 'Inserts a column of int32 values.'),
      makeOptionMethod('WithInt64Column(colName string, data []int64)', 'Inserts a column of int64 values.'),
      makeOptionMethod('WithVarcharColumn(colName string, data []string)', 'Inserts a column of string values.'),
      makeOptionMethod('WithFloatVectorColumn(colName string, dim int, data [][]float32)', 'Inserts a column of float32 dense vectors.'),
      makeOptionMethod('WithFloat16VectorColumn(colName string, dim int, data [][]float32)', 'Inserts a column of float16 vectors (converted from float32).'),
      makeOptionMethod('WithBFloat16VectorColumn(colName string, dim int, data [][]float32)', 'Inserts a column of bfloat16 vectors (converted from float32).'),
      makeOptionMethod('WithBinaryVectorColumn(colName string, dim int, data [][]byte)', 'Inserts a column of binary vectors.'),
      makeOptionMethod('WithInt8VectorColumn(colName string, dim int, data [][]int8)', 'Inserts a column of int8 vectors.'),
      makeOptionMethod('WithPartition(partitionName string)', 'Targets a specific partition for the upsert operation.'),
      makeOptionMethod('WithPartialUpdate(partialUpdate bool)', 'Enables partial update mode so only provided fields are updated (existing fields not in the payload are preserved).'),
    ],
  },
  {
    name: 'ListPartitions',
    docId: 'ZNvXd7eldozvRHxpHOcc5CPAnug',
    syntaxCode: `option := milvusclient.NewListPartitionOption(collectionName)

result, err := client.ListPartitions(ctx, option)`,
    params: [
      makeParam('collectionName', 'string', true, 'The name of the target collection.'),
    ],
    optionMethods: [],
  },
  {
    name: 'HasPartition',
    docId: 'Cased8tfhoZ25Sx4VALcy4gZnbh',
    syntaxCode: `option := milvusclient.NewHasPartitionOption(collectionName, partitionName)

result, err := client.HasPartition(ctx, option)`,
    params: [
      makeParam('collectionName', 'string', true, 'The name of the target collection.'),
      makeParam('partitionName', 'string', true, 'The name of the partition to check.'),
    ],
    optionMethods: [],
  },
  {
    name: 'DropPartition',
    docId: 'XnbJdLilXobGn1x1Uq6cvhKTnhf',
    syntaxCode: `option := milvusclient.NewDropPartitionOption(collectionName, partitionName)

err := client.DropPartition(ctx, option)`,
    params: [
      makeParam('collectionName', 'string', true, 'The name of the target collection.'),
      makeParam('partitionName', 'string', true, 'The name of the partition to drop.'),
    ],
    optionMethods: [],
  },
  {
    name: 'ListCollections',
    docId: 'AVEcd3SCwoRyiTxcNodcQAepnGf',
    syntaxCode: `option := milvusclient.NewListCollectionOption()

result, err := client.ListCollections(ctx, option)`,
    params: [],
    optionMethods: [],
  },
  {
    name: 'ListResourceGroups',
    docId: 'CqwWd5HLzoLc6Lx0IArcK0j6nQg',
    syntaxCode: `option := milvusclient.NewListResourceGroupsOption()

result, err := client.ListResourceGroups(ctx, option)`,
    params: [],
    optionMethods: [],
  },
];

// ─── Fix helpers ─────────────────────────────────────────────────────────────

/** Find and patch the example code block (last code block in the doc). */
async function fixTodoExample(fix) {
  const blocks = await getDocBlocks(fix.docId);
  const pageBlock = blocks[0];

  // Find all code blocks
  const codeBlocks = blocks.filter(b => b.block_type === 14);
  if (codeBlocks.length === 0) {
    console.log(`  SKIP ${fix.name}: no code blocks found`);
    return;
  }

  // Last code block = example
  const exampleBlock = codeBlocks[codeBlocks.length - 1];
  const currentText = (exampleBlock.code?.elements || []).map(e => e.text_run?.content || '').join('');

  if (!currentText.includes('// TODO:')) {
    console.log(`  SKIP ${fix.name}: no TODO found in last code block`);
    return;
  }

  console.log(`  UPDATE ${fix.name} (${fix.docId}): replacing TODO example`);
  if (DRY_RUN) {
    console.log('    [dry-run] would patch block', exampleBlock.block_id);
    console.log('    New example preview:', fix.example.substring(0, 80) + '...');
    return;
  }

  await patchCodeBlock(fix.docId, exampleBlock.block_id, fix.example);
  console.log(`  ✓ Updated ${fix.name}`);
}

/** Insert Request Syntax section after the function signature code block. */
async function fixMissingRequestSyntax(fix) {
  const blocks = await getDocBlocks(fix.docId);
  const pageBlock = blocks[0];
  const pageChildren = pageBlock.children || [];

  // Find the first code block (function signature) in the page's children
  let sigBlockIndex = -1;
  for (let i = 0; i < pageChildren.length; i++) {
    const childId = pageChildren[i];
    const childBlock = blocks.find(b => b.block_id === childId);
    if (childBlock && childBlock.block_type === 14) {
      sigBlockIndex = i;
      break;
    }
  }

  if (sigBlockIndex === -1) {
    console.log(`  SKIP ${fix.name}: no signature code block found`);
    return;
  }

  // Build the blocks to insert
  const newBlocks = [
    makeHeading2('Request Syntax'),
    makeCodeBlock(fix.syntaxCode, GO_LANG_ID),
  ];

  if (fix.params.length > 0) {
    newBlocks.push(makeBoldParagraph('PARAMETERS:'));
    for (const p of fix.params) newBlocks.push(p);
  }

  if (fix.optionMethods.length > 0) {
    newBlocks.push(makeBoldParagraph('OPTION METHODS:'));
    for (const m of fix.optionMethods) newBlocks.push(m);
  }

  const insertIndex = sigBlockIndex + 1;
  console.log(`  INSERT ${fix.name} (${fix.docId}): ${newBlocks.length} blocks at index ${insertIndex}`);

  if (DRY_RUN) {
    console.log(`    [dry-run] would insert ${newBlocks.length} blocks after sig block at index ${insertIndex}`);
    return;
  }

  await insertChildren(fix.docId, pageBlock.block_id, newBlocks, insertIndex);
  console.log(`  ✓ Inserted Request Syntax for ${fix.name}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Go SDK Example Fixer');
  console.log('====================\n');
  if (DRY_RUN) console.log('  *** DRY RUN MODE ***\n');
  if (ONLY_METHOD) console.log(`  Filtering to method: ${ONLY_METHOD}\n`);

  // Phase 1: Fix TODO examples
  console.log('Phase 1: Replacing TODO examples...\n');
  let todoList = TODO_FIXES;
  if (ONLY_METHOD) todoList = todoList.filter(f => f.name.toLowerCase() === ONLY_METHOD.toLowerCase());

  let updated = 0;
  for (const fix of todoList) {
    try {
      await fixTodoExample(fix);
      updated++;
    } catch (err) {
      console.error(`  ERROR ${fix.name}:`, err.message);
    }
    await delay();
  }
  console.log(`\nPhase 1 done: processed ${updated}/${todoList.length}\n`);

  // Phase 2: Add missing Request Syntax sections
  console.log('Phase 2: Adding missing Request Syntax sections...\n');
  let syntaxList = REQUEST_SYNTAX_FIXES;
  if (ONLY_METHOD) syntaxList = syntaxList.filter(f => f.name.toLowerCase() === ONLY_METHOD.toLowerCase());

  let inserted = 0;
  for (const fix of syntaxList) {
    try {
      await fixMissingRequestSyntax(fix);
      inserted++;
    } catch (err) {
      console.error(`  ERROR ${fix.name}:`, err.message);
    }
    await delay();
  }
  console.log(`\nPhase 2 done: processed ${inserted}/${syntaxList.length}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
