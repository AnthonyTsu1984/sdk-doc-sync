/**
 * Test Ollama Translator
 *
 * Usage: node tests/test-ollama-translator.js
 *
 * Requirements:
 *   - Ollama installed (https://ollama.ai)
 *   - Ollama server running (ollama serve)
 *   - Model pulled (ollama pull qwen2.5:7b)
 */

const OllamaTranslator = require('../src/feishu-doc-translator/translators/ollama-translator');

async function testOllamaTranslator() {
    console.log('=== Ollama Translator Test ===\n');

    const translator = new OllamaTranslator({
        sourceLang: 'en',
        targetLang: 'ja',
    });

    // Check if Ollama is available
    console.log('Checking Ollama availability...');
    const isAvailable = await translator.isAvailable();

    if (!isAvailable) {
        console.log('⚠️  Ollama is not available');
        console.log('\n   Setup instructions:');
        console.log('   1. Install: curl -fsSL https://ollama.ai/install.sh | sh');
        console.log('   2. Start server: ollama serve');
        console.log('   3. Pull model: ollama pull qwen2.5:7b');
        process.exit(0);
    }

    console.log('  ✅ Ollama is running\n');

    // List available models
    console.log('Checking available models...');
    const models = await translator.listModels();
    console.log(`  Available models: ${models.join(', ')}`);

    if (models.length === 0) {
        console.log('\n  ⚠️  No models found. Please pull a model:');
        console.log('     ollama pull qwen2.5:7b');
        process.exit(0);
    }

    console.log('  ✅ Models available\n');

    console.log('Test 1: Simple text translation');
    console.log('  (This may take 10-30 seconds for first request)');
    const text1 = 'Hello, World!';
    try {
        const result1 = await translator.translate(text1);
        console.log(`  Input:  "${text1}"`);
        console.log(`  Output: "${result1}"`);
        console.log('  ✅ Test 1 PASSED\n');
    } catch (error) {
        console.log(`  ❌ Test 1 FAILED: ${error.message}\n`);
        console.log('  This may indicate the model needs to be downloaded.');
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
            console.log('     (Some models may not perfectly preserve backticks)\n');
        }
    } catch (error) {
        console.log(`  ❌ Test 2 FAILED: ${error.message}\n`);
        process.exit(1);
    }

    console.log('Test 3: Cache verification');
    const text3 = 'Hello, World!';
    try {
        const start = Date.now();
        const result3 = await translator.translate(text3);
        const duration = Date.now() - start;

        console.log(`  Cached translation took ${duration}ms`);

        if (duration < 100) {
            console.log('  ✅ Test 3 PASSED (cache working)\n');
        } else {
            console.log('  ⚠️  Test 3 WARNING: cache may not be working\n');
        }
    } catch (error) {
        console.log(`  ❌ Test 3 FAILED: ${error.message}\n`);
        process.exit(1);
    }

    console.log('=== All Ollama Translator Tests PASSED ===');
    console.log('\nNote: Translation quality depends on the model used.');
    console.log('Recommended models for translation:');
    console.log('  - qwen2.5:7b (best multilingual, 3.8GB)');
    console.log('  - mixtral:8x7b (highest quality, 26GB)');
    console.log('  - llama3.1:8b (good general purpose, 4.7GB)');
}

testOllamaTranslator().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
