'use strict';

const crypto = require('node:crypto');

function normalizeCodeLanguage(language) {
  const value = String(language || 'text').trim().toLowerCase();
  return {
    'c++': 'cpp',
    cplusplus: 'cpp',
    js: 'javascript',
    node: 'javascript',
    nodejs: 'javascript',
    py: 'python',
    python3: 'python',
    plain: 'text',
    plaintext: 'text',
    sh: 'bash',
    shell: 'bash',
    ts: 'typescript',
    yml: 'yaml',
    zsh: 'bash',
  }[value] || value;
}

function codeHash(code) {
  return crypto.createHash('sha256').update(String(code || '')).digest('hex').slice(0, 12);
}

function extractMarkdownCodeSnippets(markdown, { ignoreLeadingTitle = false } = {}) {
  const source = String(markdown || '');
  const snippets = [];
  const fence = /(^|\n)(`{3,}|~{3,})([^\n`]*)\n([\s\S]*?)\n\2[ \t]*(?=\n|$)/g;
  let match;
  while ((match = fence.exec(source)) !== null) {
    const before = source.slice(0, match.index);
    const headings = [...before.matchAll(/^#{1,6}\s+(.+?)\s*(?:\{#[^}]+\})?\s*$/gm)];
    const headingStack = [];
    for (const [headingIndex, heading] of headings.entries()) {
      const level = heading[0].match(/^#+/)[0].length;
      if (ignoreLeadingTitle && headingIndex === 0 && level === 1) continue;
      headingStack[level - 1] = heading[1].replace(/\{#[^}]+\}/g, '').trim();
      headingStack.length = level;
    }
    const code = match[4];
    snippets.push({
      code,
      hash: codeHash(code),
      index: snippets.length + 1,
      language: normalizeCodeLanguage(match[3].trim().split(/\s+/)[0] || 'text'),
      section: headingStack.filter(Boolean).join(' > ') || '(root)',
    });
  }
  return snippets;
}

module.exports = {
  codeHash,
  extractMarkdownCodeSnippets,
  normalizeCodeLanguage,
};
