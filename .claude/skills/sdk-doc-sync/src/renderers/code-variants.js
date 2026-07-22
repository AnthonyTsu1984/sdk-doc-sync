'use strict';

const { normalizeAudience } = require('../sdk-reference-ir/audience');

function composeCodeVariants(variants, { lineComment } = {}) {
  const items = (variants || [])
    .filter((item) => item && String(item.code || '').trim() !== '')
    .map((item) => ({
      audience: normalizeAudience(item.audience),
      code: String(item.code),
    }));
  if (items.length === 0) return '';
  const shared = items.filter((item) => item.audience === 'shared');
  if (shared.length > 0 && items.length > 1) {
    throw new TypeError('shared code variant cannot be combined with platform-specific variants');
  }
  if (items.length === 1 && items[0].audience === 'shared') return items[0].code;
  if (typeof lineComment !== 'string' || lineComment.trim() === '') {
    throw new TypeError('code variant policy requires a line comment marker');
  }
  return items.flatMap((item) => [
    `${lineComment} include-start ${item.audience}`,
    item.code,
    `${lineComment} include-end`,
  ]).join('\n');
}

module.exports = { composeCodeVariants };
