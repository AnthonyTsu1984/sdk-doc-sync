'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    DEFAULT_RECIPES_PATH,
    IntakeRecipesError,
    loadIntakeRecipes,
    recipeFor,
    recipeLines,
    validateRecipes,
} = require('../src/sdk-doc-sync/intake-recipes');

test('the shipped intake-recipes config validates: 8 collected entries + 6 batch-15 additions', () => {
    const recipes = loadIntakeRecipes(DEFAULT_RECIPES_PATH);
    // 既有 8 条（java-v30-campaign.dwf.ts ERROR_RECIPES 收编）
    for (const code of [
        'RUN_MANIFEST_EVIDENCE_CONFLICT',
        'EXECUTION_RECONCILIATION_REQUIRED',
        'REVIEW_SESSION_REFERENCE_CONTEXT_REQUIRED',
        'RELEASE_ROOT_TOKEN_MISMATCH',
        'MISSING_REVIEWED_EVIDENCE',
        'SESSION_STATE_EXISTS',
        'ADMISSION_DIRTY_WORKTREE',
        'REVIEW_SESSION_INVALID',
    ]) {
        assert.ok(recipes.some((entry) => entry.match === code), `missing collected entry: ${code}`);
    }
    // 批 15 新增（设计 §8.2 今日六条）
    for (const code of [
        'GROUPING_STALE',
        'TARGET_ANCESTRY_REQUIRED',
        'PLACEMENT_TARGET_CHAIN_STALE',
        'TREE_DELTA_POINTING_TRACK_UNCLASSIFIED',
        'SCHEMA_FIRST_GENERATION_FAILED',
        'INTAKE_CONTEXT_KEYS_UNEXPECTED',
    ]) {
        assert.ok(recipes.some((entry) => entry.match === code), `missing batch-15 entry: ${code}`);
    }
    // Scope-chain recipes say filtered-scope, not of-record (the §6 lesson).
    const grouping = recipes.find((entry) => entry.match === 'GROUPING_STALE');
    assert.match(grouping.recipe, /filtered-scope/);
    assert.match(recipes.find((entry) => entry.match === 'TARGET_ANCESTRY_REQUIRED').recipe, /filtered-scope/);
});

test('recipeFor keeps the dwf semantics: substring containment, table order, first match wins', () => {
    const recipes = loadIntakeRecipes();
    assert.match(recipeFor('dry-run failed with GROUPING_STALE on receipt lineage', recipes), /^GROUPING_STALE → /);
    // A text carrying two codes matches the EARLIER TABLE entry, not the
    // first-in-text one (the dwf loop iterates table keys in order).
    assert.match(recipeFor('TARGET_ANCESTRY_REQUIRED then GROUPING_STALE', recipes), /^GROUPING_STALE → /);
    assert.equal(recipeFor('nothing matches here', recipes), null);
    assert.equal(recipeFor('', recipes), null);
});

test('recipeLines dedupes by code and preserves table order across a batch of texts', () => {
    const recipes = [
        { match: 'ALPHA', recipe: 'alpha fix' },
        { match: 'BETA', recipe: 'beta fix' },
        { match: 'GAMMA', recipe: 'gamma fix' },
    ];
    const lines = recipeLines(['x BETA x', 'ALPHA', 'ALPHA again'], recipes);
    assert.deepEqual(lines, ['recipe: ALPHA → alpha fix', 'recipe: BETA → beta fix']);
    assert.deepEqual(recipeLines([], recipes), []);
});

function writeConfig(temp, document) {
    const filePath = path.join(temp, `recipes-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(filePath, typeof document === 'string' ? document : JSON.stringify(document));
    return filePath;
}

test('a malformed recipe table is a typed fail-closed refusal, never "no recipes"', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-recipes-'));
    for (const broken of [
        { schemaVersion: 2, recipes: [{ match: 'A', recipe: 'b' }] },
        { schemaVersion: 1, recipes: [] },
        { schemaVersion: 1 },
        { schemaVersion: 1, recipes: [{ match: 'A' }] },
        { schemaVersion: 1, recipes: [{ match: '', recipe: 'b' }] },
        'not json at all {',
    ]) {
        const filePath = writeConfig(temp, broken);
        assert.throws(
            () => loadIntakeRecipes(filePath),
            (error) => error instanceof IntakeRecipesError && error.code === 'INTAKE_RECIPES_MALFORMED',
            `expected typed refusal for ${JSON.stringify(broken).slice(0, 40)}`,
        );
    }
    assert.throws(
        () => loadIntakeRecipes(path.join(temp, 'absent.json')),
        (error) => error instanceof IntakeRecipesError && error.code === 'INTAKE_RECIPES_MALFORMED',
    );
});

test('the sdk-doc-sync CLI attaches recipe lines to stderr for matching planning errors', async () => {
    // Minimal replica of the sdk-doc-sync-cli offline dry-run harness (its
    // helpers live inside that test file on purpose): a python dry-run whose
    // reviewed context carries no reviewed evidence plans one
    // MISSING_REVIEWED_EVIDENCE error — the recipe line must ride stderr
    // while stdout stays the machine face.
    const { runCli } = require('../bin/sdk-doc-sync');
    const symbol = JSON.parse(fs.readFileSync(
        path.resolve(__dirname, 'fixtures', 'scanners', 'python-search.json'), 'utf8'));
    const stdout = [];
    const stderr = [];
    const exitCodes = [];
    const result = await runCli({
        argv: [
            'node', 'sdk-doc-sync',
            '--sdk-dir', '/fixtures/sdk',
            '--language', 'python',
            '--sdk-name', 'python',
            '--sdk-version', 'v2.6.0',
            '--dry-run', '--json',
        ],
        env: {},
        dependencies: {
            loadEnv: false,
            scanner: { rootDir: '/fixtures/sdk', async scan() { return [symbol]; } },
            indexReader: async () => [],
            referenceContextProvider: async () => ({
                category: 'Vector',
                repository: 'milvus-io/pymilvus',
                revision: 'v2.6.0',
                summary: 'This operation searches vectors in a collection and returns nearest matches.',
                reviewedEvidence: [],
                params: [
                    { name: 'collection_name', kind: 'positional', type: 'str', default: null, description: 'The name of the target collection.' },
                    { name: 'data', kind: 'positional', type: 'list[list[float]]', default: null, description: 'The query vectors.' },
                    { name: '*', kind: 'separator', type: null, default: null },
                    { name: 'limit', kind: 'keyword', type: 'int', default: '10', description: 'The maximum number of matches to return.' },
                    { name: 'kwargs', kind: 'kwargs', type: 'Any', default: null, description: 'Additional search options forwarded to the request.' },
                ],
                examples: [{
                    title: 'Search a collection',
                    description: 'Runs a vector search.',
                    language: 'python',
                    code: 'results = client.search(collection_name="docs", data=[[0.1, 0.2]], limit=10)',
                }],
                result: {
                    type: 'list[SearchResult]',
                    description: 'Returns the matching entities ordered by similarity.',
                    fields: [
                        { name: 'results', type: 'list[SearchResult]', description: 'The matching search results ordered by similarity.' },
                    ],
                },
                exceptions: [{
                    name: 'MilvusException',
                    condition: 'The server rejects the search request.',
                    description: 'Reports the server error code and message.',
                }],
            }),
            onStdout: (line) => stdout.push(line),
            onStderr: (line) => stderr.push(line),
            exit: (code) => exitCodes.push(code),
        },
    });
    assert.equal(result.planningErrors.length, 1);
    assert.equal(result.planningErrors[0].code, 'MISSING_REVIEWED_EVIDENCE');
    assert.match(stderr.join('\n'), /recipe: MISSING_REVIEWED_EVIDENCE → /);
    assert.doesNotMatch(stdout.join('\n'), /recipe: /);
});
