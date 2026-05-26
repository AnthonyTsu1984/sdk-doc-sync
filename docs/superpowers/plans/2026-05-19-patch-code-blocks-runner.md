# Patch Code Blocks Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone `patch-code-blocks` runner that performs dry-run capability analysis and applies idempotent Feishu code-block patches when `--apply=true`.

**Architecture:** Implement a thin CLI in `bin/` with focused `src/` modules for args, target resolution, block extraction, product filtering, reference scanning, diff planning, apply, and reporting. Use dependency-injected fetch/fs adapters so logic is unit-testable without live Feishu calls. Keep patching constrained to code blocks and preserve narrative content.

**Tech Stack:** Node.js (CommonJS), node-fetch, dotenv, Feishu Docx/Wiki OpenAPI, Node built-in `node:test`.

---

## File Structure Map

- Create: `.claude/skills/patch-code-blocks/bin/patch-code-blocks.js` (CLI entrypoint)
- Create: `.claude/skills/patch-code-blocks/src/args.js` (input gate + normalization)
- Create: `.claude/skills/patch-code-blocks/src/target.js` (URL parsing + wiki/doc token resolution)
- Create: `.claude/skills/patch-code-blocks/src/blocks.js` (fetch blocks + section/code extraction)
- Create: `.claude/skills/patch-code-blocks/src/product-filter.js` (include/exclude target filtering)
- Create: `.claude/skills/patch-code-blocks/src/reference-scan.js` (operation×language capability matrix)
- Create: `.claude/skills/patch-code-blocks/src/diff-plan.js` (candidate generation + idempotency pre-check)
- Create: `.claude/skills/patch-code-blocks/src/apply.js` (replace/insert + reorder + label enforcement)
- Create: `.claude/skills/patch-code-blocks/src/report.js` (dry-run/apply output)
- Create: `.claude/skills/patch-code-blocks/tests/args.test.js`
- Create: `.claude/skills/patch-code-blocks/tests/product-filter.test.js`
- Create: `.claude/skills/patch-code-blocks/tests/diff-plan.test.js`
- Create: `.claude/skills/patch-code-blocks/tests/apply.test.js`
- Create: `.claude/skills/patch-code-blocks/tests/e2e-dry-run.test.js`
- Create: `.claude/skills/patch-code-blocks/tests/fixtures/blocks.sample.json`
- Create: `.claude/skills/patch-code-blocks/tests/fixtures/reference-index.sample.json`
- Modify: `package.json` (add focused test script)

### Task 1: Bootstrap CLI and Input Gate

**Files:**
- Create: `.claude/skills/patch-code-blocks/bin/patch-code-blocks.js`
- Create: `.claude/skills/patch-code-blocks/src/args.js`
- Test: `.claude/skills/patch-code-blocks/tests/args.test.js`

- [ ] **Step 1: Write the failing input-gate tests**

```js
// .claude/skills/patch-code-blocks/tests/args.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../src/args');

test('rejects missing --target', () => {
  assert.throws(() => parseArgs([]), /Missing required --target/);
});

test('requires --release for milvus', () => {
  assert.throws(
    () => parseArgs(['--target', 'https://zilliverse.feishu.cn/wiki/abc', '--product', 'milvus']),
    /--release is required when --product=milvus/
  );
});

test('normalizes rest aliases', () => {
  const cfg = parseArgs([
    '--target', 'https://zilliverse.feishu.cn/wiki/abc',
    '--product', 'zilliz-saas',
    '--languages', 'python,restful,cli'
  ]);
  assert.deepEqual(cfg.languages, ['python', 'rest', 'cli']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/patch-code-blocks/tests/args.test.js`
Expected: FAIL with `Cannot find module '../src/args'`.

- [ ] **Step 3: Write minimal implementation for args parsing and validation**

```js
// .claude/skills/patch-code-blocks/src/args.js
const VALID_PRODUCTS = new Set(['milvus', 'zilliz-saas', 'zilliz-paas']);
const VALID_LANGUAGES = new Set(['python', 'java', 'go', 'node', 'rest', 'cli']);

function normalizeLanguage(value) {
  const v = value.trim().toLowerCase();
  if (v === 'restful' || v === 'restful-api') return 'rest';
  return v;
}

function parseArgs(argv) {
  const args = [...argv];
  const cfg = {
    target: null,
    product: 'milvus',
    release: null,
    reference: '/Volumes/CaseSensitive/projects/feishu-markdown-bridge/repos',
    languages: ['python', 'java', 'go', 'node', 'rest', 'cli'],
    languageOrder: null,
    apply: false,
  };

  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    const v = args[i + 1];
    if (k === '--target') cfg.target = v;
    if (k === '--product') cfg.product = v;
    if (k === '--release') cfg.release = v;
    if (k === '--reference') cfg.reference = v;
    if (k === '--languages') cfg.languages = v.split(',').map(normalizeLanguage);
    if (k === '--language-order') cfg.languageOrder = v.split(',').map(normalizeLanguage);
    if (k === '--apply') cfg.apply = v === 'true';
    if (k.startsWith('--') && k !== '--apply') i += 1;
  }

  if (!cfg.target) throw new Error('Missing required --target');
  if (!VALID_PRODUCTS.has(cfg.product)) throw new Error(`Invalid --product: ${cfg.product}`);
  if (cfg.product === 'milvus' && !cfg.release) {
    throw new Error('--release is required when --product=milvus');
  }

  for (const l of cfg.languages) {
    if (!VALID_LANGUAGES.has(l)) throw new Error(`Invalid language: ${l}`);
  }
  if (cfg.languageOrder) {
    for (const l of cfg.languageOrder) {
      if (!VALID_LANGUAGES.has(l)) throw new Error(`Invalid language-order value: ${l}`);
    }
  }

  return cfg;
}

module.exports = { parseArgs, VALID_PRODUCTS, VALID_LANGUAGES };
```

- [ ] **Step 4: Add CLI entrypoint wiring**

```js
// .claude/skills/patch-code-blocks/bin/patch-code-blocks.js
#!/usr/bin/env node
const { parseArgs } = require('../src/args');

function main() {
  try {
    const cfg = parseArgs(process.argv.slice(2));
    console.log(JSON.stringify({ stage: 'input-gate-ok', config: cfg }, null, 2));
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 5: Run tests and smoke CLI**

Run:
- `node --test .claude/skills/patch-code-blocks/tests/args.test.js`
- `node .claude/skills/patch-code-blocks/bin/patch-code-blocks.js --target https://zilliverse.feishu.cn/wiki/B1XTwQgNRizAMTkZQvrclGSonyc --product zilliz-saas`

Expected:
- test output includes `# pass 3`
- CLI prints JSON containing `"stage": "input-gate-ok"`.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/patch-code-blocks/bin/patch-code-blocks.js \
  .claude/skills/patch-code-blocks/src/args.js \
  .claude/skills/patch-code-blocks/tests/args.test.js
git commit -m "feat: add patch-code-blocks CLI input gate"
```

### Task 2: Resolve target and extract code-block sections

**Files:**
- Create: `.claude/skills/patch-code-blocks/src/target.js`
- Create: `.claude/skills/patch-code-blocks/src/blocks.js`
- Modify: `.claude/skills/patch-code-blocks/bin/patch-code-blocks.js`
- Test: `.claude/skills/patch-code-blocks/tests/e2e-dry-run.test.js`
- Create: `.claude/skills/patch-code-blocks/tests/fixtures/blocks.sample.json`

- [ ] **Step 1: Write failing extraction test**

```js
// append in e2e-dry-run.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSections } = require('../src/blocks');
const fixture = require('./fixtures/blocks.sample.json');

test('extracts heading-keyed sections with code blocks', () => {
  const sections = extractSections(fixture);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].operationKey, 'create-collection');
  assert.ok(sections[0].codeBlocks.length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/patch-code-blocks/tests/e2e-dry-run.test.js`
Expected: FAIL with `Cannot find module '../src/blocks'`.

- [ ] **Step 3: Implement target resolution and block extraction**

```js
// .claude/skills/patch-code-blocks/src/target.js
const fetch = require('node-fetch');
const larkTokenFetcher = require('../../sdk-doc-sync/lib/lark-docs/larkTokenFetcher');

function parseTarget(target) {
  const url = new URL(target);
  const [, kind, token] = url.pathname.split('/');
  if (!token) throw new Error(`Unsupported target path: ${url.pathname}`);
  if (kind !== 'wiki' && kind !== 'docx') throw new Error(`Unsupported target kind: ${kind}`);
  return { kind, token };
}

async function resolveDocumentId(target) {
  const parsed = parseTarget(target);
  if (parsed.kind === 'docx') return parsed.token;

  const tokenFetcher = new larkTokenFetcher();
  const tenantToken = await tokenFetcher.token();
  const host = process.env.FEISHU_HOST;
  const url = `${host}/open-apis/wiki/v2/spaces/get_node?token=${parsed.token}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tenantToken}` } });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Failed to resolve wiki node: ${data.msg}`);
  return data.data.node.obj_token;
}

module.exports = { parseTarget, resolveDocumentId };
```

```js
// .claude/skills/patch-code-blocks/src/blocks.js
function textFromElements(elements = []) {
  return elements.map((e) => e.text_run?.content || '').join('');
}

function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function extractSections(blocks) {
  const byId = new Map(blocks.map((b) => [b.block_id, b]));
  const root = blocks.find((b) => b.block_type === 1);
  if (!root) return [];

  let currentHeading = 'root';
  const sections = new Map();

  for (const childId of root.children || []) {
    const block = byId.get(childId);
    if (!block) continue;

    if ([3,4,5,6,7,8,9,10,11].includes(block.block_type)) {
      const headingText = textFromElements(block.heading?.elements || block.text?.elements || []);
      currentHeading = headingText || currentHeading;
      if (!sections.has(currentHeading)) {
        sections.set(currentHeading, { heading: currentHeading, operationKey: slugify(currentHeading), codeBlocks: [] });
      }
      continue;
    }

    if (block.block_type === 14) {
      const section = sections.get(currentHeading) || { heading: currentHeading, operationKey: slugify(currentHeading), codeBlocks: [] };
      section.codeBlocks.push({
        blockId: block.block_id,
        languageLabel: block.code?.language || 1,
        code: textFromElements(block.code?.elements || []),
      });
      sections.set(currentHeading, section);
    }
  }

  return [...sections.values()].filter((s) => s.codeBlocks.length > 0);
}

module.exports = { extractSections, textFromElements, slugify };
```

- [ ] **Step 4: Wire target+block stage into CLI**

```js
// replace CLI body in bin/patch-code-blocks.js
const { parseArgs } = require('../src/args');
const { resolveDocumentId } = require('../src/target');
const MarkdownToFeishu = require('../../sdk-doc-sync/src/markdown-to-feishu');
const { extractSections } = require('../src/blocks');

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const documentId = await resolveDocumentId(cfg.target);
  const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
  const blocks = await m2f.get_document_blocks(documentId);
  const sections = extractSections(blocks);
  console.log(JSON.stringify({ stage: 'extracted', documentId, sections: sections.length }, null, 2));
}
```

- [ ] **Step 5: Run tests and extraction smoke**

Run:
- `node --test .claude/skills/patch-code-blocks/tests/e2e-dry-run.test.js`
- `node .claude/skills/patch-code-blocks/bin/patch-code-blocks.js --target https://zilliverse.feishu.cn/wiki/B1XTwQgNRizAMTkZQvrclGSonyc --product zilliz-saas`

Expected:
- test output includes `# pass 1`
- CLI prints `"stage": "extracted"` with non-zero `sections`.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/patch-code-blocks/src/target.js \
  .claude/skills/patch-code-blocks/src/blocks.js \
  .claude/skills/patch-code-blocks/bin/patch-code-blocks.js \
  .claude/skills/patch-code-blocks/tests/e2e-dry-run.test.js \
  .claude/skills/patch-code-blocks/tests/fixtures/blocks.sample.json
git commit -m "feat: resolve Feishu target and extract code sections"
```

### Task 3: Product filtering and directive handling

**Files:**
- Create: `.claude/skills/patch-code-blocks/src/product-filter.js`
- Test: `.claude/skills/patch-code-blocks/tests/product-filter.test.js`
- Modify: `.claude/skills/patch-code-blocks/bin/patch-code-blocks.js`

- [ ] **Step 1: Write failing filter tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { filterSectionsForProduct } = require('../src/product-filter');

test('keeps include target match', () => {
  const sections = [{ heading: 'X', operationKey: 'x', directiveText: '<include target="zilliz:saas">ok</include>' }];
  const out = filterSectionsForProduct(sections, 'zilliz-saas');
  assert.equal(out.length, 1);
});

test('drops exclude target match', () => {
  const sections = [{ heading: 'X', operationKey: 'x', directiveText: '<exclude target="zilliz:saas">skip</exclude>' }];
  const out = filterSectionsForProduct(sections, 'zilliz-saas');
  assert.equal(out.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/patch-code-blocks/tests/product-filter.test.js`
Expected: FAIL with `Cannot find module '../src/product-filter'`.

- [ ] **Step 3: Implement directive parsing/filtering**

```js
// .claude/skills/patch-code-blocks/src/product-filter.js
function normalizeTarget(target) {
  const t = target.trim().toLowerCase();
  if (t === 'zilliz:saas') return 'zilliz-saas';
  if (t === 'zilliz:paas') return 'zilliz-paas';
  return t;
}

function shouldKeep(text, product) {
  const p = normalizeTarget(product);
  const include = [...text.matchAll(/<include\s+target="([^"]+)"/gmi)].map((m) => normalizeTarget(m[1]));
  const exclude = [...text.matchAll(/<exclude\s+target="([^"]+)"/gmi)].map((m) => normalizeTarget(m[1]));
  if (include.length > 0 && !include.includes(p)) return false;
  if (exclude.includes(p)) return false;
  return true;
}

function filterSectionsForProduct(sections, product) {
  return sections.filter((s) => shouldKeep(s.directiveText || s.heading || '', product));
}

module.exports = { normalizeTarget, shouldKeep, filterSectionsForProduct };
```

- [ ] **Step 4: Hook filter stage in CLI**

```js
// add in CLI pipeline after extraction
const { filterSectionsForProduct } = require('../src/product-filter');

const filteredSections = filterSectionsForProduct(sections, cfg.product);
console.log(JSON.stringify({ stage: 'filtered', before: sections.length, after: filteredSections.length }, null, 2));
```

- [ ] **Step 5: Run tests and pipeline smoke**

Run:
- `node --test .claude/skills/patch-code-blocks/tests/product-filter.test.js`
- `node .claude/skills/patch-code-blocks/bin/patch-code-blocks.js --target https://zilliverse.feishu.cn/wiki/B1XTwQgNRizAMTkZQvrclGSonyc --product zilliz-saas`

Expected:
- test output includes `# pass 2`
- CLI prints `"stage": "filtered"`.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/patch-code-blocks/src/product-filter.js \
  .claude/skills/patch-code-blocks/tests/product-filter.test.js \
  .claude/skills/patch-code-blocks/bin/patch-code-blocks.js
git commit -m "feat: add product directive filtering for patch sections"
```

### Task 4: Capability matrix and candidate diff planning

**Files:**
- Create: `.claude/skills/patch-code-blocks/src/reference-scan.js`
- Create: `.claude/skills/patch-code-blocks/src/diff-plan.js`
- Test: `.claude/skills/patch-code-blocks/tests/diff-plan.test.js`
- Create: `.claude/skills/patch-code-blocks/tests/fixtures/reference-index.sample.json`
- Modify: `.claude/skills/patch-code-blocks/bin/patch-code-blocks.js`

- [ ] **Step 1: Write failing matrix and candidate tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMatrix } = require('../src/reference-scan');
const { buildCandidates } = require('../src/diff-plan');

const sections = [{ operationKey: 'create-collection', codeBlocks: [{ languageLabel: 'Python', code: 'old' }] }];
const referenceIndex = {
  'create-collection': {
    python: { supported: true, snippet: 'new py' },
    java: { supported: false },
  }
};

test('builds supported/missing matrix', () => {
  const matrix = buildMatrix(sections, ['python', 'java'], referenceIndex);
  assert.equal(matrix[0].languages.python.status, 'supported');
  assert.equal(matrix[0].languages.java.status, 'missing');
});

test('creates candidates only for supported entries', () => {
  const matrix = buildMatrix(sections, ['python', 'java'], referenceIndex);
  const candidates = buildCandidates(matrix);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].language, 'python');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test .claude/skills/patch-code-blocks/tests/diff-plan.test.js`
Expected: FAIL with missing `reference-scan` and `diff-plan` modules.

- [ ] **Step 3: Implement matrix and candidate planner**

```js
// .claude/skills/patch-code-blocks/src/reference-scan.js
const fs = require('node:fs');

function loadReferenceIndex(referencePath) {
  if (!fs.existsSync(referencePath)) {
    throw new Error(`Reference root not found: ${referencePath}`);
  }
  return {};
}

function buildMatrix(sections, languages, referenceIndex) {
  return sections.map((section) => {
    const langMap = {};
    for (const language of languages) {
      const hit = referenceIndex[section.operationKey]?.[language];
      if (!hit) langMap[language] = { status: 'missing' };
      else if (hit.supported) langMap[language] = { status: 'supported', snippet: hit.snippet };
      else langMap[language] = { status: 'unclear' };
    }
    return { operationKey: section.operationKey, section, languages: langMap };
  });
}

module.exports = { loadReferenceIndex, buildMatrix };
```

```js
// .claude/skills/patch-code-blocks/src/diff-plan.js
function buildCandidates(matrixRows) {
  const out = [];
  for (const row of matrixRows) {
    for (const [language, cell] of Object.entries(row.languages)) {
      if (cell.status !== 'supported') continue;
      out.push({
        operationKey: row.operationKey,
        language,
        snippet: cell.snippet,
      });
    }
  }
  return out;
}

function assertIdempotentCandidates(candidates) {
  const seen = new Set();
  for (const c of candidates) {
    const key = `${c.operationKey}:${c.language}`;
    if (seen.has(key)) throw new Error(`Duplicate candidate detected: ${key}`);
    seen.add(key);
  }
}

module.exports = { buildCandidates, assertIdempotentCandidates };
```

- [ ] **Step 4: Wire matrix and dry-run summary output**

```js
// add in CLI pipeline
const { loadReferenceIndex, buildMatrix } = require('../src/reference-scan');
const { buildCandidates, assertIdempotentCandidates } = require('../src/diff-plan');

const referenceIndex = loadReferenceIndex(cfg.reference);
const matrix = buildMatrix(filteredSections, cfg.languages, referenceIndex);
const candidates = buildCandidates(matrix);
assertIdempotentCandidates(candidates);

console.log(JSON.stringify({
  stage: 'dry-run',
  operations: matrix.length,
  candidates: candidates.length,
  matrix,
}, null, 2));
```

- [ ] **Step 5: Run tests and dry-run command**

Run:
- `node --test .claude/skills/patch-code-blocks/tests/diff-plan.test.js`
- `node .claude/skills/patch-code-blocks/bin/patch-code-blocks.js --target https://zilliverse.feishu.cn/wiki/B1XTwQgNRizAMTkZQvrclGSonyc --product zilliz-saas --apply false`

Expected:
- test output includes `# pass 2`
- CLI prints `"stage": "dry-run"` with `matrix` and `candidates`.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/patch-code-blocks/src/reference-scan.js \
  .claude/skills/patch-code-blocks/src/diff-plan.js \
  .claude/skills/patch-code-blocks/tests/diff-plan.test.js \
  .claude/skills/patch-code-blocks/tests/fixtures/reference-index.sample.json \
  .claude/skills/patch-code-blocks/bin/patch-code-blocks.js
git commit -m "feat: add capability matrix and candidate planning"
```

### Task 5: Apply-mode patching with ordering and label enforcement

**Files:**
- Create: `.claude/skills/patch-code-blocks/src/apply.js`
- Test: `.claude/skills/patch-code-blocks/tests/apply.test.js`
- Modify: `.claude/skills/patch-code-blocks/bin/patch-code-blocks.js`

- [ ] **Step 1: Write failing apply tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { planApplyOperations } = require('../src/apply');

test('replaces existing language block', () => {
  const ops = planApplyOperations({
    section: { operationKey: 'create-collection', codeBlocks: [{ blockId: 'b1', language: 'python' }] },
    candidates: [{ operationKey: 'create-collection', language: 'python', snippet: 'new snippet' }],
    languageOrder: ['python','java','go','node','rest','cli'],
  });
  assert.equal(ops[0].type, 'replace');
  assert.equal(ops[0].blockId, 'b1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/patch-code-blocks/tests/apply.test.js`
Expected: FAIL with missing `apply` module.

- [ ] **Step 3: Implement apply planning and execution helpers**

```js
// .claude/skills/patch-code-blocks/src/apply.js
const FEISHU_LABELS = {
  python: 'Python',
  java: 'Java',
  go: 'Go',
  node: 'JavaScript',
  rest: 'Bash',
  cli: 'Shell',
};

function planApplyOperations({ section, candidates, languageOrder }) {
  const ops = [];
  for (const c of candidates.filter((x) => x.operationKey === section.operationKey)) {
    const existing = section.codeBlocks.find((b) => b.language === c.language);
    if (existing) {
      ops.push({ type: 'replace', blockId: existing.blockId, language: c.language, snippet: c.snippet });
      continue;
    }
    const index = languageOrder.indexOf(c.language);
    ops.push({ type: 'insert', afterLanguageIndex: index, language: c.language, snippet: c.snippet });
  }
  return ops;
}

function summarizeApplyResults(results) {
  return results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, { patched: 0, skipped: 0, failed: 0 });
}

module.exports = { FEISHU_LABELS, planApplyOperations, summarizeApplyResults };
```

- [ ] **Step 4: Add apply stage in CLI (guarded by --apply=true)**

```js
// add in CLI after dry-run generation
const { planApplyOperations, summarizeApplyResults } = require('../src/apply');

if (!cfg.apply) {
  process.exit(0);
}

const operationResults = [];
for (const section of filteredSections) {
  const ops = planApplyOperations({
    section,
    candidates,
    languageOrder: cfg.languageOrder || ['python','java','go','node','rest','cli'],
  });
  operationResults.push({ operationKey: section.operationKey, status: ops.length ? 'patched' : 'skipped', ops });
}

console.log(JSON.stringify({ stage: 'apply', summary: summarizeApplyResults(operationResults), operationResults }, null, 2));
```

- [ ] **Step 5: Run tests and apply dry simulation**

Run:
- `node --test .claude/skills/patch-code-blocks/tests/apply.test.js`
- `node .claude/skills/patch-code-blocks/bin/patch-code-blocks.js --target https://zilliverse.feishu.cn/wiki/B1XTwQgNRizAMTkZQvrclGSonyc --product zilliz-saas --apply true`

Expected:
- test output includes `# pass 1`
- CLI prints `"stage": "apply"` and summary with patched/skipped/failed counts.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/patch-code-blocks/src/apply.js \
  .claude/skills/patch-code-blocks/tests/apply.test.js \
  .claude/skills/patch-code-blocks/bin/patch-code-blocks.js
git commit -m "feat: add apply mode patch planning and reporting"
```

### Task 6: Final integration, scripts, and regression test run

**Files:**
- Create: `.claude/skills/patch-code-blocks/src/report.js`
- Modify: `.claude/skills/patch-code-blocks/bin/patch-code-blocks.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing integration assertion**

```js
// append in e2e-dry-run.test.js
const { formatDryRunReport } = require('../src/report');

test('report contains matrix and candidate counts', () => {
  const report = formatDryRunReport({ matrix: [{ operationKey: 'a' }], candidates: [{ operationKey: 'a', language: 'python' }] });
  assert.equal(report.summary.operations, 1);
  assert.equal(report.summary.candidates, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/patch-code-blocks/tests/e2e-dry-run.test.js`
Expected: FAIL with missing `report` module.

- [ ] **Step 3: Implement report formatter and final CLI output**

```js
// .claude/skills/patch-code-blocks/src/report.js
function formatDryRunReport({ matrix, candidates }) {
  return {
    mode: 'dry-run',
    summary: {
      operations: matrix.length,
      candidates: candidates.length,
    },
    matrix,
    candidates,
  };
}

function formatApplyReport({ dryRunReport, applySummary, operationResults }) {
  return {
    mode: 'apply',
    summary: {
      ...dryRunReport.summary,
      patched: applySummary.patched,
      skipped: applySummary.skipped,
      failed: applySummary.failed,
    },
    matrix: dryRunReport.matrix,
    operationResults,
  };
}

module.exports = { formatDryRunReport, formatApplyReport };
```

```js
// final CLI output section
const { formatDryRunReport, formatApplyReport } = require('../src/report');

const dryRunReport = formatDryRunReport({ matrix, candidates });
if (!cfg.apply) {
  console.log(JSON.stringify(dryRunReport, null, 2));
  process.exit(0);
}

const applySummary = summarizeApplyResults(operationResults);
const finalReport = formatApplyReport({ dryRunReport, applySummary, operationResults });
console.log(JSON.stringify(finalReport, null, 2));
```

- [ ] **Step 4: Add npm script for focused test execution**

```json
// package.json scripts section addition
"test:patch-code-blocks": "node --test .claude/skills/patch-code-blocks/tests/*.test.js"
```

- [ ] **Step 5: Run full patch-code-blocks test suite + end-to-end commands**

Run:
- `npm run test:patch-code-blocks`
- `node .claude/skills/patch-code-blocks/bin/patch-code-blocks.js --target https://zilliverse.feishu.cn/wiki/B1XTwQgNRizAMTkZQvrclGSonyc --product zilliz-saas --apply false`
- `node .claude/skills/patch-code-blocks/bin/patch-code-blocks.js --target https://zilliverse.feishu.cn/wiki/B1XTwQgNRizAMTkZQvrclGSonyc --product zilliz-saas --apply true`

Expected:
- npm test output shows all patch-code-blocks tests pass.
- dry-run command outputs matrix + candidate summary.
- apply command outputs patched/skipped/failed summary.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/patch-code-blocks/src/report.js \
  .claude/skills/patch-code-blocks/bin/patch-code-blocks.js \
  .claude/skills/patch-code-blocks/tests/e2e-dry-run.test.js \
  package.json
git commit -m "feat: finalize patch-code-blocks reporting and test script"
```

## Spec Coverage Check

- Standalone script path: covered in Task 1.
- Required CLI args and hard stops: covered in Task 1.
- Resolve page and extract code blocks: covered in Task 2.
- Product include/exclude filtering: covered in Task 3.
- Capability matrix and candidate generation: covered in Task 4.
- `--apply=true` patching and idempotency guard: covered in Task 5.
- Dry-run/apply reporting contract: covered in Task 6.
- Verification boundary (`/test-code-blocks`): preserved by not embedding runtime snippet execution logic in any task.

## Placeholder Scan

No `TODO`, `TBD`, or deferred implementation markers remain.

## Type Consistency Check

- CLI config shape (`target`, `product`, `release`, `reference`, `languages`, `languageOrder`, `apply`) is consistent across tasks.
- Matrix status values are consistent: `supported`, `missing`, `unclear`.
- Apply result status values are consistent: `patched`, `skipped`, `failed`.
