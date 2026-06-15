#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEVTOOLS = 'http://127.0.0.1:9222';
const OUT = resolve('tmp/wiki-sync/ui-pilot');

const URLS = [
  ['source-root', 'https://zilliverse.feishu.cn/wiki/OUWXw5c4gia34ZkQUcEcMFbWn6s'],
  ['target-root', 'https://zilliverse.feishu.cn/wiki/DraZwmoqhiAWNPkvPxicnDVNnXb'],
  ['pilot-source-cluster-types', 'https://zilliverse.feishu.cn/wiki/UgqvwKh2QiKE1kkYNLJcaHt0nkg'],
  ['pilot-target-cluster-types', 'https://zilliverse.feishu.cn/wiki/DF98wbypKi0vPVke2vLcrrnVnZg'],
];

mkdirSync(OUT, { recursive: true });

const browserInfo = await fetchJson(`${DEVTOOLS}/json/version`);
const browser = await connect(browserInfo.webSocketDebuggerUrl);

const report = {
  generated_at: new Date().toISOString(),
  browser: {
    version: browserInfo.Browser,
    user_agent: browserInfo['User-Agent'],
  },
  pages: [],
};

for (const [name, url] of URLS) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const pageInfo = await waitForTarget(targetId);
  const page = await connect(pageInfo.webSocketDebuggerUrl);

  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Page.navigate', { url });
  await sleep(8000);

  const info = await page.eval(() => {
    const text = document.body?.innerText || '';
    const all = Array.from(document.querySelectorAll('*'));
    const dataBlockElements = all.filter((el) => {
      return Array.from(el.attributes || []).some((attr) => /block/i.test(attr.name) || /block/i.test(attr.value));
    });
    const contentEditables = Array.from(document.querySelectorAll('[contenteditable="true"], [contenteditable="plaintext-only"]'));
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], [aria-label]'))
      .slice(0, 80)
      .map((el) => ({
        tag: el.tagName,
        role: el.getAttribute('role') || '',
        aria: el.getAttribute('aria-label') || '',
        title: el.getAttribute('title') || '',
        text: (el.textContent || '').trim().slice(0, 80),
      }));
    const syncedHints = all
      .filter((el) => /sync|synced|同步|引用|source/i.test(`${el.textContent || ''} ${el.className || ''} ${el.getAttribute('aria-label') || ''}`))
      .slice(0, 50)
      .map((el) => ({
        tag: el.tagName,
        className: String(el.className || '').slice(0, 160),
        aria: el.getAttribute('aria-label') || '',
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      }));
    return {
      title: document.title,
      url: location.href,
      textLength: text.length,
      textPreview: text.replace(/\s+/g, ' ').slice(0, 1200),
      looksLoggedIn: !/login|sign in|登录|登入/i.test(document.title + '\n' + text.slice(0, 2000)),
      contentEditableCount: contentEditables.length,
      dataBlockLikeElementCount: dataBlockElements.length,
      buttons,
      syncedHints,
    };
  });

  const screenshot = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const screenshotPath = resolve(OUT, `${name}.png`);
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));

  report.pages.push({
    name,
    requested_url: url,
    screenshot: screenshotPath,
    ...info,
  });

  await page.close();
}

await browser.close();

const reportPath = resolve(OUT, 'report.json');
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  report: reportPath,
  pages: report.pages.map((page) => ({
    name: page.name,
    title: page.title,
    url: page.url,
    looksLoggedIn: page.looksLoggedIn,
    contentEditableCount: page.contentEditableCount,
    dataBlockLikeElementCount: page.dataBlockLikeElementCount,
    screenshot: page.screenshot,
  })),
}, null, 2));

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
    async eval(fn) {
      const result = await this.send('Runtime.evaluate', {
        expression: `(${fn})()`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    },
    close() {
      ws.close();
    },
  };
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
