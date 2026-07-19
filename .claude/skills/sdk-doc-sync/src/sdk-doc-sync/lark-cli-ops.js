'use strict';

const { spawn } = require('node:child_process');

function spawnRun(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? 120000;
    const spawnOptions = { ...options };
    delete spawnOptions.timeoutMs;
    delete spawnOptions.shell;
    delete spawnOptions.stdio;
    const child = spawn(command, args, {
      ...spawnOptions,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeout = null;

    function finish(callback, value) {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      callback(value);
    }

    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        const result = {
          command,
          args,
          status: null,
          signal: 'SIGTERM',
          stdout,
          stderr,
        };
        child.kill('SIGTERM');
        const error = new Error(`${command} timed out after ${timeoutMs}ms`);
        error.result = result;
        finish(reject, error);
      }, timeoutMs);
    }

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      error.result = {
        command,
        args,
        status: null,
        signal: null,
        stdout,
        stderr,
      };
      finish(reject, error);
    });
    child.on('close', (status, signal) => {
      const result = {
        command,
        args,
        status,
        signal,
        stdout,
        stderr,
      };

      if (status === 0) {
        finish(resolve, result);
        return;
      }

      const error = new Error(`${command} exited with status ${status}`);
      error.result = result;
      finish(reject, error);
    });
  });
}

class LarkCliOps {
  constructor({ run = spawnRun } = {}) {
    this.run = run;
  }

  authStatus() {
    return this.run('lark-cli', ['auth', 'status', '--json', '--verify']);
  }

  fetchDocBlocks(documentToken, as = 'bot') {
    return this.run('lark-cli', [
      'docs',
      '+fetch',
      '--doc',
      documentToken,
      '--as',
      as,
      '--format',
      'json',
    ]);
  }

  historyList(documentToken, as = 'bot') {
    return this.run('lark-cli', [
      'docs',
      '+history-list',
      '--doc',
      documentToken,
      '--page-size',
      '20',
      '--as',
      as,
      '--format',
      'json',
    ]);
  }

  historyRevert(documentToken, historyVersionId, as = 'bot') {
    return this.run('lark-cli', [
      'docs',
      '+history-revert',
      '--doc',
      documentToken,
      '--history-version-id',
      historyVersionId,
      '--as',
      as,
      '--format',
      'json',
    ]);
  }

  deleteDocx(documentToken, as = 'user') {
    return this.run('lark-cli', [
      'drive',
      '+delete',
      '--file-token',
      documentToken,
      '--type',
      'docx',
      '--as',
      as,
      '--yes',
      '--format',
      'json',
    ]);
  }
}

module.exports = {
  LarkCliOps,
  spawnRun,
};
