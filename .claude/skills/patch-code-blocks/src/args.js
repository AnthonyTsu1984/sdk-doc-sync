const VALID_PRODUCTS = new Set(['milvus', 'zilliz-saas', 'zilliz-paas']);
const VALID_LANGUAGES = new Set(['python', 'java', 'go', 'node', 'rest', 'cli']);
const DEFAULT_REFERENCE = '/Volumes/CaseSensitive/projects/feishu-markdown-bridge/repos';
const DEFAULT_LANGUAGES = ['python', 'java', 'go', 'node', 'rest', 'cli'];

function normalizeLanguage(value) {
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'restful' || normalized === 'restful-api') {
    return 'rest';
  }
  return normalized;
}

function parseList(value) {
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeLanguage);
}

function parseBoolean(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function requireValue(flag, value) {
  if (value == null || String(value).startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parseArgs(argv) {
  const cfg = {
    target: null,
    product: 'milvus',
    release: null,
    reference: DEFAULT_REFERENCE,
    languages: [...DEFAULT_LANGUAGES],
    languageOrder: null,
    apply: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];

    if (!String(key).startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${key}`);
    }

    switch (key) {
      case '--target':
        cfg.target = requireValue(key, argv[index + 1]);
        index += 1;
        break;
      case '--product':
        cfg.product = requireValue(key, argv[index + 1]);
        index += 1;
        break;
      case '--release':
        cfg.release = requireValue(key, argv[index + 1]);
        index += 1;
        break;
      case '--reference':
        cfg.reference = requireValue(key, argv[index + 1]);
        index += 1;
        break;
      case '--languages':
        cfg.languages = parseList(requireValue(key, argv[index + 1]));
        index += 1;
        break;
      case '--language-order':
        cfg.languageOrder = parseList(requireValue(key, argv[index + 1]));
        index += 1;
        break;
      case '--apply':
        cfg.apply = parseBoolean(requireValue(key, argv[index + 1]));
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${key}`);
    }
  }

  if (!cfg.target) {
    throw new Error('Missing required --target');
  }

  if (!VALID_PRODUCTS.has(cfg.product)) {
    throw new Error(`Invalid --product: ${cfg.product}`);
  }

  if (cfg.product === 'milvus' && !cfg.release) {
    throw new Error('--release is required when --product=milvus');
  }

  for (const language of cfg.languages) {
    if (!VALID_LANGUAGES.has(language)) {
      throw new Error(`Invalid language: ${language}`);
    }
  }

  if (cfg.languageOrder) {
    for (const language of cfg.languageOrder) {
      if (!VALID_LANGUAGES.has(language)) {
        throw new Error(`Invalid language-order value: ${language}`);
      }

      if (!cfg.languages.includes(language)) {
        throw new Error(`language-order value must also be present in --languages: ${language}`);
      }
    }
  }

  return cfg;
}

module.exports = {
  DEFAULT_LANGUAGES,
  DEFAULT_REFERENCE,
  VALID_LANGUAGES,
  VALID_PRODUCTS,
  normalizeLanguage,
  parseArgs,
};
