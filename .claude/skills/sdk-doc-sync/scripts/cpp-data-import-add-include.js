const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });
const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const FEISHU_HOST = process.env.FEISHU_HOST;
const tf = new larkTokenFetcher();

const TARGETS = [
    { docId: 'FdxMdw01eoWnXKx4Q4rcUh0unFf', blockId: 'doxcnqQnILzgU0iYmOa0AYEqEBe' },
    { docId: 'Ls7kdwtuJoZfVUx1N3vc5tkznuh', blockId: 'doxcneb5SVZNubp1hk1nr5GjUec' },
    { docId: 'NmxkduivloqgeXxVxOpcHydEnne', blockId: 'doxcn7OqWdauO1YNSROAlPOU9kc' },
];

const INCLUDE = '#include "milvus/MilvusClientV2.h"\n';

async function main() {
    const token = await tf.token();

    for (const { docId, blockId } of TARGETS) {
        const res = await fetch(`${FEISHU_HOST}/open-apis/docx/v1/documents/${docId}/blocks/${blockId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        const elems = data.data.block.code.elements;
        const currentText = elems.map(e => e.text_run?.content || '').join('');

        const patchRes = await fetch(`${FEISHU_HOST}/open-apis/docx/v1/documents/${docId}/blocks/batch_update`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requests: [{
                    block_id: blockId,
                    update_text_elements: {
                        elements: [{ text_run: { content: INCLUDE + currentText, text_element_style: {} } }],
                    },
                }],
            }),
        });
        const patchData = await patchRes.json();
        if (patchData.code !== 0) throw new Error(patchData.msg);
        console.log('Patched', docId);
    }
    console.log('Done');
}

main().catch(err => { console.error(err.message); process.exit(1); });
