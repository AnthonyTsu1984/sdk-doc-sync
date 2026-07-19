#!/usr/bin/env node

const readline = require('readline');
const path = require('path');
const fs = require('fs');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const SdkDocSync = require('../src/sdk-doc-sync');
const { validateReferenceDocument } = require('../src/sdk-reference-ir/validate');
const { validateDocumentIr } = require('../src/document-ir/validate');
const { renderMarkdown } = require('../src/document-ir/ir-to-markdown');
const { validateReleaseScope } = require('../src/sdk-doc-sync/release-scope/schema');

const adapters = Object.freeze({
    python: require('../src/sdk-reference-ir/adapters/python'),
    java: require('../src/sdk-reference-ir/adapters/java'),
    node: require('../src/sdk-reference-ir/adapters/node'),
    go: require('../src/sdk-reference-ir/adapters/go'),
    cpp: require('../src/sdk-reference-ir/adapters/cpp'),
    'zilliz-cli': require('../src/sdk-reference-ir/adapters/zilliz-cli'),
    rest: require('../src/sdk-reference-ir/adapters/openapi'),
});

const renderers = Object.freeze({
    python: require('../src/renderers/languages/python'),
    java: require('../src/renderers/languages/java'),
    node: require('../src/renderers/languages/node'),
    go: require('../src/renderers/languages/go'),
    cpp: require('../src/renderers/languages/cpp'),
    'zilliz-cli': require('../src/renderers/cli-renderer'),
    rest: require('../src/renderers/rest-renderer'),
});

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
        } else if (arg === '--reference-context' && argv[i + 1]) {
            args.referenceContext = argv[++i];
        } else if (arg === '--release-scope' && argv[i + 1]) {
            args.releaseScope = argv[++i];
        } else if (arg === '--targets' && argv[i + 1]) {
            args.targets = argv[++i].split(',').map(t => t.trim());
        } else if (arg === '--exclude' && argv[i + 1]) {
            args.exclude = (args.exclude || []).concat(argv[++i]);
        } else if (arg === '--dry-run') {
            args.dryRun = true;
        } else if (arg === '--changed-only') {
            args.changedOnly = true;
        } else if (arg === '--summary-json' && argv[i + 1]) {
            args.summaryJson = argv[++i];
        } else if (arg === '--json') {
            args.json = true;
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
  --reference-context <file>       JSON file with reviewed schema-first generation context
  --release-scope <file>           Release-scout JSON artifact for approval-grade scoped planning
  --targets <list>                 Comma-separated target platforms (e.g., Milvus,Zilliz)
  --exclude <pattern>              Glob pattern to exclude (repeatable)
  --dry-run                        Show diff without executing changes
  --changed-only                   Require release scope and scan only release-scoped symbols
  --summary-json <file>            Write bounded run summary JSON to a file
  --json                           Print the run result as formatted JSON
  --auto-approve                   Skip interactive approval
  --help, -h                       Show this help

Environment (.env):
  ROOT_TOKEN    Drive folder or Wiki parent node token (required for live writes)
  BASE_TOKEN    Bitable base token for the target version (required for diff baseline unless --previous-base-token is set)
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

function validationError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
}

function firstValidationCode(validation, fallback) {
    return validation.errors?.[0]?.code || fallback;
}

function defaultReferenceContext(action) {
    const scoped = action.releaseScopeAction || {};
    const source = scoped.source || {};
    return {
        repository: source.repository || '',
        revision: source.revision || '',
        category: action.symbol?.category || '',
        reviewedEvidence: scoped.evidence || [],
        related: [],
        notes: [],
    };
}

function stableIdCandidates(action, language) {
    const symbol = action.symbol || {};
    const category = symbol.parentClass || symbol.category || '';
    const name = symbol.name || action.slug || '';
    return [
        action.stableId,
        symbol.identity?.stableId,
        symbol.stableId,
        language && category && name ? `${language}:${category}:${name}` : null,
        action.slug,
        name,
    ].filter(Boolean);
}

function createReferenceContextProvider(filePath, { language } = {}) {
    if (!filePath) return null;
    const absolute = path.resolve(filePath);
    return async (action) => {
        const raw = JSON.parse(fs.readFileSync(absolute, 'utf8'));
        const contexts = raw.contexts || raw.byStableId || raw.bySlug || {};
        const match = stableIdCandidates(action, language)
            .map((key) => contexts[key])
            .find(Boolean) || {};
        const base = raw.contexts || raw.byStableId || raw.bySlug
            ? Object.fromEntries(Object.entries(raw).filter(([key]) => !['contexts', 'byStableId', 'bySlug'].includes(key)))
            : raw;
        return {
            ...base,
            ...match,
            ...(language === 'rest' ? { input: action.symbol } : {}),
        };
    };
}

function createSchemaFirstArtifactProvider({
    language,
    referenceContextProvider = null,
} = {}) {
    const adapter = adapters[language];
    const renderer = renderers[language];
    if (!adapter || !renderer) {
        throw new Error(`Unsupported language: ${language}. Supported: ${Object.keys(adapters).join(', ')}`);
    }

    return async (action, scope = {}) => {
        if (!['CREATE', 'UPDATE'].includes(action?.type)) return undefined;
        try {
            const context = referenceContextProvider
                ? await referenceContextProvider(action, scope)
                : defaultReferenceContext(action);
            const source = language === 'rest' && context?.input ? context.input : action.symbol;
            const reference = adapter.toReferenceDocument(source, context || {});
            const referenceValidation = validateReferenceDocument(reference, { production: true });
            if (!referenceValidation.valid) {
                throw validationError(
                    firstValidationCode(referenceValidation, 'INVALID_REFERENCE_DOCUMENT'),
                    `Reference document validation failed: ${JSON.stringify(referenceValidation.errors)}`,
                    { validation: referenceValidation },
                );
            }
            const documentIr = renderer.render(reference, { typeUrls: context?.typeUrls || {} });
            const documentValidation = validateDocumentIr(documentIr, { lossless: true });
            if (!documentValidation.valid) {
                throw validationError(
                    firstValidationCode(documentValidation, 'INVALID_DOCUMENT_IR'),
                    `Document IR validation failed: ${JSON.stringify(documentValidation.errors)}`,
                    { validation: documentValidation },
                );
            }
            return {
                title: reference.identity.title,
                content: renderMarkdown(documentIr),
                reference,
                documentIr,
                reviewed: true,
                validated: true,
                validation: { valid: true, errors: [], warnings: documentValidation.warnings },
                metadata: {
                    description: reference.summary,
                    type: reference.identity.kind,
                    progress: 'Draft',
                    targets: [],
                    source: 'schema-first',
                },
            };
        } catch (error) {
            if (error.code) throw error;
            throw validationError(
                'SCHEMA_FIRST_GENERATION_FAILED',
                `Schema-first generation failed for ${action?.slug || action?.symbol?.name || '(unknown)'}: ${error.message}`,
                { cause: error.message },
            );
        }
    };
}

function createDefaultPlanningContextProvider({ rootToken, sdkVersion }) {
    return async (action = {}) => {
        if (action.planningContext?.target) return {};
        return {
        target: {
            version: sdkVersion,
            folderToken: rootToken || 'dummy',
            versionRootToken: rootToken || 'dummy',
            ancestryVerified: true,
        },
        };
    };
}

async function runCli({
    argv = process.argv,
    env = process.env,
    dependencies = {},
} = {}) {
    if (dependencies.loadEnv !== false) {
        require('dotenv').config({
            path: path.resolve(__dirname, '../../../..', '.env'),
            processEnv: env,
            quiet: true,
        });
    }

    const out = dependencies.onStdout || ((line) => console.log(line));
    const err = dependencies.onStderr || ((line) => console.error(line));
    const exit = dependencies.exit || ((code) => process.exit(code));
    const args = parseArgs(argv);
    const readFile = dependencies.readFile || ((file) => fs.readFileSync(file, 'utf8'));
    const writeFile = dependencies.writeFile || ((file, content) => fs.writeFileSync(file, content));

    if (!args.sdkDir) {
        err('Error: --sdk-dir is required');
        printUsage();
        exit(1);
        return null;
    }
    if (!args.sdkName) {
        err('Error: --sdk-name is required');
        printUsage();
        exit(1);
        return null;
    }
    if (!args.sdkVersion) {
        err('Error: --sdk-version is required');
        printUsage();
        exit(1);
        return null;
    }

    const language = args.language || 'python';
    let releaseScope = null;
    if (args.releaseScope) {
        const releaseScopePath = path.resolve(args.releaseScope);
        releaseScope = JSON.parse(readFile(releaseScopePath));
        const validation = validateReleaseScope(releaseScope);
        if (!validation.valid) {
            err(`Error: invalid --release-scope: ${JSON.stringify(validation.errors)}`);
            exit(1);
            return null;
        }
        if (releaseScope.approvalGrade !== true || releaseScope.writesPerformed !== false || releaseScope.scanStateUpdated !== false) {
            err('Error: --release-scope must be approvalGrade=true, writesPerformed=false, and scanStateUpdated=false');
            exit(1);
            return null;
        }
        if (releaseScope.language !== language || releaseScope.sdkName !== args.sdkName || releaseScope.track !== args.sdkVersion) {
            err(`Error: --release-scope metadata does not match requested ${language}/${args.sdkName}/${args.sdkVersion}`);
            exit(1);
            return null;
        }
    }
    if (args.changedOnly && !releaseScope) {
        err('Error: --changed-only requires --release-scope');
        exit(1);
        return null;
    }

    const rootToken = env.ROOT_TOKEN;
    const baseToken = env.BASE_TOKEN;
    const indexBaseToken = args.previousBaseToken || baseToken;

    if (!args.dryRun && (!rootToken || !baseToken)) {
        err('Error: ROOT_TOKEN and BASE_TOKEN must be set in .env for live writes');
        exit(1);
        return null;
    }
    if (!indexBaseToken && !dependencies.indexReader) {
        err('Error: BASE_TOKEN is required for dry-run diff baseline; set BASE_TOKEN or pass --previous-base-token');
        exit(1);
        return null;
    }

    const fileContextProvider = createReferenceContextProvider(args.referenceContext, { language });
    const artifactProvider = dependencies.artifactProvider || createSchemaFirstArtifactProvider({
        language,
        referenceContextProvider: dependencies.referenceContextProvider || fileContextProvider,
    });
    const planningContextProvider = dependencies.planningContextProvider
        || createDefaultPlanningContextProvider({ rootToken: rootToken || 'dummy', sdkVersion: args.sdkVersion });

    const sync = new SdkDocSync({
        scanner: dependencies.scanner || null,
        indexReader: dependencies.indexReader || null,
        sdkDir: args.sdkDir,
        language,
        sdkName: args.sdkName,
        sdkVersion: args.sdkVersion,
        sourceType: args.sourceType || 'drive',
        rootToken: rootToken || 'dummy',
        baseToken: baseToken || 'dummy',
        previousBaseToken: args.previousBaseToken || null,
        targets: args.targets || [],
        dryRun: args.dryRun || false,
        changedOnly: args.changedOnly || false,
        releaseScope,
        exclude: args.exclude || [],
        approvalCallback: createApprovalCallback(args.autoApprove),
        artifactProvider,
        planningContextProvider,
        onProgress: dependencies.onProgress || (() => {}),
        documentWriter: dependencies.documentWriter || null,
        bitableWriter: dependencies.bitableWriter || null,
        executor: dependencies.executor || null,
        printPlans: args.json !== true,
    });

    const result = await sync.run();
    if (args.summaryJson) {
        writeFile(path.resolve(args.summaryJson), `${JSON.stringify(createBoundedSummary(result), null, 2)}\n`);
    }

    if (args.json) {
        out(JSON.stringify(result, null, 2));
        return result;
    }

    if (args.dryRun) {
        out(`\nDry run complete. ${result.scanned.length} symbols scanned, ${result.diff.length} diff actions.`);
    } else {
        const succeeded = result.results.filter(r => r.status === 'success').length;
        const failed = result.results.filter(r => r.status === 'error').length;
        out(`\nSync complete. ${succeeded} succeeded, ${failed} failed.`);
    }
    return result;
}

function createBoundedSummary(result) {
    return {
        scannedCount: result.scanned.length,
        indexedCount: result.indexed.length,
        diffCount: result.diff.length,
        planCount: result.plans.length,
        planningErrorCount: result.planningErrors.length,
        approvedCount: result.approved.length,
        resultCount: result.results.length,
        releaseScope: result.releaseScope || null,
        diff: result.diff.map((action) => ({
            type: action.type,
            slug: action.slug,
            stableId: action.stableId || action.symbol?.identity?.stableId || action.symbol?.stableId || null,
            symbol: action.symbol
                ? `${action.symbol.parentClass ? action.symbol.parentClass + '.' : ''}${action.symbol.name}`
                : null,
            reason: action.reason,
            source: action.releaseScopeAction?.source || null,
            evidence: action.releaseScopeAction?.evidence || [],
        })),
        planningErrors: result.planningErrors,
    };
}

if (require.main === module) {
    runCli().catch(err => {
        console.error('Fatal error:', err.message);
        process.exit(1);
    });
}

module.exports = {
    parseArgs,
    runCli,
    createSchemaFirstArtifactProvider,
    createBoundedSummary,
};
