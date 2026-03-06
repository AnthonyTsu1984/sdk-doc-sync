const PythonScanner = require('../../../../src/sdk-doc-sync/scanners/python-scanner');
const fs = require('fs');

const rootDir = process.argv[2] || './repos/pymilvus/pymilvus';
const outFile = process.argv[3] || '/tmp/pymilvus-scanned.json';

async function run() {
    const scanner = new PythonScanner({ rootDir, publicOnly: true });
    const symbols = await scanner.scan();

    const summary = {};
    symbols.forEach(s => { summary[s.kind] = (summary[s.kind] || 0) + 1; });
    console.log('Total symbols:', symbols.length);
    console.log('By kind:', JSON.stringify(summary));
    console.log('');

    // Group by parentClass
    const byParent = {};
    symbols.forEach(s => {
        const key = s.parentClass || '(top-level)';
        if (!byParent[key]) byParent[key] = [];
        byParent[key].push(s);
    });

    for (const [parent, syms] of Object.entries(byParent).sort((a, b) => b[1].length - a[1].length)) {
        console.log(`${parent}: ${syms.length} symbols`);
        syms.forEach(s => console.log(`  ${s.kind.padEnd(10)} ${s.name}`));
    }

    fs.writeFileSync(outFile, JSON.stringify(symbols, null, 2));
    console.log(`\nSaved ${symbols.length} symbols to ${outFile}`);
}

run().catch(err => { console.error(err); process.exit(1); });
