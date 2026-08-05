'use strict';

const crypto = require('node:crypto');
const { canonicalBytes } = require('./canonical-json');

function sha256Digest(bytes) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8');
  return `sha256:${crypto.createHash('sha256').update(input).digest('hex')}`;
}

function digestSemantic(value, options = {}) {
  return sha256Digest(canonicalBytes(value, options));
}

module.exports = { sha256Digest, digestSemantic };
