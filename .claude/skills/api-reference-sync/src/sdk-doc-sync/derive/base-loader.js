'use strict';

// Pinned base reads: every page is read with `git show <full-sha>:<path>` from
// the local web-content clone — never from the working tree (pr-scan rule).

const { spawnSync } = require('node:child_process');

function assertFullSha(sha, label = 'base sha') {
  if (!/^[0-9a-f]{40}$/.test(String(sha || ''))) {
    throw new Error(`BASE_REVISION_INVALID: ${label} must be a full 40-char commit sha, got ${JSON.stringify(sha)}`);
  }
}

function git(webContentDir, args) {
  const result = spawnSync('git', args, { cwd: webContentDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`BASE_READ_FAILED: git ${args.join(' ')} exited ${result.status}: ${String(result.stderr).slice(0, 300)}`);
  }
  return result.stdout;
}

// Enumerate every markdown page under a track path at the pinned revision.
// Paths look like API_Reference/milvus-sdk-rust/v3.0.x/Collections/X.md;
// the returned identity is Category.PageName (About.md -> About).
function listBasePages({ webContentDir, sdkName, track, sha }) {
  assertFullSha(sha);
  const prefix = `API_Reference/${sdkName}/${track}/`;
  // ls-tree pathspecs do not glob-expand; list the track prefix and filter
  // markdown in JS.
  const out = git(webContentDir, ['ls-tree', '-r', '--name-only', sha, '--', prefix]);
  return out.split('\n')
    .filter((line) => line.endsWith('.md'))
    .map((filePath) => {
      const rel = filePath.slice(prefix.length);
      const identity = rel.slice(0, -3).replace(/\//g, '.');
      return { identity, path: filePath, rel };
    });
}

function readBasePage({ webContentDir, sha, filePath }) {
  assertFullSha(sha);
  return git(webContentDir, ['show', `${sha}:${filePath}`]);
}

module.exports = { assertFullSha, listBasePages, readBasePage };
