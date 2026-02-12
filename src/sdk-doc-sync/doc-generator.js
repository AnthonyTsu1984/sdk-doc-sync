/**
 * DocGenerator — produces scaffold markdown and bitable metadata for SDK symbols.
 *
 * The scaffold matches the real Feishu reference doc structure:
 *   [description] → Request Syntax (code) → PARAMETERS → RETURN TYPE → EXCEPTIONS → Examples
 *
 * The scaffold is intentionally minimal — it provides structure for Claude (or a
 * human) to fill in with intelligent content: meaningful descriptions, parameter
 * explanations, realistic examples, and edge-case notes. Fields marked with
 * `<!-- TODO: ... -->` are placeholders for that intelligence layer.
 */

class DocGenerator {
    constructor({ sdkName, sdkVersion, targets = [], language = 'python' }) {
        this.sdkName = sdkName;
        this.sdkVersion = sdkVersion;
        this.targets = targets.length ? targets : [sdkName];
        this.language = language;
    }

    /**
     * Generate scaffold markdown for a symbol.
     * Returns a string matching the real Feishu reference doc structure.
     */
    generate(symbol) {
        switch (symbol.kind) {
            case 'class':
                return this._classScaffold(symbol);
            case 'enum':
                if (this.language === 'cpp') return this._cppEnumScaffold(symbol);
                return this._enumScaffold(symbol);
            case 'method':
            case 'function':
                return this._functionScaffold(symbol);
            default:
                return this._functionScaffold(symbol);
        }
    }

    /**
     * Generate bitable record metadata for a symbol.
     * Slug format matches real convention: `Category-symbol_name`
     */
    generateMeta(symbol, { parentRecordId = null } = {}) {
        const slug = this._slug(symbol);
        const title = this._title(symbol);
        const type = this._bitableType(symbol);

        const description = symbol.docstring
            ? symbol.docstring.split('\n')[0].trim()
            : '';

        return {
            title,
            slug,
            description,
            type,
            addedSince: this.sdkVersion,
            targets: this.targets,
            progress: 'Draft',
            parentRecordId,
        };
    }

    /**
     * Slug format matching the real bitable convention:
     *   - Top-level class/module: `ClassName`
     *   - Method of a class: `ClassName-method_name`
     *   - Nested under a VirtualNode category: `Category-symbol_name`
     *
     * Preserves original casing — NOT lowercased or strict-slugified.
     */
    _slug(symbol) {
        if (symbol.parentClass) {
            return `${symbol.parentClass}-${symbol.name}`;
        }
        return symbol.name;
    }

    _title(symbol) {
        if (symbol.kind === 'class' || symbol.kind === 'enum') {
            return symbol.name;
        }
        return `${symbol.name}()`;
    }

    _bitableType(symbol) {
        const map = {
            class: 'Class',
            enum: 'Enum',
            method: 'Function',
            function: 'Function',
            constant: 'Function',
            module: 'Module',
        };
        return map[symbol.kind] || 'Function';
    }

    // ── Scaffold templates ─────────────────────────────────────────────

    _functionScaffold(symbol) {
        if (this.language === 'java') {
            return this._javaFunctionScaffold(symbol);
        }
        if (this.language === 'cpp') {
            return this._cppFunctionScaffold(symbol);
        }
        return this._pythonFunctionScaffold(symbol);
    }

    _pythonFunctionScaffold(symbol) {
        const title = this._title(symbol);
        let md = '';

        // Brief description
        md += `${symbol.docstring ? symbol.docstring.split('\n')[0].trim() : `<!-- TODO: Brief description of ${title} -->`}\n\n`;

        // Request Syntax
        md += `## Request Syntax\n\n`;
        md += `\`\`\`python\n${this._buildSignature(symbol)}\n\`\`\`\n\n`;

        // Parameters
        if (symbol.params.length > 0) {
            md += `**PARAMETERS:**\n\n`;
            for (const p of symbol.params) {
                if (p.kind === 'separator') continue;
                const name = p.kind === 'args' ? `*${p.name}` : p.kind === 'kwargs' ? `**${p.name}` : p.name;
                const type = p.type || 'object';
                const required = p.default === null && p.kind === 'positional' ? '\n\n  [REQUIRED]' : '';
                md += `- **${name}** (${type}) –${required}\n\n`;
                md += `  <!-- TODO: Description of ${name} -->\n\n`;
            }
        }

        // Return type
        md += `**RETURN TYPE:**\n\n`;
        md += `${symbol.returnType || 'None'}\n\n`;

        // Exceptions
        md += `**EXCEPTIONS:**\n\n`;
        md += `<!-- TODO: List relevant exceptions -->\n\n`;

        // Examples
        md += `## Examples\n\n`;
        md += `\`\`\`python\n<!-- TODO: Usage example -->\n\`\`\`\n`;

        return md;
    }

    _javaFunctionScaffold(symbol) {
        const title = this._title(symbol);
        let md = '';

        // Brief description
        md += `${symbol.docstring ? symbol.docstring.split('\n')[0].trim() : `<!-- TODO: Brief description of ${title} -->`}\n\n`;

        // Method signature in java code block
        md += `\`\`\`java\n${symbol.signature}\n\`\`\`\n\n`;

        // Request Syntax and Builder Methods — only if there's a request class
        if (symbol.requestClass && symbol.params.length > 0) {
            md += `## Request Syntax{#request-syntax}\n\n`;
            md += `\`\`\`java\n${this._buildJavaRequestSyntax(symbol)}\n\`\`\`\n\n`;

            md += `**BUILDER METHODS:**\n\n`;
            for (const p of symbol.params) {
                md += `- \`${p.name}(${p.type} ${p.name})\`\n\n`;
                md += `    <!-- TODO: Description -->\n\n`;
            }
        }

        // Returns
        md += `**RETURNS:**\n\n`;
        md += `*${symbol.returnType || 'void'}*\n\n`;
        md += `<!-- TODO: Description of return value -->\n\n`;

        // Exceptions
        md += `**EXCEPTIONS:**\n\n`;
        md += `- **MilvusClientExceptions**\n\n`;
        md += `    This exception will be raised when any error occurs during this operation.\n\n`;

        // Example
        md += `## Example{#example}\n\n`;
        md += `\`\`\`java\n<!-- TODO: Usage example -->\n\`\`\`\n`;

        return md;
    }

    _buildJavaRequestSyntax(symbol) {
        const fields = symbol.params.map(p => `    .${p.name}(${p.type} ${p.name})`).join('\n');
        return `${symbol.name}(${symbol.requestClass}.builder()\n${fields}\n    .build()\n)`;
    }

    _cppFunctionScaffold(symbol) {
        const title = this._title(symbol);
        let md = '';

        // Brief description
        md += `${symbol.docstring || `<!-- TODO: Brief description of ${title} -->`}\n\n`;

        // Method signature
        md += `\`\`\`cpp\n${symbol.signature}\n\`\`\`\n\n`;

        // Request Syntax + REQUEST METHODS — only if there's a request class with params
        if (symbol.requestClass && symbol.params.length > 0) {
            md += `## Request Syntax{#request-syntax}\n\n`;
            md += `\`\`\`cpp\n${this._buildCppRequestSyntax(symbol)}\n\`\`\`\n\n`;

            md += `**REQUEST METHODS:**\n\n`;
            for (const p of symbol.params) {
                const methodCall = p.fullArgStr
                    ? `${p.name}(${p.fullArgStr})`
                    : p.argName
                        ? `${p.name}(${p.type} ${p.argName})`
                        : `${p.name}()`;
                md += `- \`${methodCall}\`\n\n`;
                md += `    ${p.description || '<!-- TODO: Description -->'}\n\n`;
            }
        } else if (symbol.params && symbol.params.length > 0) {
            // Direct params (non-request methods like Connect, UseDatabase)
            md += `**PARAMETERS:**\n\n`;
            for (const p of symbol.params) {
                md += `- **${p.name}** (*${p.type}*)\n\n`;
                md += `    ${p.description || '<!-- TODO: Description -->'}\n\n`;
            }
        }

        // Returns
        md += `**RETURNS:**\n\n`;
        if (symbol.responseClass) {
            md += `*Status* with *${symbol.responseClass}*\n\n`;
        } else {
            md += `*Status*\n\n`;
        }
        md += `Check \`status.IsOk()\` to confirm success.\n\n`;

        // Exceptions
        md += `**EXCEPTIONS:**\n\n`;
        md += `- **StatusCode**\n\n`;
        md += `    Check \`status.Code()\` and \`status.Message()\` for error details.\n\n`;

        // Example
        md += `## Example{#example}\n\n`;
        md += `\`\`\`cpp\n${this._buildCppExample(symbol)}\n\`\`\`\n`;

        return md;
    }

    _buildCppRequestSyntax(symbol) {
        const withMethods = symbol.params
            .filter(p => p.name.startsWith('With'))
            .map(p => {
                const arg = p.argName
                    ? `${p.argName}`
                    : 'value';
                return `    .${p.name}(${arg})`;
            });
        const chain = withMethods.length > 0 ? '\n' + withMethods.join('\n') : '';
        return `auto request = ${symbol.requestClass}();${chain ? '\nrequest' + chain + ';' : ''}`;
    }

    _buildCppExample(symbol) {
        let ex = '#include <milvus/MilvusClientV2.h>\n';
        ex += 'using namespace milvus;\n\n';
        ex += 'auto client = MilvusClientV2::Create();\n';
        ex += '// TODO: connect and use client\n';
        if (symbol.requestClass) {
            ex += `auto request = ${symbol.requestClass}();\n`;
            ex += `// TODO: configure request\n`;
            if (symbol.responseClass) {
                ex += `${symbol.responseClass} response;\n`;
                ex += `auto status = client->${symbol.name}(request, response);\n`;
            } else {
                ex += `auto status = client->${symbol.name}(request);\n`;
            }
        } else if (symbol.params && symbol.params.length > 0) {
            const args = symbol.params.map(p => `/* ${p.name} */`).join(', ');
            ex += `auto status = client->${symbol.name}(${args});\n`;
        } else {
            ex += `auto status = client->${symbol.name}();\n`;
        }
        return ex;
    }

    _cppEnumScaffold(symbol) {
        let md = '';

        md += `${symbol.docstring || `<!-- TODO: Brief description of ${symbol.name} -->`}\n\n`;

        md += `\`\`\`cpp\n${symbol.signature}\n\`\`\`\n\n`;

        if (symbol.params && symbol.params.length > 0) {
            md += `**VALUES:**\n\n`;
            for (const v of symbol.params) {
                const desc = v.comment || '<!-- TODO: Description -->';
                md += `- **${v.name}** (${v.value}) - ${desc}\n\n`;
            }
        }

        md += `## Example{#example}\n\n`;
        md += `\`\`\`cpp\n#include <milvus/types/${symbol.name}.h>\nusing namespace milvus;\n\n// TODO: Usage example\n\`\`\`\n`;

        return md;
    }

    _classScaffold(symbol) {
        let md = '';

        md += `${symbol.docstring ? symbol.docstring.split('\n')[0].trim() : `<!-- TODO: Brief description of ${symbol.name} -->`}\n\n`;

        md += `## Constructor\n\n`;
        md += `\`\`\`python\n${symbol.signature}\n\`\`\`\n\n`;

        if (symbol.baseClasses.length > 0) {
            md += `**Inherits from:** ${symbol.baseClasses.join(', ')}\n\n`;
        }

        md += `## Methods\n\n`;
        md += `<!-- TODO: List key methods with brief descriptions -->\n\n`;

        md += `## Examples\n\n`;
        md += `\`\`\`python\n<!-- TODO: Usage example -->\n\`\`\`\n`;

        return md;
    }

    _enumScaffold(symbol) {
        let md = '';

        md += `${symbol.docstring ? symbol.docstring.split('\n')[0].trim() : `<!-- TODO: Brief description of ${symbol.name} -->`}\n\n`;

        md += `## Values\n\n`;
        md += `\`\`\`python\n${symbol.signature}\n\`\`\`\n\n`;
        md += `<!-- TODO: Document enum values and their meanings -->\n\n`;

        md += `## Examples\n\n`;
        md += `\`\`\`python\n<!-- TODO: Usage example -->\n\`\`\`\n`;

        return md;
    }

    _buildSignature(symbol) {
        if (symbol.kind === 'method' && symbol.parentClass) {
            // Reconstruct clean signature without self
            const params = symbol.params.map(p => {
                let s = p.kind === 'args' ? `*${p.name}` : p.kind === 'kwargs' ? `**${p.name}` : p.name;
                if (p.type) s += `: ${p.type}`;
                if (p.default !== null && p.default !== undefined) s += ` = ${p.default}`;
                return s;
            });
            const ret = symbol.returnType ? ` -> ${symbol.returnType}` : '';
            return `${symbol.name}(\n    ${params.join(',\n    ')}\n)${ret}`;
        }
        // For top-level functions, use the original signature but format it
        if (symbol.params.length > 0) {
            const params = symbol.params.map(p => {
                let s = p.kind === 'args' ? `*${p.name}` : p.kind === 'kwargs' ? `**${p.name}` : p.name;
                if (p.type) s += `: ${p.type}`;
                if (p.default !== null && p.default !== undefined) s += ` = ${p.default}`;
                return s;
            });
            const ret = symbol.returnType ? ` -> ${symbol.returnType}` : '';
            return `${symbol.name}(\n    ${params.join(',\n    ')}\n)${ret}`;
        }
        return symbol.signature;
    }
}

module.exports = DocGenerator;
