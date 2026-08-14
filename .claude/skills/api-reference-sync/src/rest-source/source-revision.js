'use strict';

const {execFileSync} = require('node:child_process');
const {assertFullSha} = require('../rest-fragments/collection-manifest');

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024,
  });
}

function assertCommit(repo, revision) {
  const sha = assertFullSha(revision, 'source revision');
  try {
    git(repo, ['cat-file', '-e', `${sha}^{commit}`]);
  } catch {
    throw new Error(`REST_SOURCE_COMMIT_MISSING: ${sha}`);
  }
  return sha;
}

function readCommittedFile(repo, revision, file) {
  const sha = assertCommit(repo, revision);
  if (!file || file.startsWith('/') || file.split('/').includes('..')) throw new Error(`REST_SOURCE_PATH_INVALID: ${file}`);
  try {
    return git(repo, ['show', `${sha}:${file}`]);
  } catch {
    throw new Error(`REST_SOURCE_FILE_MISSING: ${file}@${sha}`);
  }
}

function listCommittedFiles(repo, revision, roots) {
  const sha = assertCommit(repo, revision);
  return git(repo, ['ls-tree', '-r', '--name-only', sha, '--', ...roots])
    .split('\n').filter(Boolean).sort();
}

module.exports = {assertCommit, listCommittedFiles, readCommittedFile};
