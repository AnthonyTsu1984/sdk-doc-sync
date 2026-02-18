#!/usr/bin/env node

/**
 * Translator Comparison Demo
 *
 * This script demonstrates all four translation engines side-by-side.
 * Useful for evaluating quality, speed, and choosing the right engine.
 *
 * Usage: node examples/translator-comparison.js
 *
 * Requirements:
 *   - For Claude: ANTHROPIC_API_KEY in .env
 *   - For DeepL: DEEPL_API_KEY in .env
 *   - For Ollama: ollama serve + model pulled
 *   - For Feishu: APP_ID and APP_SECRET in .env
 */

require('dotenv').config();

const ClaudeTranslator = require('../src/feishu-doc-translator/translators/claude-translator');
const DeepLTranslator = require('../src/feishu-doc-translator/translators/deepl-translator');
const OllamaTranslator = require('../src/feishu-doc-translator/translators/ollama-translator');
const FeishuTranslator = require('../src/feishu-doc-translator/translators/feishu-translator');

// Sample technical documentation text
const SAMPLE_TEXT = `## Request Syntax

This operation inserts data into the specified collection.

**PARAMETERS:**

- **collection_name** (*string*) - **[REQUIRED]** The name of the collection to insert data into.
- **data** (*list*) - The data records to insert. Each record is a dictionary containing field names and values.

**RETURNS:**

Returns an \`InsertResult\` object containing the IDs of the inserted records.

**Example:**

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")

result = client.insert(
    collection_name="my_collection",
    data=[
        {"id": 1, "vector": [0.1, 0.2, 0.3], "name": "Alice"},
        {"id": 2, "vector": [0.4, 0.5, 0.6], "name": "Bob"},
    ]
)

print(result.insert_count)
\`\`\``;

async function compareTranslators() {
    console.log('='.repeat(80));
    console.log('Translator Comparison Demo');
    console.log('='.repeat(80));
    console.log();

    const sourceLang = 'en';
    const targetLang = 'ja';
    const translators = [];

    // Check Claude
    if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY) {
        translators.push({
            name: 'Claude',
            translator: new ClaudeTranslator({ sourceLang, targetLang }),
        });
    } else {
        console.log('⚠️  Claude: ANTHROPIC_API_KEY not found, skipping');
    }

    // Check DeepL
    if (process.env.DEEPL_API_KEY) {
        translators.push({
            name: 'DeepL',
            translator: new DeepLTranslator({ sourceLang, targetLang }),
        });
    } else {
        console.log('⚠️  DeepL: DEEPL_API_KEY not found, skipping');
    }

    // Check Ollama
    try {
        const ollama = new OllamaTranslator({ sourceLang, targetLang });
        const isAvailable = await ollama.isAvailable();
        if (isAvailable) {
            translators.push({
                name: 'Ollama',
                translator: ollama,
            });
        } else {
            console.log('⚠️  Ollama: Server not running, skipping');
            console.log('    Start with: ollama serve');
        }
    } catch (error) {
        console.log(`⚠️  Ollama: ${error.message}, skipping`);
    }

    // Check Feishu
    if (process.env.APP_ID && process.env.APP_SECRET) {
        translators.push({
            name: 'Feishu',
            translator: new FeishuTranslator({ sourceLang, targetLang }),
        });
    } else {
        console.log('⚠️  Feishu: APP_ID or APP_SECRET not found, skipping');
    }

    if (translators.length === 0) {
        console.log('\n❌ No translators available. Please configure at least one:');
        console.log('   - Claude: Set ANTHROPIC_API_KEY in .env');
        console.log('   - DeepL: Set DEEPL_API_KEY in .env');
        console.log('   - Ollama: Run `ollama serve` and `ollama pull qwen2.5:7b`');
        console.log('   - Feishu: Set APP_ID and APP_SECRET in .env');
        process.exit(1);
    }

    console.log(`\n✅ ${translators.length} translator(s) available\n`);
    console.log('='.repeat(80));
    console.log('Source Text (English):');
    console.log('='.repeat(80));
    console.log(SAMPLE_TEXT);
    console.log();

    // Translate with each engine
    const results = [];

    for (const { name, translator } of translators) {
        console.log('='.repeat(80));
        console.log(`Translating with ${name}...`);
        console.log('='.repeat(80));

        const startTime = Date.now();

        try {
            const translated = await translator.translateMarkdown(SAMPLE_TEXT);
            const duration = Date.now() - startTime;

            results.push({
                name,
                translated,
                duration,
                error: null,
            });

            console.log(`✅ Completed in ${(duration / 1000).toFixed(1)}s\n`);
        } catch (error) {
            const duration = Date.now() - startTime;
            results.push({
                name,
                translated: null,
                duration,
                error: error.message,
            });

            console.log(`❌ Failed: ${error.message}\n`);
        }
    }

    // Display results
    console.log('='.repeat(80));
    console.log('Translation Results:');
    console.log('='.repeat(80));
    console.log();

    for (const result of results) {
        console.log('-'.repeat(80));
        console.log(`${result.name} (${(result.duration / 1000).toFixed(1)}s)`);
        console.log('-'.repeat(80));

        if (result.error) {
            console.log(`❌ Error: ${result.error}`);
        } else {
            // Show first 500 chars of translation
            const preview = result.translated.substring(0, 500);
            console.log(preview);
            if (result.translated.length > 500) {
                console.log(`\n... (${result.translated.length - 500} more characters)`);
            }
        }
        console.log();
    }

    // Summary
    console.log('='.repeat(80));
    console.log('Summary:');
    console.log('='.repeat(80));

    const successful = results.filter(r => !r.error);
    const failed = results.filter(r => r.error);

    console.log(`Total translators tested: ${results.length}`);
    console.log(`Successful: ${successful.length}`);
    console.log(`Failed: ${failed.length}`);
    console.log();

    if (successful.length > 0) {
        console.log('Performance:');
        successful.forEach(r => {
            console.log(`  ${r.name}: ${(r.duration / 1000).toFixed(1)}s`);
        });
        console.log();

        const fastest = successful.reduce((min, r) => r.duration < min.duration ? r : min);
        const slowest = successful.reduce((max, r) => r.duration > max.duration ? r : max);

        console.log(`Fastest: ${fastest.name} (${(fastest.duration / 1000).toFixed(1)}s)`);
        console.log(`Slowest: ${slowest.name} (${(slowest.duration / 1000).toFixed(1)}s)`);
    }

    console.log();
    console.log('Recommendations:');
    console.log('  - Claude: Best for technical docs with code (if budget allows)');
    console.log('  - DeepL: Best for European languages and formal text');
    console.log('  - Ollama: Best for privacy-sensitive content (free, local)');
    console.log('  - Feishu: Best for simple text (fast, built-in)');
    console.log();
    console.log('See docs/TRANSLATORS.md for detailed comparison.');
}

compareTranslators().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
