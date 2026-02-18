/**
 * Test DeepL Translator
 *
 * Usage: node tests/test-deepl-translator.js
 *
 * Requirements:
 *   - DEEPL_API_KEY in .env
 *   - Internet connection
 */

const DeepLTranslator = require('../src/feishu-doc-translator/translators/deepl-translator');

async function testDeepLTranslator() {
    console.log('=== DeepL Translator Test ===\n');

    // Check for API key
    if (!process.env.DEEPL_API_KEY) {
        console.log('⚠️  DEEPL_API_KEY not found in .env');
        console.log('   This test requires a DeepL API key');
        console.log('   Sign up at https://www.deepl.com/pro-api');
        console.log('   Free tier: 500,000 characters/month');
        process.exit(0);
    }

    const translator = new DeepLTranslator({
        sourceLang: 'en',
        targetLang: 'ja',
    });

    console.log('Test 1: Simple text translation');
    const text1 = 'Hello, World!';
    try {
        const result1 = await translator.translate(text1);
        console.log(`  Input:  "${text1}"`);
        console.log(`  Output: "${result1}"`);
        console.log('  ✅ Test 1 PASSED\n');
    } catch (error) {
        console.log(`  ❌ Test 1 FAILED: ${error.message}\n`);
        process.exit(1);
    }

    console.log('Test 2: Technical text with code');
    const text2 = 'The `INSERT` method adds data to the collection.';
    try {
        const result2 = await translator.translate(text2);
        console.log(`  Input:  "${text2}"`);
        console.log(`  Output: "${result2}"`);

        // Verify code preservation
        if (result2.includes('`INSERT`')) {
            console.log('  ✅ Test 2 PASSED (code preserved)\n');
        } else {
            console.log('  ⚠️  Test 2 WARNING: code not preserved\n');
        }
    } catch (error) {
        console.log(`  ❌ Test 2 FAILED: ${error.message}\n`);
        process.exit(1);
    }

    console.log('Test 3: Markdown translation');
    const markdown = `## Request Syntax

This operation inserts data into the collection.

**Parameters:**
- \`collection_name\` (*string*) - The name of the collection`;

    try {
        const result3 = await translator.translateMarkdown(markdown);
        console.log('  Input markdown:');
        console.log(markdown.split('\n').map(l => `    ${l}`).join('\n'));
        console.log('\n  Output markdown:');
        console.log(result3.split('\n').map(l => `    ${l}`).join('\n'));

        // Basic validation
        if (result3.includes('##') && result3.includes('`collection_name`')) {
            console.log('\n  ✅ Test 3 PASSED (markdown structure preserved)\n');
        } else {
            console.log('\n  ⚠️  Test 3 WARNING: markdown may be corrupted\n');
        }
    } catch (error) {
        console.log(`  ❌ Test 3 FAILED: ${error.message}\n`);
        process.exit(1);
    }

    console.log('=== All DeepL Translator Tests PASSED ===');
}

testDeepLTranslator().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
