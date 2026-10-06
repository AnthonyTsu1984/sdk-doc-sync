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


// ---------- three-gate model: grouping gates are campaign rows (2026-10-06 ruling) ----------

function intakePayload({ approved = false, evidence = null, withJavaRevision = false } = {}) {
  const payload = {
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
      approvalEvidence: evidence ?? (approved ? 'receipt' : null),
      receipt: approved ? { checkoutRoot: '/x/go-scan', path: 'tmp/api-reference-sync/grouping-approvals/x.json', proposalDigest: 'sha256:' + '6'.repeat(64), approvedAt: '2026-10-06T12:00:00.000Z' } : null,
      links: [],
    }],
    groupingReceipts: [],
    admission: {}, activity: [], sentinels: [],
    skillTracks: { languages: [{ name: 'go', sdkName: 'milvus-sdk-go', tracks: [{ version: 'v3.0.x', key: 'go-v30', campaigns: { total: 0, active: 0, finalized: 0, sessionPaths: [] } }] }] },
    checkouts: [{ id: 'main', label: '主检出' }],
    features: {},
  };
  if (withJavaRevision) {
    payload.intakes.push({
      kind: 'intake', checkout: 'java-v30', checkoutLabel: 'java-v30', checkoutRoot: '/x/java',
      manifestPath: 'tmp/api-reference-sync/gate-manifest-grouping-java-rev.json',
      title: 'java v3.0.x 修订战役 — 范围工件', run: 'r', digest: 'sha256:' + '7'.repeat(64),
      language: 'java', presentedAt: '2026-10-05T10:00:00.000Z', approved: true,
      approvalEvidence: 'written', receipt: null, links: [],
    });
  }
  return payload;
}

async function renderRoute(api, hash) {
  api.location.hash = hash;
  api.route();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('a pending grouping gate is an in-progress campaign row (three-gate vocabulary)', async () => {
  const { api, elements } = loadPageScript();
  api.setPage(intakePayload());
  await renderRoute(api, '#/skill/api');
  const page = elements.page.innerHTML;
  assert.ok(!page.includes('战役筹备'), 'the preparation section is gone');
  assert.ok(page.includes('战役进行中 1'), 'the gate counts as campaign activity from the scan request');
  assert.ok(page.includes('分组门待批 1'), 'the pending-gate alert chip stays');
  assert.ok(!page.includes('<span class="badge finalized">无进行中战役</span>'), 'no idle badge while a gate is pending');
  assert.ok(page.includes('APPROVE_GROUPING'), 'the gate row carries the approval line gate');
  assert.ok(page.includes('three-gate'), 'the flow badge speaks the three-gate vocabulary');
  assert.ok(!page.includes('>grouping<'), 'grouping is a phase, never a type badge');
});

test('language page and track page list the gate as a campaign row', async () => {
  const { api, elements } = loadPageScript();
  api.setPage(intakePayload());
  await renderRoute(api, '#/skill/api/lang/go');
  const langPage = elements.page.innerHTML;
  assert.ok(!langPage.includes('战役筹备'), 'no preparation section on the language page');
  assert.ok(langPage.includes('APPROVE_GROUPING'), 'gate row present in the language campaign table');

  api.setPage(intakePayload());
  await renderRoute(api, '#/skill/api/track/go-v30');
  const trackPage = elements.page.innerHTML;
  assert.ok(!trackPage.includes('战役筹备'), 'no preparation section on the track page');
  assert.ok(trackPage.includes('APPROVE_GROUPING'), 'gate row present in the track campaign table');
  assert.ok(trackPage.includes('含分组门阶段 1'), 'track kv counts the gate-phase campaign');
});

test('an approved-receipt gate stays a row (preparing); its detail page shows the digest', async () => {
  const { api, elements } = loadPageScript();
  api.setPage(intakePayload({ approved: true }));
  await renderRoute(api, '#/skill/api');
  assert.ok(elements.page.innerHTML.includes('已批 · 筹备中'), 'receipt-evidence gate still renders as its own row');

  api.setPage(intakePayload());
  await renderRoute(api, '#/campaign/' + encodeURIComponent('go-scan::tmp/sdk-release-scout/go-v30-grouping-gate-manifest-v3.json'));
  const pendingDetail = elements.page.innerHTML;
  assert.ok(pendingDetail.includes('分组门战役'), 'gate detail page renders');
  assert.ok(pendingDetail.includes('sha256:' + '6'.repeat(64)), 'full digest visible');
  assert.ok(pendingDetail.includes('APPROVE_GROUPING sha256:'), 'approval line preview present on the pending gate');
  assert.ok(pendingDetail.includes('① 分组门'), 'three-gate step strip present');

  api.setPage(intakePayload({ approved: true }));
  await renderRoute(api, '#/campaign/' + encodeURIComponent('go-scan::tmp/sdk-release-scout/go-v30-grouping-gate-manifest-v3.json'));
  const approvedDetail = elements.page.innerHTML;
  assert.ok(approvedDetail.includes('已批 · 筹备中'), 'approved status stated');
  assert.ok(approvedDetail.includes('回执文件'), 'receipt link present once approved');
});

test('a gate whose campaign row already exists never double-renders (java lesson)', async () => {
  const { api, elements } = loadPageScript();
  const payload = intakePayload({ withJavaRevision: true });
  payload.revisions.push({
    kind: 'revision', checkout: 'java-v30', checkoutLabel: 'java-v30', checkoutRoot: '/x/java',
    sessionKey: 'java-v30::tmp/api-reference-sync/java-revision-worklist.json',
    worklistPath: 'tmp/api-reference-sync/java-revision-worklist.json', worklistStem: 'java-revision-worklist',
    language: 'java', ruling: 'r', scope: { pages: 204, findings: 3, uniquePages: 2, summary: {}, generatedAt: null },
    groupingGate: { digest: 'sha256:' + '7'.repeat(64), title: 't', manifest: 'm' },
    pages: [{ page: 'Vector', documentToken: 'T', codes: ['X'] }],
    written: [], writtenPages: 0, remainingPages: 204, status: 'in_progress', updatedAt: '2026-10-06T10:00:00.000Z',
  });
  api.setPage(payload);
  await renderRoute(api, '#/skill/api');
  const page = elements.page.innerHTML;
  assert.ok(!page.includes('java v3.0.x 修订战役 — 范围工件'), 'the written-evidence gate does not render its own row');
  assert.ok(page.includes('java-revision-worklist') || page.includes('Vector'), 'the revision campaign row carries java instead');
  assert.equal((page.match(/<tr class="rowlink"/g) || []).length, 2, 'exactly two campaign rows: go gate + java revision');
});
