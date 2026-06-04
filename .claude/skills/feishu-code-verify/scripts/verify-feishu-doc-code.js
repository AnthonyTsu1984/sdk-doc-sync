#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
const SDK_ROOT = path.resolve(__dirname, '../../sdk-doc-sync');

process.noDeprecation = true;
process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';
require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });
require('dotenv').config({ path: path.join(SDK_ROOT, '.env'), quiet: true });

const BitableWriter = require(path.join(SDK_ROOT, 'src/sdk-doc-sync/bitable-writer'));
const MarkdownToFeishu = require(path.join(SDK_ROOT, 'src/markdown-to-feishu'));
const { createScenarioShimContext } = require('./scenario-shims');

const DEFAULT_REPORT = '/tmp/feishu-code-verify-report.json';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const LIVE_PROFILES = {
    zilliz: {
        description: 'Zilliz/Milvus docs that call a serving cluster or Zilliz Cloud APIs.',
        requiredEnvGroups: [
            ['SERVING_CLUSTER_ENDPOINT', 'ZILLIZ_CLUSTER_ENDPOINT', 'DOC_VERIFY_SERVING_CLUSTER_ENDPOINT'],
            ['TOKEN', 'ZILLIZ_CLUSTER_CREDENTIAL', 'ZILLIZ_API_KEY', 'DOC_VERIFY_TOKEN', 'DOC_VERIFY_ZILLIZ_API_KEY'],
        ],
        optionalEnvGroups: [
            ['CLOUD_PLATFORM_ENDPOINT', 'DOC_VERIFY_CLOUD_PLATFORM_ENDPOINT'],
        ],
    },
};

const LANG_ID = [
    null, 'plaintext', 'abap', 'ada', 'apache', 'apex', 'assembly', 'bash',
    'csharp', 'cpp', 'c', 'cobol', 'css', 'coffeescript', 'd', 'dart',
    'delphi', 'django', 'dockerfile', 'erlang', 'fortran', 'foxpro', 'go',
    'groovy', 'html', 'htmlbars', 'http', 'haskell', 'json', 'java',
    'javascript', 'julia', 'kotlin', 'latex', 'lisp', 'logo', 'lua',
    'matlab', 'makefile', 'markdown', 'nginx', 'objective', 'openedgeabl',
    'php', 'perl', 'postscript', 'power', 'prolog', 'protobuf', 'python',
    'r', 'rpg', 'ruby', 'rust', 'sas', 'scss', 'sql', 'scala', 'scheme',
    'scratch', 'shell', 'swift', 'thrift', 'typescript', 'vbscript',
    'visual', 'xml', 'yaml', 'cmake', 'diff', 'gherkin', 'graphql',
    'opengl shading language', 'properties', 'solidity', 'toml'
];

function parseArgs(argv) {
    const opts = {
        markdown: [],
        doc: [],
        bitable: null,
        table: null,
        record: [],
        slug: [],
        languages: null,
        mode: 'compile',
        report: DEFAULT_REPORT,
        maxDocs: 50,
        allowRun: false,
        live: false,
        extractOnly: false,
        selfTest: false,
        timeout: 8000,
        harness: true,
        javaClasspath: process.env.DOC_VERIFY_JAVA_CLASSPATH || '',
        javaSdkRepo: process.env.DOC_VERIFY_JAVA_SDK_REPO || '',
        javaMavenRepo: process.env.DOC_VERIFY_MAVEN_REPO || '/tmp/feishu-code-verify-m2',
        javaClasspathSource: process.env.DOC_VERIFY_JAVA_CLASSPATH ? 'explicit' : '',
        javaClasspathError: '',
        javaImportIndex: null,
        goModuleDir: process.env.DOC_VERIFY_GO_MODULE_DIR || '',
        nodeSdkRepo: process.env.DOC_VERIFY_NODE_SDK_REPO || '',
        nodeSdkBuilds: [],
        cppSdkRepo: process.env.DOC_VERIFY_CPP_SDK_REPO || '',
        cppIncludeDirs: (process.env.DOC_VERIFY_CPP_INCLUDE_DIRS || '').split(path.delimiter).filter(Boolean),
        pythonCommand: process.env.DOC_VERIFY_PYTHON || 'python3',
        pythonPath: process.env.DOC_VERIFY_PYTHONPATH || '',
        liveProfile: 'zilliz',
        requestLive: false,
        scenario: false,
        runScenarios: false,
        resourceSuffix: process.env.DOC_VERIFY_RESOURCE_SUFFIX || '',
        scenarioOutDir: '/tmp/feishu-code-scenarios',
        manta: false,
        mantaWorkspace: process.env.DOC_VERIFY_MANTA_WORKSPACE || 'default',
        mantaResource: process.env.DOC_VERIFY_MANTA_RESOURCE || '',
        mantaEndpoint: process.env.DOC_VERIFY_MANTA_ENDPOINT || '',
        mantaCreateMilvus: process.env.DOC_VERIFY_MANTA_CREATE_MILVUS || '',
        mantaTimeout: parseInt(process.env.DOC_VERIFY_MANTA_TIMEOUT || '1800', 10),
    };

    const raw = argv.slice(2);
    for (let i = 0; i < raw.length; i++) {
        const a = raw[i];
        if (a === '--help' || a === '-h') opts.help = true;
        else if (a === '--markdown' && raw[i + 1]) opts.markdown.push(raw[++i]);
        else if (a === '--doc' && raw[i + 1]) opts.doc.push(raw[++i]);
        else if (a === '--bitable' && raw[i + 1]) opts.bitable = raw[++i];
        else if (a === '--table' && raw[i + 1]) opts.table = raw[++i];
        else if (a === '--record' && raw[i + 1]) opts.record.push(raw[++i]);
        else if (a === '--slug' && raw[i + 1]) opts.slug.push(raw[++i]);
        else if (a === '--languages' && raw[i + 1]) opts.languages = new Set(raw[++i].split(',').map(normalizeLang));
        else if (a === '--mode' && raw[i + 1]) opts.mode = raw[++i];
        else if (a === '--report' && raw[i + 1]) opts.report = raw[++i];
        else if (a === '--max-docs' && raw[i + 1]) opts.maxDocs = parseInt(raw[++i], 10);
        else if (a === '--timeout' && raw[i + 1]) opts.timeout = parseInt(raw[++i], 10);
        else if (a === '--java-classpath' && raw[i + 1]) {
            opts.javaClasspath = raw[++i];
            opts.javaClasspathSource = 'explicit';
        }
        else if (a === '--java-sdk-repo' && raw[i + 1]) opts.javaSdkRepo = raw[++i];
        else if (a === '--java-maven-repo' && raw[i + 1]) opts.javaMavenRepo = raw[++i];
        else if (a === '--go-module-dir' && raw[i + 1]) opts.goModuleDir = raw[++i];
        else if (a === '--node-sdk-repo' && raw[i + 1]) opts.nodeSdkRepo = raw[++i];
        else if (a === '--cpp-sdk-repo' && raw[i + 1]) opts.cppSdkRepo = raw[++i];
        else if (a === '--cpp-include-dir' && raw[i + 1]) opts.cppIncludeDirs.push(raw[++i]);
        else if (a === '--python-command' && raw[i + 1]) opts.pythonCommand = raw[++i];
        else if (a === '--python-path' && raw[i + 1]) opts.pythonPath = raw[++i];
        else if (a === '--live-profile' && raw[i + 1]) opts.liveProfile = raw[++i];
        else if (a === '--scenario-out-dir' && raw[i + 1]) opts.scenarioOutDir = raw[++i];
        else if (a === '--resource-suffix' && raw[i + 1]) opts.resourceSuffix = raw[++i];
        else if (a === '--manta') opts.manta = true;
        else if (a === '--manta-workspace' && raw[i + 1]) opts.mantaWorkspace = raw[++i];
        else if (a === '--manta-resource' && raw[i + 1]) {
            opts.manta = true;
            opts.mantaResource = raw[++i];
        }
        else if (a === '--manta-endpoint' && raw[i + 1]) {
            opts.manta = true;
            opts.mantaEndpoint = raw[++i];
        }
        else if (a === '--manta-create-milvus' && raw[i + 1]) {
            opts.manta = true;
            opts.mantaCreateMilvus = raw[++i];
        }
        else if (a === '--manta-timeout' && raw[i + 1]) opts.mantaTimeout = parseInt(raw[++i], 10);
        else if (a === '--request-live') opts.requestLive = true;
        else if (a === '--scenario') opts.scenario = true;
        else if (a === '--run-scenarios') {
            opts.scenario = true;
            opts.runScenarios = true;
        }
        else if (a === '--no-harness') opts.harness = false;
        else if (a === '--allow-run') opts.allowRun = true;
        else if (a === '--live') opts.live = true;
        else if (a === '--extract-only') opts.extractOnly = true;
        else if (a === '--self-test') opts.selfTest = true;
        else throw new Error(`Unknown or incomplete argument: ${a}`);
    }
    return opts;
}

function printUsage() {
    console.log(`
Usage:
  node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js [options]

Inputs:
  --markdown <file>       Verify local Markdown. Repeatable.
  --doc <url|token>       Verify a Feishu docx URL/token. Repeatable.
  --bitable <base-token>  Verify docs from a bitable.
  --table <table-id>      Optional bitable table ID.
  --record <record-id>    Limit bitable verification to record IDs. Repeatable.
  --slug <slug>           Limit bitable verification to slugs. Repeatable.

Controls:
  --languages py,js,node,bash,json
                         Limit languages.
  --mode compile|parse|run|all
  --allow-run             Run only blocks annotated with doc-verify: run.
  --live                  Allow blocks annotated as live/service-backed.
  --request-live          Print env vars and rerun guidance for live verification.
  --live-profile <name>   Live env profile (default: zilliz).
  --java-classpath <cp>   Classpath for Java harness checks. Env: DOC_VERIFY_JAVA_CLASSPATH.
  --java-sdk-repo <dir>   Derive Java classpath from milvus-sdk-java. Env: DOC_VERIFY_JAVA_SDK_REPO.
  --java-maven-repo <dir> Maven local repo for Java SDK classpath build. Env: DOC_VERIFY_MAVEN_REPO.
  --scenario              Build scenario scripts from ordered snippets.
  --run-scenarios         Execute generated scenarios; requires --live and --allow-run.
  --scenario-out-dir <d>  Directory for generated scenario scripts.
  --resource-suffix <s>   Suffix for runtime database/collection names. Env: DOC_VERIFY_RESOURCE_SUFFIX.
  --go-module-dir <dir>   Go module dir for module-aware Go scenario checks. Env: DOC_VERIFY_GO_MODULE_DIR.
  --node-sdk-repo <dir>   Local @zilliz/milvus2-sdk-node checkout for JS runtime. Env: DOC_VERIFY_NODE_SDK_REPO.
  --cpp-sdk-repo <dir>    Add local milvus-sdk-cpp headers. Env: DOC_VERIFY_CPP_SDK_REPO.
  --cpp-include-dir <dir> Extra C/C++ include directory. Repeatable. Env: DOC_VERIFY_CPP_INCLUDE_DIRS.
  --python-command <cmd>  Python executable for Python checks. Env: DOC_VERIFY_PYTHON.
  --python-path <path>    Extra PYTHONPATH for Python scenario runtime. Env: DOC_VERIFY_PYTHONPATH.
  --manta                 Run an explicit Manta runtime verification job.
  --manta-workspace <w>   Manta workspace for runtime jobs. Env: DOC_VERIFY_MANTA_WORKSPACE.
  --manta-resource <id>   Reuse a Manta Milvus resource and its endpoint. Env: DOC_VERIFY_MANTA_RESOURCE.
  --manta-endpoint <uri>  Internal Milvus endpoint for the Manta runtime job. Env: DOC_VERIFY_MANTA_ENDPOINT.
  --manta-create-milvus <version-or-image>
                         Create a temporary Milvus resource through Manta first. Env: DOC_VERIFY_MANTA_CREATE_MILVUS.
  --manta-timeout <sec>   Manta job wait/follow timeout. Env: DOC_VERIFY_MANTA_TIMEOUT.
  --no-harness            Disable Java/Go partial-snippet harness checks.
  --extract-only          Do not run checks.
  --report <path>         Default: ${DEFAULT_REPORT}
  --self-test             Run built-in offline fixture.
`);
}

function normalizeLang(lang) {
    const v = String(lang || 'plaintext').trim().toLowerCase();
    const map = {
        py: 'python',
        python3: 'python',
        js: 'javascript',
        node: 'javascript',
        nodejs: 'javascript',
        ts: 'typescript',
        sh: 'bash',
        shell: 'bash',
        zsh: 'bash',
        cplusplus: 'cpp',
        'c++': 'cpp',
        yml: 'yaml',
        plaintext: 'text',
        plain: 'text',
    };
    return map[v] || v;
}

function sha(text) {
    return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function redact(text) {
    return String(text || '')
        .replace(/(api[_-]?key|token|secret|password|credential)(["'\s:=]+)[A-Za-z0-9._\-+/=]{8,}/gi, '$1$2[REDACTED]')
        .replace(/Bearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, 'Bearer [REDACTED]')
        .slice(0, 4000);
}

function docsCellToObj(docs) {
    if (!docs) return { title: '', link: '' };
    if (typeof docs === 'string') return { title: docs, link: '' };
    return { title: docs.text || docs.title || '', link: docs.link || '' };
}

function slugText(record) {
    const raw = record.fields?.Slug;
    if (Array.isArray(raw)) return raw.map(x => x.text || x[x.type] || '').join('');
    if (typeof raw === 'string') return raw;
    return '';
}

function extractDocToken(input) {
    const s = String(input || '').trim();
    const docx = s.match(/\/docx\/([A-Za-z0-9]+)/);
    if (docx) return docx[1];
    const wiki = s.match(/\/wiki\/([A-Za-z0-9]+)/);
    if (wiki) return wiki[1];
    return s;
}

function textFromElements(elements) {
    return (elements || []).map(el => {
        if (el.text_run) return el.text_run.content || '';
        if (el.equation) return el.equation.content || '';
        if (el.mention_doc) return el.mention_doc.title || '';
        return '';
    }).join('');
}

function blockTitle(block) {
    if (!block) return '';
    if (block.block_type >= 3 && block.block_type <= 11) {
        return textFromElements(block[`heading${block.block_type - 2}`]?.elements);
    }
    if (block.block_type === 2) return textFromElements(block.text?.elements);
    return '';
}

function codeFromBlock(block) {
    const lang = normalizeLang(LANG_ID[block.code?.style?.language] || 'text');
    const code = textFromElements(block.code?.elements);
    return { lang, code };
}

function buildChildrenOrder(blocks) {
    const byId = new Map(blocks.map(b => [b.block_id, b]));
    const page = blocks.find(b => b.block_type === 1) || blocks[0];
    const ordered = [];
    const visit = block => {
        if (!block) return;
        ordered.push(block);
        for (const id of block.children || []) visit(byId.get(id));
    };
    visit(page);
    for (const block of blocks) {
        if (!ordered.includes(block)) ordered.push(block);
    }
    return ordered;
}

function extractFromFeishuBlocks(blocks, source) {
    const snippets = [];
    const headings = [];
    const ordered = buildChildrenOrder(blocks);

    for (const block of ordered) {
        if (block.block_type >= 3 && block.block_type <= 11) {
            const level = block.block_type - 2;
            headings[level - 1] = blockTitle(block);
            headings.length = level;
            continue;
        }

        if (block.block_type !== 14) continue;
        const { lang, code } = codeFromBlock(block);
        snippets.push(makeSnippet({
            source,
            lang,
            code,
            section: headings.filter(Boolean).join(' > ') || '(root)',
            blockId: block.block_id,
            index: snippets.length + 1,
        }));
    }

    return snippets;
}

function extractFromMarkdown(markdown, source) {
    const snippets = [];
    const headingStack = [];
    const fence = /(^|\n)(`{3,}|~{3,})([^\n`]*)\n([\s\S]*?)\n\2[ \t]*(?=\n|$)/g;
    let match;

    while ((match = fence.exec(markdown)) !== null) {
        const before = markdown.slice(0, match.index);
        const headings = [...before.matchAll(/^#{1,6}\s+(.+?)\s*(?:\{#[^}]+\})?\s*$/gm)];
        headingStack.length = 0;
        for (const h of headings) {
            const raw = h[0];
            const level = raw.match(/^#+/)[0].length;
            headingStack[level - 1] = h[1].replace(/\{#[^}]+\}/g, '').trim();
            headingStack.length = level;
        }

        const info = match[3].trim().split(/\s+/)[0];
        snippets.push(makeSnippet({
            source,
            lang: normalizeLang(info || 'text'),
            code: match[4],
            section: headingStack.filter(Boolean).join(' > ') || '(root)',
            blockId: null,
            index: snippets.length + 1,
        }));
    }

    return snippets;
}

function parseAnnotations(code) {
    const ann = {};
    const lines = code.split('\n').filter(l => l.trim()).slice(0, 5);
    for (const raw of lines) {
        const line = raw.replace(/^\s*(#|\/\/|\/\*|\*)\s?/, '').replace(/\*\/\s*$/, '').trim();
        const m = line.match(/^(doc-verify|verify):\s*(.+)$/i);
        if (m) {
            const body = m[2].trim();
            const mode = body.split(/\s+/)[0].toLowerCase();
            ann.mode = mode;
            const reason = body.match(/reason=(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
            if (reason) ann.reason = reason[1] || reason[2] || reason[3];
        }
        const timeout = line.match(/^doc-verify-timeout:\s*(\d+)/i);
        if (timeout) ann.timeout = parseInt(timeout[1], 10);
        const name = line.match(/^doc-verify-name:\s*(.+)$/i);
        if (name) ann.name = name[1].trim();
        const expected = line.match(/^doc-verify-expected:\s*(.+)$/i);
        if (expected) ann.expected = expected[1].trim();
    }
    return ann;
}

function makeSnippet({ source, lang, code, section, blockId, index }) {
    const annotations = parseAnnotations(code);
    return {
        id: `${source.id || source.title || source.path || 'source'}:${index}`,
        source: summarizeSource(source),
        index,
        blockId,
        section,
        language: normalizeLang(lang),
        code,
        hash: sha(code),
        annotations,
    };
}

function summarizeSource(source) {
    return {
        type: source.type,
        title: source.title,
        id: source.id,
        slug: source.slug,
        link: source.link,
        path: source.path,
    };
}

function hasDangerousRuntimePattern(code) {
    return /\b(delete|drop|remove|destroy|truncate|revoke|uninstall|shutdown|kill)\b/i.test(code) ||
        /\b(api[_-]?key|password|secret|credential|tenant_access_token|authorization:\s*bearer)\b/i.test(code) ||
        /\b(MilvusClient|Zilliz|feishu|lark|curl\s+https?:\/\/|docker|kubectl|terraform)\b/i.test(code);
}

function safetyFlagsFor(code) {
    const flags = [];
    if (/\b(delete|drop|remove|destroy|truncate|revoke|uninstall|shutdown|kill)\b/i.test(code)) flags.push('mutating-or-destructive');
    if (/\b(api[_-]?key|password|secret|credential|tenant_access_token|authorization:\s*bearer)\b/i.test(code)) flags.push('secret-like-content');
    if (/\b(MilvusClient|Zilliz|feishu|lark|curl\s+https?:\/\/|docker|kubectl|terraform)\b/i.test(code)) flags.push('external-service-or-tooling');
    return flags;
}

function classify(snippet, opts) {
    const lang = snippet.language;
    const ann = snippet.annotations || {};
    const safetyFlags = safetyFlagsFor(snippet.code);

    if (ann.mode === 'skip') return { action: 'skip', reason: ann.reason || 'annotated skip', safetyFlags };
    if (ann.mode === 'manual') return { action: 'manual', reason: ann.reason || 'annotated manual', safetyFlags };

    if (opts.mode === 'parse' && !['json', 'yaml', 'toml'].includes(lang)) {
        return { action: 'skip', reason: `mode=parse does not check ${lang}`, safetyFlags };
    }

    if (opts.mode === 'run' && ann.mode !== 'run') {
        return { action: 'manual', reason: 'mode=run requires in-block doc-verify: run annotation', safetyFlags };
    }

    if (ann.mode === 'run') {
        if (!opts.allowRun) return { action: 'manual', reason: 'runtime execution requires --allow-run', safetyFlags };
        if (safetyFlags.length && !opts.live) return { action: 'manual', reason: `runtime blocked by safety policy: ${safetyFlags.join(', ')}`, safetyFlags };
        return { action: 'run', reason: 'annotated run', safetyFlags };
    }

    if (ann.mode === 'live' && !opts.live && !['json', 'yaml', 'toml', 'python', 'bash', 'javascript', 'typescript', 'go', 'java', 'cpp', 'c'].includes(lang)) {
        return { action: 'manual', reason: 'live check requires --live', safetyFlags };
    }

    if (['json', 'yaml', 'toml'].includes(lang)) return { action: 'parse', reason: 'structured data', safetyFlags };

    if (['python', 'bash', 'javascript', 'typescript', 'go', 'java', 'cpp', 'c'].includes(lang)) {
        const reason = safetyFlags.length
            ? `non-executing compile check only; runtime blocked: ${safetyFlags.join(', ')}`
            : (ann.mode === 'compile' ? 'annotated compile' : 'default compile check');
        return { action: 'compile', reason, safetyFlags };
    }

    return { action: 'skip', reason: `unsupported language: ${lang}`, safetyFlags };
}

function commandExists(cmd) {
    const result = spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' });
    return result.status === 0;
}

function commandAvailable(cmd) {
    return fs.existsSync(resolveCommandPath(cmd)) || commandExists(cmd);
}

function resolveCommandPath(cmd) {
    const text = String(cmd || '');
    if (!text.includes(path.sep) || path.isAbsolute(text)) return text;
    return path.resolve(text);
}

function runCommand(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd,
        timeout: options.timeout,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        env: options.env || process.env,
    });
    return {
        command: [command, ...args].join(' '),
        status: result.status,
        signal: result.signal,
        stdout: redact(result.stdout),
        stderr: redact(result.stderr),
        error: result.error ? result.error.message : null,
    };
}

function runCommandRaw(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd,
        timeout: options.timeout,
        encoding: 'utf8',
        maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
        env: options.env || process.env,
    });
    return {
        command: [command, ...args].join(' '),
        status: result.status,
        signal: result.signal,
        stdout: String(result.stdout || ''),
        stderr: String(result.stderr || ''),
        error: result.error ? result.error.message : null,
    };
}

function parseJsonOutput(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(raw.slice(start, end + 1));
            } catch {
                return null;
            }
        }
    }
    return null;
}

function envWithPythonPath(opts) {
    if (!opts.pythonPath) return process.env;
    const existing = process.env.PYTHONPATH || '';
    return {
        ...process.env,
        PYTHONPATH: [path.resolve(opts.pythonPath), existing].filter(Boolean).join(path.delimiter),
    };
}

function resolveJavaClasspath(opts) {
    if (opts.javaClasspath) return;
    if (!opts.javaSdkRepo) return;
    if (opts.extractOnly) return;

    const resolved = deriveJavaClasspathFromSdkRepo(opts);
    if (resolved.status === 'passed') {
        opts.javaClasspath = resolved.classpath;
        opts.javaClasspathSource = resolved.source;
        return;
    }
    opts.javaClasspathError = resolved.detail;
}

function deriveJavaClasspathFromSdkRepo(opts) {
    const repo = path.resolve(opts.javaSdkRepo);
    const coreDir = path.join(repo, 'sdk-core');
    const corePom = path.join(coreDir, 'pom.xml');
    if (!fs.existsSync(corePom)) {
        return { status: 'manual', detail: `Java SDK repo is missing sdk-core/pom.xml: ${repo}` };
    }
    const classpathFile = path.join(coreDir, 'target', 'doc-verify-full-classpath.txt');
    const existing = composeJavaSdkClasspath(coreDir, classpathFile);
    if (existing) return { status: 'passed', classpath: existing, source: 'java-sdk-repo-cache' };

    const protoDir = path.join(coreDir, 'src', 'main', 'milvus-proto', 'proto');
    if (!fs.existsSync(protoDir)) {
        return {
            status: 'manual',
            detail: `Java SDK repo is missing generated-proto source input: ${protoDir}; run git submodule update --init --recursive in the SDK repo`,
        };
    }

    if (!commandExists('mvn')) return { status: 'manual', detail: 'mvn is not available for Java SDK repo classpath generation' };

    fs.mkdirSync(path.resolve(opts.javaMavenRepo), { recursive: true });
    const common = [
        `-Dmaven.repo.local=${path.resolve(opts.javaMavenRepo)}`,
        '-DskipTests',
        '-Dmaven.test.skip=true',
        '-Dcheckstyle.skip=true',
    ];

    let result = runCommand('mvn', [
        '-q',
        ...common,
        '-pl',
        'sdk-core',
        '-am',
        'package',
    ], { cwd: repo, timeout: opts.timeout * 12 });
    if (result.status !== 0) {
        return { status: 'manual', detail: `Java SDK Maven package failed: ${mavenFailureSummary(result)}`, result };
    }

    result = runCommand('mvn', [
        '-q',
        ...common,
        '-f',
        corePom,
        'dependency:build-classpath',
        `-Dmdep.outputFile=${classpathFile}`,
    ], { cwd: repo, timeout: opts.timeout * 12 });
    if (result.status !== 0) {
        return { status: 'manual', detail: `Java SDK Maven classpath generation failed: ${mavenFailureSummary(result)}`, result };
    }

    const classpath = composeJavaSdkClasspath(coreDir, classpathFile);
    if (!classpath) {
        return { status: 'manual', detail: 'Java SDK Maven build finished but no SDK jar/classes or dependency classpath was found' };
    }
    return { status: 'passed', classpath, source: 'java-sdk-repo' };
}

function composeJavaSdkClasspath(coreDir, classpathFile) {
    if (!fs.existsSync(classpathFile)) return '';
    const entries = [];
    const classesDir = path.join(coreDir, 'target', 'classes');
    const jar = findMilvusSdkJar(path.join(coreDir, 'target'));
    if (jar) entries.push(jar);
    else if (fs.existsSync(classesDir)) entries.push(classesDir);

    if (fs.existsSync(classpathFile)) {
        const depClasspath = fs.readFileSync(classpathFile, 'utf8').trim();
        if (depClasspath) entries.push(depClasspath);
    }

    return entries.filter(Boolean).join(path.delimiter);
}

function javaSdkSourceRoot(opts) {
    if (!opts.javaSdkRepo) return '';
    return path.join(path.resolve(opts.javaSdkRepo), 'sdk-core', 'src', 'main', 'java');
}

function javaImportIndex(opts) {
    if (opts.javaImportIndex) return opts.javaImportIndex;
    const root = javaSdkSourceRoot(opts);
    const index = new Map();
    if (!root || !fs.existsSync(root)) {
        opts.javaImportIndex = index;
        return index;
    }

    const visit = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                visit(p);
                continue;
            }
            if (!entry.isFile() || !entry.name.endsWith('.java')) continue;
            const text = fs.readFileSync(p, 'utf8');
            const pkg = text.match(/^\s*package\s+([\w.]+)\s*;/m);
            if (!pkg) continue;
            const re = /\bpublic\s+(?:final\s+|abstract\s+)?(?:class|interface|enum|record)\s+([A-Z][A-Za-z0-9_]*)\b/g;
            let match;
            while ((match = re.exec(text)) !== null) {
                const simple = match[1];
                const fqcn = `${pkg[1]}.${simple}`;
                if (index.has(simple) && index.get(simple) !== fqcn) index.set(simple, '');
                else index.set(simple, fqcn);
            }
        }
    };
    visit(root);
    opts.javaImportIndex = index;
    return index;
}

function addInferredJavaImports(imports, body, opts) {
    const importSet = imports instanceof Set
        ? imports
        : new Set(String(imports || '').split('\n').map(line => line.trim()).filter(Boolean));
    const importedSimple = new Set();
    const wildcardPackages = [];

    for (const line of importSet) {
        const exact = line.match(/^import\s+([\w.]+)\.([A-Z][A-Za-z0-9_]*)\s*;\s*$/);
        if (exact) importedSimple.add(exact[2]);
        const wildcard = line.match(/^import\s+([\w.]+)\.\*\s*;\s*$/);
        if (wildcard) wildcardPackages.push(wildcard[1]);
    }

    const text = stripJavaCommentsAndStrings(body);
    for (const [simple, fqcn] of javaImportIndex(opts)) {
        if (!fqcn || importedSimple.has(simple)) continue;
        if (!new RegExp(`\\b${simple}\\b`).test(text)) continue;
        const pkg = fqcn.slice(0, fqcn.lastIndexOf('.'));
        if (wildcardPackages.includes(pkg)) continue;
        importSet.add(`import ${fqcn};`);
        importedSimple.add(simple);
    }

    return imports instanceof Set ? importSet : Array.from(importSet).join('\n');
}

function stripJavaCommentsAndStrings(code) {
    return String(code || '')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/.*$/gm, ' ')
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

function findMilvusSdkJar(targetDir) {
    if (!fs.existsSync(targetDir)) return '';
    const jars = fs.readdirSync(targetDir)
        .filter(name => /^milvus-sdk-java-.+\.jar$/.test(name))
        .filter(name => !/(sources|javadoc|tests|original)-?/.test(name))
        .map(name => path.join(targetDir, name))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return jars[0] || '';
}

function mavenFailureSummary(result) {
    const text = [result.error, result.stderr, result.stdout].filter(Boolean).join('\n');
    const lines = redact(text).split('\n').map(line => line.trim()).filter(Boolean);
    const useful = lines.filter(line =>
        /(^\[ERROR\])|Unknown host|Could not transfer|Failed to|Non-resolvable|Operation not permitted|BUILD FAILURE/i.test(line)
    );
    return (useful.length ? useful : lines).slice(0, 6).join(' | ') || 'see Maven output';
}

function writeTemp(dir, name, content) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    return file;
}

function verifySnippet(snippet, classification, opts) {
    if (opts.extractOnly) return { status: 'extracted', detail: 'extract-only mode' };
    if (classification.action === 'skip') return { status: 'skipped', detail: classification.reason };
    if (classification.action === 'manual') return { status: 'manual', detail: classification.reason };

    const timeout = snippet.annotations.timeout || opts.timeout;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `feishu-code-${snippet.hash}-`));
    const code = snippet.code;
    const lang = snippet.language;

    try {
        if (classification.action === 'parse') return parseStructured(lang, code);
        if (classification.action === 'run') return runSnippet(lang, code, tmp, timeout, opts);

        switch (lang) {
            case 'python':
                return verifyPython(code, tmp, timeout);
            case 'bash':
                return verifyBash(code, tmp, timeout);
            case 'javascript':
                return verifyJavaScript(code, tmp, timeout);
            case 'typescript':
                return verifyTypeScript(code, tmp, timeout);
            case 'go':
                return verifyGo(code, tmp, timeout, opts);
            case 'java':
                return verifyJava(code, tmp, timeout, opts);
            case 'cpp':
            case 'c':
                return verifyCpp(code, tmp, timeout, lang, opts);
            default:
                return { status: 'skipped', detail: `no verifier for ${lang}` };
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function parseStructured(lang, code) {
    try {
        if (lang === 'json') JSON.parse(code);
        else if (lang === 'yaml') {
            let yaml;
            try { yaml = require('yaml'); } catch (_) { return { status: 'manual', detail: 'yaml parser package is not installed' }; }
            yaml.parse(code);
        } else if (lang === 'toml') {
            return { status: 'manual', detail: 'toml parser is not installed' };
        }
        return { status: 'passed', detail: `${lang} parsed` };
    } catch (err) {
        return { status: 'failed', detail: err.message };
    }
}

function verifyPython(code, tmp, timeout) {
    const file = writeTemp(tmp, 'snippet.py', code);
    const command = code.includes('>>>')
        ? ['python3', ['-m', 'doctest', file]]
        : ['python3', ['-m', 'py_compile', file]];
    const result = runCommand(command[0], command[1], { cwd: tmp, timeout });
    return result.status === 0
        ? { status: 'passed', detail: command[1].includes('doctest') ? 'doctest passed' : 'py_compile passed', result }
        : { status: 'failed', detail: 'python verification failed', result };
}

function verifyBash(code, tmp, timeout) {
    const file = writeTemp(tmp, 'snippet.sh', code);
    const result = runCommand('bash', ['-n', file], { cwd: tmp, timeout });
    return result.status === 0
        ? { status: 'passed', detail: 'bash -n passed', result }
        : { status: 'failed', detail: 'bash syntax failed', result };
}

function verifyJavaScript(code, tmp, timeout) {
    const file = writeTemp(tmp, 'snippet.js', code);
    const result = runCommand('node', ['--check', file], { cwd: tmp, timeout });
    return result.status === 0
        ? { status: 'passed', detail: 'node --check passed', result }
        : { status: 'failed', detail: 'javascript syntax failed', result };
}

function verifyTypeScript(code, tmp, timeout) {
    if (!commandExists('tsc')) return { status: 'manual', detail: 'tsc is not available' };
    const file = writeTemp(tmp, 'snippet.ts', code);
    const result = runCommand('tsc', ['--noEmit', '--skipLibCheck', file], { cwd: tmp, timeout });
    return result.status === 0
        ? { status: 'passed', detail: 'tsc --noEmit passed', result }
        : { status: 'failed', detail: 'typescript check failed', result };
}

function verifyGo(code, tmp, timeout, opts) {
    if (!commandExists('gofmt')) return { status: 'manual', detail: 'gofmt is not available' };
    if (!/^\s*package\s+\w+/m.test(code)) {
        if (!opts.harness) return { status: 'manual', detail: 'go snippet is partial; no package declaration' };
        return verifyGoFragment(code, tmp, timeout);
    }
    const file = writeTemp(tmp, 'snippet.go', code);
    let result = runCommand('gofmt', ['-w', file], { cwd: tmp, timeout });
    if (result.status !== 0) return { status: 'failed', detail: 'gofmt failed', result };
    result = runCommand('go', ['test', '.'], { cwd: tmp, timeout });
    return result.status === 0
        ? { status: 'passed', detail: 'go test passed', result }
        : { status: 'failed', detail: 'go test failed', result };
}

function verifyGoFragment(code, tmp, timeout) {
    const { imports, body } = splitGoImports(code);
    const wrapped = [
        'package main',
        '',
        imports,
        '',
        'func main() {',
        indentNonEmpty(body, '    '),
        '}',
        '',
    ].filter(Boolean).join('\n');
    const file = writeTemp(tmp, 'snippet_fragment.go', wrapped);
    const result = runCommand('gofmt', ['-w', file], { cwd: tmp, timeout });
    return result.status === 0
        ? { status: 'passed', detail: 'go fragment harness syntax passed (gofmt only; not type-checked)', harness: { type: 'go-fragment', strength: 'syntax' }, result }
        : { status: 'failed', detail: 'go fragment harness syntax failed', harness: { type: 'go-fragment', strength: 'syntax' }, result };
}

function splitGoImports(code) {
    let rest = code.trim();
    const imports = [];
    while (true) {
        const block = rest.match(/^import\s*\([\s\S]*?\)\s*/);
        if (block) {
            imports.push(block[0].trim());
            rest = rest.slice(block[0].length).trimStart();
            continue;
        }
        const single = rest.match(/^import\s+("[^"]+"|[A-Za-z_][\w.]*\s+"[^"]+")\s*/);
        if (single) {
            imports.push(single[0].trim());
            rest = rest.slice(single[0].length).trimStart();
            continue;
        }
        break;
    }
    return { imports: imports.join('\n'), body: rest };
}

function verifyJava(code, tmp, timeout, opts) {
    if (!commandExists('javac')) return { status: 'manual', detail: 'javac is not available' };
    const classMatch = code.match(/\b(public\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (!classMatch) {
        if (!opts.harness) return { status: 'manual', detail: 'java snippet has no class declaration' };
        return verifyJavaFragment(code, tmp, timeout, opts);
    }
    const file = writeTemp(tmp, `${classMatch[2]}.java`, code);
    const args = opts.javaClasspath ? ['-cp', opts.javaClasspath, file] : [file];
    const result = runCommand('javac', args, { cwd: tmp, timeout });
    return result.status === 0
        ? { status: 'passed', detail: 'javac passed', result }
        : { status: 'failed', detail: 'javac failed', result };
}

function verifyJavaFragment(code, tmp, timeout, opts) {
    let { imports, body } = splitJavaImports(code);
    const importSet = javaImportSet(imports, ['import java.util.*;']);
    imports = Array.from(addInferredJavaImports(importSet, body, opts)).sort().join('\n');
    const wrapped = [
        imports,
        '',
        'public class DocsSnippet {',
        '    public static void example() throws Exception {',
        indentNonEmpty(body, '        '),
        '    }',
        '}',
        '',
    ].filter(Boolean).join('\n');
    const file = writeTemp(tmp, 'DocsSnippet.java', wrapped);
    const args = opts.javaClasspath ? ['-cp', opts.javaClasspath, file] : [file];
    const result = runCommand('javac', args, { cwd: tmp, timeout });
    if (result.status === 0) {
        return { status: 'passed', detail: 'java fragment harness compiled', harness: { type: 'java-fragment', strength: 'compile' }, result };
    }
    if (looksLikeJavaDependencyFailure(result.stderr)) {
        return {
            status: 'manual',
            detail: 'java fragment harness parsed but dependencies or setup symbols are unresolved; set DOC_VERIFY_JAVA_CLASSPATH or DOC_VERIFY_JAVA_SDK_REPO for full compile',
            harness: { type: 'java-fragment', strength: 'syntax-with-unresolved-deps' },
            result,
        };
    }
    return { status: 'failed', detail: 'java fragment harness syntax failed', harness: { type: 'java-fragment', strength: 'syntax' }, result };
}

function splitJavaImports(code) {
    const imports = [];
    const body = [];
    for (const line of code.split('\n')) {
        if (/^\s*import\s+[\w.*]+\s*;\s*$/.test(line)) imports.push(line.trim());
        else body.push(line);
    }
    return { imports: imports.join('\n'), body: body.join('\n').trim() };
}

function javaImportSet(imports, defaults = []) {
    const importSet = new Set(defaults);
    for (const line of String(imports || '').split('\n').map(item => item.trim()).filter(Boolean)) {
        importSet.add(line);
    }
    return importSet;
}

function looksLikeJavaDependencyFailure(stderr) {
    const text = String(stderr || '');
    const syntaxPatterns = [
        /';' expected/,
        /illegal start/,
        /not a statement/,
        /reached end of file/,
        /\bexpected\b/,
        /unclosed string literal/,
        /class, interface, enum, or record expected/,
    ];
    if (syntaxPatterns.some(re => re.test(text))) return false;
    return /package .* does not exist|cannot find symbol|symbol:\s+(class|variable|method)|location:\s+/m.test(text);
}

function indentNonEmpty(text, prefix) {
    return String(text || '')
        .split('\n')
        .map(line => line.trim() ? prefix + line : line)
        .join('\n');
}

function verifyCpp(code, tmp, timeout, lang, opts) {
    if (lang === 'c' && !/#include|int\s+main\s*\(/.test(code)) return { status: 'manual', detail: 'c snippet is partial' };
    if (lang === 'cpp' && !/\b(?:int|auto)\s+main\s*\(/.test(code) && opts.harness) {
        return verifyCppFragment(code, tmp, timeout, opts);
    }
    if (!/#include|\b(?:int|auto)\s+main\s*\(/.test(code)) return { status: 'manual', detail: `${lang} snippet is partial` };
    const ext = lang === 'c' ? 'c' : 'cpp';
    const compiler = lang === 'c' ? 'cc' : (commandExists('clang++') ? 'clang++' : 'g++');
    const file = writeTemp(tmp, `snippet.${ext}`, code);
    const args = cppCompileArgs(lang, opts, file);
    const result = runCommand(compiler, args, { cwd: tmp, timeout });
    return cppVerificationResult(result, `${compiler} ${args.filter(arg => arg !== file).join(' ')} passed`, `${compiler} syntax check failed`, null, opts);
}

function verifyCppFragment(code, tmp, timeout, opts) {
    const compiler = commandExists('clang++') ? 'clang++' : 'g++';
    const { includes, body } = splitCppIncludes(code);
    const includeSet = new Set(includes);
    for (const line of inferredCppIncludes(body)) includeSet.add(line);
    const wrapped = [
        Array.from(includeSet).sort().join('\n'),
        '',
        'int main() {',
        indentNonEmpty(body, '    '),
        '    return 0;',
        '}',
        '',
    ].filter(Boolean).join('\n');
    const file = writeTemp(tmp, 'snippet_fragment.cpp', wrapped);
    const args = cppCompileArgs('cpp', opts, file);
    const result = runCommand(compiler, args, { cwd: tmp, timeout });
    return cppVerificationResult(
        result,
        'c++ fragment harness compiled with -fsyntax-only',
        'c++ fragment harness syntax failed',
        { type: 'cpp-fragment', strength: 'compile' },
        opts
    );
}

function splitCppIncludes(code) {
    const includes = [];
    const body = [];
    for (const line of String(code || '').split('\n')) {
        if (/^\s*#\s*include\b/.test(line)) includes.push(line.trim());
        else body.push(line);
    }
    return { includes, body: body.join('\n').trim() };
}

function inferredCppIncludes(body) {
    const includes = [
        '#include <cstdint>',
        '#include <iostream>',
        '#include <memory>',
        '#include <string>',
        '#include <utility>',
        '#include <vector>',
    ];
    if (/\bmilvus::|\bMilvusClient\b/.test(body)) includes.push('#include <milvus/MilvusClientV2.h>');
    return includes;
}

function cppCompileArgs(lang, opts, file) {
    const args = [];
    if (lang === 'cpp') args.push('-std=c++17');
    args.push('-fsyntax-only');
    args.push(...cppIncludeArgs(opts));
    args.push(file);
    return args;
}

function cppIncludeArgs(opts) {
    const dirs = [];
    if (opts.cppSdkRepo) {
        const repo = path.resolve(opts.cppSdkRepo);
        dirs.push(path.join(repo, 'src', 'include'));
    }
    for (const dir of opts.cppIncludeDirs || []) dirs.push(path.resolve(dir));
    if (process.platform === 'darwin') {
        const sdkRoot = process.env.SDKROOT || '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk';
        dirs.push(path.join(sdkRoot, 'usr', 'include', 'c++', 'v1'));
    }
    return dirs.filter(dir => fs.existsSync(dir)).flatMap(dir => ['-I', dir]);
}

function cppVerificationResult(result, passDetail, failDetail, harness, opts) {
    if (result.status === 0) {
        return { status: 'passed', detail: passDetail, ...(harness ? { harness } : {}), result };
    }
    const dependency = cppDependencyOrSetupFailure(result.stderr, opts);
    if (dependency) {
        return {
            status: 'manual',
            detail: dependency,
            ...(harness ? { harness: { ...harness, strength: 'syntax-with-unresolved-deps' } } : {}),
            result,
        };
    }
    return { status: 'failed', detail: failDetail, ...(harness ? { harness: { ...harness, strength: 'syntax' } } : {}), result };
}

function cppDependencyOrSetupFailure(stderr, opts) {
    const text = String(stderr || '');
    const syntaxPatterns = [
        /\bexpected\b/i,
        /extraneous closing brace/i,
        /missing terminating/i,
        /unterminated/i,
        /invalid suffix/i,
        /cannot combine with previous/i,
    ];
    if (syntaxPatterns.some(re => re.test(text))) return '';

    if (/fatal error: ['"]milvus\/.+['"] file not found/.test(text)) {
        return opts.cppSdkRepo
            ? 'c++ SDK header was not found under the configured --cpp-sdk-repo; check repos/milvus-sdk-cpp/src/include'
            : 'c++ snippet requires Milvus SDK headers; set DOC_VERIFY_CPP_SDK_REPO or --cpp-sdk-repo';
    }
    if (/fatal error: ['"](string|vector|memory|iostream|cstdint|utility)['"] file not found/.test(text)) {
        return 'c++ compiler cannot find standard library headers; install/fix the local C++ toolchain';
    }
    if (/fatal error: ['"].+['"] file not found/.test(text)) {
        return 'c++ snippet requires headers that are not available locally; set --cpp-include-dir or DOC_VERIFY_CPP_INCLUDE_DIRS';
    }
    if (/use of undeclared identifier|unknown type name|no template named|does not name a type|was not declared in this scope/.test(text)) {
        return 'c++ fragment parsed but setup symbols or includes are unresolved';
    }
    return '';
}

function runSnippet(lang, code, tmp, timeout, opts) {
    if (hasDangerousRuntimePattern(code) && !opts.live) return { status: 'manual', detail: 'runtime blocked by safety policy' };
    const missingEnv = hasDangerousRuntimePattern(code) ? liveEnvMissing(opts) : [];
    if (missingEnv.length > 0) {
        return { status: 'manual', detail: `live runtime requires env: ${missingEnv.map(x => x.anyOf.join('|')).join(', ')}` };
    }
    if (lang === 'python') {
        const file = writeTemp(tmp, 'snippet.py', code);
        const result = runCommand('python3', [file], { cwd: tmp, timeout });
        return result.status === 0 ? { status: 'passed', detail: 'python run passed', result } : { status: 'failed', detail: 'python run failed', result };
    }
    if (lang === 'bash') {
        const file = writeTemp(tmp, 'snippet.sh', code);
        const result = runCommand('bash', [file], { cwd: tmp, timeout });
        return result.status === 0 ? { status: 'passed', detail: 'bash run passed', result } : { status: 'failed', detail: 'bash run failed', result };
    }
    if (lang === 'javascript') {
        const file = writeTemp(tmp, 'snippet.js', code);
        const result = runCommand('node', [file], { cwd: tmp, timeout });
        return result.status === 0 ? { status: 'passed', detail: 'node run passed', result } : { status: 'failed', detail: 'node run failed', result };
    }
    return { status: 'manual', detail: `runtime not implemented for ${lang}` };
}

function scenarioRuntimeGate(opts, language) {
    if (!opts.runScenarios) return null;
    if (!opts.allowRun) return { status: 'manual', detail: `${language} scenario runtime requires --allow-run` };
    if (!opts.live) return { status: 'manual', detail: `${language} scenario runtime requires --live` };
    const missingEnv = liveEnvMissing(opts);
    if (missingEnv.length > 0) {
        return { status: 'manual', detail: `${language} scenario runtime requires env: ${missingEnv.map(x => x.anyOf.join('|')).join(', ')}` };
    }
    return null;
}

async function fetchFeishuBlocks(docToken) {
    const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
    const token = await m2f.tokenFetcher.token();
    const all = [];
    let pageToken = null;
    do {
        let url = `${FEISHU_HOST}/open-apis/docx/v1/documents/${docToken}/blocks?page_size=500`;
        if (pageToken) url += `&page_token=${pageToken}`;
        const res = await require('node-fetch')(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.code !== 0) throw new Error(`Failed to fetch doc ${docToken}: ${data.msg}`);
        all.push(...(data.data.items || []));
        pageToken = data.data.has_more ? data.data.page_token : null;
    } while (pageToken);
    return all;
}

async function loadSources(opts) {
    const sources = [];

    if (opts.selfTest) {
        sources.push({
            type: 'markdown',
            title: 'self-test',
            path: '<self-test>',
            markdown: [
                '# Test',
                '```python',
                'x = 1',
                '```',
                '```json',
                '{"ok": true}',
                '```',
                '```bash',
                'echo "ok"',
                '```',
                '```javascript',
                'const ok = true;',
                'console.log(ok);',
                '```',
                '```go',
                'x := 1',
                '_ = x',
                '```',
                '```java',
                'int x = 1;',
                'System.out.println(x);',
                '```',
            ].join('\n'),
        });
    }

    for (const file of opts.markdown) {
        sources.push({
            type: 'markdown',
            title: path.basename(file),
            path: path.resolve(file),
            markdown: fs.readFileSync(path.resolve(file), 'utf8'),
        });
    }

    for (const doc of opts.doc) {
        const token = extractDocToken(doc);
        const blocks = await fetchFeishuBlocks(token);
        sources.push({ type: 'feishu', title: token, id: token, link: doc, blocks });
    }

    if (opts.bitable) {
        const bw = new BitableWriter({ baseToken: opts.bitable, tableId: opts.table });
        let records = await bw.listRecords({ pageSize: 500 });
        if (opts.record.length) records = records.filter(r => opts.record.includes(r.record_id || r.id));
        if (opts.slug.length) {
            const slugs = new Set(opts.slug.map(s => s.toLowerCase()));
            records = records.filter(r => slugs.has(slugText(r).toLowerCase()));
        }
        records = records.slice(0, opts.maxDocs);
        for (const record of records) {
            const docs = docsCellToObj(record.fields?.Docs);
            const token = extractDocToken(docs.link);
            if (!token || !docs.link.includes('/docx/')) continue;
            const blocks = await fetchFeishuBlocks(token);
            sources.push({
                type: 'bitable',
                title: docs.title || token,
                id: record.record_id || record.id,
                slug: slugText(record),
                link: docs.link,
                blocks,
            });
        }
    }

    return sources;
}

function snippetsForSource(source) {
    if (source.type === 'markdown') return extractFromMarkdown(source.markdown, source);
    return extractFromFeishuBlocks(source.blocks, source);
}

function buildScenarioResults(snippets, opts) {
    if (!opts.scenario) return [];
    const langs = opts.languages || new Set(['python', 'go', 'java', 'javascript', 'bash']);
    const scenarios = [];

    if (langs.has('python')) {
        for (const group of groupSnippetsBySource(snippets.filter(s => s.language === 'python')).values()) {
            scenarios.push(buildPythonScenario(group, opts));
        }
    }

    if (langs.has('go')) {
        for (const group of groupSnippetsBySource(snippets.filter(s => s.language === 'go')).values()) {
            scenarios.push(buildGoScenario(group, opts));
        }
    }

    if (langs.has('java')) {
        for (const group of groupSnippetsBySource(snippets.filter(s => s.language === 'java')).values()) {
            scenarios.push(buildJavaScenario(group, opts));
        }
    }

    if (langs.has('javascript')) {
        for (const group of groupSnippetsBySource(snippets.filter(s => s.language === 'javascript')).values()) {
            scenarios.push(buildJavaScriptScenario(group, opts));
        }
    }

    if (langs.has('bash')) {
        for (const group of groupSnippetsBySource(snippets.filter(s => s.language === 'bash')).values()) {
            scenarios.push(buildBashScenario(group, opts));
        }
    }

    return scenarios;
}

function groupSnippetsBySource(snippets) {
    const bySource = new Map();
    for (const snippet of snippets) {
        const key = snippet.source.id || snippet.source.link || snippet.source.path || snippet.source.title || 'source';
        if (!bySource.has(key)) bySource.set(key, []);
        bySource.get(key).push(snippet);
    }
    return bySource;
}

function scenarioIdBase(source, fallback) {
    return String(source.id || source.title || source.path || fallback).replace(/[^A-Za-z0-9_-]/g, '_');
}

function scenarioResourceSuffix(opts) {
    if (!opts.runScenarios) return '';
    if (!opts.resourceSuffix) {
        opts.resourceSuffix = `doc_verify_${Date.now().toString(36)}`;
    }
    return [opts.resourceSuffix, opts.scenarioScope]
        .filter(Boolean)
        .join('_')
        .replace(/[^A-Za-z0-9_]/g, '_')
        .slice(0, 120);
}

function scenarioDatabaseName(opts) {
    const suffix = scenarioResourceSuffix(opts);
    return suffix ? `my_database_${suffix}` : 'my_database';
}

function scenarioCollectionName(opts) {
    const suffix = scenarioResourceSuffix(opts);
    return suffix ? `prod_collection_${suffix}` : 'prod_collection';
}

function withScenarioScope(opts, source, language) {
    if (!opts.runScenarios) return opts;
    const base = scenarioIdBase(source, language || 'scenario').slice(0, 36);
    return { ...opts, scenarioScope: `${language || 'scenario'}_${base}` };
}

function scenarioUsesStructArrayFixture(snippets) {
    const text = snippets.map(snippet => snippet.code || '').join('\n');
    if (!/\bchunks\s*\[|\bchunks\]/.test(text) && !/"chunks"|'chunks'/.test(text)) return false;
    if (!/\b(chunk_vector|element_vector|text_vector)\b|chunks\[[^\]]+\]/.test(text)) return false;
    return !/\bcreate_collection\s*\(|\/collections\/create\b|collection\s+create\b/i.test(text);
}

function replacePythonCollectionLiterals(text) {
    return String(text || '')
        .replace(/(["'])my_database\1/g, 'DOC_VERIFY_DATABASE_NAME')
        .replace(/(["'])(?:prod_collection|my_collection|books)\1/g, 'DOC_VERIFY_COLLECTION_NAME');
}

function replaceJavaGoCollectionLiterals(text) {
    return String(text || '')
        .replace(/"my_database"/g, 'DOC_VERIFY_DATABASE_NAME')
        .replace(/"(?:prod_collection|my_collection|books)"/g, 'DOC_VERIFY_COLLECTION_NAME');
}

function replaceJavaScriptCollectionLiterals(text) {
    return String(text || '')
        .replace(/(["'`])my_database\1/g, 'globalThis.DOC_VERIFY_DATABASE_NAME')
        .replace(/(["'`])(?:prod_collection|my_collection|books)\1/g, 'globalThis.DOC_VERIFY_COLLECTION_NAME');
}

function replaceBashCollectionLiterals(text) {
    return String(text || '')
        .replace(/\bmy_database\b/g, '${DOC_VERIFY_DATABASE_NAME}')
        .replace(/\b(?:prod_collection|my_collection|books)\b/g, '${DOC_VERIFY_COLLECTION_NAME}');
}

function replaceScenarioResourceLiterals(code, opts, language) {
    if (!opts.runScenarios) return code;
    if (language === 'python') {
        let text = replacePythonCollectionLiterals(code)
            .replace(/OBJECT_URLS\s*=\s*\[\[[\s\S]*?\]\]/m, 'OBJECT_URLS = doc_verify_object_urls()')
            .replace(/^(\s*)ACCESS_KEY\s*=\s*["']YOUR_STORAGE_ACCESS_KEY["']\s*$/gm, '$1ACCESS_KEY = DOC_VERIFY_AWS_ACCESS_KEY')
            .replace(/^(\s*)SECRET_KEY\s*=\s*["']YOUR_STORAGE_SECRET_KEY["']\s*$/gm, '$1SECRET_KEY = DOC_VERIFY_AWS_SECRET_KEY')
            .replace(/api_key\s*=\s*["']YOUR_ZILLIZ_API_KEY["']/g, 'api_key=DOC_VERIFY_CLOUD_API_KEY')
            .replace(/url\s*=\s*["']https:\/\/api\.cloud\.zilliz\.com["']/g, 'url=CLOUD_PLATFORM_ENDPOINT')
            .replace(/cluster_id\s*=\s*["']inxx-[^"']+["']/g, 'cluster_id=DOC_VERIFY_CLUSTER_ID')
            .replace(/job_id\s*=\s*["']job-[^"']+["']/g, 'job_id=DOC_VERIFY_IMPORT_JOB_ID')
            .replace(/,\s*\.\.\.\s*,/g, ', *([0.0] * 763),');
        if (/get_import_progress/.test(text) && /DOC_VERIFY_IMPORT_JOB_ID/.test(text)) {
            text = text.replace(/(\s*# Get bulk-insert job progress)/, '\nDOC_VERIFY_IMPORT_JOB_ID = doc_verify_import_job_id(res)\n$1');
            text = text.replace(/print\(json\.dumps\(resp\.json\(\), indent=4\)\)/, [
                'resp = doc_verify_wait_import_complete(',
                '    api_key=DOC_VERIFY_CLOUD_API_KEY,',
                '    url=CLOUD_PLATFORM_ENDPOINT,',
                '    cluster_id=DOC_VERIFY_CLUSTER_ID,',
                '    job_id=DOC_VERIFY_IMPORT_JOB_ID,',
                ')',
                'client.load_collection(',
                '    db_name=DOC_VERIFY_DATABASE_NAME,',
                '    collection_name=DOC_VERIFY_COLLECTION_NAME',
                ')',
                'print(json.dumps(resp.json(), indent=4))',
            ].join('\n'));
        }
        return text;
    }
    if (language === 'java' || language === 'go') {
        let text = replaceJavaGoCollectionLiterals(code);
        if (language === 'java') {
            text = text
                .replace(/List<Float>\s+queryVector\s*=\s*Arrays\.asList\([\s\S]*?\);/, 'List<Float> queryVector = docVerifyVector(0);')
                .replace(/(\s*\/\/ Block \d+: .*Serve your data\.)/, '\n        docVerifyInsertRows(client, DOC_VERIFY_DATABASE_NAME, DOC_VERIFY_COLLECTION_NAME);\n$1');
        }
        if (language === 'go') {
            text = text
                .replace(/queryVector\s*:=\s*\[\]float32\{[\s\S]*?\}/, 'queryVector := docVerifyVector(0)')
                .replace(/(\s*\/\/ Block \d+: .*Serve your data\.)/, '\n\tdocVerifyInsertRows(ctx, cli, DOC_VERIFY_COLLECTION_NAME)\n$1');
        }
        return text;
    }
    if (language === 'javascript') {
        return replaceJavaScriptCollectionLiterals(code);
    }
    if (language === 'bash') {
        return replaceBashCollectionLiterals(code);
    }
    return code;
}

function buildPythonScenario(snippets, opts) {
    if (snippets.length === 0) return null;
    const source = snippets[0].source;
    opts = withScenarioScope(opts, source, 'python');
    const outDir = path.join(opts.scenarioOutDir, 'python', scenarioIdBase(source, 'python-scenario'));
    fs.mkdirSync(outDir, { recursive: true });

    const shim = createScenarioShimContext('python', snippets, opts);
    const needsStructArrayFixture = opts.runScenarios && scenarioUsesStructArrayFixture(snippets);
    const body = [];
    let insertedStructArrayLoad = false;
    for (const snippet of snippets) {
        if (needsStructArrayFixture && !insertedStructArrayLoad && /\bclient\.search\s*\(/.test(snippet.code || '')) {
            body.push('doc_verify_load_collection(client)');
            insertedStructArrayLoad = true;
        }
        body.push(`# Block ${snippet.index}: ${snippet.section}`);
        const normalized = shim.normalizeSnippet(
            snippet,
            replaceScenarioResourceLiterals(normalizePythonScenarioCode(snippet.code), opts, 'python')
        );
        body.push(normalized);
        body.push('');
    }

    const sourceText = [
        'import os',
        'import json',
        'import time',
        'from urllib.parse import urlparse',
        '',
        'SERVING_CLUSTER_ENDPOINT = os.getenv("SERVING_CLUSTER_ENDPOINT") or os.getenv("ZILLIZ_CLUSTER_ENDPOINT") or os.getenv("DOC_VERIFY_SERVING_CLUSTER_ENDPOINT")',
        'TOKEN = os.getenv("TOKEN") or os.getenv("ZILLIZ_CLUSTER_CREDENTIAL") or os.getenv("ZILLIZ_API_KEY") or os.getenv("DOC_VERIFY_TOKEN") or os.getenv("DOC_VERIFY_ZILLIZ_API_KEY")',
        'CLOUD_PLATFORM_ENDPOINT = os.getenv("CLOUD_PLATFORM_ENDPOINT") or os.getenv("DOC_VERIFY_CLOUD_PLATFORM_ENDPOINT") or "https://api.cloud.zilliz.com"',
        'DOC_VERIFY_CLOUD_API_KEY = os.getenv("DOC_VERIFY_CLOUD_API_KEY") or os.getenv("ZILLIZ_API_KEY") or TOKEN',
        'DOC_VERIFY_CLUSTER_ID = os.getenv("DOC_VERIFY_CLUSTER_ID")',
        'if not DOC_VERIFY_CLUSTER_ID and SERVING_CLUSTER_ENDPOINT:',
        '    DOC_VERIFY_CLUSTER_ID = urlparse(SERVING_CLUSTER_ENDPOINT).hostname.split(".")[0]',
        'DOC_VERIFY_AWS_ACCESS_KEY = os.getenv("DOC_VERIFY_AWS_ACCESS_KEY") or os.getenv("AWS_ACCESS_KEY") or os.getenv("AWS_ACCESS_KEY_ID")',
        'DOC_VERIFY_AWS_SECRET_KEY = os.getenv("DOC_VERIFY_AWS_SECRET_KEY") or os.getenv("AWS_ACCESS_SECRET_KEY") or os.getenv("AWS_SECRET_ACCESS_KEY")',
        'DOC_VERIFY_AWS_S3_BUCKET = os.getenv("DOC_VERIFY_AWS_S3_BUCKET") or os.getenv("AWS_S3_BUCKET")',
        `DOC_VERIFY_DATABASE_NAME = os.getenv("DOC_VERIFY_DATABASE_NAME") or "${scenarioDatabaseName(opts)}"`,
        `DOC_VERIFY_COLLECTION_NAME = os.getenv("DOC_VERIFY_COLLECTION_NAME") or "${scenarioCollectionName(opts)}"`,
        '',
        'def doc_verify_object_urls():',
        '    raw = os.getenv("DOC_VERIFY_OBJECT_URLS")',
        '    if raw:',
        '        return [[item.strip() for item in raw.split(",") if item.strip()]]',
        '    region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-west-2"',
        '    generated_key = doc_verify_prepare_parquet_fixture(region)',
        '    if generated_key:',
        '        return [[f"https://s3.{region}.amazonaws.com/{DOC_VERIFY_AWS_S3_BUCKET}/{generated_key}"]]',
        '    key = os.getenv("DOC_VERIFY_S3_OBJECT_KEY") or "path/in/external/storage.json"',
        '    if DOC_VERIFY_AWS_S3_BUCKET:',
        '        return [[f"https://s3.{region}.amazonaws.com/{DOC_VERIFY_AWS_S3_BUCKET}/{key.lstrip(\'/\')}"]]',
        '    return [["https://s3.us-west-2.amazonaws.com/your-bucket/path/in/external/storage.json"]]',
        '',
        'def doc_verify_prepare_parquet_fixture(region):',
        '    if os.getenv("DOC_VERIFY_GENERATE_PARQUET", "1").lower() in ("0", "false", "no"):',
        '        return None',
        '    if not (DOC_VERIFY_AWS_S3_BUCKET and DOC_VERIFY_AWS_ACCESS_KEY and DOC_VERIFY_AWS_SECRET_KEY):',
        '        return None',
        '    import pyarrow as pa',
        '    import pyarrow.fs as pafs',
        '    import pyarrow.parquet as pq',
        '    key = os.getenv("DOC_VERIFY_GENERATED_PARQUET_KEY") or f"doc-verify/{DOC_VERIFY_COLLECTION_NAME}/products.parquet"',
        '    table = pa.table({',
        '        "product_id": pa.array([1, 2, 3], type=pa.int64()),',
        '        "product_name": pa.array(["doc verify product 1", "doc verify product 2", "doc verify product 3"], type=pa.string()),',
        '        "embedding": pa.array([[float((row + col) % 17) / 17.0 for col in range(768)] for row in range(3)], type=pa.list_(pa.float32())),',
        '    })',
        '    fs = pafs.S3FileSystem(',
        '        access_key=DOC_VERIFY_AWS_ACCESS_KEY,',
        '        secret_key=DOC_VERIFY_AWS_SECRET_KEY,',
        '        region=region,',
        '    )',
        '    with fs.open_output_stream(f"{DOC_VERIFY_AWS_S3_BUCKET}/{key}") as out:',
        '        pq.write_table(table, out)',
        '    return key',
        '',
        'def doc_verify_import_job_id(resp):',
        '    if isinstance(resp, str):',
        '        return resp',
        '    if isinstance(resp, dict):',
        '        return resp.get("job_id") or resp.get("jobId") or resp.get("id") or doc_verify_import_job_id(resp.get("data", {}))',
        '    if hasattr(resp, "json"):',
        '        try:',
        '            return doc_verify_import_job_id(resp.json())',
        '        except Exception:',
        '            pass',
        '    for name in ("job_id", "jobId", "id"):',
        '        value = getattr(resp, name, None)',
        '        if value:',
        '            return value',
        '    raise RuntimeError(f"Cannot derive bulk import job id from response type {type(resp).__name__}")',
        '',
        'def doc_verify_wait_import_complete(api_key, url, cluster_id, job_id):',
        '    deadline = time.time() + int(os.getenv("DOC_VERIFY_IMPORT_TIMEOUT", "600"))',
        '    last_resp = None',
        '    while time.time() < deadline:',
        '        last_resp = get_import_progress(api_key=api_key, url=url, cluster_id=cluster_id, job_id=job_id)',
        '        payload = last_resp.json()',
        '        data = payload.get("data", {})',
        '        state = str(data.get("state", "")).lower()',
        '        if state in ("completed", "complete", "finished", "succeeded", "success"):',
        '            return last_resp',
        '        if state == "failed":',
        '            raise RuntimeError(data.get("reason") or json.dumps(payload))',
        '        time.sleep(int(os.getenv("DOC_VERIFY_IMPORT_POLL_SECONDS", "5")))',
        '    raise TimeoutError(f"Bulk import job did not complete before timeout: {job_id}")',
        ...(needsStructArrayFixture ? pythonStructArrayFixtureHelpers() : []),
        ...shim.helpers,
        ...shim.setup,
        ...(needsStructArrayFixture ? [
            '',
            'doc_verify_prepare_struct_array_fixture(doc_verify_get_client())',
        ] : []),
        '',
        ...body,
    ].join('\n');

    const file = path.join(outDir, 'docs_scenario.py');
    fs.writeFileSync(file, sourceText);

    const result = verifyPythonScenario(file, opts);
    return {
        language: 'python',
        source,
        snippetCount: snippets.length,
        snippetIds: snippets.map(snippet => snippet.id),
        scenarioPath: file,
        shims: scenarioShimSummary(shim),
        ...result,
    };
}

function pythonStructArrayFixtureHelpers() {
    return [
        '',
        'def doc_verify_struct_vector(row, offset=0):',
        '    return [float(((row + offset + i) % 11) + 1) / 11.0 for i in range(5)]',
        '',
        'def doc_verify_struct_rows():',
        '    return [',
        '        {',
        '            "id": 1,',
        '            "doc_status": "active",',
        '            "chunks": [',
        '                {"text": "Red book introduction", "score": 0.95, "chunk_vector": doc_verify_struct_vector(0), "element_vector": doc_verify_struct_vector(1), "text_vector": doc_verify_struct_vector(2)},',
        '                {"text": "Blue book appendix", "score": 0.70, "chunk_vector": doc_verify_struct_vector(3), "element_vector": doc_verify_struct_vector(4), "text_vector": doc_verify_struct_vector(5)},',
        '            ],',
        '        },',
        '        {',
        '            "id": 2,',
        '            "doc_status": "active",',
        '            "chunks": [',
        '                {"text": "Red chapter with examples", "score": 0.88, "chunk_vector": doc_verify_struct_vector(6), "element_vector": doc_verify_struct_vector(7), "text_vector": doc_verify_struct_vector(8)},',
        '            ],',
        '        },',
        '        {',
        '            "id": 3,',
        '            "doc_status": "archived",',
        '            "chunks": [',
        '                {"text": "Archived reference", "score": 0.55, "chunk_vector": doc_verify_struct_vector(9), "element_vector": doc_verify_struct_vector(10), "text_vector": doc_verify_struct_vector(0)},',
        '            ],',
        '        },',
        '    ]',
        '',
        'def doc_verify_prepare_struct_array_fixture(client):',
        '    from pymilvus import DataType',
        '    try:',
        '        if client.has_collection(collection_name=DOC_VERIFY_COLLECTION_NAME):',
        '            return',
        '    except Exception:',
        '        pass',
        '    schema = client.create_schema()',
        '    schema.add_field(field_name="id", datatype=DataType.INT64, is_primary=True, auto_id=False)',
        '    schema.add_field(field_name="doc_status", datatype=DataType.VARCHAR, max_length=64)',
        '    struct_schema = client.create_struct_field_schema()',
        '    struct_schema.add_field("text", DataType.VARCHAR, max_length=65535)',
        '    struct_schema.add_field("score", DataType.FLOAT)',
        '    struct_schema.add_field("chunk_vector", DataType.FLOAT_VECTOR, dim=5)',
        '    struct_schema.add_field("element_vector", DataType.FLOAT_VECTOR, dim=5)',
        '    struct_schema.add_field("text_vector", DataType.FLOAT_VECTOR, dim=5)',
        '    schema.add_field("chunks", datatype=DataType.ARRAY, element_type=DataType.STRUCT, struct_schema=struct_schema, max_capacity=100)',
        '    client.create_collection(collection_name=DOC_VERIFY_COLLECTION_NAME, schema=schema)',
        '    client.insert(collection_name=DOC_VERIFY_COLLECTION_NAME, data=doc_verify_struct_rows())',
        '    index_params = client.prepare_index_params()',
        '    index_params.add_index(field_name="chunks[chunk_vector]", index_type="AUTOINDEX", metric_type="MAX_SIM_COSINE")',
        '    index_params.add_index(field_name="chunks[element_vector]", index_type="AUTOINDEX", metric_type="COSINE")',
        '    index_params.add_index(field_name="chunks[text_vector]", index_type="AUTOINDEX", metric_type="COSINE")',
        '    index_params.add_index(field_name="chunks[text]", index_type="INVERTED")',
        '    client.create_index(collection_name=DOC_VERIFY_COLLECTION_NAME, index_params=index_params)',
        '',
        'def doc_verify_load_collection(client):',
        '    try:',
        '        client.load_collection(collection_name=DOC_VERIFY_COLLECTION_NAME)',
        '    except Exception as exc:',
        '        if "loaded" not in str(exc).lower():',
        '            raise',
        '    time.sleep(int(os.getenv("DOC_VERIFY_LOAD_WAIT_SECONDS", "2")))',
    ];
}

function normalizePythonScenarioCode(code) {
    if (!/^\s*(>>>|\.\.\.)\s?/m.test(code)) return preservePythonEnvPlaceholders(code);
    const lines = [];
    for (const raw of code.split('\n')) {
        const prompt = raw.match(/^\s*(>>>|\.\.\.)\s?(.*)$/);
        if (prompt) {
            lines.push(prompt[2]);
        } else if (raw.trim()) {
            lines.push(`# doctest output: ${raw}`);
        } else {
            lines.push('');
        }
    }
    return preservePythonEnvPlaceholders(lines.join('\n'));
}

function preservePythonEnvPlaceholders(code) {
    return String(code || '')
        .replace(/^(\s*)SERVING_CLUSTER_ENDPOINT\s*=\s*["']https?:\/\/\{cluster-id\}[^"']*["']\s*$/gm, '$1SERVING_CLUSTER_ENDPOINT = SERVING_CLUSTER_ENDPOINT or os.getenv("ZILLIZ_CLUSTER_ENDPOINT") or os.getenv("DOC_VERIFY_SERVING_CLUSTER_ENDPOINT")')
        .replace(/^(\s*)TOKEN\s*=\s*["']YOUR_[^"']*["']\s*$/gm, '$1TOKEN = TOKEN or os.getenv("ZILLIZ_CLUSTER_CREDENTIAL") or os.getenv("ZILLIZ_API_KEY") or os.getenv("DOC_VERIFY_TOKEN") or os.getenv("DOC_VERIFY_ZILLIZ_API_KEY")');
}

function verifyPythonScenario(file, opts) {
    if (opts.extractOnly) return { status: 'extracted', detail: 'python scenario generated but not compiled' };
    const pythonCommand = resolveCommandPath(opts.pythonCommand);
    if (!commandAvailable(pythonCommand)) return { status: 'manual', detail: `${opts.pythonCommand} is not available` };
    const env = envWithPythonPath(opts);
    const result = runCommand(pythonCommand, ['-m', 'py_compile', file], { cwd: path.dirname(file), timeout: opts.timeout, env });
    if (result.status !== 0) return { status: 'failed', detail: 'python scenario compile failed', result };
    if (!opts.runScenarios) return { status: 'passed', detail: 'python scenario py_compile passed', result };
    const runtimeGate = scenarioRuntimeGate(opts, 'python');
    if (runtimeGate) return { status: 'passed', detail: 'python scenario py_compile passed', result, runtime: runtimeGate };
    const runResult = runCommand(pythonCommand, [file], { cwd: path.dirname(file), timeout: opts.timeout, env });
    return runResult.status === 0
        ? { status: 'passed', detail: 'python scenario run passed', result, runtime: { status: 'passed', detail: 'python scenario run passed', result: runResult } }
        : { status: 'failed', detail: 'python scenario run failed', result, runtime: { status: 'failed', detail: 'python scenario run failed', result: runResult } };
}

function buildGoScenario(snippets, opts) {
    if (snippets.length === 0) return null;
    const source = snippets[0].source;
    opts = withScenarioScope(opts, source, 'go');
    const outDir = path.join(opts.scenarioOutDir, 'go', scenarioIdBase(source, 'go-scenario'));
    fs.mkdirSync(outDir, { recursive: true });

    const shim = createScenarioShimContext('go', snippets, opts);
    const importSpecs = new Set(['"os"']);
    if (opts.runScenarios) importSpecs.add('"time"');
    for (const spec of shim.imports) importSpecs.add(spec);
    const body = [];
    for (const snippet of snippets) {
        const parts = splitGoPackageAndImports(snippet.code);
        for (const spec of goImportSpecs(parts.imports)) importSpecs.add(spec);
        body.push(`// Block ${snippet.index}: ${snippet.section}`);
        body.push(shim.normalizeSnippet(snippet, replaceScenarioResourceLiterals(parts.body, opts, 'go')));
        body.push('');
    }

    const goRuntimeHelpers = opts.runScenarios ? [
        '',
        'func docVerifyVector(row int) []float32 {',
        '    vector := make([]float32, 768)',
        '    for i := range vector {',
        '        vector[i] = float32((row + i) % 17) / 17.0',
        '    }',
        '    return vector',
        '}',
        '',
        'func docVerifyVectors() [][]float32 {',
        '    return [][]float32{docVerifyVector(0), docVerifyVector(1), docVerifyVector(2)}',
        '}',
        '',
        'func docVerifyInsertRows(ctx context.Context, cli *milvusclient.Client, collectionName string) {',
        '    _, err := cli.Insert(ctx, milvusclient.NewColumnBasedInsertOption(collectionName).',
        '        WithInt64Column("product_id", []int64{1, 2, 3}).',
        '        WithVarcharColumn("product_name", []string{"doc verify product 1", "doc verify product 2", "doc verify product 3"}).',
        '        WithFloatVectorColumn("embedding", 768, docVerifyVectors()))',
        '    if err != nil {',
        '        panic(err)',
        '    }',
        '    time.Sleep(5 * time.Second)',
        '}',
    ] : [];

    const sourceText = [
        'package main',
        '',
        renderGoImports(importSpecs),
        '',
        'var SERVING_CLUSTER_ENDPOINT = firstEnv("SERVING_CLUSTER_ENDPOINT", "ZILLIZ_CLUSTER_ENDPOINT", "DOC_VERIFY_SERVING_CLUSTER_ENDPOINT")',
        'var TOKEN = firstEnv("TOKEN", "ZILLIZ_CLUSTER_CREDENTIAL", "ZILLIZ_API_KEY", "DOC_VERIFY_TOKEN", "DOC_VERIFY_ZILLIZ_API_KEY")',
        'var CLOUD_PLATFORM_ENDPOINT = firstEnv("CLOUD_PLATFORM_ENDPOINT", "DOC_VERIFY_CLOUD_PLATFORM_ENDPOINT")',
        `var DOC_VERIFY_DATABASE_NAME = firstEnv("DOC_VERIFY_DATABASE_NAME")`,
        `var DOC_VERIFY_COLLECTION_NAME = firstEnv("DOC_VERIFY_COLLECTION_NAME")`,
        '',
        'func firstEnv(names ...string) string {',
        '    for _, name := range names {',
        '        if value := os.Getenv(name); value != "" {',
        '            return value',
        '        }',
        '    }',
        '    return ""',
        '}',
        '',
        `func init() {`,
        `    if DOC_VERIFY_DATABASE_NAME == "" {`,
        `        DOC_VERIFY_DATABASE_NAME = "${scenarioDatabaseName(opts)}"`,
        `    }`,
        `    if DOC_VERIFY_COLLECTION_NAME == "" {`,
        `        DOC_VERIFY_COLLECTION_NAME = "${scenarioCollectionName(opts)}"`,
        `    }`,
        `}`,
        ...goRuntimeHelpers,
        '',
        'func main() {',
        indentNonEmpty(shim.setup.join('\n'), '    '),
        indentNonEmpty(body.join('\n'), '    '),
        '}',
        '',
    ].filter(Boolean).join('\n');

    const file = path.join(outDir, 'DocsScenario.go');
    fs.writeFileSync(file, sourceText);
    prepareGoScenarioModule(outDir, opts);

    const result = verifyGoScenario(file, opts);
    return {
        language: 'go',
        source,
        snippetCount: snippets.length,
        snippetIds: snippets.map(snippet => snippet.id),
        scenarioPath: file,
        shims: scenarioShimSummary(shim),
        goModuleDir: opts.goModuleDir ? path.resolve(opts.goModuleDir) : null,
        ...result,
    };
}

function splitGoPackageAndImports(code) {
    let rest = String(code || '').trim();
    const pkg = rest.match(/^package\s+\w+\s*/);
    if (pkg) rest = rest.slice(pkg[0].length).trimStart();
    const { imports, body } = splitGoImports(rest);
    return { imports, body };
}

function goImportSpecs(imports) {
    const specs = [];
    let rest = String(imports || '').trim();
    while (rest) {
        const block = rest.match(/^import\s*\(([\s\S]*?)\)\s*/);
        if (block) {
            specs.push(...block[1].split('\n').map(line => line.trim()).filter(Boolean));
            rest = rest.slice(block[0].length).trimStart();
            continue;
        }
        const single = rest.match(/^import\s+(.+?)\s*$/m);
        if (single) specs.push(single[1].trim());
        break;
    }
    return specs.filter(spec => spec && !spec.startsWith('//'));
}

function renderGoImports(specs) {
    const sorted = dedupeGoImportSpecs(specs).sort();
    if (sorted.length === 0) return '';
    return ['import (', ...sorted.map(spec => `    ${spec}`), ')'].join('\n');
}

function dedupeGoImportSpecs(specs) {
    const byPath = new Map();
    for (const spec of specs) {
        const text = String(spec || '').trim();
        const pathMatch = text.match(/"([^"]+)"/);
        const importPath = pathMatch ? pathMatch[1] : text;
        const existing = byPath.get(importPath);
        if (!existing || /^\w+\s+"/.test(text)) byPath.set(importPath, text);
    }
    return Array.from(byPath.values());
}

function goModuleRequireVersion(moduleName) {
    const major = String(moduleName || '').match(/\/v([2-9]\d*)$/);
    return major ? `v${major[1]}.0.0` : 'v0.0.0';
}

function prepareGoScenarioModule(outDir, opts) {
    if (!opts.goModuleDir) return;
    let moduleDir = path.resolve(opts.goModuleDir);
    const scenarioFile = path.join(outDir, 'DocsScenario.go');
    const scenarioText = fs.existsSync(scenarioFile) ? fs.readFileSync(scenarioFile, 'utf8') : '';
    const nestedClientDir = path.join(moduleDir, 'client');
    if (/github\.com\/milvus-io\/milvus\/client\/v2\/milvusclient/.test(scenarioText) && fs.existsSync(path.join(nestedClientDir, 'go.mod'))) {
        moduleDir = nestedClientDir;
    }
    const goMod = path.join(moduleDir, 'go.mod');
    if (!fs.existsSync(goMod)) return;

    const text = fs.readFileSync(goMod, 'utf8');
    const moduleMatch = text.match(/^\s*module\s+(\S+)/m);
    const moduleName = moduleMatch ? moduleMatch[1] : '';
    const goVersionMatch = text.match(/^\s*go\s+(\S+)/m);
    const goVersion = goVersionMatch ? goVersionMatch[1] : '1.22';
    const replaceLines = [];
    if (moduleName) replaceLines.push(`replace ${moduleName} => ${moduleDir}`);
    const repoRoot = path.resolve(opts.goModuleDir);
    const localPkgDir = path.join(repoRoot, 'pkg');
    if (fs.existsSync(path.join(localPkgDir, 'go.mod'))) {
        const pkgText = fs.readFileSync(path.join(localPkgDir, 'go.mod'), 'utf8');
        const pkgModuleMatch = pkgText.match(/^\s*module\s+(\S+)/m);
        if (pkgModuleMatch) replaceLines.push(`replace ${pkgModuleMatch[1]} => ${localPkgDir}`);
    }
    const generated = [
        'module docsverify',
        '',
        `go ${goVersion}`,
        '',
        moduleName ? `require ${moduleName} ${goModuleRequireVersion(moduleName)}` : '',
        ...replaceLines,
        '',
    ].filter(Boolean).join('\n');
    fs.writeFileSync(path.join(outDir, 'go.mod'), generated);
}

function verifyGoScenario(file, opts) {
    if (opts.extractOnly) return { status: 'extracted', detail: 'go scenario generated but not checked' };
    if (!commandExists('gofmt')) return { status: 'manual', detail: 'gofmt is not available' };
    const cwd = path.dirname(file);
    let result = runCommand('gofmt', ['-w', file], { cwd, timeout: opts.timeout });
    if (result.status !== 0) return { status: 'failed', detail: 'go scenario syntax failed', result };

    if (!opts.goModuleDir) {
        const runtimeGate = opts.runScenarios
            ? { status: 'manual', detail: 'go scenario runtime requires DOC_VERIFY_GO_MODULE_DIR or --go-module-dir' }
            : null;
        return { status: 'passed', detail: 'go scenario syntax passed (gofmt only; set DOC_VERIFY_GO_MODULE_DIR for type-check)', result, ...(runtimeGate ? { runtime: runtimeGate } : {}) };
    }
    if (!fs.existsSync(path.join(cwd, 'go.mod'))) {
        return { status: 'manual', detail: `Go module dir is missing go.mod: ${opts.goModuleDir}`, result };
    }
    if (!commandExists('go')) return { status: 'manual', detail: 'go is not available', result };

    result = runCommand('go', ['mod', 'tidy'], { cwd, timeout: opts.timeout });
    if (result.status !== 0) {
        return { status: 'manual', detail: 'go scenario module dependencies could not be resolved with go mod tidy', result };
    }

    result = runCommand('go', ['test', '.'], { cwd, timeout: opts.timeout });
    if (result.status === 0) {
        if (!opts.runScenarios) return { status: 'passed', detail: 'go scenario go test passed', result };
        const runtimeGate = scenarioRuntimeGate(opts, 'go');
        if (runtimeGate) return { status: 'passed', detail: 'go scenario go test passed', result, runtime: runtimeGate };
        const runResult = runCommand('go', ['run', '.'], { cwd, timeout: opts.timeout });
        return runResult.status === 0
            ? { status: 'passed', detail: 'go scenario run passed', result, runtime: { status: 'passed', detail: 'go scenario run passed', result: runResult } }
            : { status: 'failed', detail: 'go scenario run failed', result, runtime: { status: 'failed', detail: 'go scenario run failed', result: runResult } };
    }
    if (looksLikeGoManualFailure(result.stderr) || looksLikeGoManualFailure(result.stdout)) {
        return { status: 'manual', detail: 'go scenario generated but dependencies, shared setup symbols, or Go toolchain are unresolved; set DOC_VERIFY_GO_MODULE_DIR and a matching Go toolchain for module-aware compile', result };
    }
    return { status: 'failed', detail: 'go scenario go test failed', result };
}

function looksLikeGoManualFailure(text) {
    return /no required module provides package|package .* is not in std|cannot find package|undefined:|declared and not used|imported and not used|missing go\.sum entry|go: updates to go\.mod needed|go: downloading go\d|toolchain|requires go >=|no new variables on left side|has no field or method|cannot use .* as .* value|not enough arguments|too many arguments/i.test(String(text || ''));
}

function buildJavaScenario(snippets, opts) {
    if (snippets.length === 0) return null;
    const source = snippets[0].source;
    opts = withScenarioScope(opts, source, 'java');
    const idBase = scenarioIdBase(source, 'java-scenario');
    const outDir = path.join(opts.scenarioOutDir, 'java', idBase);
    fs.mkdirSync(outDir, { recursive: true });

    const shim = createScenarioShimContext('java', snippets, opts);
    const imports = new Set(['import java.util.*;']);
    for (const line of shim.imports) imports.add(line);
    if (opts.runScenarios) {
        imports.add('import com.google.gson.JsonArray;');
        imports.add('import com.google.gson.JsonObject;');
        imports.add('import io.milvus.v2.service.vector.request.InsertReq;');
    }
    const body = [];
    for (const snippet of snippets) {
        const parts = splitJavaImports(snippet.code);
        for (const line of parts.imports.split('\n').filter(Boolean)) imports.add(line);
        body.push(`// Block ${snippet.index}: ${snippet.section}`);
        body.push(shim.normalizeSnippet(snippet, replaceScenarioResourceLiterals(parts.body, opts, 'java')));
        body.push('');
    }
    addInferredJavaImports(imports, body.join('\n'), opts);

    const javaRuntimeHelpers = opts.runScenarios ? [
        '    private static List<Float> docVerifyVector(int row) {',
        '        List<Float> vector = new ArrayList<>();',
        '        for (int i = 0; i < 768; i++) {',
        '            vector.add((float) ((row + i) % 17) / 17.0f);',
        '        }',
        '        return vector;',
        '    }',
        '',
        '    private static void docVerifyInsertRows(MilvusClientV2 client, String databaseName, String collectionName) throws Exception {',
        '        List<JsonObject> rows = new ArrayList<>();',
        '        for (int row = 0; row < 3; row++) {',
        '            JsonObject item = new JsonObject();',
        '            item.addProperty("product_id", row + 1);',
        '            item.addProperty("product_name", "doc verify product " + (row + 1));',
        '            JsonArray embedding = new JsonArray();',
        '            for (Float value : docVerifyVector(row)) {',
        '                embedding.add(value);',
        '            }',
        '            item.add("embedding", embedding);',
        '            rows.add(item);',
        '        }',
        '        client.insert(InsertReq.builder()',
        '            .databaseName(databaseName)',
        '            .collectionName(collectionName)',
        '            .data(rows)',
        '            .build());',
        '        Thread.sleep(5000L);',
        '    }',
        '',
    ] : [];

    const sourceText = [
        ...Array.from(imports).sort(),
        '',
        'public class DocsScenario {',
        ...javaRuntimeHelpers,
        '    public static void main(String[] args) throws Exception {',
        '        String SERVING_CLUSTER_ENDPOINT = System.getenv().getOrDefault("SERVING_CLUSTER_ENDPOINT", System.getenv().getOrDefault("ZILLIZ_CLUSTER_ENDPOINT", System.getenv("DOC_VERIFY_SERVING_CLUSTER_ENDPOINT")));',
        '        String TOKEN = System.getenv().getOrDefault("TOKEN", System.getenv().getOrDefault("ZILLIZ_CLUSTER_CREDENTIAL", System.getenv().getOrDefault("ZILLIZ_API_KEY", System.getenv().getOrDefault("DOC_VERIFY_TOKEN", System.getenv("DOC_VERIFY_ZILLIZ_API_KEY")))));',
        '        String CLOUD_PLATFORM_ENDPOINT = System.getenv().getOrDefault("CLOUD_PLATFORM_ENDPOINT", System.getenv("DOC_VERIFY_CLOUD_PLATFORM_ENDPOINT"));',
        `        String DOC_VERIFY_DATABASE_NAME = System.getenv().getOrDefault("DOC_VERIFY_DATABASE_NAME", "${scenarioDatabaseName(opts)}");`,
        `        String DOC_VERIFY_COLLECTION_NAME = System.getenv().getOrDefault("DOC_VERIFY_COLLECTION_NAME", "${scenarioCollectionName(opts)}");`,
        ...shim.setup,
        indentNonEmpty(body.join('\n'), '        '),
        '    }',
        '}',
        '',
    ].join('\n');

    const file = path.join(outDir, 'DocsScenario.java');
    fs.writeFileSync(file, sourceText);

    const result = verifyJavaScenario(file, opts);
    return {
        language: 'java',
        source,
        snippetCount: snippets.length,
        snippetIds: snippets.map(snippet => snippet.id),
        scenarioPath: file,
        shims: scenarioShimSummary(shim),
        classpathProvided: Boolean(opts.javaClasspath),
        classpathSource: opts.javaClasspathSource || null,
        classpathError: opts.javaClasspathError || null,
        ...result,
    };
}

function verifyJavaScenario(file, opts) {
    if (opts.extractOnly) return { status: 'extracted', detail: 'java scenario generated but not compiled' };
    if (!commandExists('javac')) return { status: 'manual', detail: 'javac is not available' };
    const args = opts.javaClasspath ? ['-cp', opts.javaClasspath, file] : [file];
    const result = runCommand('javac', args, { cwd: path.dirname(file), timeout: opts.timeout });
    if (result.status === 0) {
        if (!opts.runScenarios) return { status: 'passed', detail: 'java scenario compiled', result };
        const runtimeGate = scenarioRuntimeGate(opts, 'java');
        if (runtimeGate) return { status: 'passed', detail: 'java scenario compiled', result, runtime: runtimeGate };
        const cwd = path.dirname(file);
        const classpath = opts.javaClasspath ? [cwd, opts.javaClasspath].join(path.delimiter) : cwd;
        const runResult = runCommand('java', ['-cp', classpath, 'DocsScenario'], { cwd, timeout: opts.timeout });
        return runResult.status === 0
            ? { status: 'passed', detail: 'java scenario run passed', result, runtime: { status: 'passed', detail: 'java scenario run passed', result: runResult } }
            : { status: 'failed', detail: 'java scenario run failed', result, runtime: { status: 'failed', detail: 'java scenario run failed', result: runResult } };
    }
    if (looksLikeJavaDependencyFailure(result.stderr)) {
        return {
            status: 'manual',
            detail: 'java scenario generated but dependencies or shared setup symbols are unresolved; set DOC_VERIFY_JAVA_CLASSPATH or DOC_VERIFY_JAVA_SDK_REPO for full compile',
            result,
        };
    }
    return { status: 'failed', detail: 'java scenario compile failed', result };
}

function buildJavaScriptScenario(snippets, opts) {
    if (snippets.length === 0) return null;
    const source = snippets[0].source;
    opts = withScenarioScope(opts, source, 'javascript');
    const outDir = path.join(opts.scenarioOutDir, 'javascript', scenarioIdBase(source, 'javascript-scenario'));
    fs.mkdirSync(outDir, { recursive: true });

    const shim = createScenarioShimContext('javascript', snippets, opts);
    const imports = new Set();
    const globalDeclarations = new Set();
    const body = [];
    for (const snippet of snippets) {
        const normalized = shim.normalizeSnippet(
            snippet,
            replaceScenarioResourceLiterals(normalizeJavaScriptScenarioCode(snippet.code), opts, 'javascript')
        );
        const parts = splitJavaScriptImports(normalized);
        for (const line of parts.imports) imports.add(line);
        const declarations = declaredJavaScriptNames(parts.body);
        const scoped = declarations.some(name => globalDeclarations.has(name));
        body.push(`// Block ${snippet.index}: ${snippet.section}`);
        if (scoped) {
            body.push('{');
            body.push(indentNonEmpty(parts.body, '  '));
            body.push('}');
        } else {
            body.push(parts.body);
            for (const name of declarations) globalDeclarations.add(name);
        }
        body.push('');
    }

    const sourceText = [
        ...Array.from(imports).sort(),
        '',
        'globalThis.SERVING_CLUSTER_ENDPOINT = process.env.SERVING_CLUSTER_ENDPOINT || process.env.ZILLIZ_CLUSTER_ENDPOINT || process.env.DOC_VERIFY_SERVING_CLUSTER_ENDPOINT || "";',
        'globalThis.TOKEN = process.env.TOKEN || process.env.ZILLIZ_CLUSTER_CREDENTIAL || process.env.ZILLIZ_API_KEY || process.env.DOC_VERIFY_TOKEN || process.env.DOC_VERIFY_ZILLIZ_API_KEY || "";',
        'globalThis.CLOUD_PLATFORM_ENDPOINT = process.env.CLOUD_PLATFORM_ENDPOINT || process.env.DOC_VERIFY_CLOUD_PLATFORM_ENDPOINT || "";',
        `globalThis.DOC_VERIFY_DATABASE_NAME = process.env.DOC_VERIFY_DATABASE_NAME || "${scenarioDatabaseName(opts)}";`,
        `globalThis.DOC_VERIFY_COLLECTION_NAME = process.env.DOC_VERIFY_COLLECTION_NAME || "${scenarioCollectionName(opts)}";`,
        '',
        ...shim.header,
        '',
        ...body,
    ].join('\n');

    const file = path.join(outDir, javascriptScenarioUsesModuleSyntax(sourceText) ? 'docs_scenario.mjs' : 'docs_scenario.js');
    fs.writeFileSync(file, sourceText);

    const result = verifyJavaScriptScenarioProgram(file, opts);
    return {
        language: 'javascript',
        source,
        snippetCount: snippets.length,
        snippetIds: snippets.map(snippet => snippet.id),
        scenarioPath: file,
        shims: scenarioShimSummary(shim),
        nodeSdkRepo: opts.nodeSdkRepo ? path.resolve(opts.nodeSdkRepo) : null,
        ...result,
    };
}

function normalizeJavaScriptScenarioCode(code) {
    return String(code || '')
        .replace(/^#!.*\n/, '');
}

function splitJavaScriptImports(code) {
    const imports = [];
    const body = [];
    for (const line of String(code || '').split('\n')) {
        if (/^\s*import\s+/.test(line)) imports.push(line.trim().replace(/;?$/, ';'));
        else body.push(line);
    }
    return { imports, body: body.join('\n').trim() };
}

function declaredJavaScriptNames(code) {
    const stripped = stripJavaScriptCommentsAndStrings(code);
    const names = [];
    const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
    let match;
    while ((match = re.exec(stripped)) !== null) names.push(match[1]);
    return names;
}

function javascriptScenarioUsesModuleSyntax(code) {
    const stripped = stripJavaScriptCommentsAndStrings(code);
    return /^\s*import\s.+?from\s+['"][^'"]+['"];?\s*$/m.test(code) ||
        /^\s*import\s+['"][^'"]+['"];?\s*$/m.test(code) ||
        /^\s*export\s+/m.test(code) ||
        /\bawait\b/.test(stripped);
}

function stripJavaScriptCommentsAndStrings(code) {
    return String(code || '')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/.*$/gm, ' ')
        .replace(/`(?:\\.|[^`\\])*`/g, '``')
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

function verifyJavaScriptScenarioProgram(file, opts) {
    if (opts.extractOnly) return { status: 'extracted', detail: 'javascript scenario generated but not checked' };
    if (!commandExists('node')) return { status: 'manual', detail: 'node is not available' };
    const cwd = path.dirname(file);
    const result = runCommand('node', ['--check', file], { cwd, timeout: opts.timeout });
    if (result.status !== 0) return { status: 'failed', detail: 'javascript scenario node --check failed', result };
    if (!opts.runScenarios) return { status: 'passed', detail: 'javascript scenario node --check passed', result };
    const runtimeGate = scenarioRuntimeGate(opts, 'javascript');
    if (runtimeGate) return { status: 'passed', detail: 'javascript scenario node --check passed', result, runtime: runtimeGate };
    const resolver = prepareNodeSdkResolver(path.dirname(file), opts, file);
    if (resolver.status === 'manual') {
        return { status: 'passed', detail: 'javascript scenario node --check passed', result, runtime: resolver };
    }
    const runResult = runCommand('node', [file], { cwd, timeout: opts.timeout });
    return runResult.status === 0
        ? { status: 'passed', detail: 'javascript scenario run passed', result, runtime: { status: 'passed', detail: 'javascript scenario run passed', result: runResult } }
        : { status: 'failed', detail: 'javascript scenario run failed', result, runtime: { status: 'failed', detail: 'javascript scenario run failed', result: runResult } };
}

function prepareNodeSdkResolver(cwd, opts, file) {
    const sourceText = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (!/@zilliz\/milvus2-sdk-node|\bmilvusClient\b|\bMilvusClient\b/.test(sourceText)) {
        return { status: 'passed', detail: 'javascript scenario does not require local Milvus Node SDK resolution' };
    }

    const resolved = runCommand('node', ['-e', 'require.resolve("@zilliz/milvus2-sdk-node")'], { cwd, timeout: opts.timeout });
    if (resolved.status === 0) {
        return { status: 'passed', detail: 'javascript Milvus Node SDK resolved from scenario directory' };
    }

    if (!opts.nodeSdkRepo) {
        return {
            status: 'manual',
            detail: 'javascript scenario runtime requires @zilliz/milvus2-sdk-node; set DOC_VERIFY_NODE_SDK_REPO or --node-sdk-repo',
        };
    }

    const repo = path.resolve(opts.nodeSdkRepo);
    const packageJson = path.join(repo, 'package.json');
    const distDir = path.join(repo, 'dist');
    if (!fs.existsSync(packageJson)) {
        return { status: 'manual', detail: `Node SDK repo is missing package.json: ${repo}` };
    }
    if (!fs.existsSync(distDir)) {
        const build = buildNodeSdkRepo(repo, opts);
        if (build.status !== 'passed') {
            return {
                status: 'manual',
                detail: `Node SDK repo build did not produce ${repo}/dist; Node runtime cannot import @zilliz/milvus2-sdk-node`,
                nodeSdkBuild: build,
            };
        }
    }

    const scopedDir = path.join(cwd, 'node_modules', '@zilliz');
    const linkPath = path.join(scopedDir, 'milvus2-sdk-node');
    fs.mkdirSync(scopedDir, { recursive: true });
    try {
        if (fs.existsSync(linkPath) || fs.lstatSync(linkPath).isSymbolicLink()) fs.rmSync(linkPath, { recursive: true, force: true });
    } catch {
        // lstatSync throws when the link does not exist; mkdir above is enough in that case.
    }
    fs.symlinkSync(repo, linkPath, 'dir');
    return { status: 'passed', detail: `javascript Milvus Node SDK linked from ${repo}` };
}

function buildNodeSdkRepo(repo, opts) {
    const record = {
        repo,
        status: 'manual',
        detail: '',
        install: null,
        build: null,
    };
    const distDir = path.join(repo, 'dist');
    if (fs.existsSync(distDir)) {
        record.status = 'passed';
        record.detail = 'Node SDK dist already exists';
        opts.nodeSdkBuilds.push(record);
        return record;
    }

    const packageJson = path.join(repo, 'package.json');
    if (!fs.existsSync(packageJson)) {
        record.detail = `Node SDK repo is missing package.json: ${repo}`;
        opts.nodeSdkBuilds.push(record);
        return record;
    }

    const hasNodeModules = fs.existsSync(path.join(repo, 'node_modules'));
    const hasYarn = commandExists('yarn');
    const hasNpm = commandExists('npm');
    const hasYarnLock = fs.existsSync(path.join(repo, 'yarn.lock'));
    const hasPackageLock = fs.existsSync(path.join(repo, 'package-lock.json'));

    if (!hasNodeModules) {
        if (hasYarn && hasYarnLock) {
            record.install = runCommand('yarn', ['install', '--frozen-lockfile'], { cwd: repo, timeout: opts.timeout });
        } else if (hasNpm && hasPackageLock) {
            record.install = runCommand('npm', ['ci'], { cwd: repo, timeout: opts.timeout });
        } else if (hasNpm) {
            record.install = runCommand('npm', ['install'], { cwd: repo, timeout: opts.timeout });
        } else {
            record.detail = 'Node SDK dependencies are missing and neither yarn nor npm is available';
            opts.nodeSdkBuilds.push(record);
            return record;
        }
        if (record.install.status !== 0) {
            record.status = 'failed';
            record.detail = 'Node SDK dependency install failed';
            opts.nodeSdkBuilds.push(record);
            return record;
        }
    }

    if (hasYarn) {
        record.build = runCommand('yarn', ['build'], { cwd: repo, timeout: opts.timeout });
    } else if (hasNpm) {
        record.build = runCommand('npm', ['run', 'build'], { cwd: repo, timeout: opts.timeout });
    } else {
        record.detail = 'Node SDK dist is missing and neither yarn nor npm is available';
        opts.nodeSdkBuilds.push(record);
        return record;
    }

    if (record.build.status !== 0) {
        record.status = 'failed';
        record.detail = 'Node SDK build failed';
        opts.nodeSdkBuilds.push(record);
        return record;
    }

    if (!fs.existsSync(distDir)) {
        record.status = 'failed';
        record.detail = 'Node SDK build completed but dist/ is still missing';
        opts.nodeSdkBuilds.push(record);
        return record;
    }

    record.status = 'passed';
    record.detail = 'Node SDK build produced dist/';
    opts.nodeSdkBuilds.push(record);
    return record;
}

function buildBashScenario(snippets, opts) {
    if (snippets.length === 0) return null;
    const source = snippets[0].source;
    opts = withScenarioScope(opts, source, 'bash');
    const outDir = path.join(opts.scenarioOutDir, 'bash', scenarioIdBase(source, 'bash-scenario'));
    fs.mkdirSync(outDir, { recursive: true });

    const shim = createScenarioShimContext('bash', snippets, opts);
    const needsStructArrayFixture = opts.runScenarios && scenarioUsesStructArrayFixture(snippets);
    const body = [];
    let insertedStructArrayLoad = false;
    for (const snippet of snippets) {
        if (needsStructArrayFixture && !insertedStructArrayLoad && /\/entities\/search\b|vector search/i.test(snippet.code || '')) {
            body.push('doc_verify_load_struct_array_collection');
            insertedStructArrayLoad = true;
        }
        body.push(`# Block ${snippet.index}: ${snippet.section}`);
        body.push(shim.normalizeSnippet(
            snippet,
            replaceScenarioResourceLiterals(normalizeBashScenarioCode(snippet.code), opts, 'bash')
        ));
        body.push('');
    }

    const sourceText = [
        '#!/usr/bin/env bash',
        'set -e',
        'SERVING_CLUSTER_ENDPOINT="${SERVING_CLUSTER_ENDPOINT:-${ZILLIZ_CLUSTER_ENDPOINT:-${DOC_VERIFY_SERVING_CLUSTER_ENDPOINT:-}}}"',
        'TOKEN="${TOKEN:-${ZILLIZ_CLUSTER_CREDENTIAL:-${ZILLIZ_API_KEY:-${DOC_VERIFY_TOKEN:-${DOC_VERIFY_ZILLIZ_API_KEY:-}}}}}"',
        'CLOUD_PLATFORM_ENDPOINT="${CLOUD_PLATFORM_ENDPOINT:-${DOC_VERIFY_CLOUD_PLATFORM_ENDPOINT:-}}"',
        `DOC_VERIFY_DATABASE_NAME="\${DOC_VERIFY_DATABASE_NAME:-${scenarioDatabaseName(opts)}}"`,
        `DOC_VERIFY_COLLECTION_NAME="\${DOC_VERIFY_COLLECTION_NAME:-${scenarioCollectionName(opts)}}"`,
        'export SERVING_CLUSTER_ENDPOINT TOKEN CLOUD_PLATFORM_ENDPOINT DOC_VERIFY_DATABASE_NAME DOC_VERIFY_COLLECTION_NAME',
        ...(needsStructArrayFixture ? bashStructArrayFixtureHelpers() : []),
        ...(needsStructArrayFixture ? [
            '',
            'doc_verify_prepare_struct_array_collection',
        ] : []),
        '',
        ...body,
    ].join('\n');

    const file = path.join(outDir, 'docs_scenario.sh');
    fs.writeFileSync(file, sourceText, { mode: 0o700 });

    const result = verifyBashScenarioProgram(file, opts);
    return {
        language: 'bash',
        source,
        snippetCount: snippets.length,
        snippetIds: snippets.map(snippet => snippet.id),
        scenarioPath: file,
        shims: scenarioShimSummary(shim),
        ...result,
    };
}

function bashStructArrayFixtureHelpers() {
    return [
        '',
        'doc_verify_rest_auth_args=()',
        'if [[ -n "${TOKEN:-}" ]]; then',
        '  doc_verify_rest_auth_args=(-H "Authorization: Bearer ${TOKEN}")',
        'fi',
        '',
        'doc_verify_struct_vector_json() {',
        '  local row="${1:-0}"',
        '  local out="["',
        '  local i value',
        '  for i in 0 1 2 3 4; do',
        '    value=$(awk -v row="$row" -v i="$i" \'BEGIN { printf "%.6f", (((row + i) % 11) + 1) / 11 }\')',
        '    if [[ "$i" != "0" ]]; then out+=","; fi',
        '    out+="$value"',
        '  done',
        '  out+="]"',
        '  printf "%s" "$out"',
        '}',
        '',
        'doc_verify_prepare_struct_array_collection() {',
        '  curl -fsS -X POST "${SERVING_CLUSTER_ENDPOINT}/v2/vectordb/collections/create" \\',
        '    -H "Content-Type: application/json" "${doc_verify_rest_auth_args[@]}" \\',
        '    -d "$(cat <<JSON',
        '{',
        '  "collectionName": "${DOC_VERIFY_COLLECTION_NAME}",',
        '  "schema": {',
        '    "autoID": false,',
        '    "fields": [',
        '      {"fieldName": "id", "dataType": "Int64", "isPrimary": true},',
        '      {"fieldName": "doc_status", "dataType": "VarChar", "elementTypeParams": {"max_length": "64"}},',
        '      {"fieldName": "chunks", "dataType": "Array", "elementDataType": "Struct", "maxCapacity": 100, "fields": [',
        '        {"fieldName": "text", "dataType": "VarChar", "elementTypeParams": {"max_length": "65535"}},',
        '        {"fieldName": "score", "dataType": "Float"},',
        '        {"fieldName": "chunk_vector", "dataType": "FloatVector", "elementTypeParams": {"dim": "5"}},',
        '        {"fieldName": "element_vector", "dataType": "FloatVector", "elementTypeParams": {"dim": "5"}},',
        '        {"fieldName": "text_vector", "dataType": "FloatVector", "elementTypeParams": {"dim": "5"}}',
        '      ]}',
        '    ]',
        '  }',
        '}',
        'JSON',
        ')" || true',
        '  local v0 v1 v2 v3',
        '  v0="$(doc_verify_struct_vector_json 0)"',
        '  v1="$(doc_verify_struct_vector_json 1)"',
        '  v2="$(doc_verify_struct_vector_json 2)"',
        '  v3="$(doc_verify_struct_vector_json 3)"',
        '  curl -fsS -X POST "${SERVING_CLUSTER_ENDPOINT}/v2/vectordb/entities/insert" \\',
        '    -H "Content-Type: application/json" "${doc_verify_rest_auth_args[@]}" \\',
        '    -d "$(cat <<JSON',
        '{',
        '  "collectionName": "${DOC_VERIFY_COLLECTION_NAME}",',
        '  "data": [',
        '    {"id": 1, "doc_status": "active", "chunks": [{"text": "Red book introduction", "score": 0.95, "chunk_vector": ${v0}, "element_vector": ${v1}, "text_vector": ${v2}}]},',
        '    {"id": 2, "doc_status": "active", "chunks": [{"text": "Red chapter with examples", "score": 0.88, "chunk_vector": ${v1}, "element_vector": ${v2}, "text_vector": ${v3}}]},',
        '    {"id": 3, "doc_status": "archived", "chunks": [{"text": "Archived reference", "score": 0.55, "chunk_vector": ${v2}, "element_vector": ${v3}, "text_vector": ${v0}}]}',
        '  ]',
        '}',
        'JSON',
        ')" || true',
        '}',
        '',
        'doc_verify_load_struct_array_collection() {',
        '  curl -fsS -X POST "${SERVING_CLUSTER_ENDPOINT}/v2/vectordb/collections/load" \\',
        '    -H "Content-Type: application/json" "${doc_verify_rest_auth_args[@]}" \\',
        '    -d "{\\"collectionName\\": \\"${DOC_VERIFY_COLLECTION_NAME}\\"}" || true',
        '  sleep "${DOC_VERIFY_LOAD_WAIT_SECONDS:-2}"',
        '}',
    ];
}

function scenarioShimSummary(shim) {
    if (!shim || !shim.names || shim.names.length === 0) return [];
    return shim.names.map(name => ({
        name,
        notes: (shim.notes || []).filter(Boolean),
    }));
}

function normalizeBashScenarioCode(code) {
    return String(code || '')
        .replace(/^#!.*\n/, '');
}

function verifyBashScenarioProgram(file, opts) {
    if (opts.extractOnly) return { status: 'extracted', detail: 'bash scenario generated but not checked' };
    if (!commandExists('bash')) return { status: 'manual', detail: 'bash is not available' };
    const cwd = path.dirname(file);
    const result = runCommand('bash', ['-n', file], { cwd, timeout: opts.timeout });
    if (result.status !== 0) return { status: 'failed', detail: 'bash scenario bash -n failed', result };
    if (!opts.runScenarios) return { status: 'passed', detail: 'bash scenario bash -n passed', result };
    const runtimeGate = scenarioRuntimeGate(opts, 'bash');
    if (runtimeGate) return { status: 'passed', detail: 'bash scenario bash -n passed', result, runtime: runtimeGate };
    const runResult = runCommand('bash', [file], { cwd, timeout: opts.timeout });
    return runResult.status === 0
        ? { status: 'passed', detail: 'bash scenario run passed', result, runtime: { status: 'passed', detail: 'bash scenario run passed', result: runResult } }
        : { status: 'failed', detail: 'bash scenario run failed', result, runtime: { status: 'failed', detail: 'bash scenario run failed', result: runResult } };
}

function applyScenarioCoverage(results, scenarioResults) {
    const bySnippetId = new Map();
    for (const scenario of scenarioResults) {
        if (scenario.status !== 'passed') continue;
        for (const id of scenario.snippetIds || []) {
            bySnippetId.set(id, {
                status: 'passed',
                detail: scenario.detail,
                scenarioPath: scenario.scenarioPath,
                scenarioLanguage: scenario.language,
            });
        }
    }

    for (const result of results) {
        if (bySnippetId.has(result.id)) result.scenarioCoverage = bySnippetId.get(result.id);
    }
    return results;
}

function firstSetEnv(group) {
    return group.find(name => process.env[name]);
}

function liveEnvMissing(opts) {
    const profile = LIVE_PROFILES[opts.liveProfile] || LIVE_PROFILES.zilliz;
    return profile.requiredEnvGroups
        .map(group => ({ anyOf: group, satisfiedBy: firstSetEnv(group) || null }))
        .filter(item => !item.satisfiedBy);
}

function buildLiveVerificationPlan(results, opts) {
    const profile = LIVE_PROFILES[opts.liveProfile] || LIVE_PROFILES.zilliz;
    const candidates = results.filter(r =>
        (r.classification.safetyFlags || []).length > 0 ||
        ['run', 'live'].includes(String(r.annotations?.mode || '').toLowerCase())
    );
    const required = profile.requiredEnvGroups.map(group => ({
        anyOf: group,
        satisfiedBy: firstSetEnv(group) || null,
    }));
    const optional = profile.optionalEnvGroups.map(group => ({
        anyOf: group,
        satisfiedBy: firstSetEnv(group) || null,
    }));
    const missingRequired = liveEnvMissing(opts);

    return {
        profile: opts.liveProfile,
        description: profile.description,
        candidateBlocks: candidates.length,
        requiredEnv: required,
        optionalEnv: optional,
        missingRequiredEnv: missingRequired,
        ready: missingRequired.length === 0,
        requested: opts.requestLive,
        enabledThisRun: opts.live && opts.allowRun,
        note: candidates.length === 0
            ? 'No live/runtime candidates were detected.'
            : 'Runtime verification still requires in-block doc-verify: run or doc-verify: live annotations plus --live and --allow-run.',
        suggestedFlags: ['--live', '--allow-run', `--live-profile ${opts.liveProfile}`],
    };
}

function runMantaRuntimeVerification(opts, sources, scenarioResults) {
    if (!opts.manta) return null;
    const state = {
        status: 'manual',
        detail: '',
        startedAt: new Date().toISOString(),
        workspace: opts.mantaWorkspace,
        endpoint: opts.mantaEndpoint || '',
        resource: null,
        createJob: null,
        verifyJob: null,
        artifacts: [],
    };

    if (!commandExists('manta-client')) {
        state.detail = 'manta-client is not available';
        return state;
    }
    if (!opts.live || !opts.allowRun || !opts.runScenarios) {
        state.detail = 'Manta runtime verification requires --run-scenarios --live --allow-run';
        return state;
    }

    if (opts.mantaCreateMilvus && !state.endpoint) {
        const created = createMantaMilvusResource(opts);
        state.createJob = created;
        if (created.status !== 'passed') {
            state.status = 'failed';
            state.detail = created.detail;
            return state;
        }
        state.endpoint = created.endpoint || '';
        state.resource = created.resource || null;
    }

    if (opts.mantaResource && !state.endpoint) {
        const resource = resolveMantaResource(opts.mantaResource, opts);
        state.resource = resource.resource || null;
        if (resource.status !== 'passed') {
            state.detail = resource.detail;
            return state;
        }
        state.endpoint = resource.endpoint;
    }

    if (!state.endpoint) {
        state.detail = 'Manta runtime requires --manta-endpoint, --manta-resource, or --manta-create-milvus';
        return state;
    }

    const verify = createMantaVerificationJob(opts, sources, scenarioResults, state.endpoint);
    state.verifyJob = verify;
    state.status = verify.status;
    state.detail = verify.detail;
    state.artifacts = verify.artifacts || [];
    return state;
}

function createMantaMilvusResource(opts) {
    const prompt = [
        `Create a temporary Milvus ${opts.mantaCreateMilvus} instance for Feishu code verification.`,
        'Use a Manta-managed Milvus resource. Wait until the service is reachable before finishing.',
        'Return resource id/name, namespace, endpoint, image tag, readiness state, and server version if available.',
    ].join(' ');
    const create = runCommandRaw('manta-client', [
        'job', 'create',
        '-w', opts.mantaWorkspace,
        '-s', 'milvus-deploy',
        '-T', String(opts.mantaTimeout),
        '-j',
        '-p', prompt,
    ], { timeout: opts.mantaTimeout * 1000 });
    const jobId = mantaJobIdFromOutput(create.stdout) || mantaJobIdFromOutput(create.stderr);
    const record = { status: 'failed', detail: '', jobId, create: redactMantaCommand(create), wait: null, info: null, endpoint: '', resource: null };
    if (create.status !== 0 || !jobId) {
        record.detail = 'Failed to create Manta Milvus deployment job';
        return record;
    }
    record.wait = redactMantaCommand(runCommandRaw('manta-client', ['job', 'wait', jobId, '--timeout', String(opts.mantaTimeout)], { timeout: (opts.mantaTimeout + 30) * 1000 }));
    record.info = redactMantaCommand(runCommandRaw('manta-client', ['job', 'info', jobId, '--json'], { timeout: opts.timeout }));
    const info = parseJsonOutput(record.info.stdout);
    const resultText = [info?.result, record.info.stdout, record.wait.stdout].filter(Boolean).join('\n');
    record.endpoint = extractMantaEndpoint(resultText);
    record.resource = extractMantaResource(resultText);
    if (!record.endpoint) {
        record.detail = 'Manta Milvus deployment completed but no endpoint was found in job output';
        return record;
    }
    record.status = 'passed';
    record.detail = 'Manta Milvus resource created and endpoint discovered';
    return record;
}

function resolveMantaResource(resourceIdOrName, opts) {
    const value = String(resourceIdOrName || '').trim();
    if (!value) return { status: 'manual', detail: 'empty Manta resource id/name' };
    let resource = null;
    if (/^\d+$/.test(value)) {
        const infoResult = runCommandRaw('manta-client', ['resource', 'info', value, '--json'], { timeout: opts.timeout });
        if (infoResult.status !== 0) {
            return { status: 'manual', detail: `manta-client resource info failed for ${value}`, result: redactMantaCommand(infoResult) };
        }
        resource = parseJsonOutput(infoResult.stdout);
    } else {
        const listResult = runCommandRaw('manta-client', ['resource', 'list', '--limit', '100', '--json'], { timeout: opts.timeout });
        if (listResult.status !== 0) {
            return { status: 'manual', detail: 'manta-client resource list failed', result: redactMantaCommand(listResult) };
        }
        const list = parseJsonOutput(listResult.stdout);
        resource = (list?.items || []).find(item => item.resource_name === value || String(item.id) === value);
    }
    const endpoint = resource?.resource_metadata?.endpoint;
    if (!endpoint) return { status: 'manual', detail: `Manta resource has no endpoint: ${value}`, resource };
    if (resource?.resource_metadata?.ready === false) return { status: 'manual', detail: `Manta resource is not ready: ${value}`, resource, endpoint };
    return { status: 'passed', detail: 'Manta resource endpoint resolved', resource, endpoint: endpoint.startsWith('http') ? endpoint : `http://${endpoint}` };
}

function createMantaVerificationJob(opts, sources, scenarioResults, endpoint) {
    const docInputs = sources.map(source => source.link || source.id || source.title).filter(Boolean).join(', ');
    const languages = Array.from(opts.languages || new Set(scenarioResults.map(s => s.language))).join(',');
    const prompt = [
        `Run a live Feishu code verification against Milvus endpoint ${endpoint}.`,
        docInputs ? `Docs: ${docInputs}.` : '',
        languages ? `Languages/scenarios: ${languages}.` : '',
        'Use the generated feishu-code-verify scenario behavior as the reference: create isolated fixture resources, print server version, run documented steps, record pass/fail per step, and clean up only isolated resources.',
        'Python probes should use MilvusClient, not ORM, unless the document explicitly documents ORM. Java, Go, and Node probes should use SDK v2 surfaces.',
        'Return output.md and output.json artifacts with local static status, Manta runtime status, endpoint, server version, SDK versions, created resource names, and document-change recommendations.',
    ].filter(Boolean).join(' ');
    const create = runCommandRaw('manta-client', [
        'job', 'create',
        '-w', opts.mantaWorkspace,
        '-s', 'milvus-test',
        '-T', String(opts.mantaTimeout),
        '-j',
        '-p', prompt,
    ], { timeout: opts.timeout });
    const jobId = mantaJobIdFromOutput(create.stdout) || mantaJobIdFromOutput(create.stderr);
    const record = { status: 'failed', detail: '', jobId, create: redactMantaCommand(create), wait: null, info: null, artifacts: [] };
    if (create.status !== 0 || !jobId) {
        record.detail = 'Failed to create Manta verification job';
        return record;
    }
    record.wait = redactMantaCommand(runCommandRaw('manta-client', ['job', 'wait', jobId, '--timeout', String(opts.mantaTimeout)], { timeout: (opts.mantaTimeout + 30) * 1000 }));
    record.info = redactMantaCommand(runCommandRaw('manta-client', ['job', 'info', jobId, '--json'], { timeout: opts.timeout }));
    const info = parseJsonOutput(record.info.stdout);
    const terminalStatus = info?.status || (record.wait.status === 0 ? 'completed' : 'failed');
    record.artifacts = downloadMantaVerificationArtifacts(jobId, opts);
    if (terminalStatus === 'completed') {
        record.status = 'passed';
        record.detail = 'Manta verification job completed';
    } else {
        record.status = 'failed';
        record.detail = `Manta verification job ended with status ${terminalStatus}`;
    }
    return record;
}

function downloadMantaVerificationArtifacts(jobId, opts) {
    const artifactDir = path.join('/tmp', `feishu-code-verify-manta-${jobId}`);
    fs.mkdirSync(artifactDir, { recursive: true });
    return ['output.md', 'output.json'].map(filename => {
        const output = path.join(artifactDir, filename);
        const result = runCommandRaw('manta-client', ['job', 'download', jobId, filename, '--output', output], { timeout: opts.timeout });
        return {
            filename,
            output,
            status: result.status === 0 ? 'passed' : 'manual',
            detail: result.status === 0 ? 'downloaded' : 'artifact not available',
            result: redactMantaCommand(result),
        };
    });
}

function mantaJobIdFromOutput(text) {
    const parsed = parseJsonOutput(text);
    const id = parsed?.job_id || parsed?.id || parsed?.jobId;
    if (id) return String(id);
    const match = String(text || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return match ? match[0] : '';
}

function extractMantaEndpoint(text) {
    const match = String(text || '').match(/(?:https?:\/\/)?[A-Za-z0-9.-]+\.manta-user-[A-Za-z0-9-]+(?::19530)?/);
    if (!match) return '';
    return match[0].startsWith('http') ? match[0] : `http://${match[0]}`;
}

function extractMantaResource(text) {
    const name = String(text || '').match(/(?:resource|Managed resource|Resource):\s*`?([A-Za-z0-9._-]+)`?/i);
    return name ? { resource_name: name[1] } : null;
}

function redactMantaCommand(result) {
    if (!result) return null;
    return {
        command: result.command,
        status: result.status,
        signal: result.signal,
        stdout: redact(result.stdout),
        stderr: redact(result.stderr),
        error: result.error || null,
    };
}

function printLivePlan(plan) {
    if (plan.candidateBlocks === 0) return;
    console.log('\nLive verification plan');
    console.log(`Profile: ${plan.profile}`);
    console.log(`Candidate blocks: ${plan.candidateBlocks}`);
    if (plan.missingRequiredEnv.length > 0) {
        console.log('Missing required env groups:');
        for (const item of plan.missingRequiredEnv) console.log(`  one of: ${item.anyOf.join(', ')}`);
    } else {
        console.log('Required env vars are present.');
    }
    console.log(`Rerun with: ${plan.suggestedFlags.join(' ')}`);
}

async function main() {
    const opts = parseArgs(process.argv);
    if (opts.help) {
        printUsage();
        return;
    }
    resolveJavaClasspath(opts);

    const sources = await loadSources(opts);
    if (sources.length === 0) throw new Error('No input provided. Use --markdown, --doc, --bitable, or --self-test.');

    const snippets = [];
    for (const source of sources) snippets.push(...snippetsForSource(source));

    const filtered = opts.languages
        ? snippets.filter(s => opts.languages.has(s.language))
        : snippets;
    const results = filtered.map(snippet => {
        const classification = classify(snippet, opts);
        const verification = verifySnippet(snippet, classification, opts);
        return {
            id: snippet.id,
            source: snippet.source,
            index: snippet.index,
            blockId: snippet.blockId,
            section: snippet.section,
            language: snippet.language,
            hash: snippet.hash,
            classification,
            annotations: snippet.annotations,
            verification,
            codePreview: redact(snippet.code.split('\n').slice(0, 8).join('\n')),
        };
    });
    const scenarioResults = buildScenarioResults(filtered, opts).filter(Boolean);
    applyScenarioCoverage(results, scenarioResults);
    const mantaRuntime = runMantaRuntimeVerification(opts, sources, scenarioResults);

    const manualCoveredByScenario = results.filter(r =>
        r.verification.status === 'manual' &&
        r.scenarioCoverage?.status === 'passed'
    ).length;

    const summary = {
        generatedAt: new Date().toISOString(),
        sources: sources.length,
        snippets: snippets.length,
        filteredSnippets: filtered.length,
        passed: results.filter(r => r.verification.status === 'passed').length,
        failed: results.filter(r => r.verification.status === 'failed').length,
        manual: results.filter(r => r.verification.status === 'manual').length,
        manualCoveredByScenario,
        manualUncovered: results.filter(r => r.verification.status === 'manual').length - manualCoveredByScenario,
        skipped: results.filter(r => r.verification.status === 'skipped').length,
        extracted: results.filter(r => r.verification.status === 'extracted').length,
        scenarios: scenarioResults.length,
        scenarioPassed: scenarioResults.filter(r => r.status === 'passed').length,
        scenarioFailed: scenarioResults.filter(r => r.status === 'failed').length,
        scenarioManual: scenarioResults.filter(r => r.status === 'manual').length,
        scenarioExtracted: scenarioResults.filter(r => r.status === 'extracted').length,
        scenarioRuntimePassed: scenarioResults.filter(r => r.runtime?.status === 'passed').length,
        scenarioRuntimeFailed: scenarioResults.filter(r => r.runtime?.status === 'failed').length,
        scenarioRuntimeManual: scenarioResults.filter(r => r.runtime?.status === 'manual').length,
        mantaRuntimePassed: mantaRuntime?.status === 'passed' ? 1 : 0,
        mantaRuntimeFailed: mantaRuntime?.status === 'failed' ? 1 : 0,
        mantaRuntimeManual: mantaRuntime?.status === 'manual' ? 1 : 0,
        javaClasspathSource: opts.javaClasspathSource || null,
        javaClasspathError: opts.javaClasspathError || null,
        nodeSdkBuildPassed: opts.nodeSdkBuilds.filter(r => r.status === 'passed').length,
        nodeSdkBuildFailed: opts.nodeSdkBuilds.filter(r => r.status === 'failed').length,
        nodeSdkBuildManual: opts.nodeSdkBuilds.filter(r => r.status === 'manual').length,
        cppSdkRepo: opts.cppSdkRepo ? path.resolve(opts.cppSdkRepo) : null,
        cppIncludeDirs: (opts.cppIncludeDirs || []).map(dir => path.resolve(dir)),
        sdkRuntimeRules: {
            python: 'MilvusClient',
            java: 'v2',
            go: 'v2',
            node: 'v2',
        },
    };

    const liveVerification = buildLiveVerificationPlan(results, opts);
    const report = { summary, liveVerification, nodeSdkBuilds: opts.nodeSdkBuilds, mantaRuntime, scenarios: scenarioResults, results };
    fs.writeFileSync(opts.report, JSON.stringify(report, null, 2));

    console.log('Feishu code verification summary');
    console.log(JSON.stringify(summary, null, 2));
    if (opts.scenario && scenarioResults.length > 0) {
        console.log('Scenario summary');
        for (const scenario of scenarioResults) {
            console.log(`  ${scenario.language}: ${scenario.status} - ${scenario.detail}`);
            if (scenario.runtime) console.log(`    runtime: ${scenario.runtime.status} - ${scenario.runtime.detail}`);
            console.log(`    ${scenario.scenarioPath}`);
        }
    }
    if (mantaRuntime) {
        console.log(`Manta runtime: ${mantaRuntime.status} - ${mantaRuntime.detail}`);
    }
    if (opts.javaSdkRepo && opts.javaClasspathError) {
        console.log(`Java SDK classpath: manual - ${opts.javaClasspathError}`);
    } else if (opts.javaClasspathSource) {
        console.log(`Java SDK classpath: ${opts.javaClasspathSource}`);
    }
    if (opts.requestLive) printLivePlan(liveVerification);
    console.log(`Report written to ${opts.report}`);

    if (summary.failed > 0 || summary.mantaRuntimeFailed > 0) process.exitCode = 1;
}

main().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});
