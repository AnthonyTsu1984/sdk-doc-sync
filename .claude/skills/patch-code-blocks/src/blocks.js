function textFromElements(elements = []) {
  return elements.map((element) => element.text_run?.content || '').join('');
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function headingElements(block) {
  return (
    block.heading1?.elements ||
    block.heading2?.elements ||
    block.heading3?.elements ||
    block.heading4?.elements ||
    block.heading5?.elements ||
    block.heading6?.elements ||
    block.heading7?.elements ||
    block.heading8?.elements ||
    block.heading9?.elements ||
    block.text?.elements ||
    []
  );
}

function fallbackOperationKey(sectionIndex) {
  return `section-${sectionIndex}`;
}

function operationKeyForHeading(heading, sectionIndex, operationKeyCounts) {
  const baseKey = slugify(heading) || fallbackOperationKey(sectionIndex);
  const nextCount = (operationKeyCounts.get(baseKey) || 0) + 1;
  operationKeyCounts.set(baseKey, nextCount);

  return nextCount === 1 ? baseKey : `${baseKey}-${nextCount}`;
}

function extractSections(blocks) {
  const byId = new Map(blocks.map((block) => [block.block_id, block]));
  const root = blocks.find((block) => block.block_type === 1);
  if (!root) {
    return [];
  }

  const rootHeading = 'root';
  const sections = [];
  let sectionCounter = 0;
  const headingTypes = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const visited = new Set();
  const operationKeyCounts = new Map();

  function createSection(heading) {
    sectionCounter += 1;
    const section = {
      heading,
      operationKey: operationKeyForHeading(heading, sectionCounter, operationKeyCounts),
      codeBlocks: [],
    };
    sections.push(section);
    return section;
  }

  function ensureSection(activeSection, activeHeading) {
    if (activeSection) {
      return activeSection;
    }
    return createSection(activeHeading);
  }

  function walk(blockId, activeSection, activeHeading) {
    if (!blockId || visited.has(blockId)) {
      return;
    }
    visited.add(blockId);

    const block = byId.get(blockId);
    if (!block) {
      return;
    }

    let sectionForChildren = activeSection;
    let headingForChildren = activeHeading;

    if (headingTypes.has(block.block_type)) {
      headingForChildren = textFromElements(headingElements(block)) || activeHeading;
      sectionForChildren = createSection(headingForChildren);
    } else if (block.block_type === 14) {
      const section = ensureSection(activeSection, activeHeading);
      section.codeBlocks.push({
        blockId: block.block_id,
        languageLabel: block.code?.language || 1,
        code: textFromElements(block.code?.elements || []),
      });
      sectionForChildren = section;
    }

    for (const childId of block.children || []) {
      walk(childId, sectionForChildren, headingForChildren);
    }
  }

  for (const childId of root.children || []) {
    walk(childId, null, rootHeading);
  }

  return sections.filter((section) => section.codeBlocks.length > 0);
}

module.exports = {
  extractSections,
  textFromElements,
  slugify,
};
