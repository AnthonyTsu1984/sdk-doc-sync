const fs = require('fs');
const path = require('path');
const BaseScanner = require('./base-scanner');

class PythonScanner extends BaseScanner {
    constructor(opts) {
        super(opts);
    }

    _defaultExcludes() {
        return ['__pycache__', '**/__pycache__/**', 'test_*', '*_test.py', '*.pyc', '.git', '**/.git/**'];
    }

    async scan() {
        const files = this._walkFiles(['.py']);
        const symbols = [];

        for (const filePath of files) {
            const content = fs.readFileSync(filePath, 'utf-8');
            const relPath = path.relative(this.rootDir, filePath);
            symbols.push(...this._extractSymbols(content, relPath));
        }

        return symbols;
    }

    _extractSymbols(content, filePath) {
        const lines = content.split('\n');
        const symbols = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Class definitions
            const classMatch = line.match(/^class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/);
            if (classMatch) {
                const name = classMatch[1];
                if (this.publicOnly && name.startsWith('_') && name !== '__init__') continue;

                const baseClasses = classMatch[2]
                    ? classMatch[2].split(',').map(b => b.trim()).filter(Boolean)
                    : [];
                const decorators = this._getDecorators(lines, i);
                const docstring = this._getDocstring(lines, i + 1);

                symbols.push({
                    name,
                    kind: 'class',
                    signature: line.trim(),
                    docstring,
                    params: [],
                    filePath,
                    lineNumber: i + 1,
                    parentClass: null,
                    decorators,
                    returnType: null,
                    baseClasses,
                });

                // Extract methods within this class
                const methods = this._extractMethods(lines, i, name, filePath);
                symbols.push(...methods);
                continue;
            }

            // Top-level function definitions
            const funcStart = line.match(/^def\s+(\w+)\s*\(/);
            if (funcStart) {
                const name = funcStart[1];
                if (this.publicOnly && name.startsWith('_')) continue;

                const { fullSignature, endLine } = this._collectSignature(lines, i);
                const funcMatch = fullSignature.match(/^\s*def\s+(\w+)\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)\s*(?:->\s*(.+?))?\s*:/);
                if (!funcMatch) continue;

                const decorators = this._getDecorators(lines, i);
                const docstring = this._getDocstring(lines, endLine + 1);
                const params = this._parseParams(funcMatch[2]);
                const returnType = funcMatch[3]?.trim() || null;

                symbols.push({
                    name,
                    kind: 'function',
                    signature: fullSignature.trim().replace(/\s+/g, ' '),
                    docstring,
                    params,
                    filePath,
                    lineNumber: i + 1,
                    parentClass: null,
                    decorators,
                    returnType,
                    baseClasses: [],
                });
                continue;
            }

            // Top-level constants (UPPER_CASE = ...)
            const constMatch = line.match(/^([A-Z][A-Z0-9_]+)\s*(?::\s*\w+)?\s*=\s*(.+)/);
            if (constMatch) {
                const name = constMatch[1];
                symbols.push({
                    name,
                    kind: 'constant',
                    signature: line.trim(),
                    docstring: null,
                    params: [],
                    filePath,
                    lineNumber: i + 1,
                    parentClass: null,
                    decorators: [],
                    returnType: null,
                    baseClasses: [],
                });
                continue;
            }

            // Enum classes are captured by the class regex above, but we re-tag them
        }

        // Re-tag enum classes
        for (const sym of symbols) {
            if (sym.kind === 'class' && sym.baseClasses.some(b => b.includes('Enum'))) {
                sym.kind = 'enum';
            }
        }

        return symbols;
    }

    _extractMethods(lines, classLineIdx, className, filePath) {
        const methods = [];
        const classIndent = this._getIndent(lines[classLineIdx]);
        const methodIndent = classIndent + 4; // expected indent for direct class methods

        for (let i = classLineIdx + 1; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim() === '') continue;

            const indent = this._getIndent(line);
            // If we've dedented back to or before class level, stop
            if (indent <= classIndent && line.trim() !== '') break;

            // Check for start of a def statement
            const defStart = line.match(/^\s+def\s+(\w+)\s*\(/);
            if (!defStart) continue;

            // Only capture direct class methods, not nested functions
            if (indent > methodIndent) continue;

            const name = defStart[1];
            // publicOnly: skip _private but keep __init__
            if (this.publicOnly && name.startsWith('_') && name !== '__init__') continue;

            // Collect full signature (may span multiple lines)
            const { fullSignature, endLine } = this._collectSignature(lines, i);

            // Parse the complete signature
            const sigMatch = fullSignature.match(/^\s*def\s+(\w+)\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)\s*(?:->\s*(.+?))?\s*:/);
            if (!sigMatch) continue;

            const decorators = this._getDecorators(lines, i);
            const docstring = this._getDocstring(lines, endLine + 1);
            const rawParams = sigMatch[2];
            // Strip 'self' and 'cls' from params
            const cleanedParams = rawParams
                .split(',')
                .map(p => p.trim())
                .filter(p => p && p !== 'self' && p !== 'cls')
                .join(', ');
            const params = this._parseParams(cleanedParams);
            const returnType = sigMatch[3]?.trim() || null;

            methods.push({
                name,
                kind: 'method',
                signature: fullSignature.trim().replace(/\s+/g, ' '),
                docstring,
                params,
                filePath,
                lineNumber: i + 1,
                parentClass: className,
                decorators,
                returnType,
                baseClasses: [],
            });
        }

        return methods;
    }

    /**
     * Collect a full def signature that may span multiple lines.
     * Joins lines until balanced parentheses + colon are found.
     */
    _collectSignature(lines, startIdx) {
        let sig = lines[startIdx];
        let depth = 0;
        for (const ch of sig) {
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
        }
        let endLine = startIdx;
        while (depth > 0 && endLine + 1 < lines.length) {
            endLine++;
            sig += ' ' + lines[endLine].trim();
            for (const ch of lines[endLine]) {
                if (ch === '(') depth++;
                else if (ch === ')') depth--;
            }
        }
        return { fullSignature: sig, endLine };
    }

    _getDecorators(lines, lineIdx) {
        const decorators = [];
        for (let j = lineIdx - 1; j >= 0; j--) {
            const trimmed = lines[j].trim();
            if (trimmed.startsWith('@')) {
                decorators.unshift(trimmed);
            } else if (trimmed === '' || trimmed.startsWith('#')) {
                continue;
            } else {
                break;
            }
        }
        return decorators;
    }

    _getDocstring(lines, defLineIdx) {
        // Look for a docstring starting from the line after the definition
        let i = defLineIdx;
        // Skip blank lines
        while (i < lines.length && lines[i].trim() === '') i++;
        if (i >= lines.length) return null;

        const trimmed = lines[i].trim();
        let quote = null;
        if (trimmed.startsWith('"""')) quote = '"""';
        else if (trimmed.startsWith("'''")) quote = "'''";
        if (!quote) return null;

        // Single-line docstring
        const singleMatch = trimmed.match(new RegExp(`^${this._escapeRegex(quote)}(.+?)${this._escapeRegex(quote)}$`));
        if (singleMatch) return singleMatch[1].trim();

        // Multi-line docstring
        let docstring = trimmed.slice(quote.length);
        i++;
        while (i < lines.length) {
            const line = lines[i];
            const endIdx = line.indexOf(quote);
            if (endIdx !== -1) {
                docstring += '\n' + line.slice(0, endIdx);
                break;
            }
            docstring += '\n' + line;
            i++;
        }
        return docstring.trim();
    }

    _escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    _parseParams(paramStr) {
        if (!paramStr || !paramStr.trim()) return [];

        const params = [];
        let depth = 0;
        let current = '';

        for (const ch of paramStr) {
            if (ch === '(' || ch === '[' || ch === '{') depth++;
            else if (ch === ')' || ch === ']' || ch === '}') depth--;

            if (ch === ',' && depth === 0) {
                params.push(this._parseSingleParam(current.trim()));
                current = '';
            } else {
                current += ch;
            }
        }
        if (current.trim()) {
            params.push(this._parseSingleParam(current.trim()));
        }

        return params;
    }

    _parseSingleParam(param) {
        if (param.startsWith('**')) {
            const name = param.slice(2).split(':')[0].split('=')[0].trim();
            return { name, kind: 'kwargs', type: this._extractType(param), default: null };
        }
        if (param.startsWith('*')) {
            const name = param.slice(1).split(':')[0].split('=')[0].trim();
            if (!name) return { name: '*', kind: 'separator', type: null, default: null };
            return { name, kind: 'args', type: this._extractType(param), default: null };
        }

        const name = param.split(':')[0].split('=')[0].trim();
        const type = this._extractType(param);
        const defaultVal = this._extractDefault(param);

        return { name, kind: defaultVal !== null ? 'keyword' : 'positional', type, default: defaultVal };
    }

    _extractType(param) {
        const colonIdx = param.indexOf(':');
        if (colonIdx === -1) return null;
        const afterColon = param.slice(colonIdx + 1);
        const eqIdx = afterColon.indexOf('=');
        return (eqIdx !== -1 ? afterColon.slice(0, eqIdx) : afterColon).trim() || null;
    }

    _extractDefault(param) {
        const eqIdx = param.indexOf('=');
        if (eqIdx === -1) return null;
        return param.slice(eqIdx + 1).trim();
    }

    _getIndent(line) {
        const match = line.match(/^(\s*)/);
        return match ? match[1].length : 0;
    }
}

module.exports = PythonScanner;
