const fetch = require('node-fetch');
const Bottleneck = require('bottleneck');

require('dotenv').config();

/**
 * OllamaTranslator - Use local Ollama for translation
 *
 * Ollama allows running LLMs locally for free, private translation.
 * Best for: privacy-sensitive content, offline work, cost reduction
 *
 * Setup:
 *   1. Install Ollama: https://ollama.ai
 *   2. Pull a multilingual model:
 *      - ollama pull qwen2.5:7b (recommended for translation)
 *      - ollama pull mixtral:8x7b (higher quality, slower)
 *      - ollama pull llama3.1:8b (general purpose)
 *   3. Start Ollama: ollama serve
 *   4. Configure in .env:
 *      - OLLAMA_BASE_URL=http://localhost:11434 (default)
 *      - OLLAMA_MODEL=qwen2.5:7b (or your preferred model)
 */
class OllamaTranslator {
    constructor({ sourceLang, targetLang, cache = null, model = null, baseUrl = null }) {
        this.sourceLang = sourceLang;
        this.targetLang = targetLang;
        this.cache = cache || new Map();

        // Ollama configuration
        this.baseUrl = baseUrl
            || process.env.OLLAMA_BASE_URL
            || 'http://localhost:11434';

        this.model = model
            || process.env.OLLAMA_MODEL
            || 'qwen2.5:7b'; // Qwen 2.5 is excellent for multilingual translation

        // Rate limiter: Ollama is local, but still limit concurrent requests
        this.limiter = new Bottleneck({
            maxConcurrent: 1, // Process one at a time for local models
            minTime: 0, // No minimum time needed for local
        });
    }

    /**
     * Translate text using Ollama
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

        const response = await fetch(`${this.baseUrl}/api/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: this.model,
                prompt: prompt,
                stream: false,
                options: {
                    temperature: 0.3, // Lower temperature for more consistent translation
                    top_p: 0.9,
                    num_predict: 2048, // Max tokens for response
                },
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Ollama API error: ${response.status} - ${error}`);
        }

        const data = await response.json();

        if (!data.response) {
            throw new Error('Ollama returned no response');
        }

        // Clean up response (remove any explanations)
        return this._cleanTranslationResponse(data.response);
    }

    /**
     * Build translation prompt for Ollama
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
            it: 'Italian',
            pt: 'Portuguese',
            ru: 'Russian',
        };

        const sourceName = langNames[this.sourceLang] || this.sourceLang;
        const targetName = langNames[this.targetLang] || this.targetLang;

        return `Translate the following ${sourceName} text to ${targetName}.

CRITICAL RULES:
1. Output ONLY the translated text, no explanations
2. Preserve ALL formatting (markdown, line breaks, spacing)
3. Do NOT translate code between backticks
4. Do NOT translate technical terms, API names, parameter names
5. Maintain professional/technical tone
6. Do NOT add any commentary or notes

Text to translate:
${text}

Translation:`;
    }

    /**
     * Clean translation response (remove explanations, notes, etc.)
     * @private
     */
    _cleanTranslationResponse(response) {
        // Remove common unwanted prefixes
        let cleaned = response.trim();

        // Remove "Translation:" prefix if present
        cleaned = cleaned.replace(/^Translation:\s*/i, '');

        // Remove "Here is the translation:" prefix
        cleaned = cleaned.replace(/^Here is the translation:\s*/i, '');

        // Remove explanatory text after translation (common pattern: "Note: ...")
        cleaned = cleaned.replace(/\n\nNote:[\s\S]*$/i, '');

        return cleaned.trim();
    }

    /**
     * Translate markdown document
     * @param {string} markdown - Markdown content
     * @returns {Promise<string>} Translated markdown
     */
    async translateMarkdown(markdown) {
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

        const prompt = `Translate the following technical documentation from ${sourceName} to ${targetName}.

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
6. Output ONLY the translated markdown, no explanations

Markdown to translate:
${markdown}

Translated markdown:`;

        const response = await fetch(`${this.baseUrl}/api/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: this.model,
                prompt: prompt,
                stream: false,
                options: {
                    temperature: 0.3,
                    top_p: 0.9,
                    num_predict: 8192, // Larger for full markdown docs
                },
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Ollama API error: ${response.status} - ${error}`);
        }

        const data = await response.json();
        return this._cleanTranslationResponse(data.response);
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

    /**
     * Check if Ollama is available
     * @returns {Promise<boolean>} True if Ollama is running
     */
    async isAvailable() {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`, {
                method: 'GET',
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get list of available models
     * @returns {Promise<Array<string>>} List of model names
     */
    async listModels() {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`, {
                method: 'GET',
            });

            if (!response.ok) {
                return [];
            }

            const data = await response.json();
            return data.models ? data.models.map(m => m.name) : [];
        } catch (error) {
            return [];
        }
    }
}

module.exports = OllamaTranslator;
