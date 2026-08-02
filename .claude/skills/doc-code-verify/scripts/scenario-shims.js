'use strict';

function createScenarioShimContext(language, snippets, opts = {}) {
    const text = snippets.map(s => s.code || '').join('\n');
    const shim = {
        language,
        names: [],
        imports: [],
        header: [],
        helpers: [],
        setup: [],
        notes: [],
        normalizeSnippet(snippet, code) {
            return code;
        },
    };

    const addName = name => {
        if (!shim.names.includes(name)) shim.names.push(name);
    };
    const addImport = line => {
        if (!shim.imports.includes(line)) shim.imports.push(line);
    };
    const addHeader = line => shim.header.push(line);
    const addHelper = line => shim.helpers.push(line);
    const addSetup = line => shim.setup.push(line);
    const addNote = note => {
        if (!shim.notes.includes(note)) shim.notes.push(note);
    };

    if (language === 'python') {
        if (/\b(client|MilvusClient)\b/.test(text) || opts.runScenarios) {
            addName('python-milvus-client');
            addNote('injects a MilvusClient named client when the document omits client setup');
            shim.helpers.push(...[
                '',
                'def doc_verify_get_client():',
                '    global client',
                '    if "client" in globals() and client is not None:',
                '        return client',
                '    from pymilvus import MilvusClient',
                '    uri = SERVING_CLUSTER_ENDPOINT or os.getenv("MILVUS_URI") or "http://localhost:19530"',
                '    kwargs = {"uri": uri}',
                '    if TOKEN:',
                '        kwargs["token"] = TOKEN',
                '    client = MilvusClient(**kwargs)',
                '    return client',
                '',
                'def doc_verify_expression(expr):',
                '    return expr',
            ]);
            shim.setup.push(...[
                '',
                'client = globals().get("client")',
                'if SERVING_CLUSTER_ENDPOINT and client is None:',
                '    client = doc_verify_get_client()',
            ]);
        }
        shim.normalizeSnippet = (snippet, code) => normalizePythonExpressionSnippets(code, addName, addNote);
    }

    if (language === 'javascript') {
        const declaresMilvusClient = /\b(?:const|let|var)\s+milvusClient\b/.test(text);
        if (/\bmilvusClient\b|\bMilvusClient\b/.test(text) || opts.runScenarios) {
            addName('javascript-milvus-client');
            addNote('injects a MilvusClient named milvusClient when the document omits client setup');
            shim.header.push(...[
                'let __docVerifyMilvusClientConstructor = globalThis.MilvusClient;',
                'if (!__docVerifyMilvusClientConstructor && globalThis.SERVING_CLUSTER_ENDPOINT) {',
                '  try {',
                '    const __docVerifyMilvusSdk = await import("@zilliz/milvus2-sdk-node");',
                '    __docVerifyMilvusClientConstructor = __docVerifyMilvusSdk.MilvusClient || __docVerifyMilvusSdk.default;',
                '  } catch (error) {',
                '    if (typeof MilvusClient !== "undefined") __docVerifyMilvusClientConstructor = MilvusClient;',
                '  }',
                '}',
                'if (!globalThis.milvusClient && __docVerifyMilvusClientConstructor && globalThis.SERVING_CLUSTER_ENDPOINT) {',
                '  const __docVerifyClientConfig = { address: globalThis.SERVING_CLUSTER_ENDPOINT };',
                '  if (globalThis.TOKEN) __docVerifyClientConfig.token = globalThis.TOKEN;',
                '  globalThis.milvusClient = new __docVerifyMilvusClientConstructor(__docVerifyClientConfig);',
                '}',
                'globalThis.DOC_VERIFY_ROWS = globalThis.DOC_VERIFY_ROWS || [];',
            ]);
            if (!declaresMilvusClient) {
                shim.header.splice(shim.header.length - 1, 0, 'const milvusClient = globalThis.milvusClient;');
            }
        }
        shim.normalizeSnippet = (snippet, code) => normalizeJavaScriptDataSnippets(code, snippet, addName, addNote);
    }

    if (language === 'bash') {
        addName('bash-live-endpoint');
        addNote('rewrites common localhost Milvus REST endpoints to SERVING_CLUSTER_ENDPOINT');
        shim.normalizeSnippet = (snippet, code) => normalizeBashScenarioSnippets(code, addName, addNote);
    }

    if (language === 'go') {
        if (/\b(ctx|cli|client)\b/.test(text) || opts.runScenarios) {
            addName('go-milvus-client');
            addNote('injects ctx and cli when the document omits Go client setup');
            for (const spec of [
                '"context"',
                '"strings"',
                'milvusclient "github.com/milvus-io/milvus/client/v2/milvusclient"',
            ]) addImport(spec);
            shim.setup.push(...[
                '',
                'ctx := context.Background()',
                'address := strings.TrimPrefix(strings.TrimPrefix(SERVING_CLUSTER_ENDPOINT, "http://"), "https://")',
                'clientConfig := &milvusclient.ClientConfig{Address: address}',
                'if TOKEN != "" {',
                '    clientConfig.APIKey = TOKEN',
                '}',
                'cli, err := milvusclient.New(ctx, clientConfig)',
                'if err != nil {',
                '    panic(err)',
                '}',
                'defer cli.Close(ctx)',
                'client := cli',
            ]);
        }
    }

    if (language === 'java') {
        const declaresClient = /\bMilvusClientV2\s+client\b/.test(text);
        if ((/\bclient\b|\bMilvusClientV2\b/.test(text) || opts.runScenarios) && !declaresClient) {
            addName('java-milvus-client');
            addNote('injects a MilvusClientV2 named client when the document omits Java client setup');
            for (const line of [
                'import io.milvus.v2.client.ConnectConfig;',
                'import io.milvus.v2.client.MilvusClientV2;',
            ]) addImport(line);
            shim.setup.push(...[
                '        ConnectConfig.ConnectConfigBuilder docVerifyConnectBuilder = ConnectConfig.builder().uri(SERVING_CLUSTER_ENDPOINT);',
                '        if (TOKEN != null && !TOKEN.isEmpty()) {',
                '            docVerifyConnectBuilder.token(TOKEN);',
                '        }',
                '        MilvusClientV2 client = new MilvusClientV2(docVerifyConnectBuilder.build());',
            ]);
        }
        const javaSeenLocals = new Set(declaresClient ? [] : ['client']);
        shim.normalizeSnippet = (snippet, code) => normalizeJavaLocalRedeclarations(code, javaSeenLocals, addName, addNote);
    }

    return shim;
}

function normalizePythonExpressionSnippets(code, addName, addNote) {
    let text = rewritePythonLocalMilvusClient(code, addName, addNote);
    text = rewritePythonCloudUrls(text, addName, addNote);
    const lines = String(text || '').split('\n');
    let changed = false;
    const normalized = lines.map(line => {
        if (isPythonCommentOrBlank(line)) return line;
        if (!looksLikeMilvusExpressionDsl(line)) return line;
        changed = true;
        return `${leadingWhitespace(line)}doc_verify_expression(${JSON.stringify(line.trim())})`;
    });
    if (changed) {
        addName('python-expression-dsl');
        addNote('wraps bare Milvus filter DSL lines as expression strings in generated Python scenarios');
    }
    return normalized.join('\n');
}

function rewritePythonLocalMilvusClient(code, addName, addNote) {
    let changed = false;
    const text = String(code || '')
        .replace(/MilvusClient\(\s*uri\s*=\s*["']https?:\/\/(?:localhost|127\.0\.0\.1):19530["']\s*,\s*token\s*=\s*["']root:Milvus["']\s*\)/g, () => {
            changed = true;
            return 'doc_verify_get_client()';
        })
        .replace(/uri\s*=\s*["']https?:\/\/(?:localhost|127\.0\.0\.1):19530["']/g, () => {
            changed = true;
            return 'uri=SERVING_CLUSTER_ENDPOINT or "http://localhost:19530"';
        });
    if (changed) {
        addName('python-localhost-client-rewrite');
        addNote('rewrites localhost MilvusClient setup to the live scenario endpoint');
    }
    return text;
}

function rewritePythonCloudUrls(code, addName, addNote) {
    let changed = false;
    const text = String(code || '').replace(/(["'])https:\/\/[^"']*\.cloud\.zilliz\.com(?=\/v2\/vectordb\/)[^"']*\1/g, match => {
        changed = true;
        const quote = match[0];
        const url = match.slice(1, -1).replace(/\?.*$/, '');
        const pathMatch = url.match(/\/v2\/vectordb\/.*$/);
        return pathMatch ? `f"{SERVING_CLUSTER_ENDPOINT}${pathMatch[0]}"` : match;
    });
    if (changed) {
        addName('python-cloud-url-rewrite');
        addNote('rewrites hardcoded Zilliz Cloud vector database URLs to the live scenario endpoint');
    }
    return text;
}

function isPythonCommentOrBlank(line) {
    return !String(line || '').trim() || /^\s*#/.test(line);
}

function looksLikeMilvusExpressionDsl(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed) return false;
    if (/^["'].*["']$/.test(trimmed)) return false;
    return /\$\[[^\]]+\]/.test(trimmed) || /\s&&\s|\s\|\|\s/.test(trimmed) || /\belement_filter\s*\(/.test(trimmed);
}

function leadingWhitespace(line) {
    const match = String(line || '').match(/^\s*/);
    return match ? match[0] : '';
}

function normalizeJavaScriptDataSnippets(code, snippet, addName, addNote) {
    let text = String(code || '')
        .replace(/(["'`])https?:\/\/localhost:19530\1/g, 'globalThis.SERVING_CLUSTER_ENDPOINT || "http://localhost:19530"')
        .replace(/(["'`])https:\/\/[^"'`]*\.cloud\.zilliz\.com(?=\/v2\/vectordb\/)[^"'`]*\1/g, (match) => {
            addName('javascript-cloud-url-rewrite');
            addNote('rewrites hardcoded Zilliz Cloud vector database URLs to the live scenario endpoint');
            const quote = match[0];
            const url = match.slice(1, -1).replace(/\?.*$/, '');
            const pathMatch = url.match(/\/v2\/vectordb\/.*$/);
            return pathMatch ? `\`${'${globalThis.SERVING_CLUSTER_ENDPOINT}'}${pathMatch[0]}\`` : `${quote}${url}${quote}`;
        })
        .trim();
    if (/^\{[\s\S]*\]\s*;[\s\S]*\bdata\s*:\s*data\b/.test(text)) {
        addName('javascript-data-array');
        addNote('wraps JavaScript data array fragments that omit the opening const data = [');
        return `const data = [\n${text}`;
    }
    if (/^\{[\s\S]*\}\s*,\s*\]\s*;?$/.test(text)) {
        addName('javascript-data-array');
        addNote('wraps JavaScript data array fragments that omit the opening const data = [');
        return `const data = [\n${text}`;
    }
    if (!/^\{[\s\S]*\}$/.test(text)) return text;
    if (!/\b(id|title|chunks|vector|embedding)\s*:/.test(text)) return code;
    addName('javascript-data-object');
    addNote('wraps bare JavaScript data object literals into DOC_VERIFY_ROWS in generated scenarios');
    return `globalThis.DOC_VERIFY_ROWS.push(\n${text.replace(/,\s*$/, '')}\n);`;
}

function normalizeBashScenarioSnippets(code, addName, addNote) {
    let text = String(code || '')
        .replace(/https?:\/\/localhost:19530/g, '${SERVING_CLUSTER_ENDPOINT}')
        .replace(/http:\/\/127\.0\.0\.1:19530/g, '${SERVING_CLUSTER_ENDPOINT}')
        .replace(/https:\/\/[^"'\s]*\.cloud\.zilliz\.com(?=\/v2\/vectordb\/)[^"'\s]*/g, url => {
            addName('bash-cloud-url-rewrite');
            addNote('rewrites hardcoded Zilliz Cloud vector database URLs to SERVING_CLUSTER_ENDPOINT and strips cluster_id query strings');
            const pathMatch = url.replace(/\?.*$/, '').match(/\/v2\/vectordb\/.*$/);
            return pathMatch ? '${SERVING_CLUSTER_ENDPOINT}' + pathMatch[0] : url;
        });

    text = text.replace(/^(\s*)([A-Z_][A-Z0-9_]*)\s*\+=\s*(['"])/gm, (full, indent, name, quote) => {
        addName('bash-append-assignment');
        addNote('rewrites non-shell VAR += literal appends into Bash string append syntax');
        return `${indent}${name}="\${${name}}"$'\\n'${quote}`;
    });
    text = commentBashZillizCliBlocks(text, addName, addNote);
    return text;
}

function commentBashZillizCliBlocks(code, addName, addNote) {
    const lines = String(code || '').split('\n');
    const out = [];
    let inZilliz = false;
    let changed = false;
    for (const line of lines) {
        const startsZilliz = /^\s*zilliz\b/.test(line);
        if (startsZilliz) inZilliz = true;
        if (inZilliz) {
            if (!line.trim()) {
                out.push(line);
                inZilliz = false;
                continue;
            }
            changed = true;
            out.push(`# doc-verify skipped zilliz-cli: ${line}`);
            continue;
        }
        out.push(line);
    }
    if (changed) {
        addName('bash-zilliz-cli-runtime-skip');
        addNote('skips zilliz CLI command blocks in generated runtime scenarios because they require local CLI login/config outside the REST endpoint fixture');
    }
    return out.join('\n');
}

function normalizeJavaLocalRedeclarations(code, seen, addName, addNote) {
    return String(code || '').split('\n').map(line => {
        const match = line.match(/^(\s*)([A-Z][A-Za-z0-9_.$]*(?:\s*<[^;=]+>)?(?:\[\])?)\s+([a-z][A-Za-z0-9_]*)\s*=/);
        if (!match) return line;
        const [, indent, type, name] = match;
        if (!seen.has(name)) {
            seen.add(name);
            return line;
        }
        addName('java-local-redeclare');
        addNote('rewrites repeated Java local variable declarations into assignments in generated scenarios');
        return line.replace(new RegExp(`^${escapeRegExp(indent)}${escapeRegExp(type)}\\s+${name}\\s*=`), `${indent}${name} =`);
    }).join('\n');
}

function escapeRegExp(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
    createScenarioShimContext,
};
