const fetch = require('node-fetch');
const LarkTokenFetcher = require('../../sdk-doc-sync/lib/lark-docs/larkTokenFetcher');

function parseTarget(target) {
  const url = new URL(target);
  const [, kind, token] = url.pathname.split('/');

  if (!token) {
    throw new Error(`Unsupported target path: ${url.pathname}`);
  }

  if (kind !== 'wiki' && kind !== 'docx') {
    throw new Error(`Unsupported target kind: ${kind}`);
  }

  return { kind, token };
}

function resolveRequestTimeoutMs() {
  const fallback = 10000;
  const raw = process.env.FEISHU_REQUEST_TIMEOUT_MS;
  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    return fallback;
  }

  return parsed;
}

function isUnsafeHostAllowed() {
  return String(process.env.FEISHU_ALLOW_UNSAFE_HOST || '').toLowerCase() === 'true';
}

function assertTrustedHost(host) {
  if (isUnsafeHostAllowed()) {
    return;
  }

  const { hostname } = new URL(host);
  const trusted =
    hostname === 'open.feishu.cn' ||
    hostname === 'open.larksuite.com' ||
    hostname.endsWith('.feishu.cn') ||
    hostname.endsWith('.larksuite.com');

  if (!trusted) {
    throw new Error(`Untrusted FEISHU_HOST: ${host}`);
  }
}

async function resolveDocumentId(target) {
  const parsed = parseTarget(target);
  if (parsed.kind === 'docx') {
    return parsed.token;
  }

  const host = process.env.FEISHU_HOST;
  if (!host) {
    throw new Error('Missing FEISHU_HOST environment variable');
  }

  assertTrustedHost(host);

  const tokenFetcher = new LarkTokenFetcher();
  const tenantToken = await tokenFetcher.token();

  const timeoutMs = resolveRequestTimeoutMs();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${host}/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(parsed.token)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tenantToken}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to resolve wiki node: HTTP ${response.status}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error(`Failed to resolve wiki node: invalid JSON (${error.message})`);
    }

    if (!data || typeof data !== 'object') {
      throw new Error('Failed to resolve wiki node: empty response body');
    }

    if (data.code !== 0) {
      throw new Error(`Failed to resolve wiki node: ${data.msg || `code ${data.code}`}`);
    }

    const objToken = data?.data?.node?.obj_token;
    if (!objToken) {
      throw new Error('Failed to resolve wiki node: missing obj_token');
    }

    return objToken;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Failed to resolve wiki node: request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  parseTarget,
  resolveDocumentId,
  assertTrustedHost,
};
