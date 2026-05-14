/**
 * ReportGenerator — produces a Markdown alignment report from the
 * method registry and parameter comparisons.
 *
 * Uses HTML tables so MarkdownToFeishu renders them as native Feishu tables.
 */

const ALL_LANGUAGES = ['python', 'java', 'node', 'cpp', 'go'];
const LANG_HEADERS = { python: 'Py', java: 'Java', node: 'Node', cpp: 'C++', go: 'Go' };

// Feishu API rejects tables with row_size >= 10; keep 1 header + up to 8 data rows
const MAX_ROWS = 8;

// Category display order
const CATEGORY_ORDER = [
    'Client', 'Collections', 'Database', 'Management',
    'Partitions', 'Vector', 'Authentication', 'ResourceGroup',
    'Uncategorized',
];

class ReportGenerator {
    /**
     * @param {string[]} languages - SDK languages to include in the report
     */
    constructor(languages = ALL_LANGUAGES) {
        this.languages = languages;
    }

    /**
     * Generate the full markdown report.
     *
     * @param {Map} registry - Map<canonicalName, { category, sdks }>
     * @param {Object} paramComparisons - { canonicalName: { params, allLanguages } }
     * @param {string} date - Report date string
     * @returns {string} Markdown content
     */
    generate(registry, paramComparisons, date) {
        const sections = [];

        sections.push(`# Milvus SDK Alignment Report - ${date}`);
        sections.push('');
        sections.push(this._generateSummary(registry));
        sections.push('');
        sections.push(this._generateCoverageMatrix(registry));
        sections.push('');
        sections.push(this._generateDisalignmentDetails(registry, paramComparisons));
        sections.push('');
        sections.push(this._generateMissingSummary(registry));

        return sections.join('\n');
    }

    _generateSummary(registry) {
        let total = 0;
        let fullyAligned = 0;
        let partial = 0;
        let singleSdk = 0;

        for (const [, entry] of registry) {
            total++;
            const sdkCount = this._countSdks(entry);
            if (sdkCount === this.languages.length) {
                fullyAligned++;
            } else if (sdkCount === 1) {
                singleSdk++;
            } else {
                partial++;
            }
        }

        const lines = [
            '## Summary',
            '',
            `- Total canonical methods: ${total}`,
            `- Fully aligned (all ${this.languages.length} SDKs): ${fullyAligned}`,
            `- Partially aligned: ${partial}`,
            `- SDK-specific only: ${singleSdk}`,
        ];

        return lines.join('\n');
    }

    _generateCoverageMatrix(registry) {
        const lines = ['## Method Coverage Matrix'];

        // Group rows by category
        const byCategory = {};
        for (const [name, entry] of registry) {
            const cat = entry.category;
            if (!byCategory[cat]) byCategory[cat] = [];
            byCategory[cat].push({ name, ...entry });
        }

        for (const cat of CATEGORY_ORDER) {
            const rows = byCategory[cat];
            if (!rows || rows.length === 0) continue;
            rows.sort((a, b) => a.name.localeCompare(b.name));

            lines.push('');
            lines.push(`### ${cat}`);

            // Split into chunks of MAX_ROWS to stay within Feishu 9-row table limit
            for (let i = 0; i < rows.length; i += MAX_ROWS) {
                const chunk = rows.slice(i, i + MAX_ROWS);
                lines.push('');
                lines.push(this._buildCoverageTable(chunk));
            }
        }

        return lines.join('\n');
    }

    _buildCoverageTable(rows) {
        const langHeaders = this.languages.map(l => `<th>${LANG_HEADERS[l]}</th>`).join('');
        const lines = [`<table><tr><th>Method</th>${langHeaders}</tr>`];
        for (const row of rows) {
            const langCells = this.languages.map(lang => {
                const mark = row.sdks[lang] ? '\u2713' : '-';
                return `<td>${mark}</td>`;
            }).join('');
            lines.push(`<tr><td>${row.name}</td>${langCells}</tr>`);
        }
        lines.push('</table>');
        return lines.join('\n');
    }

    _generateDisalignmentDetails(registry, paramComparisons) {
        const sections = ['## Disalignment Details'];

        // Group by category
        const byCategory = {};
        for (const [name, entry] of registry) {
            const sdkCount = this._countSdks(entry);
            if (sdkCount <= 1) continue;

            const cat = entry.category;
            if (!byCategory[cat]) byCategory[cat] = [];
            byCategory[cat].push({ name, entry, sdkCount });
        }

        for (const cat of CATEGORY_ORDER) {
            if (!byCategory[cat] || byCategory[cat].length === 0) continue;

            sections.push('');
            sections.push(`### ${cat}`);

            for (const { name, entry, sdkCount } of byCategory[cat]) {
                const sdkList = this.languages
                    .map(lang => entry.sdks[lang] ? LANG_HEADERS[lang] : null)
                    .filter(Boolean)
                    .join(', ');

                const missingList = this.languages
                    .filter(lang => !entry.sdks[lang])
                    .map(lang => LANG_HEADERS[lang]);

                sections.push('');
                if (sdkCount === this.languages.length) {
                    sections.push(`**${name}** \u2014 All ${this.languages.length} SDKs \u2713`);
                } else {
                    sections.push(`**${name}** \u2014 ${sdkList} (missing: ${missingList.join(', ')})`);
                }

                // Show param comparison as a table if there are disaligned params
                const comparison = paramComparisons[name];
                if (comparison && comparison.params.size > 0) {
                    const hasDisalignment = this._hasParamDisalignment(comparison, entry);
                    if (hasDisalignment) {
                        const disalignedParams = [];
                        for (const [param, presence] of comparison.params) {
                            const allPresent = this.languages.every(lang =>
                                !entry.sdks[lang] || presence[lang]
                            );
                            if (!allPresent) {
                                disalignedParams.push({ param, presence });
                            }
                        }

                        if (disalignedParams.length > 0) {
                            for (let pi = 0; pi < disalignedParams.length; pi += MAX_ROWS) {
                                const chunk = disalignedParams.slice(pi, pi + MAX_ROWS);
                                sections.push('');
                                const langHeaders = this.languages.map(l => `<th>${LANG_HEADERS[l]}</th>`).join('');
                                sections.push(`<table><tr><th>Parameter</th>${langHeaders}</tr>`);
                                for (const { param, presence } of chunk) {
                                    const langCells = this.languages.map(lang => {
                                        if (!entry.sdks[lang]) return '<td>n/a</td>';
                                        return presence[lang] ? '<td>\u2713</td>' : '<td>-</td>';
                                    }).join('');
                                    sections.push(`<tr><td>${param}</td>${langCells}</tr>`);
                                }
                                sections.push('</table>');
                            }
                        }
                    }
                }
            }
        }

        return sections.join('\n');
    }

    _generateMissingSummary(registry) {
        const missing = {};
        for (const lang of this.languages) {
            missing[lang] = [];
        }

        for (const [name, entry] of registry) {
            if (this._countSdks(entry) <= 1) continue;

            for (const lang of this.languages) {
                if (!entry.sdks[lang]) {
                    missing[lang].push(name);
                }
            }
        }

        const lines = ['## Missing Methods by SDK'];

        for (const lang of this.languages) {
            const list = missing[lang];
            if (list.length === 0) {
                lines.push(`- **${LANG_HEADERS[lang]}**: fully covered`);
            } else {
                list.sort();
                lines.push(`- **${LANG_HEADERS[lang]}** missing (${list.length}): ${list.join(', ')}`);
            }
        }

        return lines.join('\n');
    }

    _countSdks(entry) {
        return this.languages.filter(lang => entry.sdks[lang]).length;
    }

    _hasParamDisalignment(comparison, entry) {
        for (const [, presence] of comparison.params) {
            const presentLangs = this.languages.filter(lang => entry.sdks[lang]);
            const hasParam = presentLangs.filter(lang => presence[lang]);
            if (hasParam.length > 0 && hasParam.length < presentLangs.length) {
                return true;
            }
        }
        return false;
    }
}

module.exports = ReportGenerator;
