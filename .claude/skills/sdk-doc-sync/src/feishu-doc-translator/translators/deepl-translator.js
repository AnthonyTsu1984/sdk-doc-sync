const fetch = require('node-fetch');
const Bottleneck = require('bottleneck');

require('dotenv').config();

/**
 * DeepLTranslator - Use DeepL API for high-quality translation
 *
 * DeepL is known for superior translation quality, especially for European languages.
 * Supports both free and pro API keys.
 *
 * Setup:
 *   1. Sign up at https://www.deepl.com/pro-api
 *   2. Get your API key
 *   3. Add to .env: DEEPL_API_KEY=your-key-here
 *   4. Optional: DEEPL_API_URL (defaults to free tier URL)
 */
class DeepLTranslator {
    constructor({ sourceLang, targetLang, cache = null, apiUrl = null }) {
        this.sourceLang = sourceLang;
        this.targetLang = targetLang;
        this.cache = cache || new Map();

        const apiKey = process.env.DEEPL_API_KEY;
        if (!apiKey) {
            throw new Error('DEEPL_API_KEY must be set in .env file');
        }

        this.apiKey = apiKey;

        // Default to free API endpoint, override with DEEPL_API_URL for pro tier
        this.apiUrl = apiUrl
            || process.env.DEEPL_API_URL
            || 'https://api-free.deepl.com/v2/translate';

        // Rate limiter: DeepL free tier allows ~500k chars/month
        // Limit to 1 request per 100ms to be conservative
        this.limiter = new Bottleneck({
            maxConcurrent: 5,
            minTime: 100,
        });
    }

    /**
     * Translate text using DeepL API
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
        const body = new URLSearchParams({
            auth_key: this.apiKey,
            text: text,
            source_lang: this._mapLanguageCode(this.sourceLang, 'source'),
            target_lang: this._mapLanguageCode(this.targetLang, 'target'),
            preserve_formatting: '1',
            tag_handling: 'xml', // Better handling of markdown-like tags
        });

        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body,
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`DeepL API error: ${response.status} - ${error}`);
        }

        const data = await response.json();

        if (!data.translations || data.translations.length === 0) {
            throw new Error('DeepL returned no translations');
        }

        return data.translations[0].text;
    }

    /**
     * Map language codes to DeepL format
     * DeepL uses different codes for some languages
     * @private
     */
    _mapLanguageCode(code, direction) {
        const langMap = {
            // Common mappings
            'en': direction === 'target' ? 'EN-US' : 'EN',
            'ja': 'JA',
            'zh': 'ZH',
            'zh-CN': 'ZH',
            'zh-TW': 'ZH', // DeepL doesn't distinguish traditional/simplified in API
            'ko': 'KO',
            'de': 'DE',
            'fr': 'FR',
            'es': 'ES',
            'it': 'IT',
            'pt': 'PT-PT',
            'pt-BR': 'PT-BR',
            'ru': 'RU',
            'nl': 'NL',
            'pl': 'PL',
        };

        const mapped = langMap[code];
        if (!mapped) {
            console.warn(`Language code '${code}' not in DeepL mapping, using as-is`);
            return code.toUpperCase();
        }

        return mapped;
    }

    /**
     * Translate markdown document
     * @param {string} markdown - Markdown content
     * @returns {Promise<string>} Translated markdown
     */
    async translateMarkdown(markdown) {
        // DeepL doesn't have markdown-specific mode, but preserve_formatting helps
        // Split by code blocks to avoid translating code
        const parts = this._splitMarkdownForTranslation(markdown);
        const translated = [];

        for (const part of parts) {
            if (part.type === 'code' || part.type === 'inline-code') {
                // Don't translate code
                translated.push(part.content);
            } else if (part.type === 'text') {
                // Translate text content
                const result = await this.translate(part.content);
                translated.push(result);
            }
        }

        return translated.join('');
    }

    /**
     * Split markdown into translatable and non-translatable parts
     * @private
     */
    _splitMarkdownForTranslation(markdown) {
        const parts = [];
        let remaining = markdown;

        // Extract code blocks first (```...```)
        const codeBlockRegex = /(```[\s\S]*?```)/g;
        const withCodeBlocks = remaining.split(codeBlockRegex);

        for (let i = 0; i < withCodeBlocks.length; i++) {
            const part = withCodeBlocks[i];
            if (part.startsWith('```')) {
                parts.push({ type: 'code', content: part });
            } else if (part.trim()) {
                // Further split by inline code (`...`)
                const inlineCodeRegex = /(`[^`]+`)/g;
                const withInlineCode = part.split(inlineCodeRegex);

                for (let j = 0; j < withInlineCode.length; j++) {
                    const segment = withInlineCode[j];
                    if (segment.startsWith('`') && segment.endsWith('`')) {
                        parts.push({ type: 'inline-code', content: segment });
                    } else if (segment.trim()) {
                        parts.push({ type: 'text', content: segment });
                    }
                }
            }
        }

        return parts;
    }

    /**
     * Translate multiple texts in batch
     * @param {Array<string>} texts - Array of texts to translate
     * @returns {Promise<Array<string>>} Array of translated texts
     */
    async translateBatch(texts) {
        // DeepL supports batch translation in single request
        // But we'll use individual requests with rate limiting for reliability
        const results = [];
        for (const text of texts) {
            results.push(await this.translate(text));
        }
        return results;
    }
}

module.exports = DeepLTranslator;
