#!/usr/bin/env node

const DEVTOOLS = 'http://127.0.0.1:9222';
const TARGET_URL = 'https://zilliverse.feishu.cn/wiki/DF98wbypKi0vPVke2vLcrrnVnZg';
const DO_UNDO = process.argv.includes('--undo');
const TARGET_ID = readArg('--target-id');

const targets = await fetchJson(`${DEVTOOLS}/json/list`);
const pages = targets.filter((target) => target.type === 'page' && target.url === TARGET_URL && target.webSocketDebuggerUrl);
if (!pages.length) throw new Error(`No target tab found for ${TARGET_URL}`);

const pageInfo = TARGET_ID ? pages.find((page) => page.id === TARGET_ID) : pages[0];
if (!pageInfo) throw new Error(`No target tab found with id ${TARGET_ID}`);
const page = await connect(pageInfo.webSocketDebuggerUrl);
await page.send('Runtime.enable');
await page.send('Page.enable');

if (DO_UNDO) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Meta', code: 'MetaLeft', modifiers: 4 });
  await page.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'z',
    code: 'KeyZ',
    text: 'z',
    unmodifiedText: 'z',
    modifiers: 4,
  });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 4 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Meta', code: 'MetaLeft', modifiers: 0 });
  await sleep(3000);
}

const state = await page.eval(() => {
  const synced = Array.from(document.querySelectorAll('[data-block-type="synced_source"], .docx-synced_source-block'));
  const placeholder = document.querySelector('[data-record-id="doxcnmAruMEfLVBSGPVzlqV0r5U"], [data-record-id="S0tEdweOboVppAxhpH1cH75nnee"]');
  return {
    url: location.href,
    title: document.title,
    syncedSourceCount: synced.length,
    syncedSources: synced.map((el) => ({
      recordId: el.getAttribute('data-record-id') || '',
      text: String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    })),
    placeholder: placeholder ? {
      recordId: placeholder.getAttribute('data-record-id') || '',
      className: String(placeholder.className || ''),
      text: String(placeholder.textContent || '').replace(/\s+/g, ' ').trim(),
    } : null,
  };
});

await page.closeConnection();
console.log(JSON.stringify({ ok: true, tab: { id: pageInfo.id, title: pageInfo.title }, undo: DO_UNDO, state }, null, 2));

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}: ${await response.text()}`);
  return response.json();
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

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}
