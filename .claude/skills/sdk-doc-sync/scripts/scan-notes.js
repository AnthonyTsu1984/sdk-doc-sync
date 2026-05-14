const path = require('path');

require('dotenv').config({ path: path.resolve('/Volumes/CaseSensitive/projects/feishu-markdown-bridge/.claude/skills/sdk-doc-sync', '.env') });

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const fetch = require('node-fetch');

async function getToken() {
  const larkTokenFetcher = require(path.resolve('/Volumes/CaseSensitive/projects/feishu-markdown-bridge/.claude/skills/sdk-doc-sync', 'lib/lark-docs/larkTokenFetcher'));
  const tf = new larkTokenFetcher();
  return tf.token();
}

async function getBlocks(docId, token) {
  const res = await fetch(`${FEISHU_HOST}/open-apis/docx/v1/documents/${docId}/blocks?document_revision_id=-1`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`getBlocks failed: ${data.msg}`);
  return data.data.items;
}

function getBlockText(block) {
  let elems = [];
  if (block.text?.elements) elems = block.text.elements;
  else if (block.quote?.elements) elems = block.quote.elements;
  else if (block.heading2?.elements) elems = block.heading2.elements;
  return elems.map(e => e.text_run?.content || '').join('');
}

async function scanDoc(docId, docName) {
  const token = await getToken();
  const blocks = await getBlocks(docId, token);
  const page = blocks.find(b => b.block_type === 1);
  if (!page) return [];
  
  const issues = [];
  const children = page.children.map(id => blocks.find(b => b.block_id === id));
  
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    
    // Check quote blocks (type 15)
    if (child.block_type === 15) {
      const text = getBlockText(child);
      // Check if it's a note block
      if (text.includes('Note') || text.includes('Notes')) {
        // Expected format: starts with 📖 Notes
        if (!text.startsWith('📖 Notes')) {
          issues.push({
            doc: docName,
            docId,
            index: i,
            type: 'quote',
            text: text.slice(0, 100),
            issue: 'Quote block does not start with 📖 Notes'
          });
        } else {
          // Check if it has content after 📖 Notes
          const afterTitle = text.slice('📖 Notes'.length).trim();
          if (!afterTitle) {
            issues.push({
              doc: docName,
              docId,
              index: i,
              type: 'quote',
              text: text.slice(0, 100),
              issue: 'Quote block has no content after 📖 Notes'
            });
          }
        }
      }
    }
    
    // Check quote containers (type 34)
    else if (child.block_type === 34) {
      const containerText = getBlockText(child);
      // Get children of container
      const containerChildren = blocks.filter(b => b.parent_id === child.block_id);
      const childTexts = containerChildren.map(getBlockText);
      const fullText = childTexts.join(' | ');
      
      if (fullText.includes('Note') || fullText.includes('Notes')) {
        if (!fullText.startsWith('📖 Notes')) {
          issues.push({
            doc: docName,
            docId,
            index: i,
            type: 'quote_container',
            text: fullText.slice(0, 100),
            issue: 'Quote container does not start with 📖 Notes'
          });
        }
      }
    }
    
    // Check text blocks that might be old-format notes
    else if (child.block_type === 2) {
      const text = getBlockText(child);
      if (text.match(/^\s*Note:/i) || text.match(/^\s*>\s*Note:/i)) {
        issues.push({
          doc: docName,
          docId,
          index: i,
          type: 'text',
          text: text.slice(0, 100),
          issue: 'Plain text block contains old Note: format'
        });
      }
    }
  }
  
  return issues;
}

const DOCS = [
  { id: 'WF1JdhGAgodzpExXO1hcPjADn8b', name: 'context-set' },
  { id: 'GaWqdekPvokCUtxBjRTcpNxInXg', name: 'login' },
  { id: 'LeH5d568MolZfhxAwoZcmjWTnGc', name: 'uninstall' },
  { id: 'ZCnedaDvloSUhwxvycSc4gwhnbf', name: 'upgrade' },
  { id: 'Oq1Pd3N3popZ2ExT184cksHfnxh', name: 'collection-create' },
  { id: 'YRQbd0bSOoMIDixpInlcg05jn4g', name: 'external-collection-list' },
  { id: 'NV6mdzUocoqBpjxpf6Lc649mnjh', name: 'external-collection-describe' },
  { id: 'ApSLdblNKo7ru0xGTqbconxBnSh', name: 'external-collection-trigger' },
  { id: 'GXhEdTZt9or6nix81GtcENu9n0f', name: 'project-create' },
  { id: 'JP80dUdphoM5N9xsTFTccZeRnhp', name: 'project-add-regions' },
  { id: 'IqkTduvaBo7477xaW1Hc1wBTn9c', name: 'on-demand-cluster-create' },
  { id: 'HPKQd2dsfoBpcBx84yXc5IhenrM', name: 'on-demand-cluster-delete' },
  { id: 'L2WsdkbDVoD5sGxAkkkcK4UEnHb', name: 'on-demand-cluster-describe' },
  { id: 'BZ6WdvA0eoRUJyxAqfMcJe6QnMd', name: 'on-demand-cluster-list' },
  { id: 'Tz35d2fXsogFeWxJblIcS7n2nYc', name: 'privatelink-add-whitelist' },
  { id: 'JYr4dveljoLs84xSAXJclFSkn8d', name: 'privatelink-delete' },
  { id: 'JQ1JdRsfBo1LdpxdTSpcgrx4n3b', name: 'privatelink-list' },
  { id: 'WIbvdNJNIoOG3Rx4gfncUuD4nBd', name: 'privatelink-list-services' },
  { id: 'GBdVd6bJ1o6VhRxgHxLcsFsVn2b', name: 'privatelink-create' },
  { id: 'JIV1ddqSXoFrNZxCCnecFvqKnxf', name: 'stage-apply' },
  { id: 'AHprdNjYcooS7RxesB6cQYKtnCe', name: 'stage-delete' },
  { id: 'GOv8dWju0oB8pbxAqt9cZJ27n1b', name: 'stage-create' },
  { id: 'XZjvd7rnUoOqd5xd42icajCtn3f', name: 'stage-list' },
  { id: 'VJ8cdV2uuoYAuMxrJAjcMmRknke', name: 'volume-apply' },
  { id: 'ZNogdKQgHotZObx7vXbc6FI8nZc', name: 'volume-describe' },
];

async function main() {
  const allIssues = [];
  for (const doc of DOCS) {
    const issues = await scanDoc(doc.id, doc.name);
    if (issues.length > 0) {
      allIssues.push(...issues);
    } else {
      console.log(`✓ ${doc.name}: no note issues`);
    }
  }
  
  if (allIssues.length > 0) {
    console.log('\n=== Note style drift found ===');
    for (const issue of allIssues) {
      console.log(`\n[${issue.doc}] (${issue.docId}) index ${issue.index}`);
      console.log(`  Type: ${issue.type}`);
      console.log(`  Text: ${issue.text}`);
      console.log(`  Issue: ${issue.issue}`);
    }
  } else {
    console.log('\n=== All docs have consistent note formatting ===');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
