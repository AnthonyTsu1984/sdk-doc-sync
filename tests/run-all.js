#!/usr/bin/env node

/**
 * Test Runner - Run all tests in batch by category
 *
 * Usage:
 *   node tests/run-all.js                  # Run unit + offline tests
 *   node tests/run-all.js --all            # Run all tests (including integration)
 *   node tests/run-all.js --unit           # Run only unit tests
 *   node tests/run-all.js --offline        # Run only offline tests
 *   node tests/run-all.js --integration    # Run only integration tests
 *   node tests/run-all.js --name equations # Run a specific test by name
 *   node tests/run-all.js --list           # List all available tests
 */

const { execSync } = require('child_process');
const path = require('path');
const { config, tests } = require('./test.config');

const args = process.argv.slice(2);
const testsDir = __dirname;

function parseArgs() {
    if (args.includes('--list')) return { mode: 'list' };
    if (args.includes('--all')) return { mode: 'categories', categories: ['unit', 'offline', 'integration'] };
    if (args.includes('--unit')) return { mode: 'categories', categories: ['unit'] };
    if (args.includes('--offline')) return { mode: 'categories', categories: ['offline'] };
    if (args.includes('--integration')) return { mode: 'categories', categories: ['integration'] };

    const nameIdx = args.indexOf('--name');
    if (nameIdx !== -1 && args[nameIdx + 1]) {
        return { mode: 'name', name: args[nameIdx + 1] };
    }

    // Default: unit + offline (safe, no API calls)
    return { mode: 'categories', categories: ['unit', 'offline'] };
}

function listTests() {
    console.log('Available tests:\n');
    const categories = ['unit', 'offline', 'integration'];
    for (const cat of categories) {
        const catTests = tests.filter(t => t.category === cat);
        console.log(`  ${cat.toUpperCase()} (${catTests.length} tests):`);
        for (const t of catTests) {
            console.log(`    ${t.name.padEnd(25)} ${t.description}`);
        }
        console.log();
    }
}

function runTest(test) {
    const filePath = path.join(testsDir, test.file);
    const startTime = Date.now();

    try {
        execSync(`node "${filePath}"`, {
            stdio: 'pipe',
            cwd: path.resolve(testsDir, '..'),
            timeout: 30000,
            env: { ...process.env },
        });
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        return { status: 'pass', elapsed };
    } catch (err) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const output = (err.stdout?.toString() || '') + (err.stderr?.toString() || '');
        return { status: 'fail', elapsed, output };
    }
}

function main() {
    const parsed = parseArgs();

    if (parsed.mode === 'list') {
        listTests();
        return;
    }

    // Select tests to run
    let selected;
    if (parsed.mode === 'name') {
        selected = tests.filter(t => t.name === parsed.name || t.file === parsed.name);
        if (selected.length === 0) {
            console.error(`No test found matching: ${parsed.name}`);
            console.error('Use --list to see available tests.');
            process.exit(1);
        }
    } else {
        selected = tests.filter(t => parsed.categories.includes(t.category));
    }

    // Check integration prerequisites
    const hasIntegration = selected.some(t => t.category === 'integration');
    if (hasIntegration && !config.hasIntegrationTokens()) {
        console.log('Warning: Integration tests selected but tokens may be missing.');
        console.log('Set ROOT_TOKEN, BASE_TOKEN (and optionally WIKI_* tokens) in .env\n');
    }

    // Run tests
    console.log('='.repeat(60));
    console.log('  Test Runner');
    console.log('='.repeat(60));
    console.log(`  Tests: ${selected.length} selected`);
    console.log(`  Categories: ${[...new Set(selected.map(t => t.category))].join(', ')}`);
    console.log('='.repeat(60));
    console.log();

    const results = { pass: 0, fail: 0, details: [] };

    for (const test of selected) {
        process.stdout.write(`  ${test.category.padEnd(12)} ${test.name.padEnd(25)} `);
        const result = runTest(test);

        if (result.status === 'pass') {
            console.log(`PASS  (${result.elapsed}s)`);
            results.pass++;
        } else {
            console.log(`FAIL  (${result.elapsed}s)`);
            results.fail++;
        }
        results.details.push({ ...test, ...result });
    }

    // Summary
    console.log();
    console.log('='.repeat(60));
    console.log(`  Results: ${results.pass} passed, ${results.fail} failed, ${selected.length} total`);
    console.log('='.repeat(60));

    // Show failure details
    const failures = results.details.filter(d => d.status === 'fail');
    if (failures.length > 0) {
        console.log('\nFailure details:\n');
        for (const f of failures) {
            console.log(`--- ${f.name} (${f.file}) ---`);
            // Show last 20 lines of output
            const lines = (f.output || '').trim().split('\n');
            const tail = lines.slice(-20).join('\n');
            console.log(tail || '(no output)');
            console.log();
        }
    }

    process.exit(results.fail > 0 ? 1 : 0);
}

main();
