#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEVTOOLS = 'http://127.0.0.1:9222';
const OUT = resolve('tmp/wiki-sync/ui-pilot');

const PAGES = [
  {
    name: 'source-cluster-types-dom',
    url: 'https://zilliverse.feishu.cn/wiki/UgqvwKh2QiKE1kkYNLJcaHt0nkg',
    probes: ['Performance-optimized cluster', 'Capacity-optimized cluster', 'Tiered-storage cluster'],
  },
  {
    name: 'target-cluster-types-dom',
    url: 'https://zilliverse.feishu.cn/wiki/DF98wbypKi0vPVke2vLcrrnVnZg',
    probes: ['Select an optimal cluster type', 'Understand cluster types'],
  },
];

mkdirSync(OUT, { recursive: true });

const browserInfo = await fetchJson(`${DEVTOOLS}/json/version`);
const browser = await connect(browserInfo.webSocketDebuggerUrl);
const report = {
  generated_at: new Date().toISOString(),
  browser: browserInfo.Browser,
  pages: [],
};

for (const spec of PAGES) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const pageInfo = await waitForTarget(targetId);
  const page = await connect(pageInfo.webSocketDebuggerUrl);

  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('DOM.enable');
  await page.send('Page.navigate', { url: spec.url });
  await sleep(8000);

  const info = await page.eval((probes) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const rectOf = (el) => {
      const rect = el.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
      };
    };
    const cssPath = (el) => {
      const parts = [];
      for (let node = el; node && node.nodeType === Node.ELEMENT_NODE && parts.length < 8; node = node.parentElement) {
        const id = node.id ? `#${CSS.escape(node.id)}` : '';
        const cls = String(node.className || '')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3)
          .map((name) => `.${CSS.escape(name)}`)
          .join('');
        parts.unshift(`${node.tagName.toLowerCase()}${id}${cls}`);
      }
      return parts.join(' > ');
    };
    const attrs = (el) => {
      const obj = {};
      for (const attr of Array.from(el.attributes || [])) {
        if (/block|data|id|contenteditable|role|aria|title/i.test(attr.name) || /block|synced|sync|docx/i.test(attr.value)) {
          obj[attr.name] = attr.value.slice(0, 180);
        }
      }
      return obj;
    };
    const ancestry = (el) => {
      const rows = [];
      for (let node = el; node && node.nodeType === Node.ELEMENT_NODE && rows.length < 12; node = node.parentElement) {
        rows.push({
          tag: node.tagName,
          id: node.id || '',
          className: String(node.className || '').slice(0, 180),
          attrs: attrs(node),
          rect: rectOf(node),
          text: clean(node.textContent).slice(0, 240),
          path: cssPath(node),
        });
      }
      return rows;
    };
    const textNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = clean(node.nodeValue);
      if (!text) continue;
      for (const probe of probes) {
        if (text.includes(probe)) {
          textNodes.push({
            probe,
            text,
            ancestry: ancestry(node.parentElement),
          });
        }
      }
    }
    const blockish = Array.from(document.querySelectorAll('*'))
      .filter((el) => Array.from(el.attributes || []).some((attr) => /block|synced|sync/i.test(`${attr.name} ${attr.value}`)))
      .map((el) => ({
        tag: el.tagName,
        id: el.id || '',
        className: String(el.className || '').slice(0, 180),
        attrs: attrs(el),
        rect: rectOf(el),
        text: clean(el.textContent).slice(0, 220),
        path: cssPath(el),
      }))
      .filter((row) => row.rect.width > 0 && row.rect.height > 0)
      .slice(0, 300);
    return {
      title: document.title,
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight, scrollY },
      bodyTextPreview: clean(document.body?.innerText).slice(0, 1000),
      textNodes,
      blockish,
    };
  }, spec.probes);

  const screenshot = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const screenshotPath = resolve(OUT, `${spec.name}.png`);
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));

  report.pages.push({ ...spec, screenshot: screenshotPath, ...info });
  await page.close();
}

await browser.close();

const reportPath = resolve(OUT, 'synced-dom-report.json');
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  report: reportPath,
  pages: report.pages.map((page) => ({
    name: page.name,
    title: page.title,
    url: page.url,
    textNodeMatches: page.textNodes.length,
    blockish: page.blockish.length,
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
    async eval(fn, arg) {
      const result = await this.send('Runtime.evaluate', {
        expression: `(${fn})(${JSON.stringify(arg)})`,
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
