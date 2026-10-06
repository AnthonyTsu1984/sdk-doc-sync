'use strict';
// Headless regression coverage for the single-file SPA: the page script is
// evaluated against minimal DOM stubs and the router is driven the way the
// browser would (set location.hash → route()). Born from a real defect —
// the revision detail page crashed inside pageCampaign before its fallback
// could match, so the hash changed but the page never rendered — which
// module-level tests cannot see because the bug lived in inline JS.

const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const INDEX_HTML = path.join(__dirname, '..', '..', 'scripts', 'dashboard', 'public', 'index.html');

function loadPageScript() {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(match, 'index.html carries its inline script');
  const elements = {};
  const el = (id) => elements[id] ||= {
    innerHTML: '', textContent: '', className: '', href: '', value: '',
    classList: { add() {}, remove() {}, contains() { return false; } },
    insertAdjacentHTML() {}, outerHTML: '',
  };
  const location = { hash: '' };
  const page = {
    window: { addEventListener() {} },
    document: { getElementById: el, querySelector: () => null, addEventListener() {} },
    EventSource: class { addEventListener() {} },
    confirm: () => false,
    alert: () => {},
    navigator: {},
    payload: null,
  };
  page.fetch = async (url) => ({
    json: async () => (String(url).includes('/api/cards') ? page.payload : {
      ok: true, available: true,
      totals: { sessions: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      collectedSince: null, perUnit: [], sessions: [],
    }),
  });
  // Strip the page's own bootstrap (SSE/poll/initial fetch) and timers; the
  // test drives the router explicitly via the captured handle.
  const source = match[1]
    .replace("'use strict';", '')
    .replace('connect();', '')
    .replace(/setInterval\(/g, '(()=>{})(');
  const api = {};
  const harness = new Function(
    'window', 'document', 'location', 'EventSource', 'fetch', 'confirm', 'alert', 'navigator', 'setTimeout', 'capture',
    `${source}
     capture({ route, parseHash, cardKey, snapshotUiState, restoreUiState, setPage: (p) => { latest = p; } });`,
  );
  harness(
    page.window, page.document, location, page.EventSource, page.fetch,
    page.confirm, page.alert, page.navigator, setTimeout,
    (captured) => Object.assign(api, captured, { location, document: page.document }),
  );
  return { api, elements };
}

function revisionPayload() {
  return {
    uiVersion: 'v1',
    generatedAt: '2026-10-05T15:00:00.000Z',
    campaigns: [],
    revisions: [{
      kind: 'revision',
      checkout: 'wt',
      checkoutLabel: 'wt-label',
      checkoutRoot: '/x',
      sessionKey: 'wt::tmp/api-reference-sync/java-revision-worklist.json',
      worklistPath: 'tmp/api-reference-sync/java-revision-worklist.json',
      worklistStem: 'java-revision-worklist',
      language: 'java',
      ruling: 'ruling text',
      scope: { pages: 204, findings: 294, uniquePages: 153, summary: {}, generatedAt: '2026-10-05T12:00:00.000Z' },
      groupingGate: { digest: 'sha256:' + 'a'.repeat(64), title: 'gate', manifest: 'm' },
      pages: [{ page: 'LexicalHighlighter', documentToken: 'TOK1', codes: ['RETURNS_MIN_DEPTH'] }],
      written: [{ flow: 'revision', unit: 'java-v3-LexicalHighlighter', manifest: 'tmp/api-reference-sync/run-manifest-revision-apply-review-java-v3-LexicalHighlighter.json', writtenAt: '2026-10-05T13:41:00.000Z' }],
      writtenPages: 1,
      remainingPages: 203,
      status: 'in_progress',
      updatedAt: '2026-10-05T13:41:00.000Z',
    }],
    admission: {}, activity: [], sentinels: [], skillTracks: { languages: [] },
    checkouts: [{ id: 'main', label: '主检出' }, { id: 'wt', label: 'wt-label' }],
    features: {},
  };
}

test('routing a revision session key renders the revision detail page', () => {
  const { api, elements } = loadPageScript();
  const payload = revisionPayload();
  api.setPage(payload);
  const key = payload.revisions[0].sessionKey;

  // Exactly the browser flow: hash changes, the hashchange handler routes.
  api.location.hash = `#/campaign/${encodeURIComponent(key)}`;
  api.route();

  const page = elements.page.innerHTML;
  assert.ok(page.includes('页面清单'), 'revision detail renders the page list');
  assert.ok(page.includes('已写回执'), 'revision detail renders written receipts');
  assert.ok(page.includes('LexicalHighlighter'), 'written unit visible');
  assert.ok(page.includes('版本族缩写'), 'v2/v3 version-family legend stated');
  assert.ok(page.includes('204'), 'scope total visible');
});

test('routing an unknown campaign path renders the honest not-found state', () => {
  const { api, elements } = loadPageScript();
  api.setPage(revisionPayload());
  api.location.hash = `#/campaign/${encodeURIComponent('main::tmp/nope-session.json')}`;
  api.route();
  assert.ok(elements.page.innerHTML.includes('未找到'), 'not-found state renders instead of crashing');
});


test('ui state survives a re-render: open details, select values, typed inputs', () => {
  const { api, elements } = loadPageScript();
  api.setPage(revisionPayload());
  const detailsEl = { textContent: ' 这块看板怎么用（流程与按钮说明） ', parentElement: { open: false } };
  const selectEl = { id: 'tkCheckout', tagName: 'SELECT', value: 'main' };
  const inputEl = { id: 'apDigest', tagName: 'INPUT', value: 'sha256:xyz' };
  api.document.querySelectorAll = (selector) => {
    if (selector.startsWith('details')) return [detailsEl];
    if (selector.startsWith('select')) return [selectEl, inputEl]; // 'select[id], input[id]'
    return [inputEl];
  };
  elements.tkCheckout = selectEl;
  elements.apDigest = inputEl;
  detailsEl.parentElement.open = true;
  const state = api.snapshotUiState();
  detailsEl.parentElement.open = false;
  selectEl.value = '';
  inputEl.value = '';
  api.restoreUiState(state);
  assert.ok(detailsEl.parentElement.open, 'expanded fold stays expanded');
  assert.equal(selectEl.value, 'main', 'select choice restored');
  assert.equal(inputEl.value, 'sha256:xyz', 'typed input restored');
});


// ---------- preparation phase visible on every surface (intake gates) ----------

function intakePayload({ approved = false } = {}) {
  return {
    uiVersion: 'v1',
    generatedAt: '2026-10-06T12:00:00.000Z',
    campaigns: [],
    revisions: [],
    intakes: [{
      kind: 'intake',
      checkout: 'go-scan',
      checkoutLabel: 'go-scan',
      checkoutRoot: '/x/go-scan',
      manifestPath: 'tmp/sdk-release-scout/go-v30-grouping-gate-manifest-v3.json',
      title: 'go v3.0.0 分组门 v3-r2',
      run: 'go run',
      digest: 'sha256:' + '6'.repeat(64),
      language: 'go',
      presentedAt: '2026-10-06T11:00:00.000Z',
      approved,
      approvalEvidence: approved ? 'receipt' : null,
      receipt: approved ? { path: 'tmp/api-reference-sync/grouping-approvals/x.json', proposalDigest: 'sha256:' + '6'.repeat(64), approvedAt: '2026-10-06T12:00:00.000Z' } : null,
      links: [],
    }],
    groupingReceipts: approved ? [{ checkout: 'go-scan', path: 'tmp/api-reference-sync/grouping-approvals/x.json' }] : [],
    admission: {}, activity: [], sentinels: [],
    skillTracks: { languages: [{ name: 'go', sdkName: 'milvus-sdk-go', tracks: [{ version: 'v3.0.x', key: 'go-v30', campaigns: { total: 0, active: 0, finalized: 0, sessionPaths: [] } }] }] },
    checkouts: [{ id: 'main', label: '主检出' }],
    features: {},
  };
}

test('a presented grouping gate replaces 无进行中战役 on the language card', async () => {
  const { api, elements } = loadPageScript();
  api.setPage(intakePayload());
  api.location.hash = '#/skill/api';
  api.route();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const page = elements.page.innerHTML;
  assert.ok(page.includes('分组门待批 1'), 'language card counts the pending gate');
  assert.ok(!page.includes('<span class="badge finalized">无进行中战役</span>'), 'the idle badge is gone while a gate is pending');
  assert.ok(page.includes('战役筹备'), 'the api page keeps its intake section');
});

test('language page and track page surface the preparation-phase gate', async () => {
  const { api, elements } = loadPageScript();
  api.setPage(intakePayload());
  api.location.hash = '#/skill/api/lang/go';
  api.route();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(elements.page.innerHTML.includes('战役筹备'), 'language page renders the intake section');
  assert.ok(elements.page.innerHTML.includes('go v3.0.0 分组门 v3-r2'), 'gate card visible on the language page');

  api.setPage(intakePayload());
  api.location.hash = '#/skill/api/track/go-v30';
  api.route();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const trackPage = elements.page.innerHTML;
  assert.ok(trackPage.includes('战役筹备'), 'track page renders the intake section');
  assert.ok(trackPage.includes('筹备 1（分组门阶段）'), 'track kv row counts the preparation entry');
});

test('an approved-but-preparing gate shows 筹备中 instead of the idle badge', async () => {
  const { api, elements } = loadPageScript();
  api.setPage(intakePayload({ approved: true }));
  api.location.hash = '#/skill/api';
  api.route();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const page = elements.page.innerHTML;
  assert.ok(page.includes('筹备中 1'), 'approved gate reads as preparing, not idle');
  assert.ok(!page.includes('<span class="badge finalized">无进行中战役</span>'), 'no idle badge while preparation is in flight');
  assert.ok(page.includes('分组已批'), 'the approved intake card keeps its approved badge');
});
