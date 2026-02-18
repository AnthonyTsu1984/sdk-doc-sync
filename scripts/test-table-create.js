const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const MarkdownToFeishu = require('../src/markdown-to-feishu');

async function testRows(m2f, rows) {
    try {
        let tableRows = '';
        for (let r = 0; r < rows; r++) {
            const tag = r === 0 ? 'th' : 'td';
            tableRows += `<tr><${tag}>A</${tag}><${tag}>B</${tag}><${tag}>C</${tag}></tr>\n`;
        }
        const markdown = `# Test\n\n<table>\n${tableRows}</table>\n\nDone.`;
        const result = await m2f.push_markdown({
            markdown_content: markdown,
            title: `R${rows} - DEL`,
            folder_token: 'Gw47fZMsAltMqxdb6Y4cYfVknfe',
        });
        console.log(`OK  ${rows} rows`);
        return true;
    } catch (err) {
        console.log(`FAIL ${rows} rows: ${err.message.slice(0, 60)}`);
        return false;
    }
}

async function main() {
    const m2f = new MarkdownToFeishu({ sourceType: 'drive' });
    // Test to find max row limit
    for (const rows of [9, 10, 11, 12]) {
        await testRows(m2f, rows);
        await new Promise(r => setTimeout(r, 2000));
    }
}

main().catch(err => { console.error(err); process.exit(1); });
