'use strict';

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

class FeishuError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FeishuError';
    this.code = code;
    Object.assign(this, details);
  }
}

class FeishuClient {
  constructor({
    host,
    tokenProvider,
    transport,
    maxRetries = 3,
    wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  }) {
    if (typeof host !== 'string' || host.trim() === '') {
      throw new TypeError('FeishuClient requires a non-empty host');
    }
    if (typeof tokenProvider !== 'function') {
      throw new TypeError('FeishuClient requires an async tokenProvider function');
    }
    if (typeof transport !== 'function') {
      throw new TypeError('FeishuClient requires an async transport function');
    }
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
      throw new TypeError('FeishuClient maxRetries must be a non-negative integer');
    }
    if (typeof wait !== 'function') {
      throw new TypeError('FeishuClient wait must be a function');
    }

    this.host = host.replace(/\/+$/, '');
    this.tokenProvider = tokenProvider;
    this.transport = transport;
    this.maxRetries = maxRetries;
    this.wait = wait;
  }

  async request({ method = 'GET', path, body = null }) {
    if (typeof path !== 'string' || path.trim() === '') {
      throw new TypeError('FeishuClient request requires a non-empty path');
    }

    const requestMethod = String(method).toUpperCase();
    const url = `${this.host}/${path.replace(/^\/+/, '')}`;
    for (let retry = 0; ; retry += 1) {
      const token = await this.tokenProvider();
      if (typeof token !== 'string' || token.trim() === '') {
        throw new FeishuError(
          'FEISHU_TOKEN_INVALID',
          'Feishu tokenProvider must return a non-empty access token',
        );
      }

      const headers = { Authorization: `Bearer ${token.trim()}` };
      let encodedBody;
      if (body !== null) {
        headers['Content-Type'] = 'application/json; charset=utf-8';
        encodedBody = JSON.stringify(body);
      }

      const response = await this.transport({
        url,
        method: requestMethod,
        headers,
        body: encodedBody,
      });
      const status = response?.status;
      if (!Number.isInteger(status)) {
        throw new FeishuError(
          'FEISHU_INVALID_RESPONSE',
          `Feishu ${requestMethod} ${path} returned a response without an HTTP status`,
        );
      }

      if (TRANSIENT_STATUSES.has(status)) {
        if (retry >= this.maxRetries) {
          throw new FeishuError(
            'FEISHU_RETRY_EXHAUSTED',
            `Feishu ${requestMethod} ${path} exhausted ${this.maxRetries} retries after HTTP ${status}`,
            { status, attempts: retry + 1 },
          );
        }
        await this.wait(this._retryDelay(response, retry));
        continue;
      }

      if (status < 200 || status >= 300) {
        throw new FeishuError(
          'FEISHU_HTTP_ERROR',
          `Feishu ${requestMethod} ${path} failed with HTTP ${status}`,
          { status },
        );
      }

      let envelope;
      try {
        envelope = await response.json();
      } catch (cause) {
        throw new FeishuError(
          'FEISHU_INVALID_JSON',
          `Feishu ${requestMethod} ${path} returned invalid JSON`,
          { cause },
        );
      }

      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
        throw new FeishuError(
          'FEISHU_INVALID_RESPONSE',
          `Feishu ${requestMethod} ${path} must return an object envelope`,
        );
      }
      if (!Object.hasOwn(envelope, 'code') || typeof envelope.code !== 'number') {
        throw new FeishuError(
          'FEISHU_INVALID_RESPONSE',
          `Feishu ${requestMethod} ${path} returned an envelope without a numeric code`,
        );
      }
      if (envelope.code !== 0) {
        const apiMessage = typeof envelope.msg === 'string' && envelope.msg
          ? `: ${envelope.msg}`
          : '';
        throw new FeishuError(
          'FEISHU_API_ERROR',
          `Feishu ${requestMethod} ${path} failed with API code ${envelope.code}${apiMessage}`,
          { apiCode: envelope.code },
        );
      }

      return envelope;
    }
  }

  async paginate({ path, itemPath = ['data', 'items'], pageTokenName = 'page_token' }) {
    if (!Array.isArray(itemPath) || itemPath.length === 0) {
      throw new TypeError('FeishuClient paginate itemPath must be a non-empty array');
    }

    const items = [];
    let pageToken = null;
    const seenTokens = new Set();

    for (;;) {
      const pagePath = this._withPageToken(path, pageTokenName, pageToken);
      const envelope = await this.request({ path: pagePath });
      const pageItems = itemPath.reduce((value, key) => value?.[key], envelope);
      if (!Array.isArray(pageItems)) {
        throw new FeishuError(
          'FEISHU_PAGINATION_INVALID',
          `Feishu pagination response at ${itemPath.join('.')} must be an array`,
        );
      }
      items.push(...pageItems);

      const data = envelope.data;
      if (!data?.has_more) return items;
      pageToken = data.page_token;
      if (typeof pageToken !== 'string' || pageToken === '') {
        throw new FeishuError(
          'FEISHU_PAGINATION_INVALID',
          'Feishu pagination response has_more=true without a page_token',
        );
      }
      if (seenTokens.has(pageToken)) {
        throw new FeishuError(
          'FEISHU_PAGINATION_INVALID',
          `Feishu pagination repeated page_token ${pageToken}`,
        );
      }
      seenTokens.add(pageToken);
    }
  }

  _retryDelay(response, retry) {
    const reset = response?.headers?.get?.('x-ogw-ratelimit-reset');
    const seconds = Number(reset);
    if (reset !== null && reset !== '' && Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
    return 1000 * (2 ** retry);
  }

  _withPageToken(path, pageTokenName, pageToken) {
    if (pageToken === null) return path;
    const url = new URL(path, 'https://feishu-client.invalid');
    url.searchParams.set(pageTokenName, pageToken);
    return `${url.pathname}${url.search}`;
  }
}

module.exports = FeishuClient;
module.exports.FeishuClient = FeishuClient;
module.exports.FeishuError = FeishuError;
