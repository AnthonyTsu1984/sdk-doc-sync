#!/usr/bin/env node

const readline = require('readline');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const FeishuDocTranslator = require('../src/feishu-doc-translator');

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--source-bitable' && argv[i + 1]) {
            args.sourceBitable = argv[++i];
        } else if (arg === '--target-bitable' && argv[i + 1]) {
            args.targetBitable = argv[++i];
        } else if (arg === '--source-root' && argv[i + 1]) {
            args.sourceRoot = argv[++i];
        } else if (arg === '--target-root' && argv[i + 1]) {
            args.targetRoot = argv[++i];
        } else if (arg === '--source-lang' && argv[i + 1]) {
            args.sourceLang = argv[++i];
        } else if (arg === '--target-lang' && argv[i + 1]) {
            args.targetLang = argv[++i];
        } else if (arg === '--drive-type' && argv[i + 1]) {
            args.driveType = argv[++i];
        } else if (arg === '--translator' && argv[i + 1]) {
            args.translatorType = argv[++i];
        } else if (arg === '--action' && argv[i + 1]) {
            args.action = argv[++i];
        } else if (arg === '--dry-run') {
            args.dryRun = true;
        } else if (arg === '--auto-approve') {
            args.autoApprove = true;
        } else if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        }
    }
    return args;
}

function printUsage() {
    console.log(`
Usage: feishu-doc-translator [options]

Options:
  --source-bitable <token>     Source bitable app token (required)
  --target-bitable <token>     Target bitable app token (required)
  --source-root <token>        Source root page/folder token (required)
  --target-root <token>        Target root page/folder token (required)
  --source-lang <lang>         Source language code (default: en)
  --target-lang <lang>         Target language code (default: ja)
  --drive-type <type>          Storage type: drive or wiki (default: wiki)
  --translator <engine>        Translation engine (default: claude)
                               - feishu: Feishu's built-in translation API
                               - claude: Anthropic Claude (best quality)
                               - deepl: DeepL API (excellent for EU languages)
                               - ollama: Local Ollama models (free, private)
  --action <type>              Filter actions: new, update, all (default: all)
  --dry-run                    Show diff without executing changes
  --auto-approve               Skip interactive approval
  --help, -h                   Show this help

Environment (.env):
  APP_ID              Feishu app ID (required)
  APP_SECRET          Feishu app secret (required)
  FEISHU_HOST         Feishu API host (default: https://open.feishu.cn)
  WIKI_SPACE_ID       Wiki space ID (required if using --drive-type wiki)
  ANTHROPIC_API_KEY   Claude API key (required for --translator claude)
  DEEPL_API_KEY       DeepL API key (required for --translator deepl)
  DEEPL_API_URL       DeepL API URL (optional, defaults to free tier)
  OLLAMA_BASE_URL     Ollama server URL (default: http://localhost:11434)
  OLLAMA_MODEL        Ollama model name (default: qwen2.5:7b)

Examples:
  # Dry run to preview changes
  feishu-doc-translator \\
    --source-bitable BxnFwvWwSiO6oMkevVdcqY3snd2 \\
    --target-bitable ONV5w3nrRiOFkmk0bM6cWYrznbd \\
    --source-root OUWXw5c4gia34ZkQUcEcMFbWn6s \\
    --target-root KSvxw0h8LiXtIdkpAnCcrl7cnio \\
    --dry-run

  # Translate new documents only
  feishu-doc-translator \\
    --source-bitable BxnFwvWwSiO6oMkevVdcqY3snd2 \\
    --target-bitable ONV5w3nrRiOFkmk0bM6cWYrznbd \\
    --source-root OUWXw5c4gia34ZkQUcEcMFbWn6s \\
    --target-root KSvxw0h8LiXtIdkpAnCcrl7cnio \\
    --source-lang en \\
    --target-lang ja \\
    --translator claude \\
    --action new

  # Full translation with auto-approve
  feishu-doc-translator \\
    --source-bitable BxnFwvWwSiO6oMkevVdcqY3snd2 \\
    --target-bitable ONV5w3nrRiOFkmk0bM6cWYrznbd \\
    --source-root OUWXw5c4gia34ZkQUcEcMFbWn6s \\
    --target-root KSvxw0h8LiXtIdkpAnCcrl7cnio \\
    --auto-approve
`);
}

function createApprovalCallback(autoApprove, actionFilter) {
    if (autoApprove) return null;

    return async (actions) => {
        // Filter by action type if specified
        let filteredActions = actions;
        if (actionFilter && actionFilter !== 'all') {
            const filterType = actionFilter.toUpperCase();
            filteredActions = actions.filter(a => a.type === filterType);
        }

        if (filteredActions.length === 0) {
            console.log('\nNo actions match the filter.');
            return [];
        }

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        const ask = (question) => new Promise(resolve => rl.question(question, resolve));

        console.log(`\n--- Approval Required: ${filteredActions.length} actions ---\n`);

        const approved = [];
        let approveAll = false;

        for (const action of filteredActions) {
            const title = action.source?.metadata.title || '(no title)';
            const slug = action.slug || '(no slug)';

            console.log(`  ${action.type.padEnd(10)} ${slug}`);
            console.log(`             ${title}`);
            console.log(`             ${action.reason}`);

            if (approveAll) {
                approved.push(action);
                console.log('             → approved (all)\n');
                continue;
            }

            const answer = await ask('  [y/N/a(ll)/q(uit)] ');
            const choice = answer.trim().toLowerCase();

            if (choice === 'y' || choice === 'yes') {
                approved.push(action);
            } else if (choice === 'a' || choice === 'all') {
                approveAll = true;
                approved.push(action);
            } else if (choice === 'q' || choice === 'quit') {
                break;
            }
            console.log('');
        }

        rl.close();
        return approved;
    };
}

async function main() {
    const args = parseArgs(process.argv);

    // Validate required arguments
    if (!args.sourceBitable) {
        console.error('Error: --source-bitable is required');
        printUsage();
        process.exit(1);
    }
    if (!args.targetBitable) {
        console.error('Error: --target-bitable is required');
        printUsage();
        process.exit(1);
    }
    if (!args.sourceRoot) {
        console.error('Error: --source-root is required');
        printUsage();
        process.exit(1);
    }
    if (!args.targetRoot) {
        console.error('Error: --target-root is required');
        printUsage();
        process.exit(1);
    }

    // Check for required environment variables
    if (!process.env.APP_ID || !process.env.APP_SECRET) {
        console.error('Error: APP_ID and APP_SECRET must be set in .env');
        process.exit(1);
    }

    if (args.driveType === 'wiki' && !process.env.WIKI_SPACE_ID) {
        console.error('Error: WIKI_SPACE_ID must be set in .env when using --drive-type wiki');
        process.exit(1);
    }

    if (args.translatorType === 'claude' && !process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_API_KEY) {
        console.error('Error: ANTHROPIC_API_KEY or CLAUDE_API_KEY must be set in .env when using claude translator');
        process.exit(1);
    }

    const translator = new FeishuDocTranslator({
        sourceBitable: args.sourceBitable,
        targetBitable: args.targetBitable,
        sourceRoot: args.sourceRoot,
        targetRoot: args.targetRoot,
        sourceLang: args.sourceLang || 'en',
        targetLang: args.targetLang || 'ja',
        driveType: args.driveType || 'wiki',
        translatorType: args.translatorType || 'claude',
        dryRun: args.dryRun || false,
        approvalCallback: createApprovalCallback(args.autoApprove, args.action),
    });

    try {
        const result = await translator.run();

        if (args.dryRun) {
            console.log('\n=== Dry Run Summary ===');
            console.log(`Total actions: ${result.actions.length}`);
            console.log(`  NEW: ${result.summary.new}`);
            console.log(`  UPDATE: ${result.summary.update}`);
            console.log(`  SKIP: ${result.summary.skip}`);
            console.log(`  ORPHAN: ${result.summary.orphan}`);
        } else {
            console.log('\n=== Execution Summary ===');
            const succeeded = result.results.filter(r => r.status === 'success').length;
            const failed = result.results.filter(r => r.status === 'error').length;
            console.log(`Success: ${succeeded}`);
            console.log(`Failed: ${failed}`);
        }
    } catch (error) {
        console.error('\nFatal error:', error.message);
        if (process.env.DEBUG) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Unhandled error:', err.message);
    process.exit(1);
});
