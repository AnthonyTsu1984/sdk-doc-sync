const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');

async function run() {
    const writer = new BitableWriter({ baseToken: 'J3Qzbv7AWazzivsv7vqcqlGCnFc' });
    const records = await writer.listRecords({ pageSize: 500 });

    const byPrefix = {};
    const noDash = [];

    for (const r of records) {
        const fields = r.fields || {};
        let slug = '';
        if (fields['Slug']) {
            if (Array.isArray(fields['Slug'])) {
                slug = fields['Slug'].map(s => s.text || s).join('');
            } else if (typeof fields['Slug'] === 'object') {
                slug = fields['Slug'].text || '';
            } else {
                slug = String(fields['Slug']);
            }
        }
        slug = slug.trim();
        if (!slug) continue;

        if (!slug.includes('-')) {
            noDash.push({ slug, type: fields['Type'] || '' });
            continue;
        }

        const prefix = slug.substring(0, slug.indexOf('-'));
        if (!byPrefix[prefix]) byPrefix[prefix] = [];
        byPrefix[prefix].push(slug);
    }

    console.log('=== Top-level (no dash) ===');
    noDash.forEach(n => console.log(`  ${n.slug} [${n.type}]`));

    console.log('\n=== All prefix groups ===');
    for (const [prefix, slugs] of Object.entries(byPrefix).sort((a, b) => b[1].length - a[1].length)) {
        console.log(`\n${prefix} (${slugs.length}):`);
        slugs.sort().forEach(s => console.log(`  ${s}`));
    }
}

run().catch(err => { console.error(err); process.exit(1); });
