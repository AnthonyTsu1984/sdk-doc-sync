# ztrans Lark Interface MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the localization doc-agent MVP human-readable in Lark by improving cards with affected document titles and parsing `@ztrans` friendly commands.

**Architecture:** Keep `.claude/agent-team` as the orchestration spine. Add reusable report-rendering helpers for affected document groups, feed those helpers into card builders and scan/dry-run entrypoints, and extend the existing approval parser with conservative mention stripping plus friendly aliases. Local non-dispatch intents return structured results that the event consumer can acknowledge without triggering GitHub workflows.

**Tech Stack:** Node.js CommonJS, `node:test`, existing Feishu IM client, existing GitHub dispatch and task artifact stores.

---

## File Structure

Modify:

- `.claude/agent-team/src/report-renderer.js` — add reusable affected-document title extraction and grouped Markdown rendering.
- `.claude/agent-team/src/cards.js` — use readable `ztrans` card copy and affected-doc sections.
- `.claude/agent-team/bin/doc-agent-scan.js` — pass scan actions into the daily report card.
- `.claude/agent-team/bin/doc-agent-dry-run.js` — pass live-write actions and orphan counts into the approval card.
- `.claude/agent-team/src/approval-commands.js` — strip `@ztrans` mentions, parse friendly aliases, and return local intents.
- `.claude/agent-team/src/event-consumer.js` — avoid dispatching local intents and return a structured local response.
- `.claude/agent-team/src/feishu-im.js` — add optional text message helper for later acknowledgement use.
- `.claude/agent-team/tests/cards.test.js` — cover title grouping, caps, readable copy, and live-write filtering.
- `.claude/agent-team/tests/approval-commands.test.js` — cover `@ztrans` mention parsing, friendly aliases, local intents, and ambiguous messages.
- `.claude/agent-team/tests/event-consumer.test.js` — cover local intents do not dispatch.

---

### Task 1: Add Affected Document Render Helpers

**Files:**
- Modify: `.claude/agent-team/src/report-renderer.js`
- Modify: `.claude/agent-team/tests/cards.test.js`

- [ ] **Step 1: Add failing tests for affected document sections**

Append to `.claude/agent-team/tests/cards.test.js`:

```js
const { renderAffectedDocsMarkdown } = require('../src/report-renderer');

test('renderAffectedDocsMarkdown groups titles and caps long lists', () => {
  const actions = [
    { type: 'UPDATE', slug: 'a', source: { metadata: { title: 'Alpha' } } },
    { type: 'UPDATE', slug: 'b', source: { metadata: { title: 'Beta' } } },
    { type: 'UPDATE', slug: 'c', source: { metadata: { title: 'Gamma' } } },
    { type: 'UPDATE', slug: 'd', source: { metadata: { title: 'Delta' } } },
    { type: 'UPDATE', slug: 'e', source: { metadata: { title: 'Epsilon' } } },
    { type: 'UPDATE', slug: 'f', source: { metadata: { title: 'Zeta' } } },
    { type: 'ORPHAN', slug: 'legacy', target: { metadata: { title: 'Legacy Pricing' } } },
  ];
  const markdown = renderAffectedDocsMarkdown({ actions, includeTypes: ['UPDATE', 'ORPHAN'], limitPerType: 5 });
  assert.match(markdown, /UPDATE/);
  assert.match(markdown, /Alpha/);
  assert.match(markdown, /Epsilon/);
  assert.doesNotMatch(markdown, /Zeta\n/);
  assert.match(markdown, /\.\.\.and 1 more/);
  assert.match(markdown, /ORPHAN \(report only\)/);
  assert.match(markdown, /Legacy Pricing/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test:agent-team
```

Expected: FAIL because `renderAffectedDocsMarkdown` is not exported.

- [ ] **Step 3: Implement helpers**

In `.claude/agent-team/src/report-renderer.js`, replace the module with:

```js
function actionTitle(action) {
  return action.source?.metadata?.title || action.target?.metadata?.title || action.slug || '(untitled)';
}

function groupActionsByType(actions = [], includeTypes = []) {
  const groups = new Map(includeTypes.map(type => [type, []]));
  for (const action of actions) {
    if (!groups.has(action.type)) continue;
    groups.get(action.type).push(action);
  }
  return groups;
}

function renderAffectedDocsMarkdown({ actions = [], includeTypes = ['NEW', 'UPDATE', 'META_ONLY', 'ORPHAN'], limitPerType = 5 } = {}) {
  const lines = ['**Affected docs**'];
  let hasAny = false;
  const groups = groupActionsByType(actions, includeTypes);
  for (const [type, typedActions] of groups.entries()) {
    if (typedActions.length === 0) continue;
    hasAny = true;
    const label = type === 'ORPHAN' ? 'ORPHAN (report only)' : type;
    lines.push('', `**${label}**`);
    for (const action of typedActions.slice(0, limitPerType)) {
      lines.push(`- ${actionTitle(action)}`);
    }
    const remaining = typedActions.length - limitPerType;
    if (remaining > 0) lines.push(`...and ${remaining} more`);
  }
  if (!hasAny) lines.push('', '- No affected docs.');
  return lines.join('\n');
}

function renderMarkdownReport({ task, summary, actions, linkReport = { summary: {}, findings: [] } }) {
  const lines = [];
  lines.push('# Doc Agent Daily Localization Report');
  lines.push('');
  lines.push(`Task: \`${task.id}\``);
  lines.push(`Generated: ${task.createdAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total: ${summary.total}`);
  lines.push(`- NEW: ${summary.NEW}`);
  lines.push(`- UPDATE: ${summary.UPDATE}`);
  lines.push(`- META_ONLY: ${summary.META_ONLY}`);
  lines.push(`- SKIP: ${summary.SKIP}`);
  lines.push(`- ORPHAN: ${summary.ORPHAN}`);
  lines.push(`- Broken links: ${linkReport.summary.brokenLinks || 0}`);
  lines.push(`- Broken mention_doc references: ${linkReport.summary.brokenMentionDocs || 0}`);
  lines.push('');
  lines.push('## Actionable Items');
  lines.push('');

  for (const action of actions.filter(a => ['NEW', 'UPDATE', 'META_ONLY', 'ORPHAN'].includes(a.type))) {
    lines.push(`- **${action.type}** \`${action.slug || '(no-slug)'}\` - ${actionTitle(action)}`);
    lines.push(`  Reason: ${action.reason || 'No reason recorded'}`);
  }

  if (!actions.some(a => ['NEW', 'UPDATE', 'META_ONLY', 'ORPHAN'].includes(a.type))) {
    lines.push('- No actionable items.');
  }

  lines.push('');
  lines.push('## Broken Link Findings');
  lines.push('');
  for (const finding of linkReport.findings || []) {
    lines.push(`- **${finding.type}** ${finding.title}: ${finding.target || finding.docUrl}`);
    if (finding.status || finding.error) lines.push(`  Status: ${finding.status || finding.error}`);
  }
  if (!linkReport.findings || linkReport.findings.length === 0) {
    lines.push('- No broken links found.');
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderFeishuSummary({ summary, linkReport = { summary: {} } }) {
  return [
    `Total: ${summary.total}`,
    `NEW: ${summary.NEW}`,
    `UPDATE: ${summary.UPDATE}`,
    `META_ONLY: ${summary.META_ONLY}`,
    `ORPHAN: ${summary.ORPHAN}`,
    `Broken links: ${(linkReport.summary.brokenLinks || 0) + (linkReport.summary.brokenMentionDocs || 0)}`,
  ].join(' · ');
}

module.exports = {
  actionTitle,
  groupActionsByType,
  renderAffectedDocsMarkdown,
  renderMarkdownReport,
  renderFeishuSummary,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm run test:agent-team
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/agent-team/src/report-renderer.js .claude/agent-team/tests/cards.test.js
git commit -m "feat: render affected docs for ztrans cards"
```

---

### Task 2: Make Cards Human-Readable

**Files:**
- Modify: `.claude/agent-team/src/cards.js`
- Modify: `.claude/agent-team/bin/doc-agent-scan.js`
- Modify: `.claude/agent-team/bin/doc-agent-dry-run.js`
- Modify: `.claude/agent-team/tests/cards.test.js`

- [ ] **Step 1: Add failing card tests**

Extend `.claude/agent-team/tests/cards.test.js`:

```js
test('daily report card lists affected doc titles', () => {
  const card = buildDailyReportCard({
    task: { id: 'task-1', sourceRunId: '123' },
    summaryText: 'Total: 2 · NEW: 1 · UPDATE: 1',
    actions: [
      { type: 'NEW', slug: 'new-doc', source: { metadata: { title: 'New Doc' } } },
      { type: 'UPDATE', slug: 'old-doc', source: { metadata: { title: 'Old Doc' } } },
    ],
  });
  const content = JSON.stringify(card);
  assert.match(content, /ztrans found localization work/);
  assert.match(content, /New Doc/);
  assert.match(content, /Old Doc/);
  assert.match(content, /No Feishu docs have been changed yet/);
});

test('live write card lists only write-capable docs and calls out orphans', () => {
  const card = buildLiveWriteApprovalCard({
    task: { id: 'task-1', sourceRunId: '456' },
    summaryText: 'NEW: one doc',
    actions: [
      { type: 'NEW', slug: 'new-doc', source: { metadata: { title: 'New Doc' } } },
      { type: 'ORPHAN', slug: 'legacy', target: { metadata: { title: 'Legacy Doc' } } },
    ],
    orphanCount: 1,
  });
  const content = JSON.stringify(card);
  assert.match(content, /Approve localization writes/);
  assert.match(content, /New Doc/);
  assert.doesNotMatch(content, /Legacy Doc/);
  assert.match(content, /1 orphan target doc is report-only/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test:agent-team
```

Expected: FAIL because card builders ignore `actions`.

- [ ] **Step 3: Update card builders**

Replace `.claude/agent-team/src/cards.js` with:

```js
const { renderAffectedDocsMarkdown } = require('./report-renderer');

function commandBlock(task, commands) {
  const sourceRun = task.sourceRunId ? `\nsource run: \`${task.sourceRunId}\`` : '';
  return [
    `task: \`${task.id}\`${sourceRun}`,
    '',
    ...commands.map(command => `- \`${command}\``),
  ].join('\n');
}

function buildDailyReportCard({ task, summaryText, actions = [] }) {
  const suffix = task.sourceRunId ? ` ${task.sourceRunId}` : '';
  const commands = [
    `ignore ${task.id}${suffix}`,
    `dry-run ${task.id}${suffix}`,
    `patch ${task.id}${suffix}`,
    `custom ${task.id}${suffix}: <your instruction>`,
  ];
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: 'ztrans found localization work' },
      template: 'blue',
    },
    elements: [
      { tag: 'markdown', content: `**Summary**\n${summaryText}` },
      { tag: 'markdown', content: renderAffectedDocsMarkdown({ actions }) },
      { tag: 'markdown', content: '**Risk**\nNo Feishu docs have been changed yet.\nORPHAN items are report-only. Live writes require explicit approval.' },
      { tag: 'markdown', content: '**Recommended next step**\nCreate a dry-run plan first.' },
      { tag: 'markdown', content: `**Fallback reply commands**\n${commandBlock(task, commands)}` },
    ],
  };
}

function buildLiveWriteApprovalCard({ task, summaryText, actions = [], orphanCount = 0 }) {
  const suffix = task.sourceRunId ? ` ${task.sourceRunId}` : '';
  const commands = [
    `approve ${task.id}${suffix}`,
    `reject ${task.id}${suffix}`,
    `changes ${task.id}${suffix}: <what to change>`,
  ];
  const writeActions = actions.filter(action => ['NEW', 'UPDATE', 'META_ONLY'].includes(action.type));
  const orphanLine = orphanCount > 0
    ? `\n${orphanCount} orphan target doc${orphanCount === 1 ? ' is' : 's are'} report-only. No deletion will happen.`
    : '';
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: 'Approve localization writes?' },
      template: 'orange',
    },
    elements: [
      { tag: 'markdown', content: `**Summary**\n${summaryText}` },
      { tag: 'markdown', content: renderAffectedDocsMarkdown({ actions: writeActions, includeTypes: ['NEW', 'UPDATE', 'META_ONLY'] }) },
      { tag: 'markdown', content: `**Approval effect**\nApproving allows ztrans to create/update only the listed localization docs and metadata.${orphanLine}` },
      { tag: 'markdown', content: `**Fallback reply commands**\n${commandBlock(task, commands)}` },
    ],
  };
}

module.exports = {
  buildDailyReportCard,
  buildLiveWriteApprovalCard,
  commandBlock,
};
```

- [ ] **Step 4: Pass actions into cards**

In `.claude/agent-team/bin/doc-agent-scan.js`, change:

```js
const card = buildDailyReportCard({
  task,
  summaryText: renderFeishuSummary({ ...diff, linkReport }),
});
```

to:

```js
const card = buildDailyReportCard({
  task,
  summaryText: renderFeishuSummary({ ...diff, linkReport }),
  actions: diff.actions,
});
```

In `.claude/agent-team/bin/doc-agent-dry-run.js`, change:

```js
const card = buildLiveWriteApprovalCard({
  task: nextTask,
  summaryText: renderFeishuSummary({ summary: task.summary }),
});
```

to:

```js
const orphanCount = actions.filter(action => action.type === 'ORPHAN').length;
const card = buildLiveWriteApprovalCard({
  task: nextTask,
  summaryText: renderFeishuSummary({ summary: task.summary }),
  actions: [...actionable, ...actions.filter(action => action.type === 'ORPHAN')],
  orphanCount,
});
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test:agent-team
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .claude/agent-team/src/cards.js .claude/agent-team/bin/doc-agent-scan.js .claude/agent-team/bin/doc-agent-dry-run.js .claude/agent-team/tests/cards.test.js
git commit -m "feat: make ztrans cards readable"
```

---

### Task 3: Parse @ztrans Friendly Commands

**Files:**
- Modify: `.claude/agent-team/src/approval-commands.js`
- Modify: `.claude/agent-team/tests/approval-commands.test.js`

- [ ] **Step 1: Add failing parser tests**

Append to `.claude/agent-team/tests/approval-commands.test.js`:

```js
test('parseApprovalCommand strips ztrans mention and friendly dry run alias', () => {
  const parsed = parseApprovalCommand('@ztrans dry run loc-scan-1 123456');
  assert.equal(parsed.action, 'dry_run_only');
  assert.equal(parsed.taskId, 'loc-scan-1');
  assert.equal(parsed.sourceRunId, '123456');
});

test('parseApprovalCommand supports friendly approve live write alias', () => {
  const parsed = parseApprovalCommand('@ztrans approve live write loc-scan-1');
  assert.equal(parsed.action, 'approve_live_write');
  assert.equal(parsed.taskId, 'loc-scan-1');
});

test('parseApprovalCommand returns local intents for help and explain', () => {
  assert.deepEqual(parseApprovalCommand('@ztrans help'), {
    action: 'help',
    local: true,
    taskId: null,
    sourceRunId: null,
    customInstruction: '',
    raw: '@ztrans help',
  });
  const explain = parseApprovalCommand('@ztrans explain loc-scan-1');
  assert.equal(explain.action, 'explain');
  assert.equal(explain.local, true);
  assert.equal(explain.taskId, 'loc-scan-1');
});

test('parseApprovalCommand rejects ambiguous ztrans instruction', () => {
  assert.equal(parseApprovalCommand('@ztrans please do the thing'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test:agent-team
```

Expected: FAIL because mentions and local intents are unsupported.

- [ ] **Step 3: Implement parser normalization**

Replace `.claude/agent-team/src/approval-commands.js` with:

```js
const ACTION_ALIASES = Object.freeze({
  ignore: 'ignore',
  'dry-run': 'dry_run_only',
  dryrun: 'dry_run_only',
  patch: 'patch_after_approval',
  custom: 'custom',
  approve: 'approve_live_write',
  reject: 'reject',
  changes: 'changes_requested',
});

function stripBotMention(text) {
  return String(text || '')
    .replace(/^@\s*ztrans\b[:,]?\s*/i, '')
    .replace(/^<at[^>]*>[^<]*<\/at>\s*/i, '')
    .trim();
}

function normalizeFriendlyCommand(text) {
  return text
    .replace(/^dry\s+run\b/i, 'dry-run')
    .replace(/^create\s+patch\s+plan\b/i, 'patch')
    .replace(/^approve\s+live\s+write\b/i, 'approve')
    .replace(/^show\s+/i, 'explain ');
}

function localIntent(action, taskId, raw) {
  return {
    action,
    local: true,
    taskId: taskId || null,
    sourceRunId: null,
    customInstruction: '',
    raw,
  };
}

function parseApprovalCommand(text) {
  const raw = String(text || '').trim();
  const normalized = normalizeFriendlyCommand(stripBotMention(raw));
  if (!normalized) return null;
  if (/^help$/i.test(normalized)) return localIntent('help', null, raw);
  const explainMatch = normalized.match(/^explain\s+([a-zA-Z0-9_.:-]+)$/i);
  if (explainMatch) return localIntent('explain', explainMatch[1], raw);

  const match = normalized.match(/^([a-zA-Z-]+)\s+([a-zA-Z0-9_.:-]+)(?:\s+([0-9]+))?(?::\s*([\s\S]+))?$/);
  if (!match) return null;
  const command = match[1].toLowerCase();
  const action = ACTION_ALIASES[command];
  if (!action) return null;
  return {
    action,
    taskId: match[2],
    sourceRunId: match[3] || null,
    customInstruction: match[4] ? match[4].trim() : '',
    raw,
  };
}

function normalizeFeishuMessageEvent(event) {
  const root = event.event || event;
  return {
    chatId: root.chat_id || root.message?.chat_id || '',
    senderId: root.sender_id || root.sender?.sender_id?.open_id || root.sender?.id || '',
    messageId: root.message_id || root.message?.message_id || '',
    threadId: root.thread_id || root.message?.thread_id || '',
    text: root.text || root.content || root.message?.content || '',
  };
}

module.exports = {
  parseApprovalCommand,
  normalizeFeishuMessageEvent,
  stripBotMention,
};
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm run test:agent-team
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/agent-team/src/approval-commands.js .claude/agent-team/tests/approval-commands.test.js
git commit -m "feat: parse ztrans lark commands"
```

---

### Task 4: Avoid Dispatch For Local Intents

**Files:**
- Modify: `.claude/agent-team/src/event-consumer.js`
- Modify: `.claude/agent-team/src/feishu-im.js`
- Modify: `.claude/agent-team/tests/event-consumer.test.js`

- [ ] **Step 1: Add failing event consumer test**

Append to `.claude/agent-team/tests/event-consumer.test.js`:

```js
test('handleEvent returns local response for help without dispatching', async () => {
  const config = configFixture();
  let dispatched = false;
  const result = await handleEvent({
    config,
    event: {
      chat_id: config.feishu.chatId,
      sender_id: config.feishu.approverIds[0],
      message_id: 'om-help',
      content: '@ztrans help',
    },
    githubToken: 'token',
    dispatch: async () => { dispatched = true; },
  });
  assert.equal(dispatched, false);
  assert.equal(result.local, true);
  assert.match(result.responseText, /@ztrans dry run/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test:agent-team
```

Expected: FAIL because local intents are currently dispatched.

- [ ] **Step 3: Implement local response handling**

In `.claude/agent-team/src/event-consumer.js`, add:

```js
function localResponseText(parsed) {
  if (parsed.action === 'help') {
    return [
      'ztrans understands:',
      '- @ztrans dry run <task-id>',
      '- @ztrans patch <task-id>',
      '- @ztrans approve <task-id>',
      '- @ztrans reject <task-id>',
      '- @ztrans changes <task-id>: <instruction>',
      '- @ztrans explain <task-id>',
    ].join('\n');
  }
  if (parsed.action === 'explain') {
    return `I can explain task ${parsed.taskId}, but task lookup is not wired into chat replies yet. Use the latest scan card or artifact summary for now.`;
  }
  return 'ztrans did not dispatch a workflow for this local instruction.';
}
```

Then, inside `handleEvent()` after `if (!parsed) ...`, add:

```js
if (parsed.local) {
  return { local: true, parsed, responseText: localResponseText(parsed) };
}
```

Export `localResponseText` in `module.exports`.

- [ ] **Step 4: Add text send helper**

In `.claude/agent-team/src/feishu-im.js`, add this method to `FeishuImClient`:

```js
async sendText({ chatId, text }) {
  const token = await this.tokenFetcher.token();
  const response = await fetch(`${this.host}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
  });
  const data = await response.json();
  if (data.code !== 0) {
    throw new Error(`Failed to send Feishu text: ${data.msg || response.status}`);
  }
  return data.data;
}
```

The event consumer does not need to call it yet for this MVP step; this keeps acknowledgement sending available for the next pass without changing consumer process behavior.

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test:agent-team
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .claude/agent-team/src/event-consumer.js .claude/agent-team/src/feishu-im.js .claude/agent-team/tests/event-consumer.test.js
git commit -m "feat: handle local ztrans intents"
```

---

### Task 5: Final Verification And Runbook Note

**Files:**
- Modify: `docs/superpowers/runbooks/feishu-agent-team-mvp.md`

- [ ] **Step 1: Add ztrans usage note**

Append this section to `docs/superpowers/runbooks/feishu-agent-team-mvp.md`:

```md
## ztrans Lark Interface

The configured bot is called `ztrans` in the Lark approval chat.

Users can still reply with raw commands from the cards, but the preferred form is:

- `@ztrans dry run <task-id> <source-run-id>`
- `@ztrans patch <task-id> <source-run-id>`
- `@ztrans approve <task-id> <source-run-id>`
- `@ztrans reject <task-id> <source-run-id>`
- `@ztrans changes <task-id> <source-run-id>: <instruction>`
- `@ztrans help`

Cards list affected document titles grouped by action type. Long groups are capped in the card; use the workflow artifact `summary.md` for the full list.
```

- [ ] **Step 2: Run full focused tests**

Run:

```bash
npm run test:agent-team
npm run test:patch-code-blocks
```

Expected: both pass.

- [ ] **Step 3: Check status**

Run:

```bash
git status --short
```

Expected: only intentional files from this implementation plus any pre-existing unrelated worktree changes.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/runbooks/feishu-agent-team-mvp.md
git commit -m "docs: document ztrans lark commands"
```

---

## Plan Self-Review

Spec coverage:

- `@ztrans` mention parsing: Task 3.
- Friendly fixed commands: Task 3.
- Backward-compatible raw commands: Task 3 keeps existing parser semantics.
- Human-readable cards: Task 2.
- Affected document titles grouped and capped: Task 1 and Task 2.
- ORPHAN report-only messaging: Task 1 and Task 2.
- Local non-dispatch intents: Task 3 and Task 4.
- Feishu text helper for acknowledgements: Task 4.
- Tests: every task includes focused `npm run test:agent-team`; final task includes patch-code-blocks regression.

Known limitations:

- `scan localization` and `show latest scan` chat intents are documented as future follow-ups because they need workflow dispatch or task lookup beyond the current approval event path.
- Threaded replies are not implemented in this MVP plan; the plan adds enough normalized event shape and IM helper groundwork to support them later.
