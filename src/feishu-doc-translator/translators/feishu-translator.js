const fetch = require('node-fetch');
const Bottleneck = require('bottleneck');
const larkTokenFetcher = require('../../../lib/lark-docs/larkTokenFetcher');

require('dotenv').config();

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';

/**
 * FeishuTranslator - Use Feishu's translation API
 */
class FeishuTranslator {
    constructor({ sourceLang, targetLang, cache = null }) {
        this.sourceLang = sourceLang;
        this.targetLang = targetLang;
        this.cache = cache || new Map();
        this.tokenFetcher = new larkTokenFetcher();

        // Rate limiter: 30 requests per minute
        this.limiter = new Bottleneck({
            maxConcurrent: 1,
            minTime: 2000, // 2 seconds between requests
        });
    }

    /**
     * Translate text using Feishu API
     * @param {string} text - Text to translate
     * @returns {Promise<string>} Translated text
     */
    async translate(text) {
        if (!text || text.trim() === '') {
            return text;
        }

        // Check cache
        const cacheKey = `${this.sourceLang}:${this.targetLang}:${text}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        // Translate with rate limiting
        const throttledTranslate = this.limiter.wrap(this._translateText.bind(this));
        const translated = await throttledTranslate(text);

        // Cache result
        this.cache.set(cacheKey, translated);

        return translated;
    }

    /**
     * Internal translation method
     * @private
     */
    async _translateText(text) {
        const token = await this.tokenFetcher.token();
        const url = `${FEISHU_HOST}/open-apis/translation/v1/text/translate`;

        const body = {
            source_language: this.sourceLang,
            target_language: this.targetLang,
            text: text,
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });

        const data = await response.json();

        if (data.code !== 0) {
            throw new Error(`Feishu translation error: ${data.msg}`);
        }

        return data.data.text;
    }

    /**
     * Translate multiple texts in batch
     * @param {Array<string>} texts - Array of texts to translate
     * @returns {Promise<Array<string>>} Array of translated texts
     */
    async translateBatch(texts) {
        const results = [];
        for (const text of texts) {
            results.push(await this.translate(text));
        }
        return results;
    }
}

module.exports = FeishuTranslator;
