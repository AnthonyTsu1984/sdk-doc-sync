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
        const methods = this._extractClientMethods(clientContent, clientRelPath);
        methods.push(...this._extractBulkWriterSymbols(allFiles));

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
    _extractClientMethods(content, filePath) {
        return this._extractMethods(content, filePath, { parentClass: 'MilvusClientV2' });
    }

    _extractMethods(content, filePath, { parentClass = null } = {}) {
        const lines = content.split('\n');
        const symbols = [];
        const methodRegex = /^\s*public\s+([\w.<>,\s\[\]?]+?)\s+(\w+)\s*\(([^)]*)\)/;
        const resolvedParentClass = parentClass || this._extractTopLevelClassName(content) || path.basename(filePath, '.java');
        let braceDepth = 0;
        let seenTopClass = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const updateBraceDepth = () => {
                braceDepth += (line.match(/{/g) || []).length;
                braceDepth -= (line.match(/}/g) || []).length;
            };
            if (/^\s*public\s+(?:abstract\s+|final\s+)?class\s+/.test(line)) {
                seenTopClass = true;
            }
            const inTopLevelClass = seenTopClass && braceDepth === 1;
            const match = line.match(methodRegex);
            if (!match || !inTopLevelClass) {
                updateBraceDepth();
                continue;
            }

            const returnType = match[1].trim();
            const name = match[2];
            const paramStr = match[3].trim();

            // Skip constructors (return type === class name) and non-public
            if (name === resolvedParentClass) {
                updateBraceDepth();
                continue;
            }

            // Skip Lombok-generated setter methods (not documented as API methods)
            if (this._isSetterMethod(name)) {
                updateBraceDepth();
                continue;
            }

            // Check for @Deprecated annotation on preceding lines
            const decorators = this._getDecorators(lines, i);

            // Extract request class name from parameter
            const requestClass = this._extractRequestClass(paramStr);

            // Build full signature
            const signature = `public ${returnType} ${name}(${paramStr})`;

            if (this.publicOnly && name.startsWith('_')) {
                updateBraceDepth();
                continue;
            }

            symbols.push({
                name,
                kind: 'method',
                signature,
                docstring: null,
                params: [],
                filePath,
                lineNumber: i + 1,
                parentClass: resolvedParentClass,
                decorators,
                returnType,
                baseClasses: [],
                requestClass,
            });

            updateBraceDepth();
        }

        return symbols;
    }

    _extractBulkWriterSymbols(allFiles) {
        const symbols = [];
        const publicMethodClasses = new Set([
            'VolumeManager',
            'VolumeFileManager',
            'VolumeBulkWriter',
            'BulkWriter',
        ]);
        const publicTypeDirs = [
            '/request/',
            '/model/',
            '/response/',
        ];
        const publicParamClasses = new Set([
            'VolumeBulkWriterParam',
            'VolumeFileManagerParam',
            'VolumeManagerParam',
            'RemoteBulkWriterParam',
            'LocalBulkWriterParam',
        ]);

        for (const file of allFiles) {
            const relPath = path.relative(this.rootDir, file).split(path.sep).join('/');
            if (!relPath.includes('sdk-bulkwriter/src/main/java/io/milvus/bulkwriter/')) continue;
            if (relPath.includes('/storage/') || relPath.includes('/writer/') || relPath.includes('/resolver/')) continue;
            if (relPath.includes('/restful/') || relPath.includes('/common/') || relPath.includes('/utils/')) continue;

            const basename = path.basename(file, '.java');
            const content = fs.readFileSync(file, 'utf-8');

            if (publicMethodClasses.has(basename)) {
                symbols.push(...this._extractMethods(content, relPath, { parentClass: basename }));
            }

            if (publicParamClasses.has(basename) || publicTypeDirs.some(dir => relPath.includes(dir))) {
                const classSymbol = this._extractClassSymbol(content, relPath, basename);
                if (classSymbol) symbols.push(classSymbol);
            }
        }

        return symbols;
    }

    _extractTopLevelClassName(content) {
        const match = content.match(/^\s*public\s+(?:abstract\s+|final\s+)?class\s+(\w+)/m);
        return match ? match[1] : null;
    }

    _extractClassSymbol(content, filePath, fallbackName) {
        const lines = content.split('\n');
        const name = this._extractTopLevelClassName(content) || fallbackName;
        const lineIndex = lines.findIndex(line => new RegExp(`\\bclass\\s+${name}\\b`).test(line));
        const params = this._extractBuilderFields(content);
        const builderMethods = this._extractBuilderMethods(content);

        return {
            name,
            kind: 'class',
            signature: `public class ${name}`,
            docstring: null,
            params: builderMethods.length > 0 ? builderMethods : params,
            filePath,
            lineNumber: lineIndex >= 0 ? lineIndex + 1 : 1,
            parentClass: null,
            decorators: [],
            returnType: null,
            baseClasses: [],
            requestClass: null,
        };
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
        const reqMatch = paramStr.match(/(\w+(?:Req\w*|Request))\s+\w+/);
        return reqMatch ? reqMatch[1] : null;
    }

    /**
     * Build a map of request class name → file path for fast lookup.
     */
    _indexReqFiles(allFiles) {
        const map = new Map();
        for (const f of allFiles) {
            const basename = path.basename(f, '.java');
            if (/Req(V\d+)?$/.test(basename) || /Request$/.test(basename)) {
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

    _extractBuilderMethods(content) {
        const params = [];
        const lines = content.split('\n');
        const builderStart = lines.findIndex(line => /^\s*public\s+static\s+(?:final\s+)?class\s+\w*Builder\b/.test(line));
        if (builderStart < 0) return params;

        let depth = 0;
        let inBuilder = false;
        const methodRegex = /^\s*public\s+([\w.<>,\s\[\]?]+?)\s+(\w+)\s*\(([^)]*)\)/;
        for (let i = builderStart; i < lines.length; i++) {
            const line = lines[i];
            for (const char of line) {
                if (char === '{') {
                    depth += 1;
                    inBuilder = true;
                } else if (char === '}') {
                    depth -= 1;
                }
            }
            if (!inBuilder) continue;
            if (i !== builderStart && depth <= 0) break;

            const match = line.match(methodRegex);
            if (!match) continue;
            const [, returnType, name, paramStr] = match;
            if (name === 'build') continue;
            if (this._isSetterMethod(name)) continue;
            const parts = paramStr.trim().split(/\s+/).filter(Boolean);
            const paramName = parts.length > 1 ? parts[parts.length - 1] : name;
            const paramType = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
            params.push({
                name,
                kind: 'keyword',
                type: paramType,
                default: null,
                method: name,
                fullSignature: `${name}(${paramStr.trim()})`,
                returnType: returnType.trim(),
                paramName,
            });
        }

        return params;
    }
}

module.exports = JavaScanner;
