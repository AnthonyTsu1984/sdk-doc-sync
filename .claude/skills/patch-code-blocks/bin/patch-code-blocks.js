#!/usr/bin/env node

const { parseArgs } = require('../src/args');
const { resolveDocumentId } = require('../src/target');
const MarkdownToFeishu = require('../../sdk-doc-sync/src/markdown-to-feishu');
const { extractSections } = require('../src/blocks');
const { filterSectionsForProduct } = require('../src/product-filter');
const { loadReferenceIndexFromRoot, buildMatrix } = require('../src/reference-scan');
const { buildCandidates, assertIdempotentCandidates } = require('../src/diff-plan');
const { planApplyOperations } = require('../src/apply');
const { formatDryRunReport, formatApplyReport } = require('../src/report');

async function main() {
  try {
    const config = parseArgs(process.argv.slice(2));
    const documentId = await resolveDocumentId(config.target);

    const m2f = new MarkdownToFeishu({
      sourceType: 'drive',
      rootToken: null,
      baseToken: null,
    });

    const blocks = await m2f.get_document_blocks(documentId);
    const sections = extractSections(blocks);
    const filteredSections = filterSectionsForProduct(sections, config.product);

    const referenceIndex = loadReferenceIndexFromRoot(config.reference, config.product);
    const matrix = buildMatrix(referenceIndex, { languages: config.languages });
    const candidates = buildCandidates(matrix);
    assertIdempotentCandidates(candidates);

    const dryRunReport = formatDryRunReport({
      matrix,
      candidates,
    });

    if (!config.apply) {
      console.log(JSON.stringify(dryRunReport, null, 2));
      return;
    }

    const applyPlan = planApplyOperations({
      sections: filteredSections,
      candidates,
      languageOrder: config.languageOrder || config.languages,
    });

    console.log(JSON.stringify(formatApplyReport({
      dryRunReport,
      applySummary: applyPlan.summary,
      operationResults: applyPlan.results,
    }), null, 2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    console.error('Usage: patch-code-blocks --target <wiki-url|docx-url> [--product milvus|zilliz-saas|zilliz-paas] [--release <version>] [--languages <csv>] [--language-order <csv>] [--apply true|false]');
    process.exit(1);
  }
}

main();
