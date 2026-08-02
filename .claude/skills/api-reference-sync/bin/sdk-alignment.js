#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const AlignmentReport = require('../src/sdk-alignment/alignment-report');

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--dry-run') {
            args.dryRun = true;
        } else if (arg === '--bitable') {
            args.bitable = true;
        } else if (arg === '--cleanup') {
            args.cleanup = true;
        } else if (arg.startsWith('--app-token=')) {
            args.appToken = arg.split('=')[1];
        } else if (arg === '--app-token' && argv[i + 1]) {
            args.appToken = argv[++i];
        } else if (arg.startsWith('--table-id=')) {
            args.tableId = arg.split('=')[1];
        } else if (arg === '--table-id' && argv[i + 1]) {
            args.tableId = argv[++i];
        } else if (arg === '--languages' && argv[i + 1]) {
            args.languages = argv[++i].split(',').map(l => l.trim());
        } else if (arg === '--output' && argv[i + 1]) {
            args.output = argv[++i];
        } else if (arg === '--folder-token' && argv[i + 1]) {
            args.folderToken = argv[++i];
        } else if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        }
    }
    return args;
}

function printUsage() {
    console.log(`
Usage: sdk-alignment [options]

Compare Milvus SDK methods and parameters across Python, Java, Node, C++, and Go.
Generates an alignment report and optionally pushes it to Feishu.

Options:
  --dry-run              Print report to stdout, don't push to Feishu
  --bitable              Write to a bitable instead of a document
  --app-token <tok>      Existing bitable app token (omit to create new)
  --table-id <tid>       Existing bitable table ID (auto-resolved if omitted)
  --cleanup              Delete orphan records from bitable
  --languages <list>     Comma-separated SDKs (default: python,java,node,cpp,go)
  --output <path>        Also write markdown to a local file
  --folder-token <tok>   Override Feishu folder (default: Gw47fZMsAltMqxdb6Y4cYfVknfe)
  --help, -h             Show this help

Environment (.env):
  APP_ID        Feishu app ID (required unless --dry-run)
  APP_SECRET    Feishu app secret (required unless --dry-run)
  FEISHU_HOST   Feishu API host (default: https://open.feishu.cn)
`);
}

async function main() {
    const args = parseArgs(process.argv);

    const report = new AlignmentReport({
        languages: args.languages,
        folderToken: args.folderToken,
        dryRun: args.dryRun || false,
        appToken: args.appToken || null,
        tableId: args.tableId || null,
        cleanup: args.cleanup || false,
    });

    if (args.bitable) {
        const result = await report.runBitable();
        console.log(`\nDone. ${result.registry.size} canonical methods written to bitable.`);
        return;
    }

    const result = await report.run();

    // Write to file if requested
    if (args.output) {
        const outPath = path.resolve(args.output);
        fs.writeFileSync(outPath, result.markdown, 'utf-8');
        console.log(`\nReport written to: ${outPath}`);
    }

    if (args.dryRun) {
        console.log(`\nDone. ${result.registry.size} canonical methods compared across ${report.languages.length} SDKs.`);
    }
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
});
