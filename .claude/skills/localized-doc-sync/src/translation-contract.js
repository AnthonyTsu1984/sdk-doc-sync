'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

const PROMPTS = Object.freeze({
  translation: 'prompts/translation-agent.zh-CN.md',
  review: 'prompts/review-agent.zh-CN.md',
  correction: 'prompts/correction-agent.zh-CN.md',
});

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadTranslationContract({ skillRoot, locale, audienceProfile, productProfile, translatorAdapterVersion }) {
  if (!skillRoot) throw new TypeError('skillRoot is required');
  if (locale !== 'zh-CN') throw new Error(`Unsupported localization contract locale: ${locale}`);
  if (typeof translatorAdapterVersion !== 'string' || !translatorAdapterVersion) throw new Error('translatorAdapterVersion is required');
  const localeContract = JSON.parse(read(skillRoot, 'references/zh-CN-localization-contract.json'));
  if (localeContract.schemaVersion !== 1 || localeContract.locale !== locale) throw new Error('Locale contract identity is invalid');
  if (!localeContract.audienceProfiles?.[audienceProfile]) throw new Error(`Unknown audience profile: ${audienceProfile}`);
  if (!localeContract.productProfiles?.[productProfile]) throw new Error(`Unknown product profile: ${productProfile}`);
  const prompts = Object.fromEntries(Object.entries(PROMPTS).map(([name, relativePath]) => [name, read(skillRoot, relativePath)]));
  const semantic = canonicalize({
    locale,
    audienceProfile,
    audienceRule: localeContract.audienceProfiles[audienceProfile],
    productProfile,
    productRule: localeContract.productProfiles[productProfile],
    translatorAdapterVersion,
    localeContract,
    prompts,
  });
  const promptContractDigest = digestSemantic(prompts);
  const contractDigest = digestSemantic(semantic);
  return Object.freeze({
    ...semantic,
    contractDigest,
    translationContractDigest: contractDigest,
    promptContractDigest,
  });
}

function countOccurrences(text, value, caseSensitive) {
  if (!value) return 0;
  const source = caseSensitive ? String(text) : String(text).toLowerCase();
  const target = caseSensitive ? String(value) : String(value).toLowerCase();
  let count = 0;
  for (let index = 0; (index = source.indexOf(target, index)) !== -1; index += target.length) count += 1;
  return count;
}

function validateLocaleContractUnits(sourceUnits, draftUnits, localeContract) {
  const draftById = new Map((draftUnits || []).map((unit) => [unit.id, unit.text]));
  const forbiddenBySource = new Map((localeContract?.forbiddenTranslations || []).map((rule) => [rule.source, rule.targets || []]));
  const issues = [];
  for (const sourceUnit of sourceUnits || []) {
    const draft = draftById.get(sourceUnit.id);
    if (typeof draft !== 'string') {
      issues.push({ unitId: sourceUnit.id, type: 'missing_draft_unit', message: `Missing draft semantic unit ${sourceUnit.id}` });
      continue;
    }
    for (const term of localeContract?.mandatoryTerms || []) {
      const sourceCount = countOccurrences(sourceUnit.text, term.source, term.caseSensitive === true);
      if (sourceCount === 0) continue;
      const targetCount = countOccurrences(draft, term.target, term.caseSensitive === true);
      const forbidden = (forbiddenBySource.get(term.source) || []).filter((value) => draft.includes(value));
      if (targetCount < sourceCount || forbidden.length) {
        issues.push({
          unitId: sourceUnit.id,
          type: 'terminology',
          source: term.source,
          target: term.target,
          message: `Locale contract requires ${term.source} to remain ${term.target}${forbidden.length ? `; forbidden replacement found: ${forbidden.join(', ')}` : ''}`,
        });
      }
    }
  }
  return issues;
}

module.exports = { loadTranslationContract, validateLocaleContractUnits };
