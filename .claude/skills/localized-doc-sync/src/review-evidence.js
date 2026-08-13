'use strict';

const SEVERITIES = new Set(['high', 'medium', 'low']);
const TYPES = new Set([
  'accuracy_omission', 'accuracy_addition', 'accuracy_mistranslation', 'product_claim',
  'terminology', 'consistency', 'untranslated_prose', 'locale_style', 'mdx_structure',
  'protected_content', 'link_or_path',
]);
const REVIEW_KEYS = ['issues', 'pass'];
const ISSUE_KEYS = ['comment', 'draft_quote', 'location', 'severity', 'source_quote', 'type'];

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)) {
    throw new Error(`${label} must use the exact schema`);
  }
}

function parseReview(text) {
  let review;
  try { review = JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new Error('Review response must be valid JSON'); }
  exactKeys(review, REVIEW_KEYS, 'Review response');
  if (typeof review.pass !== 'boolean' || !Array.isArray(review.issues)) throw new Error('Review response must use the exact schema');
  if (review.pass && review.issues.length) throw new Error('A passing review cannot contain issues');
  for (const issue of review.issues) {
    exactKeys(issue, ISSUE_KEYS, 'Review issue');
    if (!SEVERITIES.has(issue.severity) || !TYPES.has(issue.type)) throw new Error('Review issue must use allowed severity and type values');
    for (const field of ['location', 'source_quote', 'draft_quote', 'comment']) {
      if (typeof issue[field] !== 'string' || !issue[field]) throw new Error(`Review issue ${field} must be a non-empty string`);
    }
  }
  return review;
}

function conflictsWithLocaleContract(issue, localeContract) {
  for (const rule of localeContract?.forbiddenTranslations || []) {
    if (!issue.source_quote.toLowerCase().includes(String(rule.source).toLowerCase())) continue;
    if ((rule.targets || []).some((target) => issue.comment.includes(target))) return true;
  }
  return false;
}

function parseAndAuthorizeReview(text, { sourceUnits, draftUnits, localeContract = {} }) {
  const review = parseReview(text);
  const sourceById = new Map((sourceUnits || []).map((unit) => [unit.id, unit.text]));
  const draftById = new Map((draftUnits || []).map((unit) => [unit.id, unit.text]));
  const authorizedIssues = [];
  const unsupportedIssues = [];
  for (const issue of review.issues) {
    const source = sourceById.get(issue.location);
    const draft = draftById.get(issue.location);
    let reason = null;
    if (source === undefined || draft === undefined) reason = 'Reviewer location must identify the same existing semantic unit in source and draft';
    else if (!source.includes(issue.source_quote)) reason = 'Reviewer evidence must contain a contiguous source quote from the identified semantic unit';
    else if (!draft.includes(issue.draft_quote)) reason = 'Reviewer evidence must contain a contiguous draft quote from the identified semantic unit';
    else if (issue.type !== 'accuracy_omission' && issue.source_quote === issue.draft_quote) reason = 'Identical source and draft quotes do not prove a changed value';
    else if (conflictsWithLocaleContract(issue, localeContract)) reason = 'Reviewer allegation conflicts with the locale contract';
    if (reason) unsupportedIssues.push({ issue, reason });
    else authorizedIssues.push(issue);
  }
  return Object.freeze({
    reviewerPass: review.pass,
    pass: review.pass && authorizedIssues.length === 0,
    effectivePass: authorizedIssues.length === 0,
    correctionAuthorized: authorizedIssues.length > 0,
    authorizedIssues,
    unsupportedIssues,
    authorizedUnitIds: [...new Set(authorizedIssues.map((issue) => issue.location))].sort(),
  });
}

module.exports = { parseAndAuthorizeReview };
