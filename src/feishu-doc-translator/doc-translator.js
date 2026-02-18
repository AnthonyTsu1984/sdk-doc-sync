/**
 * DocTranslator - Translate markdown document content while preserving structure
 */
class DocTranslator {
    constructor({ translator, sourceLang, targetLang }) {
        this.translator = translator;
        this.sourceLang = sourceLang;
        this.targetLang = targetLang;
    }

    /**
     * Translate markdown content while preserving formatting
     * @param {string} markdown - Source markdown content
     * @returns {Promise<string>} Translated markdown
     */
    async translateMarkdown(markdown) {
        // Split markdown into translatable and non-translatable parts
        const segments = this._segmentMarkdown(markdown);

        // Translate each segment
        const translatedSegments = [];
        for (const segment of segments) {
            if (segment.translatable) {
                const translated = await this.translator.translate(segment.text);
                translatedSegments.push(translated);
            } else {
                translatedSegments.push(segment.text);
            }
        }

        return translatedSegments.join('');
    }

    /**
     * Segment markdown into translatable and non-translatable parts
     * @private
     */
    _segmentMarkdown(markdown) {
        const segments = [];
        const lines = markdown.split('\n');

        let inCodeBlock = false;
        let codeBlockDelimiter = '';
        let currentSegment = '';
        let isTranslatable = true;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Detect code block start/end
            const codeBlockMatch = line.match(/^(`{3,}|~{3,})/);
            if (codeBlockMatch) {
                if (!inCodeBlock) {
                    // Starting code block
                    if (currentSegment) {
                        segments.push({ text: currentSegment, translatable: isTranslatable });
                        currentSegment = '';
                    }
                    inCodeBlock = true;
                    codeBlockDelimiter = codeBlockMatch[1];
                    isTranslatable = false;
                    currentSegment = line + '\n';
                } else if (line.startsWith(codeBlockDelimiter)) {
                    // Ending code block
                    currentSegment += line + '\n';
                    segments.push({ text: currentSegment, translatable: false });
                    currentSegment = '';
                    inCodeBlock = false;
                    isTranslatable = true;
                } else {
                    currentSegment += line + '\n';
                }
                continue;
            }

            if (inCodeBlock) {
                currentSegment += line + '\n';
                continue;
            }

            // Detect inline code, links, and other special patterns
            // For now, we translate whole lines except code blocks
            // More sophisticated parsing can be added later
            currentSegment += line + '\n';
        }

        // Add final segment
        if (currentSegment) {
            segments.push({ text: currentSegment, translatable: isTranslatable });
        }

        return segments;
    }

    /**
     * Translate a single text segment
     * @param {string} text - Text to translate
     * @returns {Promise<string>} Translated text
     */
    async translateText(text) {
        if (!text || text.trim() === '') {
            return text;
        }
        return await this.translator.translate(text);
    }

    /**
     * Preserve inline code and special markers while translating
     * @private
     */
    _preserveInlineCode(text) {
        // Extract inline code segments
        const inlineCodePattern = /`[^`]+`/g;
        const matches = text.match(inlineCodePattern) || [];
        const placeholders = [];

        let processedText = text;
        matches.forEach((match, index) => {
            const placeholder = `__CODE_${index}__`;
            placeholders.push({ placeholder, original: match });
            processedText = processedText.replace(match, placeholder);
        });

        return { processedText, placeholders };
    }

    /**
     * Restore inline code after translation
     * @private
     */
    _restoreInlineCode(text, placeholders) {
        let restored = text;
        placeholders.forEach(({ placeholder, original }) => {
            restored = restored.replace(placeholder, original);
        });
        return restored;
    }
}

module.exports = DocTranslator;
