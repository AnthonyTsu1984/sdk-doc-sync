const MarkdownToFeishu = require('../src/markdown-to-feishu');
require('dotenv').config();

async function testEquations() {
    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: process.env.ROOT_TOKEN,
        baseToken: process.env.BASE_TOKEN
    });

    const markdown = `
# Equation Test

## Inline Equations

The formula for area is $A = \\pi r^2$ where $r$ is the radius.

Einstein's famous equation is $E = mc^2$.

## Mixed Content

You can have **bold text** with equations like $x^2 + y^2 = z^2$ in the same line.

The quadratic formula is $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$ which solves $ax^2 + bx + c = 0$.

## Block Equations

For larger equations, use block format:

$$
\\int_{a}^{b} f(x) dx = F(b) - F(a)
$$

Matrix notation:

$$
\\begin{bmatrix}
a & b \\\\
c & d
\\end{bmatrix}
$$
`;

    console.log('Testing equation parsing...\n');

    // Parse markdown
    const { tokens } = await m2f.parse_markdown(markdown);
    console.log(`✅ Parsed ${tokens.length} tokens\n`);

    // Convert to blocks
    const blocks = await m2f.markdown_to_blocks(tokens);
    console.log(`✅ Converted to ${blocks.length} blocks\n`);

    // Check for equation elements in text blocks
    let equationCount = 0;
    blocks.forEach(block => {
        if (block.text && block.text.elements) {
            block.text.elements.forEach(element => {
                if (element.equation) {
                    equationCount++;
                    console.log(`Found equation: ${element.equation.content}`);
                }
            });
        }
    });

    console.log(`\n✅ Found ${equationCount} inline equations\n`);

    // Show block structure
    console.log('Block types:');
    blocks.forEach((block, idx) => {
        const typeName = Object.keys(m2f.block_type_map).find(
            key => m2f.block_type_map[key] === block.block_type
        );
        console.log(`  ${idx + 1}. ${typeName} (type ${block.block_type})`);
    });

    if (equationCount > 0) {
        console.log('\n✅ Inline equation support working!');
    } else {
        console.log('\n⚠️  No inline equations found - check parsing logic');
    }

    // Uncomment to push to Feishu
    /*
    console.log('\nPushing to Feishu...');
    const result = await m2f.push_markdown({
        markdown_content: markdown,
        title: 'Equation Test Document'
    });
    console.log('Document ID:', result.document_id);
    */
}

testEquations().catch(console.error);
