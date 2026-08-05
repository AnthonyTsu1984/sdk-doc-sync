#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const BitableWriter = require('../../src/sdk-doc-sync/bitable-writer');
const MarkdownToFeishu = require('../../src/markdown-to-feishu');
const TokenFetcher = require('../../lib/lark-docs/larkTokenFetcher');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DOC_BASE = 'https://zilliverse.feishu.cn/docx';
const FOLDER_BASE = 'https://zilliverse.feishu.cn/drive/folder';

const BITABLE_APP = 'Lx1bbCdpMaSmJXs8wz5cjsDengf';
const BITABLE_TABLE = 'tblpP0OITBDkNAsN';
const V14_ROOT = 'LF1Kf54jFllUBydVk7hcha30nUh';
const OUT = '/tmp/zilliz-cli-v144-v145-update-results.json';

const DRY_RUN = process.argv.includes('--dry-run');
const APPLY_NODELESS = process.argv.includes('--skip-create') === false;

const tokenFetcher = new TokenFetcher();
const bw = new BitableWriter({ baseToken: BITABLE_APP, tableId: BITABLE_TABLE });
const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function docsCell(docs) {
  if (!docs) return { title: '', link: '' };
  if (typeof docs === 'string') return { title: docs, link: '' };
  return { title: docs.text || docs.title || '', link: docs.link || '' };
}

function extractSlug(record) {
  const raw = record.fields?.Slug;
  if (Array.isArray(raw)) return raw.map(x => x.text || '').join('');
  return raw || '';
}

function typeValues(record) {
  const t = record.fields?.Type;
  if (Array.isArray(t)) return t.map(String);
  return t ? [String(t)] : [];
}

function parentIds(record) {
  const field = record.fields?.父记录;
  if (!Array.isArray(field)) return [];
  const out = [];
  for (const item of field) {
    if (typeof item === 'string') out.push(item);
    else if (Array.isArray(item?.record_ids)) out.push(...item.record_ids);
    else if (item?.record_id) out.push(item.record_id);
  }
  return out.filter(Boolean);
}

function docxToken(link) {
  const m = String(link || '').match(/\/docx\/([A-Za-z0-9]+)/);
  return m ? m[1] : '';
}

function textRun(content, opts = {}) {
  return {
    text_run: {
      content,
      text_element_style: {
        bold: !!opts.bold,
        italic: !!opts.italic,
        inline_code: !!opts.code,
        strikethrough: false,
        underline: false,
      },
    },
  };
}

function paragraphBlock(elements) {
  return { block_type: 2, text: { elements, style: { align: 1, folded: false } } };
}

function bulletBlock(label, type) {
  return {
    block_type: 12,
    bullet: {
      elements: [
        textRun(label, { bold: true }),
        textRun(' ('),
        textRun(type, { italic: true }),
        textRun(') -'),
      ],
      style: { align: 1, folded: false },
    },
  };
}

function blockText(block) {
  const containers = ['text', 'heading1', 'heading2', 'heading3', 'bullet', 'ordered', 'quote', 'code', 'page'];
  for (const key of containers) {
    const elements = block[key]?.elements;
    if (Array.isArray(elements)) return elements.map(e => e.text_run?.content || '').join('');
  }
  return '';
}

async function api(method, endpoint, body = null) {
  const headers = {
    Authorization: `Bearer ${await tokenFetcher.token()}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
  const res = await fetch(`${FEISHU_HOST}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`${method} ${endpoint} failed: ${data.msg} (${data.code})`);
  }
  return data.data;
}

async function listFolder(folderToken, type = 'all') {
  const files = [];
  let pageToken = null;
  do {
    let endpoint = `/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=200`;
    if (type !== 'all') endpoint += `&type=${type}`;
    if (pageToken) endpoint += `&page_token=${pageToken}`;
    const data = await api('GET', endpoint);
    files.push(...(data.files || []));
    pageToken = data.has_more ? data.next_page_token : null;
  } while (pageToken);
  return files;
}

async function createFolder(name, parentToken) {
  if (DRY_RUN) return `<dry-run-folder-${name}>`;
  const data = await api('POST', '/open-apis/drive/v1/files/create_folder', {
    name,
    folder_token: parentToken,
  });
  await delay(500);
  return data.token;
}

async function ensureFolder(name, parentToken, result) {
  const existing = await listFolder(parentToken, 'folder');
  const found = existing.find(f => f.name === name);
  if (found) {
    result.folders.push({ name, token: found.token, created: false });
    return found.token;
  }
  const token = await createFolder(name, parentToken);
  result.folders.push({ name, token, created: true });
  return token;
}

async function pushMarkdown(markdown, title, folderToken) {
  if (DRY_RUN) return `<dry-run-doc-${title}>`;
  const writer = new MarkdownToFeishu({ sourceType: 'drive', rootToken: folderToken, baseToken: null });
  const pushed = await writer.push_markdown({
    markdown_content: markdown,
    title,
    folder_token: folderToken,
  });
  await delay(500);
  return pushed.document_id;
}

async function appendMarkdown(docId, markdown, marker, result, key) {
  const before = await m2f.get_document_blocks(docId);
  const beforeText = before.map(blockText).join('\n');
  if (beforeText.includes(marker)) {
    result.patches.push({ key, docId, skipped: true, reason: 'marker already present' });
    return;
  }
  if (!DRY_RUN) {
    const { tokens } = await m2f.parse_markdown(markdown);
    const blocks = await m2f.markdown_to_blocks(tokens);
    await m2f.patch_document({ document_id: docId, blocks, strategy: 'append' });
    await delay(500);
  }
  result.patches.push({ key, docId, skipped: false, dryRun: DRY_RUN, marker });
}

function optionLine(flag, type, description, required = false) {
  return [
    `- **${flag}** (*${type}*) -`,
    required ? '**[REQUIRED]**' : null,
    description,
  ].filter(Boolean).join('\n');
}

function cliDoc({ description, synopsis, options, examples, notes = [] }) {
  let md = `${description}\n\n`;
  if (notes.length) {
    md += `> 📖 **Notes**\n>\n`;
    for (const note of notes) md += `> ${note}\n`;
    md += '\n';
  }
  md += `## Synopsis{#synopsis}\n\n\`\`\`bash\n${synopsis}\n\`\`\`\n\n`;
  md += `**OPTIONS:**\n\n`;
  if (options.length === 0) {
    md += 'This command has no command-specific options.\n\n';
  } else {
    md += options.join('\n') + '\n\n';
  }
  md += `## Example{#example}\n\n\`\`\`bash\n${examples.join('\n\n')}\n\`\`\`\n`;
  return md;
}

const STORAGE_DOCS = [
  {
    title: 'list',
    description: 'This operation lists external storage integrations so you can review integration IDs, names, status, regions, buckets, and server messages before using them with import or external collection workflows.',
    synopsis: 'zilliz storage-integration list [OPTIONS]',
    options: [
      optionLine('--project-id', 'string', 'Specifies the project ID used to filter storage integrations.'),
      optionLine('--page-size', 'integer', 'Specifies the number of items to return per page.'),
      optionLine('--page', 'integer', 'Specifies the page number to return.'),
    ],
    examples: ['zilliz storage-integration list', 'zilliz storage-integration list --project-id proj-xxxx'],
  },
  {
    title: 'create',
    description: 'This operation creates an external storage integration. Use it to register bucket credentials for AWS, Azure, or GCP so Zilliz Cloud can access external data sources.',
    synopsis: 'zilliz storage-integration create --name <string> --bucket-name <string> [OPTIONS]',
    options: [
      optionLine('--name', 'string', 'Specifies the storage integration name.', true),
      optionLine('--bucket-name', 'string', 'Specifies the external bucket or container name.', true),
      optionLine('--project-id', 'string', 'Specifies the owning project ID.'),
      optionLine('--description', 'string', 'Specifies a human-readable description for the integration.'),
      optionLine('--region-id', 'string', 'Specifies the cloud region, such as `aws-us-east-1`.'),
      optionLine('--role-arn', 'string', 'Specifies the AWS IAM role ARN.'),
      optionLine('--external-id', 'string', 'Specifies the AWS external ID. This value is redacted from local command history.'),
      optionLine('--account-name', 'string', 'Specifies the Azure storage account name.'),
      optionLine('--client-id', 'string', 'Specifies the Azure client ID.'),
      optionLine('--tenant-id', 'string', 'Specifies the Azure tenant ID.'),
      optionLine('--gcp-project-id', 'string', 'Specifies the GCP project ID.'),
      optionLine('--service-account-email', 'string', 'Specifies the GCP service account email.'),
      optionLine('--body', 'path', 'Specifies a JSON body file, such as `file://integration.json`, when the flat flags are not sufficient.'),
    ],
    examples: [
      '# AWS',
      'zilliz storage-integration create --name s3-int --bucket-name my-bucket --region-id aws-us-east-1 --role-arn arn:aws:iam::123456789012:role/my-role --external-id ext-1',
      '# Azure',
      'zilliz storage-integration create --name az-int --bucket-name my-container --region-id azure-eastus --account-name myacct --client-id <client> --tenant-id <tenant>',
      '# GCP',
      'zilliz storage-integration create --name gcs-int --bucket-name my-bucket --region-id gcp-us-central1 --gcp-project-id my-proj --service-account-email sa@my-proj.iam.gserviceaccount.com',
      '# Raw body escape hatch',
      'zilliz storage-integration create --body file://integration.json',
    ],
  },
  {
    title: 'describe',
    description: 'This operation describes a storage integration by ID so you can inspect its current configuration, status, and validation message.',
    synopsis: 'zilliz storage-integration describe --integration-id <string>',
    options: [
      optionLine('--integration-id', 'string', 'Specifies the storage integration ID.', true),
    ],
    examples: ['zilliz storage-integration describe --integration-id int-xxxxxxxx'],
  },
  {
    title: 'delete',
    description: 'This operation deletes a storage integration by ID. Use it when an external bucket credential should no longer be available to Zilliz Cloud.',
    synopsis: 'zilliz storage-integration delete --integration-id <string>',
    options: [
      optionLine('--integration-id', 'string', 'Specifies the storage integration ID.', true),
    ],
    examples: ['zilliz storage-integration delete --integration-id int-xxxxxxxx'],
  },
  {
    title: 'validate',
    description: 'This operation validates an external storage integration configuration before or after creating the integration.',
    synopsis: 'zilliz storage-integration validate --bucket-name <string> [OPTIONS]',
    options: [
      optionLine('--bucket-name', 'string', 'Specifies the external bucket or container name to validate.', true),
      optionLine('--project-id', 'string', 'Specifies the project ID.'),
      optionLine('--region-id', 'string', 'Specifies the cloud region, such as `aws-us-east-1`.'),
      optionLine('--role-arn', 'string', 'Specifies the AWS IAM role ARN.'),
      optionLine('--external-id', 'string', 'Specifies the AWS external ID. This value is redacted from local command history.'),
      optionLine('--account-name', 'string', 'Specifies the Azure storage account name.'),
      optionLine('--client-id', 'string', 'Specifies the Azure client ID.'),
      optionLine('--tenant-id', 'string', 'Specifies the Azure tenant ID.'),
      optionLine('--gcp-project-id', 'string', 'Specifies the GCP project ID.'),
      optionLine('--service-account-email', 'string', 'Specifies the GCP service account email.'),
      optionLine('--body', 'path', 'Specifies a JSON body file, such as `file://integration.json`, when the flat flags are not sufficient.'),
    ],
    examples: ['zilliz storage-integration validate --bucket-name my-bucket --region-id aws-us-east-1 --role-arn arn:aws:iam::123456789012:role/my-role --external-id ext-1'],
  },
  {
    title: 'generate-auth-materials',
    description: 'This operation generates authorization materials for a storage integration. Use it to obtain the cloud-side credential material required before finalizing external storage access.',
    synopsis: 'zilliz storage-integration generate-auth-materials --bucket-name <string> [OPTIONS]',
    options: [
      optionLine('--bucket-name', 'string', 'Specifies the external bucket or container name.', true),
      optionLine('--project-id', 'string', 'Specifies the project ID.'),
      optionLine('--region-id', 'string', 'Specifies the cloud region, such as `aws-us-east-1`.'),
      optionLine('--body', 'path', 'Specifies a JSON body file, such as `file://authorization-materials.json`.'),
    ],
    examples: ['zilliz storage-integration generate-auth-materials --bucket-name my-bucket --region-id aws-us-east-1'],
  },
];

async function batchUpdate(docId, requests) {
  if (DRY_RUN) return;
  await api('PATCH', `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`, { requests });
  await delay(500);
}

async function insertChildren(docId, parentId, children, index) {
  if (DRY_RUN) return children.map((_, i) => ({ block_id: `<dry-run-${parentId}-${index + i}>` }));
  const data = await api('POST', `/open-apis/docx/v1/documents/${docId}/blocks/${parentId}/children`, {
    children,
    index,
  });
  await delay(500);
  return data.children || [];
}

async function patchRestoreCluster(record, result) {
  const link = docsCell(record.fields.Docs).link;
  const docId = docxToken(link);
  if (!docId) throw new Error('restore-cluster has no docx link');
  const blocks = await m2f.get_document_blocks(docId);
  const root = blocks.find(b => b.block_id === docId);
  const codeBlocks = blocks.filter(b => b.block_type === 14);
  const synopsisCode = codeBlocks[0];
  const exampleCode = codeBlocks[codeBlocks.length - 1];
  const allText = blocks.map(blockText).join('\n');
  const requests = [];

  if (synopsisCode) {
    const old = blockText(synopsisCode);
    let next = old
      .replace('--collection-status <LOADED | NOT_LOADED>', '--collection-status <KEEP | RELEASE>')
      .replace('[--output <value>]', '--restore-version-policy <LATEST | ORIGINAL>\n[--output <value>]');
    if (next !== old) {
      requests.push({
        block_id: synopsisCode.block_id,
        update_text_elements: { elements: [textRun(next)] },
      });
    }
  }

  if (exampleCode) {
    const old = blockText(exampleCode);
    let next = old
      .replace('--collection-status LOADED', '--collection-status KEEP')
      .replace('--cu-size 1 \\\n--collection-status KEEP', '--cu-size 1 \\\n--collection-status KEEP \\\n--restore-version-policy LATEST');
    if (next !== old) {
      requests.push({
        block_id: exampleCode.block_id,
        update_text_elements: { elements: [textRun(next)] },
      });
    }
  }

  if (requests.length) await batchUpdate(docId, requests);

  if (!allText.includes('--restore-version-policy')) {
    const optionsHeading = blocks.find(b => blockText(b).trim() === 'Options');
    const optionsIndex = root?.children?.indexOf(optionsHeading?.block_id) ?? -1;
    let insertIndex = optionsIndex + 1;
    if (insertIndex <= 0) insertIndex = root.children.length - 1;
    while (insertIndex < root.children.length) {
      const b = blocks.find(x => x.block_id === root.children[insertIndex]);
      if (!b || b.block_type !== 12) break;
      insertIndex += 1;
    }
    const inserted = await insertChildren(docId, docId, [bulletBlock('--restore-version-policy', 'string')], insertIndex);
    if (inserted[0]?.block_id) {
      await insertChildren(docId, inserted[0].block_id, [
        paragraphBlock([textRun('Specifies the DB version restore policy. Possible values: '), textRun('LATEST', { code: true }), textRun(' and '), textRun('ORIGINAL', { code: true }), textRun('.')]),
      ], 0);
    }
  }

  const collectionStatus = blocks.find(b => b.block_type === 12 && blockText(b).includes('--collection-status'));
  if (collectionStatus?.children?.length) {
    const childBlocks = blocks.filter(b => collectionStatus.children.includes(b.block_id));
    const possible = childBlocks.find(b => blockText(b).includes('LOADED') || blockText(b).includes('NOT_LOADED'));
    if (possible) {
      await batchUpdate(docId, [{
        block_id: possible.block_id,
        update_text_elements: {
          elements: [
            textRun('Possible values: '),
            textRun('KEEP', { code: true }),
            textRun(' and '),
            textRun('RELEASE', { code: true }),
            textRun('.'),
          ],
        },
      }]);
    }
  }

  if (!DRY_RUN) {
    await bw.updateRecord(record.record_id, { lastModified: 'v1.4.x' });
  }
  result.patches.push({ key: 'backup-restore-cluster', docId, recordId: record.record_id, dryRun: DRY_RUN });
}

async function main() {
  const result = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    bitable: { app: BITABLE_APP, table: BITABLE_TABLE },
    folders: [],
    records: [],
    docs: [],
    patches: [],
    deprecated: [],
    skipped: [],
    failed: [],
  };

  const records = await bw.listRecords({ pageSize: 500 });
  const bySlug = new Map(records.map(r => [extractSlug(r), r]));
  const virtualByTitle = new Map(
    records
      .filter(r => typeValues(r).includes('VirtualNode'))
      .map(r => [docsCell(r.fields.Docs).title, r])
  );

  const cloudManagement = virtualByTitle.get('Cloud Management');
  if (!cloudManagement) throw new Error('Missing Cloud Management VirtualNode');

  const cloudFolder = docxToken('');
  void cloudFolder;
  const cloudManagementFolder = 'QMg2fBP94l5N7VdSwbucwMffnje';
  const storageFolder = await ensureFolder('StorageIntegration', cloudManagementFolder, result);

  let storageParent = virtualByTitle.get('StorageIntegration');
  if (!storageParent && APPLY_NODELESS) {
    if (DRY_RUN) {
      storageParent = { record_id: '<dry-run-storage-virtual-node>' };
      result.records.push({ title: 'StorageIntegration', type: 'VirtualNode', dryRun: true });
    } else {
      storageParent = await bw.createRecord({
        title: 'StorageIntegration',
        link: `${FOLDER_BASE}/${storageFolder}`,
        type: 'VirtualNode',
        addedSince: 'v1.4.x',
        progress: 'Draft',
        targets: ['Zilliz'],
        parentRecordId: cloudManagement.record_id,
      });
      result.records.push({ title: 'StorageIntegration', type: 'VirtualNode', recordId: storageParent.record_id });
    }
  } else if (storageParent) {
    result.skipped.push({ key: 'StorageIntegration', reason: 'VirtualNode already exists', recordId: storageParent.record_id });
  }

  for (const spec of STORAGE_DOCS) {
    const slug = `StorageIntegration-${spec.title.replace(/-/g, '')}`;
    const existing = bySlug.get(slug);
    if (existing) {
      result.skipped.push({ key: slug, reason: 'Function record already exists', recordId: existing.record_id });
      continue;
    }
    const markdown = cliDoc(spec);
    const docId = await pushMarkdown(markdown, spec.title, storageFolder);
    const link = `${DOC_BASE}/${docId}`;
    let recordId = '<dry-run-record>';
    if (!DRY_RUN) {
      const rec = await bw.createRecord({
        title: spec.title,
        link,
        type: 'Function',
        addedSince: 'v1.4.x',
        progress: 'Draft',
        targets: ['Zilliz'],
        parentRecordId: storageParent.record_id,
      });
      recordId = rec.record_id;
    }
    result.docs.push({ key: slug, title: spec.title, docId, link, recordId });
  }

  const restore = bySlug.get('Backup-restorecluster');
  if (restore) await patchRestoreCluster(restore, result);
  else result.failed.push({ key: 'Backup-restorecluster', reason: 'record not found' });

  const version = bySlug.get('Global-version');
  if (version) {
    await appendMarkdown(
      docxToken(docsCell(version.fields.Docs).link),
      '## Shell completion{#shell-completion}\n\nShell completion is configured automatically on first run and again after each upgrade. The CLI detects installed shells such as Bash, Zsh, Fish, Elvish, and PowerShell, registers completion for both `zilliz` and `zz`, and migrates setups created by the removed `completion install` command.\n',
      'Shell completion is configured automatically on first run',
      result,
      'global-shell-completion'
    );
    if (!DRY_RUN) await bw.updateRecord(version.record_id, { lastModified: 'v1.4.x' });
  }

  const completionSlugs = ['Completion-install', 'Completion-uninstall', 'Completion-status', 'Completion-show'];
  for (const slug of completionSlugs) {
    const rec = bySlug.get(slug);
    if (!rec) {
      result.skipped.push({ key: slug, reason: 'record not found' });
      continue;
    }
    const title = docsCell(rec.fields.Docs).title;
    await appendMarkdown(
      docxToken(docsCell(rec.fields.Docs).link),
      '## Availability{#availability}\n\nThis command was removed in Zilliz CLI v1.4.4. Shell completion is configured automatically on first run and after each upgrade, so no manual `completion` command is required.\n',
      'This command was removed in Zilliz CLI v1.4.4',
      result,
      slug
    );
    if (!DRY_RUN) {
      await bw.updateRecord(rec.record_id, {
        deprecateSince: 'v1.4.4',
        lastModified: 'v1.4.x',
        progress: 'Deprecated',
      });
    }
    result.deprecated.push({ key: slug, title, recordId: rec.record_id });
  }

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(`Result written to ${OUT}`);
  console.log(JSON.stringify({
    dryRun: result.dryRun,
    folders: result.folders.length,
    docs: result.docs.length,
    patches: result.patches.length,
    deprecated: result.deprecated.length,
    skipped: result.skipped.length,
    failed: result.failed.length,
  }, null, 2));

  if (result.failed.length) process.exit(2);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
