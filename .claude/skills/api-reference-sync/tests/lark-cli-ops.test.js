'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { LarkCliOps, spawnRun } = require('../src/sdk-doc-sync/lark-cli-ops');

function recorder() {
  const calls = [];
  const run = async (command, args) => {
    calls.push({ command, args });
    return { ok: true };
  };
  return { calls, run };
}

test('authStatus builds lark-cli auth status argv', async () => {
  const { calls, run } = recorder();
  const ops = new LarkCliOps({ run });

  const result = await ops.authStatus();

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [{
    command: 'lark-cli',
    args: ['auth', 'status', '--json', '--verify'],
  }]);
});

test('fetchDocBlocks builds a raw paginated Docx blocks API argv with bot default', async () => {
  const { calls, run } = recorder();
  const ops = new LarkCliOps({ run });

  await ops.fetchDocBlocks('doc-token');

  assert.deepEqual(calls, [{
    command: 'lark-cli',
    args: [
      'api',
      'GET',
      '/open-apis/docx/v1/documents/doc-token/blocks',
      '--params',
      '{"page_size":500}',
      '--page-all',
      '--as',
      'bot',
      '--format',
      'json',
    ],
  }]);
});

test('historyList builds lark-cli docs history-list argv', async () => {
  const { calls, run } = recorder();
  const ops = new LarkCliOps({ run });

  await ops.historyList('doc-token', 'user');

  assert.deepEqual(calls, [{
    command: 'lark-cli',
    args: [
      'docs',
      '+history-list',
      '--doc',
      'doc-token',
      '--page-size',
      '20',
      '--as',
      'user',
      '--format',
      'json',
    ],
  }]);
});

test('historyRevert builds lark-cli docs history-revert argv', async () => {
  const { calls, run } = recorder();
  const ops = new LarkCliOps({ run });

  await ops.historyRevert('doc-token', 'history-version-id');

  assert.deepEqual(calls, [{
    command: 'lark-cli',
    args: [
      'docs',
      '+history-revert',
      '--doc',
      'doc-token',
      '--history-version-id',
      'history-version-id',
      '--as',
      'bot',
      '--format',
      'json',
    ],
  }]);
});

test('deleteDocx builds lark-cli drive delete argv with user default', async () => {
  const { calls, run } = recorder();
  const ops = new LarkCliOps({ run });

  await ops.deleteDocx('doc-token');

  assert.deepEqual(calls, [{
    command: 'lark-cli',
    args: [
      'drive',
      '+delete',
      '--file-token',
      'doc-token',
      '--type',
      'docx',
      '--as',
      'user',
      '--yes',
      '--format',
      'json',
    ],
  }]);
});

test('spawnRun captures stdout and stderr with stdin ignored', async () => {
  const result = await spawnRun(process.execPath, [
    '-e',
    'process.stdout.write("out"); process.stderr.write("err"); process.stdin.on("data", () => process.exit(9));',
  ]);

  assert.equal(result.command, process.execPath);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'out');
  assert.equal(result.stderr, 'err');
});

test('spawnRun does not allow shell override', async () => {
  const result = await spawnRun(process.execPath, [
    '-e',
    'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
    'literal && shell-token',
  ], { shell: true });

  assert.deepEqual(JSON.parse(result.stdout), ['literal && shell-token']);
});

test('spawnRun rejects nonzero exits with captured output', async () => {
  await assert.rejects(
    () => spawnRun(process.execPath, [
      '-e',
      'process.stdout.write("out"); process.stderr.write("err"); process.exit(7);',
    ]),
    (error) => {
      assert.match(error.message, /exited with status 7/);
      assert.equal(error.result.status, 7);
      assert.equal(error.result.stdout, 'out');
      assert.equal(error.result.stderr, 'err');
      return true;
    },
  );
});

test('spawnRun rejects stalled commands after timeout', async () => {
  await assert.rejects(
    () => spawnRun(process.execPath, ['-e', 'setTimeout(() => {}, 5000);'], { timeoutMs: 20 }),
    (error) => {
      assert.match(error.message, /timed out/);
      assert.equal(error.result.status, null);
      assert.equal(error.result.signal, 'SIGTERM');
      return true;
    },
  );
});
