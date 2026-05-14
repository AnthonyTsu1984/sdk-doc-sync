const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const fetch = require('node-fetch');

async function getToken() {
  const larkTokenFetcher = require(path.resolve(__dirname, '..', 'lib/lark-docs/larkTokenFetcher'));
  const tf = new larkTokenFetcher();
  return tf.token();
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

async function insertNote(docId, parentId, index, noteContent, token) {
  // Try block_type 15 (Quote) with inline content
  const quoteBlock = {
    block_type: 15,
    quote: {
      elements: [
        { text_run: { content: '📖 Notes', text_element_style: { bold: true } } },
        { text_run: { content: '\n' + noteContent, text_element_style: {} } }
      ]
    }
  };
  
  await insertBlockChildren(docId, parentId, [quoteBlock], index, token);
  console.log(`Inserted note at index ${index} in doc ${docId}`);
}

async function main() {
  const docId = process.argv[2];
  const parentId = process.argv[3];
  const index = parseInt(process.argv[4], 10);
  const content = process.argv[5];
  
  if (!docId || !parentId || isNaN(index) || !content) {
    console.error('Usage: node insert-note.js <doc-id> <parent-id> <index> <content>');
    process.exit(1);
  }
  
  const token = await getToken();
  await insertNote(docId, parentId, index, content, token);
}

main().catch(e => { console.error(e); process.exit(1); });
