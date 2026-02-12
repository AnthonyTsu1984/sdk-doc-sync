#!/usr/bin/env node

const readline = require('readline');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const SdkDocSync = require('../src/sdk-doc-sync');

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--sdk-dir' && argv[i + 1]) {
            args.sdkDir = argv[++i];
        } else if (arg === '--language' && argv[i + 1]) {
            args.language = argv[++i];
        } else if (arg === '--sdk-name' && argv[i + 1]) {
            args.sdkName = argv[++i];
        } else if (arg === '--sdk-version' && argv[i + 1]) {
            args.sdkVersion = argv[++i];
        } else if (arg === '--source-type' && argv[i + 1]) {
            args.sourceType = argv[++i];
        } else if (arg === '--previous-base-token' && argv[i + 1]) {
            args.previousBaseToken = argv[++i];
        } else if (arg === '--targets' && argv[i + 1]) {
            args.targets = argv[++i].split(',').map(t => t.trim());
        } else if (arg === '--exclude' && argv[i + 1]) {
            args.exclude = (args.exclude || []).concat(argv[++i]);
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
Usage: sdk-doc-sync [options]

Options:
  --sdk-dir <path>                 Path to the SDK source directory (required)
  --language <lang>                Programming language (default: python)
  --sdk-name <name>                SDK name for metadata (required)
  --sdk-version <ver>              SDK version for metadata (required)
  --source-type <type>             Feishu source type: drive or wiki (default: drive)
  --previous-base-token <token>    Bitable token of previous version (for incremental diff)
  --targets <list>                 Comma-separated target platforms (e.g., Milvus,Zilliz)
  --exclude <pattern>              Glob pattern to exclude (repeatable)
  --dry-run                        Show diff without executing changes
  --auto-approve                   Skip interactive approval
  --help, -h                       Show this help

Environment (.env):
  ROOT_TOKEN    Drive folder or Wiki parent node token (required unless --dry-run)
  BASE_TOKEN    Bitable base token for the new version (required unless --dry-run)
  APP_ID        Feishu app ID
  APP_SECRET    Feishu app secret
  FEISHU_HOST   Feishu API host (default: https://open.feishu.cn)
`);
}

function createApprovalCallback(autoApprove) {
    if (autoApprove) return null;

    return async (actions) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        const ask = (question) => new Promise(resolve => rl.question(question, resolve));

        console.log(`\n--- Approval Required: ${actions.length} actions ---\n`);

        const approved = [];
        let approveAll = false;

        for (const action of actions) {
            const symbol = action.symbol
                ? `${action.symbol.parentClass ? action.symbol.parentClass + '.' : ''}${action.symbol.name}`
                : '(orphan)';

            console.log(`  ${action.type.padEnd(10)} ${action.slug}`);
            console.log(`             ${symbol} — ${action.reason}`);

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

    if (!args.sdkDir) {
        console.error('Error: --sdk-dir is required');
        printUsage();
        process.exit(1);
    }
    if (!args.sdkName) {
        console.error('Error: --sdk-name is required');
        printUsage();
        process.exit(1);
    }
    if (!args.sdkVersion) {
        console.error('Error: --sdk-version is required');
        printUsage();
        process.exit(1);
    }

    const rootToken = process.env.ROOT_TOKEN;
    const baseToken = process.env.BASE_TOKEN;

    if (!args.dryRun && (!rootToken || !baseToken)) {
        console.error('Error: ROOT_TOKEN and BASE_TOKEN must be set in .env (or use --dry-run)');
        process.exit(1);
    }

    const sync = new SdkDocSync({
        sdkDir: args.sdkDir,
        language: args.language || 'python',
        sdkName: args.sdkName,
        sdkVersion: args.sdkVersion,
        sourceType: args.sourceType || 'drive',
        rootToken: rootToken || 'dummy',
        baseToken: baseToken || 'dummy',
        previousBaseToken: args.previousBaseToken || null,
        targets: args.targets || [],
        dryRun: args.dryRun || false,
        exclude: args.exclude || [],
        approvalCallback: createApprovalCallback(args.autoApprove),
    });

    const result = await sync.run();

    if (args.dryRun) {
        console.log(`\nDry run complete. ${result.scanned.length} symbols scanned, ${result.diff.length} diff actions.`);
    } else {
        const succeeded = result.results.filter(r => r.status === 'success').length;
        const failed = result.results.filter(r => r.status === 'error').length;
        console.log(`\nSync complete. ${succeeded} succeeded, ${failed} failed.`);
    }
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
