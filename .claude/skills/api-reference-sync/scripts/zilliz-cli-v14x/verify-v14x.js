#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const BitableWriter = require('../../src/sdk-doc-sync/bitable-writer');
const tf = new (require('../../lib/lark-docs/larkTokenFetcher'))();

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DRIVE_BASE = 'https://zilliverse.feishu.cn/drive/folder';
const DOC_BASE = 'https://zilliverse.feishu.cn/docx';

const ROOT_FOLDER = 'HbYZfaMOilKsLmdCCuGc5FkCnpg';
const BITABLE_APP = 'Ly1Tb2SAnaoqSes750ZcNFkOnTd';
const BITABLE_TABLE = 'tblVFXzRMjCj4d0m';
const OUTPUT_PATH = '/tmp/v14x-verification-report.json';
const AUDIT_ALL = process.argv.includes('--audit-all');

const SCOPED_TREE = {
  Configuration: ['Global', 'Context', 'Auth'],
  'Cloud Management': ['Project', 'OnDemandCluster', 'PrivateLink'],
  'Data Operations': ['Collection', 'ExternalCollectionRefresh'],
};

const FULL_TREE = {
  'Configuration': ['Alert', 'Global', 'Context', 'Configure', 'Completion', 'Auth', 'History', 'Quickstart'],
  'Cloud Management': ['Cluster', 'Billing', 'Job', 'Volume', 'Import', 'Backup', 'Project', 'Milvus Standalone', 'OnDemandCluster', 'PrivateLink'],
  'Data Operations': ['Collection', 'Alias', 'Role', 'User', 'Partition', 'Index', 'Database', 'Vector', 'ExternalCollectionRefresh'],
};

const EXPECTED_TREE = AUDIT_ALL ? FULL_TREE : SCOPED_TREE;

const EXPECTED_NEW_DOCS = [
  { title: 'trigger', subfolder: 'ExternalCollectionRefresh' },
  { title: 'describe', subfolder: 'ExternalCollectionRefresh' },
  { title: 'list', subfolder: 'ExternalCollectionRefresh' },
  { title: 'upgrade', subfolder: 'Global' },
  { title: 'uninstall', subfolder: 'Global' },
];

const SCOPED_DOC_PRESENCE_SUBFOLDERS = new Set(
  Object.values(SCOPED_TREE).flat()
);

const UPDATE_SCOPE_SLUGS = [
  'Context-set',
  'Auth-login',
  'Collection-create',
  'QueryCluster',
  'Query-cluster',
  'OnDemandCluster',
  'On-demand-cluster',
  'QueryCluster-create',
  'Query-cluster-create',
  'OnDemandCluster-create',
  'On-demand-cluster-create',
  'QueryCluster-list',
  'Query-cluster-list',
  'QueryCluster-describe',
  'Query-cluster-describe',
  'OnDemandCluster-list',
  'On-demand-cluster-list',
  'OnDemandCluster-describe',
  'On-demand-cluster-describe',
  'Project-create',
  'Project-addregions',
  'Project-add-regions',
  'PrivateLink',
  'Privatelink',
  'PrivateLink-list',
  'Privatelink-list',
  'Global-version',
];

function docsCellToObj(docs) {
  if (!docs) return { title: '', link: '' };
  if (typeof docs === 'string') return { title: docs, link: '' };
  return { title: docs.text || docs.title || '', link: docs.link || '' };
}

function slugText(record) {
  const raw = record.fields?.Slug;
  if (Array.isArray(raw)) return raw.map(x => x.text || '').join('');
  if (typeof raw === 'string') return raw;
  return '';
}

function extractParentRecordIds(parentField) {
  if (!Array.isArray(parentField)) return [];
  const out = [];
  for (const p of parentField) {
    if (typeof p === 'string') out.push(p);
    else if (p?.record_ids && Array.isArray(p.record_ids)) out.push(...p.record_ids);
    else if (p?.record_id) out.push(p.record_id);
  }
  return out.filter(Boolean);
}

function parseDocxToken(link) {
  const m = (link || '').match(/\/docx\/([A-Za-z0-9]+)/);
  return m ? m[1] : '';
}

function parseFolderToken(link) {
  const m = (link || '').match(/\/drive\/folder\/([A-Za-z0-9]+)/);
  return m ? m[1] : '';
}

function normalizeTitle(text) {
  return String(text || '').trim().toLowerCase();
}

function normalizeTypeValues(typeField) {
  if (Array.isArray(typeField)) return typeField.filter(Boolean).map(String);
  if (typeField == null) return [];
  return [String(typeField)];
}

async function listFolder(folderToken, type = 'all') {
  const all = [];
  let pageToken = null;
  do {
    let url = `${FEISHU_HOST}/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=200`;
    if (type !== 'all') url += `&type=${type}`;
    if (pageToken) url += `&page_token=${pageToken}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${await tf.token()}` },
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`listFolder(${folderToken}) failed: ${data.msg}`);
    all.push(...(data.data.files || []));
    pageToken = data.data.has_more ? data.data.next_page_token : null;
  } while (pageToken);
  return all;
}

(async () => {
  const report = {
    generatedAt: new Date().toISOString(),
    auditAll: AUDIT_ALL,
    rootFolder: ROOT_FOLDER,
    bitable: { app: BITABLE_APP, table: BITABLE_TABLE },
    structural: {
      categoryChecks: [],
      subfolderChecks: [],
      docPresenceChecks: {
        inScopeChecks: [],
        outOfScopeObservations: [],
      },
      newDocChecks: [],
      representativeSubfolderDocx: {},
    },
    bitableChecks: {
      representativeVirtualNodes: [],
      updateRecords: [],
      newRecords: [],
      representativeRecordIds: [],
    },
    closureMatrix: [],
    summary: {},
    scanState: {
      pendingApproval: true,
      note: 'Do not update scan-state.json (zilliz-cli.lastScannedTag -> zilliz-v1.4.2) until explicit user approval.',
    },
  };

  try {

  const rootItems = await listFolder(ROOT_FOLDER, 'folder');
  const categories = {};
  for (const f of rootItems) categories[f.name] = f.token;

  for (const [catName, expectedSubs] of Object.entries(EXPECTED_TREE)) {
    const token = categories[catName] || '';
    const ok = Boolean(token);
    report.structural.categoryChecks.push({ name: catName, token, pass: ok });

    if (!ok) {
      for (const subName of expectedSubs) {
        report.structural.subfolderChecks.push({ category: catName, name: subName, token: '', pass: false, reason: 'Category missing' });
      }
      continue;
    }

    const subItems = await listFolder(token, 'folder');
    const subByName = new Map(subItems.map(x => [x.name, x.token]));

    for (const subName of expectedSubs) {
      const subToken = subByName.get(subName) || '';
      const subOk = Boolean(subToken);
      report.structural.subfolderChecks.push({ category: catName, name: subName, token: subToken, pass: subOk });
      if (!subOk) continue;

      const docx = await listFolder(subToken, 'docx');
      const entry = { subfolder: subName, token: subToken, docxCount: docx.length, pass: docx.length > 0 };
      if (SCOPED_DOC_PRESENCE_SUBFOLDERS.has(subName)) {
        report.structural.docPresenceChecks.inScopeChecks.push(entry);
        report.structural.representativeSubfolderDocx[subName] = docx.slice(0, 10).map(d => ({ token: d.token, name: d.name }));
      } else if (AUDIT_ALL) {
        report.structural.docPresenceChecks.outOfScopeObservations.push(entry);
      }
    }
  }

  const subfolderTokenByName = new Map(report.structural.subfolderChecks.filter(x => x.pass).map(x => [x.name, x.token]));
  for (const spec of EXPECTED_NEW_DOCS) {
    const folderToken = subfolderTokenByName.get(spec.subfolder) || '';
    if (!folderToken) {
      report.structural.newDocChecks.push({ ...spec, pass: false, reason: `Missing subfolder ${spec.subfolder}` });
      continue;
    }
    const docs = await listFolder(folderToken, 'docx');
    const expectedName = normalizeTitle(spec.title);
    const found = docs.find(d => normalizeTitle(d.name) === expectedName);
    report.structural.newDocChecks.push({
      ...spec,
      folderToken,
      pass: Boolean(found),
      docToken: found?.token || '',
      docUrl: found ? `${DOC_BASE}/${found.token}` : '',
    });
  }

  const bw = new BitableWriter({ baseToken: BITABLE_APP, tableId: BITABLE_TABLE });
  const records = await bw.listRecords({ pageSize: 500 });

  const virtualNodesByTitle = new Map();
  const functionRecords = [];
  for (const r of records) {
    const docs = docsCellToObj(r.fields?.Docs);
    const types = normalizeTypeValues(r.fields?.Type);
    if (types.includes('VirtualNode')) {
      if (docs.title) virtualNodesByTitle.set(docs.title, { recordId: r.record_id, link: docs.link || '' });
      continue;
    }

    if (types.includes('Function')) {
      functionRecords.push({
        recordId: r.record_id,
        title: docs.title,
        link: docs.link,
        docxToken: parseDocxToken(docs.link),
        slug: slugText(r),
        parentRecordIds: extractParentRecordIds(r.fields?.父记录),
      });
    }
  }

  for (const vTitle of ['Configuration', 'Cloud Management', 'Data Operations', 'Global', 'Project', 'OnDemandCluster', 'PrivateLink', 'ExternalCollectionRefresh']) {
    const vn = virtualNodesByTitle.get(vTitle);
    const expectedFolderToken = subfolderTokenByName.get(vTitle) || categories[vTitle] || '';
    report.bitableChecks.representativeVirtualNodes.push({
      title: vTitle,
      recordId: vn?.recordId || '',
      docsLink: vn?.link || '',
      expectedFolderToken,
      expectedLink: expectedFolderToken ? `${DRIVE_BASE}/${expectedFolderToken}` : '',
      pass: Boolean(vn && expectedFolderToken && parseFolderToken(vn.link) === expectedFolderToken),
    });
  }

  const updateSlugSet = new Set(UPDATE_SCOPE_SLUGS.map(x => x.toLowerCase()));
  const updateRecords = functionRecords.filter(r => updateSlugSet.has((r.slug || '').toLowerCase()));
  for (const r of updateRecords) {
    report.bitableChecks.updateRecords.push({
      scope: r.slug,
      recordId: r.recordId,
      title: r.title,
      docUrl: r.link,
      parentRecordIds: r.parentRecordIds,
      pass: Boolean(r.docxToken && r.link.startsWith(DOC_BASE)),
    });
  }

  const newSpecToSlug = {
    'external-collection refresh trigger': 'ExternalCollectionRefresh-trigger',
    'external-collection refresh describe': 'ExternalCollectionRefresh-describe',
    'external-collection refresh list': 'ExternalCollectionRefresh-list',
    'upgrade': 'Global-upgrade',
    'uninstall': 'Global-uninstall',
  };
  for (const [name, slug] of Object.entries(newSpecToSlug)) {
    const rec = functionRecords.find(r => (r.slug || '').toLowerCase() === slug.toLowerCase());
    report.bitableChecks.newRecords.push({
      item: name,
      slug,
      recordId: rec?.recordId || '',
      title: rec?.title || '',
      docUrl: rec?.link || '',
      parentRecordIds: rec?.parentRecordIds || [],
      pass: Boolean(rec && rec.docxToken && rec.link.startsWith(DOC_BASE)),
    });
  }

  const representative = [];
  const addRep = rec => {
    if (rec?.recordId && !representative.includes(rec.recordId)) representative.push(rec.recordId);
  };
  addRep(report.bitableChecks.newRecords.find(x => x.slug === 'ExternalCollectionRefresh-trigger'));
  addRep(report.bitableChecks.newRecords.find(x => x.slug === 'Global-upgrade'));
  addRep(report.bitableChecks.updateRecords.find(x => /Auth-login/i.test(x.scope)));
  addRep(report.bitableChecks.updateRecords.find(x => /Context-set/i.test(x.scope)));
  addRep(report.bitableChecks.updateRecords.find(x => /Project-create/i.test(x.scope)));
  report.bitableChecks.representativeRecordIds = representative;

  const closureItems = [
    { kind: 'UPDATE', item: 'context set', searchedPatterns: ['Context-set'], pred: r => /Context-set/i.test(r.slug) },
    { kind: 'UPDATE', item: 'login', searchedPatterns: ['Auth-login'], pred: r => /Auth-login/i.test(r.slug) },
    { kind: 'UPDATE', item: 'collection create', searchedPatterns: ['Collection-create'], pred: r => /Collection-create/i.test(r.slug) },
    { kind: 'UPDATE', item: 'on-demand-cluster family', searchedPatterns: ['QueryCluster', 'OnDemandCluster', 'On-demand-cluster', 'Query-cluster'], pred: r => /(QueryCluster|OnDemandCluster|On-demand-cluster|Query-cluster)/i.test(r.slug) },
    { kind: 'UPDATE', item: 'project create', searchedPatterns: ['Project-create'], pred: r => /Project-create/i.test(r.slug) },
    { kind: 'UPDATE', item: 'project add-regions', searchedPatterns: ['Project-addregions', 'Project-add-regions'], pred: r => /(Project-addregions|Project-add-regions)/i.test(r.slug) },
    { kind: 'UPDATE', item: 'privatelink family', searchedPatterns: ['PrivateLink', 'Privatelink'], pred: r => /(PrivateLink|Privatelink)/i.test(r.slug) },
    { kind: 'UPDATE', item: 'global update-check note', searchedPatterns: ['Global-version'], pred: r => /Global-version/i.test(r.slug) },
    { kind: 'CREATE', item: 'external-collection refresh trigger', searchedPatterns: ['ExternalCollectionRefresh-trigger'], pred: r => /ExternalCollectionRefresh-trigger/i.test(r.slug) },
    { kind: 'CREATE', item: 'external-collection refresh describe', searchedPatterns: ['ExternalCollectionRefresh-describe'], pred: r => /ExternalCollectionRefresh-describe/i.test(r.slug) },
    { kind: 'CREATE', item: 'external-collection refresh list', searchedPatterns: ['ExternalCollectionRefresh-list'], pred: r => /ExternalCollectionRefresh-list/i.test(r.slug) },
    { kind: 'CREATE', item: 'upgrade', searchedPatterns: ['Global-upgrade'], pred: r => /Global-upgrade/i.test(r.slug) },
    { kind: 'CREATE', item: 'uninstall', searchedPatterns: ['Global-uninstall'], pred: r => /Global-uninstall/i.test(r.slug) },
  ];

  for (const item of closureItems) {
    const matches = functionRecords.filter(item.pred);
    if (matches.length === 0) {
      report.closureMatrix.push({
        kind: item.kind,
        item: item.item,
        status: 'MISSING',
        records: [],
        diagnostics: {
          searchedPatterns: item.searchedPatterns,
          candidateSlugs: functionRecords.slice(0, 25).map(r => r.slug).filter(Boolean),
          candidateTitles: functionRecords.slice(0, 25).map(r => r.title).filter(Boolean),
        },
      });
      continue;
    }
    report.closureMatrix.push({
      kind: item.kind,
      item: item.item,
      status: 'OK',
      records: matches.map(m => ({ recordId: m.recordId, slug: m.slug, title: m.title, docUrl: m.link })),
    });
  }

  const countPass = arr => arr.filter(x => x.pass).length;
  report.summary = {
    categoryChecks: {
      passed: countPass(report.structural.categoryChecks),
      total: report.structural.categoryChecks.length,
    },
    subfolderChecks: {
      passed: countPass(report.structural.subfolderChecks),
      total: report.structural.subfolderChecks.length,
    },
    inScopeDocPresenceChecks: {
      passed: countPass(report.structural.docPresenceChecks.inScopeChecks),
      total: report.structural.docPresenceChecks.inScopeChecks.length,
    },
    outOfScopeDocPresenceObservations: report.structural.docPresenceChecks.outOfScopeObservations.length,
    representativeDocxSubfolders: Object.keys(report.structural.representativeSubfolderDocx).length,
    expectedNewDocs: {
      passed: countPass(report.structural.newDocChecks),
      total: report.structural.newDocChecks.length,
    },
    representativeVirtualNodes: {
      passed: countPass(report.bitableChecks.representativeVirtualNodes),
      total: report.bitableChecks.representativeVirtualNodes.length,
    },
    updateRecordsFound: report.bitableChecks.updateRecords.length,
    newRecordsFound: {
      passed: countPass(report.bitableChecks.newRecords),
      total: report.bitableChecks.newRecords.length,
    },
    closureChecks: {
      passed: report.closureMatrix.filter(x => x.status === 'OK').length,
      total: report.closureMatrix.length,
    },
    representativeRecordIds: report.bitableChecks.representativeRecordIds.length,
    human: {
      categories: `${countPass(report.structural.categoryChecks)}/${report.structural.categoryChecks.length}`,
      subfolders: `${countPass(report.structural.subfolderChecks)}/${report.structural.subfolderChecks.length}`,
      expectedNewDocs: `${countPass(report.structural.newDocChecks)}/${report.structural.newDocChecks.length}`,
      representativeVirtualNodes: `${countPass(report.bitableChecks.representativeVirtualNodes)}/${report.bitableChecks.representativeVirtualNodes.length}`,
      newRecordsFound: `${countPass(report.bitableChecks.newRecords)}/${report.bitableChecks.newRecords.length}`,
      closureOk: `${report.closureMatrix.filter(x => x.status === 'OK').length}/${report.closureMatrix.length}`,
    },
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));

  console.log('Verification summary');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Representative record IDs: ${report.bitableChecks.representativeRecordIds.join(', ') || '(none)'}`);
  console.log(`Report written to ${OUTPUT_PATH}`);
  } catch (error) {
    const failureReport = {
      status: 'FAILED',
      generatedAt: new Date().toISOString(),
      outputPath: OUTPUT_PATH,
      error: {
        message: error?.message || String(error),
        stack: error?.stack || '',
      },
    };
    console.error('[verify-v14x] Verification failed');
    console.error(JSON.stringify(failureReport, null, 2));
    process.exit(1);
  }
})();
