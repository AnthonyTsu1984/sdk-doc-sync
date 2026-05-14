const fs = require('fs');
const path = require('path');
const BaseScanner = require('./base-scanner');

class JavaScanner extends BaseScanner {
    constructor(opts) {
        super(opts);
    }

    _defaultExcludes() {
        return ['**/test/**', '**/tests/**', '.git', '**/.git/**', '**/generated/**'];
    }

    async scan() {
        // Phase 1: Find MilvusClientV2.java and extract public method signatures
        const allFiles = this._walkFiles(['.java']);
        const clientFile = allFiles.find(f => f.endsWith('MilvusClientV2.java'));
        if (!clientFile) {
            throw new Error('MilvusClientV2.java not found under ' + this.rootDir);
        }

        const clientContent = fs.readFileSync(clientFile, 'utf-8');
        const clientRelPath = path.relative(this.rootDir, clientFile);
        const methods = this._extractMethods(clientContent, clientRelPath);

        // Phase 2: For each method with a Req parameter, find and parse the Request class
        const reqFiles = this._indexReqFiles(allFiles);
        for (const method of methods) {
            if (method.requestClass) {
                const reqFile = reqFiles.get(method.requestClass);
                if (reqFile) {
                    const reqContent = fs.readFileSync(reqFile, 'utf-8');
                    method.params = this._extractBuilderFields(reqContent);
                }
            }
        }

        return methods;
    }

    /**
     * Extract public method signatures from MilvusClientV2.java.
     */
    _extractMethods(content, filePath) {
        const lines = content.split('\n');
        const symbols = [];
        const methodRegex = /^\s*public\s+([\w.<>,\s\[\]?]+?)\s+(\w+)\s*\(([^)]*)\)/;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = line.match(methodRegex);
            if (!match) continue;

            const returnType = match[1].trim();
            const name = match[2];
            const paramStr = match[3].trim();

            // Skip constructors (return type === class name) and non-public
            if (name === 'MilvusClientV2') continue;

            // Skip Lombok-generated setter methods (not documented as API methods)
            if (this._isSetterMethod(name)) continue;

            // Check for @Deprecated annotation on preceding lines
            const decorators = this._getDecorators(lines, i);

            // Extract request class name from parameter
            const requestClass = this._extractRequestClass(paramStr);

            // Build full signature
            const signature = `public ${returnType} ${name}(${paramStr})`;

            if (this.publicOnly && name.startsWith('_')) continue;

            symbols.push({
                name,
                kind: 'method',
                signature,
                docstring: null,
                params: [],
                filePath,
                lineNumber: i + 1,
                parentClass: 'MilvusClientV2',
                decorators,
                returnType,
                baseClasses: [],
                requestClass,
            });
        }

        return symbols;
    }

    /**
     * Returns true if the method name is a Lombok-generated setter (e.g. setName, setFields).
     */
    _isSetterMethod(name) {
        return /^set[A-Z]/.test(name);
    }

    /**
     * Look for annotations on lines immediately preceding the method definition.
     */
    _getDecorators(lines, lineIdx) {
        const decorators = [];
        for (let j = lineIdx - 1; j >= 0; j--) {
            const trimmed = lines[j].trim();
            if (trimmed.startsWith('@')) {
                decorators.unshift(trimmed);
            } else if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed === '*/') {
                continue;
            } else {
                break;
            }
        }
        return decorators;
    }

    /**
     * Extract the Req class name from a method parameter string.
     * e.g., "CreateCollectionReq request" → "CreateCollectionReq"
     * Returns null for methods with no Req parameter.
     */
    _extractRequestClass(paramStr) {
        if (!paramStr.trim()) return null;
        const reqMatch = paramStr.match(/(\w+Req\w*)\s+\w+/);
        return reqMatch ? reqMatch[1] : null;
    }

    /**
     * Build a map of request class name → file path for fast lookup.
     */
    _indexReqFiles(allFiles) {
        const map = new Map();
        for (const f of allFiles) {
            const basename = path.basename(f, '.java');
            if (/Req(V\d+)?$/.test(basename)) {
                map.set(basename, f);
            }
        }
        return map;
    }

    /**
     * Extract builder fields from a Request class (private field declarations).
     * Only captures top-level class fields; stops at inner class definitions
     * to avoid picking up fields from nested classes like CollectionSchema, FieldSchema, etc.
     * Returns params array compatible with the symbol schema.
     */
    _extractBuilderFields(content) {
        const params = [];
        const lines = content.split('\n');
        const fieldRegex = /^\s*private\s+([\w<>,\s\[\]?]+?)\s+(\w+)\s*(?:=\s*(.+?))?\s*;/;
        const classRegex = /^\s*(public|private|protected)?\s*(static\s+)?class\s+/;

        let seenTopClass = false;

        for (const line of lines) {
            // Detect class definitions
            if (classRegex.test(line)) {
                if (!seenTopClass) {
                    seenTopClass = true;
                    continue;
                }
                // Hit an inner class — stop extracting
                break;
            }

            if (!seenTopClass) continue;

            const match = line.match(fieldRegex);
            if (!match) continue;

            const type = match[1].trim();
            const name = match[2];
            const defaultVal = match[3] ? match[3].trim() : null;

            // Skip internal/synthetic fields
            if (name === 'serialVersionUID') continue;

            params.push({
                name,
                kind: 'keyword',
                type,
                default: defaultVal,
            });
        }

        return params;
    }
}

module.exports = JavaScanner;
