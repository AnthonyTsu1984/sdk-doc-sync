#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEVTOOLS = 'http://127.0.0.1:9222';
const OUT = resolve('tmp/wiki-sync/ui-pilot');
const APPLY = process.argv.includes('--apply');

const SOURCE = {
  url: 'https://zilliverse.feishu.cn/wiki/UgqvwKh2QiKE1kkYNLJcaHt0nkg',
  recordId: 'TzKFdAB7isHJcDb7aXEcc7HVnWf',
};
const TARGET = {
  url: 'https://zilliverse.feishu.cn/wiki/DF98wbypKi0vPVke2vLcrrnVnZg',
  placeholderRecordId: 'doxcnmAruMEfLVBSGPVzlqV0r5U',
};

mkdirSync(OUT, { recursive: true });

const browserInfo = await fetchJson(`${DEVTOOLS}/json/version`);
const browser = await connect(browserInfo.webSocketDebuggerUrl);

const sourcePage = await openPage(browser, SOURCE.url);
const targetPage = await openPage(browser, TARGET.url);

await sourcePage.send('Input.setIgnoreInputEvents', { ignore: false });
await targetPage.send('Input.setIgnoreInputEvents', { ignore: false });

const sourceBefore = await sourcePage.eval((recordId) => {
  const block = document.querySelector(`[data-record-id="${CSS.escape(recordId)}"]`);
  if (!block) return { found: false };
  block.scrollIntoView({ block: 'center', inline: 'center' });
  const rect = block.getBoundingClientRect();
  return {
    found: true,
    rect: rectJson(rect),
    text: clean(block.textContent).slice(0, 500),
    className: String(block.className || ''),
  };

  function rectJson(rect) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom };
  }
  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }
}, SOURCE.recordId);

if (!sourceBefore.found) throw new Error(`source synced block not found: ${SOURCE.recordId}`);
await sleep(1000);

const copyResult = await sourcePage.eval((recordId) => {
  const block = document.querySelector(`[data-record-id="${CSS.escape(recordId)}"]`);
  if (!block) return { selected: false };
  block.scrollIntoView({ block: 'center', inline: 'center' });
  const selection = window.getSelection();
  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNode(block);
  selection.addRange(range);
  block.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  block.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
  return {
    selected: true,
    selectedText: selection.toString().replace(/\s+/g, ' ').trim().slice(0, 500),
  };
}, SOURCE.recordId);

if (!copyResult.selected) throw new Error(`source synced block could not be selected: ${SOURCE.recordId}`);

await sourcePage.send('Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: 'Meta',
  code: 'MetaLeft',
  modifiers: 4,
});
await sourcePage.send('Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: 'c',
  code: 'KeyC',
  text: 'c',
  unmodifiedText: 'c',
  modifiers: 4,
});
await sourcePage.send('Input.dispatchKeyEvent', {
  type: 'keyUp',
  key: 'c',
  code: 'KeyC',
  modifiers: 4,
});
await sourcePage.send('Input.dispatchKeyEvent', {
  type: 'keyUp',
  key: 'Meta',
  code: 'MetaLeft',
  modifiers: 0,
});
await sleep(1000);

const targetBefore = await targetPage.eval((placeholderRecordId) => {
  const placeholder = document.querySelector(`[data-record-id="${CSS.escape(placeholderRecordId)}"]`);
  const existingSynced = Array.from(document.querySelectorAll('[data-block-type="synced_source"], .docx-synced_source-block'));
  if (!placeholder) return { found: false, syncedSourceCount: existingSynced.length };
  placeholder.scrollIntoView({ block: 'center', inline: 'center' });
  const rect = placeholder.getBoundingClientRect();
  return {
    found: true,
    syncedSourceCount: existingSynced.length,
    rect: rectJson(rect),
    text: clean(placeholder.textContent),
    className: String(placeholder.className || ''),
  };

  function rectJson(rect) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom };
  }
  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }
}, TARGET.placeholderRecordId);

if (!targetBefore.found) throw new Error(`target placeholder not found: ${TARGET.placeholderRecordId}`);

let targetAfter = null;
let undone = false;

if (APPLY) {
  await sleep(1000);
  const click = {
    x: Math.round(targetBefore.rect.x + 20),
    y: Math.round(targetBefore.rect.y + Math.max(8, Math.min(18, targetBefore.rect.height / 2))),
  };
  await targetPage.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: click.x, y: click.y, button: 'none' });
  await targetPage.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: click.x, y: click.y, button: 'left', clickCount: 1 });
  await targetPage.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: click.x, y: click.y, button: 'left', clickCount: 1 });
  await sleep(500);
  await targetPage.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Meta',
    code: 'MetaLeft',
    modifiers: 4,
  });
  await targetPage.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'v',
    code: 'KeyV',
    text: 'v',
    unmodifiedText: 'v',
    modifiers: 4,
  });
  await targetPage.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'v',
    code: 'KeyV',
    modifiers: 4,
  });
  await targetPage.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Meta',
    code: 'MetaLeft',
    modifiers: 0,
  });
  await sleep(6000);

  targetAfter = await targetPage.eval(inspectTarget);
  if (targetAfter.syncedSourceCount === 0) {
    await targetPage.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Meta',
      code: 'MetaLeft',
      modifiers: 4,
    });
    await targetPage.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'z',
      code: 'KeyZ',
      text: 'z',
      unmodifiedText: 'z',
      modifiers: 4,
    });
    await targetPage.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'z',
      code: 'KeyZ',
      modifiers: 4,
    });
    await targetPage.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Meta',
      code: 'MetaLeft',
      modifiers: 0,
    });
    undone = true;
    await sleep(3000);
    targetAfter = await targetPage.eval(inspectTarget);
  }
}

const sourceShot = await sourcePage.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
const targetShot = await targetPage.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
const sourceScreenshot = resolve(OUT, APPLY ? 'copy-pilot-source-apply.png' : 'copy-pilot-source-dry-run.png');
const targetScreenshot = resolve(OUT, APPLY ? 'copy-pilot-target-apply.png' : 'copy-pilot-target-dry-run.png');
writeFileSync(sourceScreenshot, Buffer.from(sourceShot.data, 'base64'));
writeFileSync(targetScreenshot, Buffer.from(targetShot.data, 'base64'));

const report = {
  generated_at: new Date().toISOString(),
  apply: APPLY,
  source: sourceBefore,
  copy: copyResult,
  target_before: targetBefore,
  target_after: targetAfter,
  undone,
  screenshots: { source: sourceScreenshot, target: targetScreenshot },
};
const reportPath = resolve(OUT, APPLY ? 'copy-synced-pilot-apply.json' : 'copy-synced-pilot-dry-run.json');
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify({
  ok: true,
  apply: APPLY,
  report: reportPath,
  sourceFound: sourceBefore.found,
  targetFound: targetBefore.found,
  targetSyncedBefore: targetBefore.syncedSourceCount,
  targetSyncedAfter: targetAfter?.syncedSourceCount ?? null,
  undone,
  screenshots: report.screenshots,
}, null, 2));

await sourcePage.closeConnection();
await targetPage.closeConnection();
await browser.closeConnection();

function inspectTarget() {
  const synced = Array.from(document.querySelectorAll('[data-block-type="synced_source"], .docx-synced_source-block'));
  const placeholder = document.querySelector(`[data-record-id="${CSS.escape('doxcnmAruMEfLVBSGPVzlqV0r5U')}"]`);
  return {
    syncedSourceCount: synced.length,
    syncedSources: synced.map((el) => ({
      recordId: el.getAttribute('data-record-id') || '',
      blockId: el.getAttribute('data-block-id') || '',
      className: String(el.className || ''),
      text: String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
      rect: rectJson(el.getBoundingClientRect()),
    })),
    placeholder: placeholder ? {
      className: String(placeholder.className || ''),
      text: String(placeholder.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
      rect: rectJson(placeholder.getBoundingClientRect()),
    } : null,
  };

  function rectJson(rect) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom };
  }
}

async function openPage(browser, url) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const pageInfo = await waitForTarget(targetId);
  const page = await connect(pageInfo.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('DOM.enable');
  await page.send('Page.navigate', { url });
  await sleep(8000);
  return page;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}: ${await response.text()}`);
  return response.json();
}

async function waitForTarget(targetId) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const targets = await fetchJson(`${DEVTOOLS}/json/list`);
    const found = targets.find((target) => target.id === targetId);
    if (found?.webSocketDebuggerUrl) return found;
    await sleep(100);
  }
  throw new Error(`target ${targetId} not found`);
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let id = 0;

  await new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', rejectOpen, { once: true });
  });

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const callbacks = pending.get(message.id);
    if (!callbacks) return;
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(JSON.stringify(message.error)));
    else callbacks.resolve(message.result || {});
  });

  return {
    send(method, params = {}) {
      const messageId = ++id;
      ws.send(JSON.stringify({ id: messageId, method, params }));
      return new Promise((resolveSend, rejectSend) => pending.set(messageId, { resolve: resolveSend, reject: rejectSend }));
    },
    async eval(fn, arg) {
      const result = await this.send('Runtime.evaluate', {
        expression: `(${fn})(${JSON.stringify(arg)})`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    },
    closeConnection() {
      ws.close();
    },
  };
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
