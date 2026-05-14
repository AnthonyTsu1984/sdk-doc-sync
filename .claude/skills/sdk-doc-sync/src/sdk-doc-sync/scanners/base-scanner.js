const fs = require('fs');
const path = require('path');

class BaseScanner {
    constructor({ rootDir, include = [], exclude = [], publicOnly = true }) {
        this.rootDir = path.resolve(rootDir);
        this.include = include;
        this.exclude = exclude;
        this.publicOnly = publicOnly;
    }

    _walkFiles(extensions = []) {
        const results = [];
        const walk = (dir) => {
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relPath = path.relative(this.rootDir, fullPath);

                if (this._isExcluded(relPath, entry.name)) continue;

                if (entry.isDirectory()) {
                    walk(fullPath);
                } else if (entry.isFile()) {
                    if (extensions.length > 0 && !extensions.some(ext => entry.name.endsWith(ext))) {
                        continue;
                    }
                    if (this.include.length > 0 && !this._matchesAny(relPath, this.include)) {
                        continue;
                    }
                    results.push(fullPath);
                }
            }
        };

        walk(this.rootDir);
        return results;
    }

    _isExcluded(relPath, name) {
        if (this.exclude.length > 0 && this._matchesAny(relPath, this.exclude)) {
            return true;
        }
        if (this._defaultExcludes().some(pattern => this._matchGlob(relPath, pattern) || this._matchGlob(name, pattern))) {
            return true;
        }
        return false;
    }

    _matchesAny(relPath, patterns) {
        return patterns.some(pattern => this._matchGlob(relPath, pattern));
    }

    _matchGlob(str, pattern) {
        const regex = this._globToRegex(pattern);
        return regex.test(str);
    }

    _globToRegex(glob) {
        let regex = glob
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '{{GLOBSTAR}}')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '[^/]')
            .replace(/\{\{GLOBSTAR\}\}/g, '.*');
        return new RegExp(`^${regex}$`);
    }

    _defaultExcludes() {
        return [];
    }

    async scan() {
        throw new Error('scan() must be implemented by subclass');
    }
}

module.exports = BaseScanner;
