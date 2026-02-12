const MarkdownToFeishu = require('../src/markdown-to-feishu');
const fs = require('fs');
require('dotenv').config();

async function testExample() {
    try {
        const markdown = fs.readFileSync('./example.md', 'utf-8');

        const m2f = new MarkdownToFeishu({
            sourceType: 'drive',
            rootToken: process.env.ROOT_TOKEN,
            baseToken: process.env.BASE_TOKEN
        });

        console.log('📄 Testing example.md conversion...\n');

        const { frontmatter, tokens } = await m2f.parse_markdown(markdown);
        console.log('✅ Frontmatter:', frontmatter);
        console.log(`✅ Parsed ${tokens.length} tokens\n`);

        const blocks = await m2f.markdown_to_blocks(tokens);
        console.log(`✅ Converted to ${blocks.length} Feishu blocks\n`);

        // Show block type distribution
        const blockStats = {};
        blocks.forEach(block => {
            const typeName = Object.keys(m2f.block_type_map).find(
                key => m2f.block_type_map[key] === block.block_type
            );
            blockStats[typeName] = (blockStats[typeName] || 0) + 1;
        });

        console.log('📊 Block type distribution:');
        Object.entries(blockStats).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
            console.log(`   ${type}: ${count}`);
        });

        console.log('\n✅ Example file processed successfully!');
        console.log('\n💡 To upload to Feishu, run:');
        console.log('   await m2f.push_markdown({ markdown_content: markdown, title: "Example Document" })');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    }
}

testExample();
