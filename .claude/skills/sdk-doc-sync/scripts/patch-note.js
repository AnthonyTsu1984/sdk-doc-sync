const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const fetch = require('node-fetch');

async function getToken() {
  const larkTokenFetcher = require(path.resolve(__dirname, '..', 'lib/lark-docs/larkTokenFetcher'));
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

async function deleteBlockChildren(docId, parentId, startIndex, endIndex, token) {
  const res = await fetch(`${FEISHU_HOST}/open-apis/docx/v1/documents/${docId}/blocks/${parentId}/children/batch_delete`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ start_index: startIndex, end_index: endIndex })
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`delete failed: ${data.msg}`);
  return data;
}

async function insertBlockChildren(docId, parentId, children, index, token) {
  const res = await fetch(`${FEISHU_HOST}/open-apis/docx/v1/documents/${docId}/blocks/${parentId}/children`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ children, index })
  });
  const data = await res.json();
  if (data.code !== 0) {
    console.error('Insert response:', JSON.stringify(data, null, 2));
    throw new Error(`insert failed: ${data.msg}`);
  }
  return data;
}

async function patchDoc(docId, noteContent) {
  const token = await getToken();
  const blocks = await getBlocks(docId, token);
  
  const page = blocks.find(b => b.block_type === 1);
  if (!page) throw new Error('Page block not found');
  
  const children = page.children.map(id => blocks.find(b => b.block_id === id));
  
  // Find note blocks to replace
  const indicesToDelete = [];
  
  for (let i = 0; i < children.length; i++) {
    const child = children[i];

    // Case 1: Quote block containing old Note: text or new Notes text
    if (child.block_type === 15 || child.block_type === 34) {
      const text = getBlockText(child, blocks);
      if (text.includes('Note:') || text.includes('Notes')) {
        indicesToDelete.push(i);
      }
    }

    // Case 2: Text block with 📖 Notes (our previous patch)
    else if (child.block_type === 2) {
      const text = getBlockText(child, blocks);
      if (text.includes('📖 Notes')) {
        indicesToDelete.push(i);
        // Also delete the next text block if it's the content
        if (i + 1 < children.length && children[i + 1].block_type === 2) {
          const nextText = getBlockText(children[i + 1], blocks);
          if (!nextText.startsWith('##') && !nextText.startsWith('**OPTIONS')) {
            indicesToDelete.push(i + 1);
          }
        }
      }
    }
  }
  
  if (indicesToDelete.length === 0) {
    console.log('No note blocks found');
    return;
  }
  
  // Deduplicate and sort descending for deletion
  const uniqueIndices = [...new Set(indicesToDelete)].sort((a, b) => b - a);
  console.log(`Found note blocks at indices: ${uniqueIndices.join(', ')}`);
  
  // Delete from highest index to lowest
  for (const idx of uniqueIndices) {
    await deleteBlockChildren(docId, page.block_id, idx, idx + 1, token);
  }
  console.log('Deleted old note blocks');
  
  // Insert new quote block at the lowest index
  const insertIndex = Math.min(...indicesToDelete);
  
  // Insert quote container (type 34)
  const quoteContainer = {
    block_type: 34
  };
  
  const insertRes = await insertBlockChildren(docId, page.block_id, [quoteContainer], insertIndex, token);
  const newBlockId = insertRes.data?.children?.[0]?.block_id;
  
  if (!newBlockId) {
    throw new Error('Failed to get new quote block ID');
  }
  console.log(`Created quote container: ${newBlockId}`);
  
  // Insert children into quote container
  const quoteChildren = [
    {
      block_type: 2,
      text: {
        elements: [
          { text_run: { content: '📖 Notes', text_element_style: { bold: true } } }
        ]
      }
    },
    {
      block_type: 2,
      text: {
        elements: [
          { text_run: { content: noteContent, text_element_style: {} } }
        ]
      }
    }
  ];
  
  await insertBlockChildren(docId, newBlockId, quoteChildren, 0, token);
  console.log('Inserted note content into quote block');
}

function getBlockText(block, allBlocks) {
  let elems = [];
  if (block.text?.elements) elems = block.text.elements;
  else if (block.quote?.elements) elems = block.quote.elements;
  else if (block.heading2?.elements) elems = block.heading2.elements;

  const directText = elems.map(e => e.text_run?.content || '').join('');

  // For quote containers (type 34), also check child blocks
  if (block.block_type === 34 && allBlocks) {
    const children = allBlocks.filter(b => b.parent_id === block.block_id);
    const childTexts = children.map(c => getBlockText(c, allBlocks));
    return childTexts.join(' | ') || directText;
  }

  return directText;
}

async function main() {
  const docId = process.argv[2];
  const content = process.argv[3];
  if (!docId || !content) {
    console.error('Usage: node patch-note.js <doc-id> <content>');
    process.exit(1);
  }
  await patchDoc(docId, content);
}

main().catch(e => { console.error(e); process.exit(1); });
