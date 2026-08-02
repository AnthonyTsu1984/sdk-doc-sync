const Anthropic = require('@anthropic-ai/sdk');
const Bottleneck = require('bottleneck');

require('dotenv').config();

/**
 * ClaudeTranslator - Use Claude API for context-aware translation
 */
class ClaudeTranslator {
    constructor({ sourceLang, targetLang, cache = null, model = 'claude-haiku-4-5-20251001' }) {
        this.sourceLang = sourceLang;
        this.targetLang = targetLang;
        this.cache = cache || new Map();
        this.model = model;

        const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
        if (!apiKey) {
            throw new Error('ANTHROPIC_API_KEY or CLAUDE_API_KEY must be set in .env');
        }

        this.client = new Anthropic({ apiKey });

        // Rate limiter for Claude API
        this.limiter = new Bottleneck({
            maxConcurrent: 5,
            minTime: 200, // 200ms between requests
        });
    }

    /**
     * Translate text using Claude API
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
        const prompt = this._buildTranslationPrompt(text);

        const message = await this.client.messages.create({
            model: this.model,
            max_tokens: 4096,
            messages: [{
                role: 'user',
                content: prompt,
            }],
        });

        return message.content[0].text.trim();
    }

    /**
     * Build translation prompt for Claude
     * @private
     */
    _buildTranslationPrompt(text) {
        const langNames = {
            en: 'English',
            ja: 'Japanese',
            zh: 'Chinese (Simplified)',
            'zh-TW': 'Chinese (Traditional)',
            ko: 'Korean',
            de: 'German',
            fr: 'French',
            es: 'Spanish',
        };

        const sourceName = langNames[this.sourceLang] || this.sourceLang;
        const targetName = langNames[this.targetLang] || this.targetLang;

        return `Translate the following ${sourceName} text to ${targetName}.

IMPORTANT RULES:
1. Preserve ALL markdown formatting (headings, lists, bold, italic, code blocks, links)
2. Do NOT translate inline code (text between backticks \`like this\`)
3. Do NOT translate code blocks (text between triple backticks)
4. Do NOT translate anchor IDs (e.g., {#request-syntax})
5. Preserve technical terms (API names, parameter names, class names)
6. Maintain the same structure and line breaks
7. For documentation, use formal/technical tone
8. Output ONLY the translated text, no explanations

Text to translate:

${text}`;
    }

    /**
     * Translate markdown document with better preservation
     * @param {string} markdown - Markdown content
     * @returns {Promise<string>} Translated markdown
     */
    async translateMarkdown(markdown) {
        const prompt = `Translate the following technical documentation from ${this.sourceLang} to ${this.targetLang}.

CRITICAL REQUIREMENTS:
1. Preserve ALL markdown syntax exactly (headings #, lists -, bold **, italic *, code blocks \`\`\`)
2. Do NOT translate:
   - Code blocks (between \`\`\`)
   - Inline code (between single backticks)
   - Parameter names, function names, class names
   - Anchor IDs like {#request-syntax}
   - URLs
3. DO translate:
   - Headings (but keep anchor IDs)
   - Paragraph text
   - List item descriptions
   - Bold/italic text content
4. Maintain exact same structure and line breaks
5. Use formal technical writing style
6. Output ONLY the translated markdown, no explanations or comments

Markdown to translate:

${markdown}`;

        const message = await this.client.messages.create({
            model: this.model,
            max_tokens: 8192,
            messages: [{
                role: 'user',
                content: prompt,
            }],
        });

        return message.content[0].text.trim();
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

module.exports = ClaudeTranslator;
