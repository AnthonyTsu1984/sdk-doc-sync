#!/usr/bin/env node
// Patch UPDATE-scope Zilliz CLI v1.4.x docs in place (deterministic append-only).
//
// Reads:
//   /tmp/v14x-update-copy-map.json
//   ./markdown/updates/*.md
//
// Writes:
//   /tmp/v14x-update-patch-results.json

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const MarkdownToFeishu = require('../../src/markdown-to-feishu');

const COPY_MAP_PATH = '/tmp/v14x-update-copy-map.json';
const OUTPUT_PATH = '/tmp/v14x-update-patch-results.json';
const PATCH_DIR = path.resolve(__dirname, 'markdown', 'updates');
const DRY_RUN = process.argv.includes('--dry-run');

const PATCH_SPECS = [
  {
    scopeKey: 'login',
    patchFile: 'login.md',
    expectedMarker: '--dev and --cn are mutually exclusive',
    targetSlugs: ['Auth-login'],
  },
  {
    scopeKey: 'context-set',
    patchFile: 'context-set.md',
    expectedMarker: '--on-demand',
    targetSlugs: ['Context-set'],
  },
  {
    scopeKey: 'collection-create',
    patchFile: 'collection-create.md',
    expectedMarker: 'externalSource and externalSpec belong in the request body payload',
    targetSlugs: ['Collection-create'],
  },
  {
    scopeKey: 'project-create',
    patchFile: 'project-create.md',
    expectedMarker: 'regionIds',
    targetSlugs: ['Project-create'],
  },
  {
    scopeKey: 'global-update-check-note',
    patchFile: 'global-version.md',
    expectedMarker: 'stderr only',
    targetSlugs: ['Global-version'],
  },
  {
    scopeKey: 'project-add-regions',
    patchFile: 'project-add-regions.md',
    expectedMarker: 'regionIds',
    targetSlugs: ['Project-addregions', 'Project-add-regions'],
  },
  {
    scopeKey: 'on-demand-cluster-create',
    patchFile: 'on-demand-cluster-create.md',
    expectedMarker: '--cu-size',
    targetSlugs: ['OnDemandCluster-create', 'On-demand-cluster-create', 'QueryCluster-create', 'Query-cluster-create'],
  },
  {
    scopeKey: 'privatelink-family',
    patchFile: 'privatelink-family.md',
    expectedMarker: 'endpoint family',
    targetSlugs: ['PrivateLink', 'Privatelink', 'PrivateLink-list', 'Privatelink-list'],
    allowMultiple: true,
  },
];

function parseDocxToken(link) {
  if (!link || typeof link !== 'string') return '';
  const m = link.match(/\/docx\/([A-Za-z0-9]+)/);
  return m ? m[1] : '';
}

function extractBlockText(block) {
  const keys = ['text', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6', 'heading7', 'heading8', 'heading9', 'bullet', 'ordered', 'quote', 'code'];
  for (const key of keys) {
    if (!block[key] || !Array.isArray(block[key].elements)) continue;
    const joined = block[key].elements
      .map(el => (el.text_run && typeof el.text_run.content === 'string' ? el.text_run.content : ''))
      .join('');
    if (joined) return joined;
  }
  return '';
}

function validateMarkdownFormatting(markdown, filePath) {
  const errors = [];

  if (/^\s{2,}-\s+/m.test(markdown)) {
    errors.push('Nested bullet indentation detected (disallowed for parameter list style).');
  }

  if (/\*\*\[REQUIRED\]\*\*/.test(markdown) === false) {
    // Optional check: do not require this token in every patch, but ensure no malformed variant exists.
    if (/\[REQUIRED\]/.test(markdown) && !/\*\*\[REQUIRED\]\*\*/.test(markdown)) {
      errors.push('Found [REQUIRED] without bold formatting (**[REQUIRED]**).');
    }
  }

  if (/\n\n\n+/.test(markdown)) {
    errors.push('Excessive blank lines detected.');
  }

  return {
    filePath,
    pass: errors.length === 0,
    errors,
  };
}

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to read JSON ${filePath}: ${err.message}`);
  }
}

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

function firstNonEmptyText(blocks) {
  for (const block of blocks || []) {
    const text = extractBlockText(block).trim();
    if (text) return text;
  }
  return '';
}

function dedupeByRecordId(items) {
  const byRecord = new Map();
  for (const item of items || []) {
    if (!item?.recordId) continue;
    if (!byRecord.has(item.recordId)) byRecord.set(item.recordId, item);
  }
  return [...byRecord.values()];
}

(async () => {
  const copyMap = loadJson(COPY_MAP_PATH);

  const resolvedByScope = new Map();
  for (const item of copyMap.resolved || []) {
    if (!resolvedByScope.has(item.scopeKey)) resolvedByScope.set(item.scopeKey, []);
    resolvedByScope.get(item.scopeKey).push(item);
  }
  for (const [scopeKey, items] of resolvedByScope.entries()) {
    resolvedByScope.set(scopeKey, dedupeByRecordId(items));
  }

  const updatedByRecordId = new Map();
  for (const upd of copyMap.updated || []) {
    if (upd?.recordId) updatedByRecordId.set(upd.recordId, upd);
  }

  const unresolvedFromCopyMap = new Map((copyMap.unresolved || []).map(x => [x.scopeKey, x]));
  const validatedRecordIds = new Set(
    (copyMap.validation || [])
      .filter(v => v.pass)
      .map(v => v.recordId)
  );

  const result = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    copyMapPath: COPY_MAP_PATH,
    outputPath: OUTPUT_PATH,
    applied: [],
    skipped: [],
    unresolved: [],
    failed: [],
    markdownValidation: [],
    summary: {},
  };

  const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
  const patchedDocxTokens = new Set();

  for (const spec of PATCH_SPECS) {
    const patchPath = path.join(PATCH_DIR, spec.patchFile);
    if (!fs.existsSync(patchPath)) {
      result.failed.push({ scopeKey: spec.scopeKey, reason: `Missing patch file ${patchPath}` });
      continue;
    }

    const markdown = fs.readFileSync(patchPath, 'utf8');
    const fmt = validateMarkdownFormatting(markdown, patchPath);
    result.markdownValidation.push({ scopeKey: spec.scopeKey, ...fmt });

    if (!fmt.pass) {
      result.failed.push({ scopeKey: spec.scopeKey, reason: `Markdown format validation failed: ${fmt.errors.join(' | ')}` });
      continue;
    }

    let resolvedList = resolvedByScope.get(spec.scopeKey) || [];
    if (spec.targetSlugs && spec.targetSlugs.length > 0) {
      const expected = new Set(spec.targetSlugs.map(normalizeSlug));
      resolvedList = resolvedList.filter(x => expected.has(normalizeSlug(x.slug)));
    }

    if (resolvedList.length === 0) {
      const unresolved = unresolvedFromCopyMap.get(spec.scopeKey);
      result.unresolved.push({
        scopeKey: spec.scopeKey,
        reason: unresolved?.reason || 'No resolved v1.4 record from copy map after slug filtering',
        label: unresolved?.label || unresolved?.scopeLabel || spec.scopeKey,
      });
      continue;
    }

    if (resolvedList.length > 1 && !spec.allowMultiple) {
      result.failed.push({
        scopeKey: spec.scopeKey,
        reason: `Ambiguous resolved targets after slug filtering: ${resolvedList.map(x => `${x.recordId}:${x.slug}`).join(', ')}`,
      });
      continue;
    }

    for (const resolved of resolvedList) {
      if (!validatedRecordIds.has(resolved.recordId)) {
        result.skipped.push({
          scopeKey: spec.scopeKey,
          recordId: resolved.recordId,
          reason: 'Record not validated as v1.4-linked in copy map validation',
        });
        continue;
      }

      const updated = updatedByRecordId.get(resolved.recordId);
      const targetLink = updated?.newLink || resolved.newLink || resolved.oldLink;
      const docxToken = parseDocxToken(targetLink);
      if (!docxToken) {
        result.failed.push({ scopeKey: spec.scopeKey, recordId: resolved.recordId, reason: 'No docx token in resolved target link' });
        continue;
      }

      if (patchedDocxTokens.has(docxToken)) {
        result.skipped.push({
          scopeKey: spec.scopeKey,
          recordId: resolved.recordId,
          docxToken,
          reason: 'Doc already patched in this run via another scope owner',
        });
        continue;
      }

      if (DRY_RUN) {
        result.applied.push({
          scopeKey: spec.scopeKey,
          recordId: resolved.recordId,
          docxToken,
          patchFile: patchPath,
          strategy: 'append',
          dryRun: true,
        });
        patchedDocxTokens.add(docxToken);
        continue;
      }

      try {
        const preBlocks = await m2f.get_document_blocks(docxToken);
        const preText = preBlocks.map(extractBlockText).join('\n');
        const preIntro = firstNonEmptyText(preBlocks);

        if (preText.includes(spec.expectedMarker)) {
          result.skipped.push({
            scopeKey: spec.scopeKey,
            recordId: resolved.recordId,
            docxToken,
            reason: `Expected marker already present: ${spec.expectedMarker}`,
          });
          patchedDocxTokens.add(docxToken);
          continue;
        }

        const { tokens } = await m2f.parse_markdown(markdown);
        const blocks = await m2f.markdown_to_blocks(tokens);
        const patchStats = await m2f.patch_document({ document_id: docxToken, blocks, strategy: 'append' });

        const postBlocks = await m2f.get_document_blocks(docxToken);
        const postText = postBlocks.map(extractBlockText).join('\n');
        const postIntro = firstNonEmptyText(postBlocks);
        const markerFound = postText.includes(spec.expectedMarker);
        const introPreserved = !preIntro || preIntro === postIntro;
        const lengthNonDecreasing = postBlocks.length >= preBlocks.length;

        result.applied.push({
          scopeKey: spec.scopeKey,
          recordId: resolved.recordId,
          slug: resolved.slug,
          docxToken,
          patchFile: patchPath,
          strategy: 'append',
          patchStats,
          markerFound,
          introPreserved,
          lengthNonDecreasing,
          marker: spec.expectedMarker,
        });

        patchedDocxTokens.add(docxToken);

        if (!markerFound || !introPreserved || !lengthNonDecreasing) {
          const reasons = [];
          if (!markerFound) reasons.push(`Patch marker not found after patch: ${spec.expectedMarker}`);
          if (!introPreserved) reasons.push('Top-level intro changed unexpectedly after append patch');
          if (!lengthNonDecreasing) reasons.push('Post-patch block count is smaller than pre-patch count');
          result.failed.push({
            scopeKey: spec.scopeKey,
            recordId: resolved.recordId,
            docxToken,
            reason: reasons.join(' | '),
          });
        }
      } catch (err) {
        result.failed.push({
          scopeKey: spec.scopeKey,
          recordId: resolved.recordId,
          docxToken,
          reason: err.message,
        });
      }
    }
  }

  result.summary = {
    patchSpecs: PATCH_SPECS.length,
    applied: result.applied.length,
    unresolved: result.unresolved.length,
    skipped: result.skipped.length,
    failed: result.failed.length,
    markdownValidationFailed: result.markdownValidation.filter(v => !v.pass).length,
    markerVerified: result.applied.filter(x => x.markerFound).length,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));

  console.log('Patch summary:');
  for (const [k, v] of Object.entries(result.summary)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(`Result written to ${OUTPUT_PATH}`);

  if (result.failed.length > 0) {
    process.exit(2);
  }
})();
