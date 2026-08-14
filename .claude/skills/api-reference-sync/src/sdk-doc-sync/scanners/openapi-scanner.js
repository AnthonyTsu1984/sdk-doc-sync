const fs = require('fs');
const path = require('path');
const BaseScanner = require('./base-scanner');

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']);

function escapePointer(segment) {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

class OpenApiScanner extends BaseScanner {
    _defaultExcludes() {
        return ['node_modules/**', '.git/**'];
    }

    async scan() {
        const files = fs.existsSync(this.rootDir) && fs.statSync(this.rootDir).isFile()
            ? [this.rootDir]
            : this._walkFiles(['.json']);
        const operations = [];
        for (const filePath of files) {
            const spec = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            for (const [operationPath, pathItem] of Object.entries(spec.paths || {})) {
                if (!pathItem || typeof pathItem !== 'object') continue;
                for (const [method, operation] of Object.entries(pathItem)) {
                    const normalizedMethod = method.toLowerCase();
                    if (!HTTP_METHODS.has(normalizedMethod) || !operation || typeof operation !== 'object') continue;
                    const sourceFile = path.relative(this.rootDir, filePath) || path.basename(filePath);
                    operations.push({
                        spec,
                        path: operationPath,
                        method: normalizedMethod,
                        name: operation.operationId || `${normalizedMethod.toUpperCase()} ${operationPath}`,
                        kind: 'rest-operation',
                        filePath: path.relative(this.rootDir, filePath) || path.basename(filePath),
                        operationPointer: `#/paths/${escapePointer(operationPath)}/${normalizedMethod}`,
                        operationId: operation.operationId || `${normalizedMethod}:${operationPath}`,
                        sourceFile,
                        lineNumber: 1,
                    });
                }
            }
        }
        return operations;
    }
}

module.exports = OpenApiScanner;
