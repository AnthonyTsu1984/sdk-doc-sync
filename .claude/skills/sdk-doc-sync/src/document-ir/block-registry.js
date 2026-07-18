const BLOCK_ID_TO_NAME = Object.freeze({
  1: 'page',
  2: 'text',
  3: 'heading1',
  4: 'heading2',
  5: 'heading3',
  6: 'heading4',
  7: 'heading5',
  8: 'heading6',
  9: 'heading7',
  10: 'heading8',
  11: 'heading9',
  12: 'bullet',
  13: 'ordered',
  14: 'code',
  15: 'quote',
  16: null,
  17: 'todo',
  18: 'bitable',
  19: 'callout',
  20: 'chat_card',
  21: 'diagram',
  22: 'divider',
  23: 'file',
  24: 'grid',
  25: 'grid_column',
  26: 'iframe',
  27: 'image',
  28: 'isv',
  29: 'mindnote',
  30: 'sheet',
  31: 'table',
  32: 'table_cell',
  33: 'view',
  34: 'quote_container',
  35: 'task',
  36: 'okr',
  37: 'okr_objective',
  38: 'okr_key_result',
  39: 'okr_progress',
  40: 'add_ons',
  41: 'jira_issue',
  42: 'wiki_catelog',
  43: 'board',
  44: 'agenda',
  45: 'agenda_item',
  46: 'agenda_item_title',
  47: 'agenda_item_content',
  48: 'link_preview',
  49: 'source_synced',
  50: 'reference_synced',
  51: 'sub_page_list',
  52: 'ai_template',
});

const BLOCK_NAME_TO_ID = Object.freeze(Object.fromEntries(
  Object.entries(BLOCK_ID_TO_NAME)
    .filter(([, name]) => name !== null)
    .map(([id, name]) => [name, Number(id)]),
));

const LANGUAGE_ID_TO_NAME = Object.freeze([
  null,
  'PlainText',
  'ABAP',
  'Ada',
  'Apache',
  'Apex',
  'Assembly',
  'Bash',
  'CSharp',
  'C++',
  'C',
  'COBOL',
  'CSS',
  'CoffeeScript',
  'D',
  'Dart',
  'Delphi',
  'Django',
  'Dockerfile',
  'Erlang',
  'Fortran',
  'FoxPro',
  'Go',
  'Groovy',
  'HTML',
  'HTMLBars',
  'HTTP',
  'Haskell',
  'JSON',
  'Java',
  'JavaScript',
  'Julia',
  'Kotlin',
  'LateX',
  'Lisp',
  'Logo',
  'Lua',
  'MATLAB',
  'Makefile',
  'Markdown',
  'Nginx',
  'Objective',
  'OpenEdgeABL',
  'PHP',
  'Perl',
  'PostScript',
  'Power',
  'Prolog',
  'ProtoBuf',
  null,
  'Python',
  'R',
  'RPG',
  'Ruby',
  'Rust',
  'SAS',
  'SCSS',
  'SQL',
  'Scala',
  'Scheme',
  'Scratch',
  'Shell',
  'Swift',
  'Thrift',
  'TypeScript',
  'VBScript',
  'Visual',
  'XML',
  'YAML',
  'CMake',
  'Diff',
  'Gherkin',
  'GraphQL',
  'OpenGL Shading Language',
  'Properties',
  'Solidity',
  'TOML',
]);

const LANGUAGE_ALIASES = Object.freeze({
  js: 30,
  ts: 64,
  py: 50,
  cpp: 9,
  'c++': 9,
  bash: 7,
  shell: 61,
  plaintext: 1,
  text: 1,
});

const LANGUAGE_NAME_TO_ID = Object.freeze(Object.fromEntries(
  LANGUAGE_ID_TO_NAME
    .map((name, id) => [name, id])
    .filter(([name]) => name !== null)
    .map(([name, id]) => [name.toLowerCase(), id]),
));

function languageId(name) {
  if (typeof name !== 'string') return null;
  const normalized = name.toLowerCase();
  return LANGUAGE_ALIASES[normalized] ?? LANGUAGE_NAME_TO_ID[normalized] ?? null;
}

function languageName(id) {
  return LANGUAGE_ID_TO_NAME[id] ?? null;
}

function blockId(name) {
  if (typeof name !== 'string') return null;
  return BLOCK_NAME_TO_ID[name] ?? null;
}

function blockName(id) {
  return BLOCK_ID_TO_NAME[id] ?? null;
}

module.exports = {
  BLOCK_ID_TO_NAME,
  BLOCK_NAME_TO_ID,
  LANGUAGE_ID_TO_NAME,
  LANGUAGE_ALIASES,
  languageId,
  languageName,
  blockId,
  blockName,
};
