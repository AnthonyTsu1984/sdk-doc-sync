const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher.js');
const fetch = require('node-fetch');
const marked = require('marked');
const cheerio = require('cheerio');
const {
    BLOCK_NAME_TO_ID,
    LANGUAGE_ID_TO_NAME,
    LANGUAGE_ALIASES,
    languageId,
} = require('./document-ir/block-registry');
const layoutProfiles = require('./renderers/sdk-layout-profiles');
const { buildApiSectionModel } = require('./sdk-doc-sync/api-section-model');
const { assertWriterMutation } = require('../../doc-ops-core/src/writer-governance');

require('dotenv').config();

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';

class MarkdownToFeishu {
    constructor({ sourceType = 'drive', rootToken, baseToken, document_id = null, governance = null }) {
        this.source_type = sourceType;
        this.root_token = rootToken;
        this.base_token = baseToken;
        this.document_id = document_id;
        this.governance = governance;
        this.tokenFetcher = new larkTokenFetcher();

        // Reverse mappings from larkDocWriter
        this.block_type_map = this.__create_block_type_map();
        this.lang_map = this.__create_lang_map();
        this.lang_id_map = this.__create_lang_id_map();
    }

    __create_block_type_map() {
        return { ...BLOCK_NAME_TO_ID };
    }

    __create_lang_map() {
        return Array.from(LANGUAGE_ID_TO_NAME);
    }

    __create_lang_id_map() {
        // Create reverse lookup: language name -> ID
        const map = {};
        this.lang_map.forEach((lang, idx) => {
            if (lang) {
                map[lang.toLowerCase()] = idx;
            }
        });
        Object.assign(map, LANGUAGE_ALIASES);
        return map;
    }

    __get_lang_id(lang_name) {
        return languageId(lang_name) ?? 1;
    }

    // ==================== Text Element Parsing ====================

    __create_text_element(content, styles = {}) {
        return {
            text_run: {
                content: content,
                text_element_style: {
                    bold: styles.bold || false,
                    italic: styles.italic || false,
                    strikethrough: styles.strikethrough || false,
                    underline: styles.underline || false,
                    inline_code: styles.inline_code || false,
                    ...(styles.link && { link: styles.link })
                }
            }
        };
    }

    __parse_inline_markdown(text) {
        // Reverse the escaping from larkDocWriter.__text_run()
        if (!text || text.trim() === '') {
            return [this.__create_text_element(text || '')];
        }

        text = text.replace(/\\([\\`*_[\]{}()#+\-.!>])/g, '$1');
        text = text.replace(/&(?:amp|lt|gt|quot|#39|#x27);/gi, entity => ({
            '&amp;': '&',
            '&lt;': '<',
            '&gt;': '>',
            '&quot;': '"',
            '&#39;': "'",
            '&#x27;': "'",
        })[entity.toLowerCase()] || entity);

        const elements = [];
        let buffer = '';

        for (let i = 0; i < text.length; i++) {
            // Check for inline equation $formula$ (but not $$)
            if (text[i] === '$' && text[i+1] !== '$') {
                const end = text.indexOf('$', i + 1);
                if (end !== -1) {
                    if (buffer) {
                        elements.push(this.__create_text_element(buffer));
                        buffer = '';
                    }
                    const formula = text.substring(i + 1, end);
                    elements.push(this.__create_equation_element(formula));
                    i = end;
                    continue;
                }
            }

            // Check for bold **text**
            if (text.substr(i, 2) === '**') {
                const end = text.indexOf('**', i + 2);
                if (end !== -1) {
                    if (buffer) {
                        elements.push(this.__create_text_element(buffer));
                        buffer = '';
                    }
                    const bold_text = text.substring(i + 2, end);
                    elements.push(this.__create_text_element(bold_text, { bold: true }));
                    i = end + 1;
                    continue;
                }
            }

            // Check for italic *text* (but not **)
            if (text[i] === '*' && text[i+1] !== '*') {
                const end = text.indexOf('*', i + 1);
                if (end !== -1 && text[end-1] !== '*') {
                    if (buffer) {
                        elements.push(this.__create_text_element(buffer));
                        buffer = '';
                    }
                    const italic_text = text.substring(i + 1, end);
                    elements.push(this.__create_text_element(italic_text, { italic: true }));
                    i = end;
                    continue;
                }
            }

            // Check for strikethrough ~~text~~
            if (text.substr(i, 2) === '~~') {
                const end = text.indexOf('~~', i + 2);
                if (end !== -1) {
                    if (buffer) {
                        elements.push(this.__create_text_element(buffer));
                        buffer = '';
                    }
                    const strike_text = text.substring(i + 2, end);
                    elements.push(this.__create_text_element(strike_text, { strikethrough: true }));
                    i = end + 1;
                    continue;
                }
            }

            // Check for inline code `text`
            if (text[i] === '`') {
                const end = text.indexOf('`', i + 1);
                if (end !== -1) {
                    if (buffer) {
                        elements.push(this.__create_text_element(buffer));
                        buffer = '';
                    }
                    const code_text = text.substring(i + 1, end);
                    elements.push(this.__create_text_element(code_text, { inline_code: true }));
                    i = end;
                    continue;
                }
            }

            // Check for links [text](url)
            if (text[i] === '[') {
                const link_end = text.indexOf('](', i);
                const url_end = text.indexOf(')', link_end);
                if (link_end !== -1 && url_end !== -1) {
                    if (buffer) {
                        elements.push(this.__create_text_element(buffer));
                        buffer = '';
                    }
                    const link_text = text.substring(i + 1, link_end);
                    const url = text.substring(link_end + 2, url_end);
                    elements.push(this.__create_text_element(link_text, {
                        link: { url: encodeURIComponent(url) }
                    }));
                    i = url_end;
                    continue;
                }
            }

            // Regular character - add to buffer
            buffer += text[i];
        }

        // Add remaining buffer
        if (buffer) {
            elements.push(this.__create_text_element(buffer));
        }

        return elements.length > 0 ? elements : [this.__create_text_element('')];
    }

    __create_equation_element(content) {
        return {
            equation: {
                content: content,
                text_element_style: {}
            }
        };
    }

    // ==================== Block Converters ====================

    __create_heading_block(token) {
        // Parse: ## Request syntax{#request-syntax}
        let text = token.text;
        let custom_slug = null;

        const match = text.match(/^(.+?)\{#([a-z0-9-]+)\}$/);
        if (match) {
            text = match[1].trim();
            custom_slug = match[2];
        }

        const level = Math.min(token.depth, 9); // Feishu supports h1-h9
        const block_type = this.block_type_map[`heading${level}`];

        return {
            block_type: block_type,
            [`heading${level}`]: {
                elements: this.__parse_inline_markdown(text),
                style: { align: 1 }
            }
        };
    }

    __create_text_block(token) {
        return {
            block_type: this.block_type_map.text,
            text: {
                elements: this.__parse_inline_markdown(token.text),
                style: { align: 1 }
            }
        };
    }

    __create_code_block(token) {
        const lang_id = this.__get_lang_id(token.lang);

        return {
            block_type: this.block_type_map.code,
            code: {
                elements: [{
                    text_run: {
                        content: token.text,
                        text_element_style: {}
                    }
                }],
                style: {
                    language: lang_id
                }
            }
        };
    }

    __create_list_blocks(token, ordered = false) {
        const blocks = [];
        const block_type = ordered ? this.block_type_map.ordered : this.block_type_map.bullet;

        token.items.forEach(item => {
            if (item.loose) {
                // Loose list: child tokens are paragraph/space/list types.
                // First paragraph becomes the bullet text; rest become children.
                const children = [];
                let bulletText = '';

                for (const childToken of (item.tokens || [])) {
                    if (childToken.type === 'space') continue;
                    if (!bulletText && childToken.type === 'paragraph') {
                        bulletText = childToken.text;
                    } else if (childToken.type === 'paragraph') {
                        children.push(this.__create_text_block({
                            ...childToken,
                            text: String(childToken.text || '').replace(/^\s+/, ''),
                        }));
                    } else if (childToken.type === 'list') {
                        children.push(...this.__create_list_blocks(childToken, childToken.ordered));
                    }
                }

                const block = {
                    block_type: block_type,
                    [ordered ? 'ordered' : 'bullet']: {
                        elements: this.__parse_inline_markdown(bulletText || item.text),
                        style: {}
                    }
                };
                if (children.length > 0) block.children = children;
                blocks.push(block);
            } else {
                // Tight list: nested lists are represented both in item.text and as
                // structural list tokens. Use the tokens so nested labels are emitted once.
                const contentTokens = (item.tokens || []).filter(childToken => childToken.type !== 'space');
                const labelToken = contentTokens.find(childToken =>
                    childToken.type !== 'list' &&
                    childToken.type !== 'checkbox' &&
                    childToken.text?.trim()
                );
                const labelLines = String(labelToken?.text || item.text || '')
                    .split(/\r?\n/)
                    .map(line => line.trim())
                    .filter(Boolean);
                const bulletText = labelLines.shift() || '';

                const block = {
                    block_type: block_type,
                    [ordered ? 'ordered' : 'bullet']: {
                        elements: this.__parse_inline_markdown(bulletText),
                        style: {}
                    }
                };

                const children = [];
                for (const continuation of labelLines) {
                    children.push(this.__create_text_block({ type: 'text', text: continuation }));
                }
                for (const childToken of contentTokens) {
                    if (childToken.type === 'list') {
                        children.push(...this.__create_list_blocks(childToken, childToken.ordered));
                    } else if (childToken.type === 'checkbox' || childToken === labelToken) {
                        continue;
                    } else if (childToken.text?.trim()) {
                        children.push(this.__create_text_block({
                            ...childToken,
                            text: String(childToken.text || '').replace(/^\s+/, ''),
                        }));
                    }
                }

                if (children.length > 0) block.children = children;
                blocks.push(block);
            }
        });

        return blocks;
    }

    __create_divider_block() {
        return {
            block_type: this.block_type_map.divider,
            divider: {}
        };
    }

    __parse_html_block(token) {
        const html = token.text;

        // Check if it's a Grid component
        if (html.includes('<Grid')) {
            return this.__parse_grid(html);
        }

        // Check if it's a Tabs component
        if (html.includes('<Tabs')) {
            return this.__parse_tabs(html);
        }

        // Check if it's a Supademo component
        if (html.includes('<Supademo')) {
            return this.__parse_supademo(html);
        }

        // Check if it's an Admonition
        if (html.includes('<Admonition')) {
            return this.__parse_admonition(html);
        }

        // Check if it's a feishu-block metadata comment (board, iframe, sheet)
        if (html.includes('feishu-block:')) {
            return this.__parse_feishu_metadata(html);
        }

        // Check if it's a table
        if (html.includes('<table')) {
            return this.__create_table_block(html);
        }

        // Preserve audience markers while parsing the enclosed Markdown into
        // normal rich blocks. Treating the complete region as one text block
        // exposes Markdown escapes such as object\_url in the live Docx.
        const audience = html.match(/^\s*<(include|exclude)\s+target="([^"]+)">\s*\n?([\s\S]*?)\n?\s*<\/\1>\s*$/i);
        if (audience) {
            const [, mode, target, body] = audience;
            const innerBlocks = marked.lexer(body)
                .flatMap(innerToken => this.__token_to_blocks(innerToken));
            return {
                __audience_blocks: [
                    this.__create_audience_marker_block(`<${mode.toLowerCase()} target="${target}">`),
                    ...innerBlocks,
                    this.__create_audience_marker_block(`</${mode.toLowerCase()}>`),
                ]
            };
        }

        // Preserve malformed or marker-only audience HTML verbatim so the
        // caller can surface it for review instead of silently dropping it.
        if (html.includes('<include') || html.includes('<exclude')) {
            return this.__create_audience_marker_block(html);
        }

        // Default: create text block with HTML
        return this.__create_text_block({ text: html });
    }

    __create_audience_marker_block(text) {
        return {
            block_type: this.block_type_map.text,
            text: {
                elements: [this.__create_text_element(text)],
                style: {}
            }
        };
    }

    __parse_admonition(html) {
        const $ = cheerio.load(html);
        const admonition = $('Admonition');
        const icon = admonition.attr('icon');
        const title = admonition.attr('title');
        const content = admonition.html();

        // Map icon to Feishu emoji_id
        const emoji_map = {
            '📘': 'blue_book',
            '🚧': 'construction',
            '⚠️': 'warning',
            '💡': 'bulb',
            '✅': 'white_check_mark'
        };

        const children = [];

        // Add title as first child
        if (title) {
            children.push({
                block_type: this.block_type_map.text,
                text: {
                    elements: this.__parse_inline_markdown(title),
                    style: {}
                }
            });
        }

        // Parse content
        if (content) {
            const contentText = admonition.text().trim();
            children.push({
                block_type: this.block_type_map.text,
                text: {
                    elements: this.__parse_inline_markdown(contentText),
                    style: {}
                }
            });
        }

        return {
            block_type: this.block_type_map.callout,
            callout: {
                emoji_id: emoji_map[icon] || 'blue_book',
                ...(icon === '📘' && { background_color: 2, border_color: 2 })
            },
            children: children
        };
    }

    __parse_grid(html) {
        /**
         * Parse Grid component: <Grid columnSize="2" widthRatios="1,1">...</Grid>
         *
         * Creates a Feishu grid block with grid_column children.
         *
         * Example:
         *   <Grid columnSize="2" widthRatios="1,1">
         *     <div>Column 1 content</div>
         *     <div>Column 2 content</div>
         *   </Grid>
         *
         * Becomes:
         *   {
         *     block_type: 24,  // grid
         *     grid: { column_size: 2 },
         *     children: [
         *       { block_type: 25, grid_column: { width_ratio: 1 }, children: [...] },
         *       { block_type: 25, grid_column: { width_ratio: 1 }, children: [...] }
         *     ]
         *   }
         */

        // Extract Grid attributes using regex (more reliable than cheerio for JSX)
        const gridMatch = html.match(/<Grid\s+columnSize="(\d+)"\s+widthRatios="([^"]+)"/);
        if (!gridMatch) {
            console.warn('Could not parse Grid attributes, using defaults');
            return this.__create_text_block({ text: html });
        }

        const columnSize = parseInt(gridMatch[1]);
        const widthRatios = gridMatch[2].split(',').map(r => parseInt(r.trim()));

        // Extract content between <Grid> and </Grid>
        const gridContentMatch = html.match(/<Grid[^>]*>([\s\S]*)<\/Grid>/);
        if (!gridContentMatch) {
            console.warn('Could not parse Grid content');
            return this.__create_text_block({ text: html });
        }

        const gridContent = gridContentMatch[1];

        // Extract div blocks using regex
        const divRegex = /<div>([\s\S]*?)<\/div>/g;
        const divMatches = [...gridContent.matchAll(divRegex)];

        if (divMatches.length === 0) {
            console.warn('No div columns found in Grid');
            return {
                block_type: this.block_type_map.grid,
                grid: { column_size: columnSize },
                children: []
            };
        }

        // Parse each column's content as markdown
        const gridColumns = divMatches.map((match, index) => {
            const columnMarkdown = match[1].trim();

            // Parse the markdown content to blocks
            const tokens = marked.lexer(columnMarkdown);
            const columnBlocks = [];

            for (const token of tokens) {
                const converted = this.__token_to_blocks(token);
                columnBlocks.push(...converted);
            }

            // Create grid_column block
            return {
                block_type: this.block_type_map.grid_column,
                grid_column: {
                    width_ratio: widthRatios[index] || 1
                },
                children: columnBlocks
            };
        });

        // Create grid block with children
        return {
            block_type: this.block_type_map.grid,
            grid: {
                column_size: columnSize
            },
            children: gridColumns
        };
    }

    __parse_tabs(html) {
        /**
         * Parse Tabs component and convert to array of code blocks
         *
         * Tabs in markdown (generated by larkDocWriter) are JSX components:
         *   <Tabs groupId="code" defaultValue="python" values={[...]}>
         *     <TabItem value="python">
         *       ```python
         *       code here
         *       ```
         *     </TabItem>
         *     <TabItem value="java">
         *       ```java
         *       code here
         *       ```
         *     </TabItem>
         *   </Tabs>
         *
         * In Feishu, tabs are just consecutive code blocks that get rendered together.
         * So we extract each TabItem's code block and return them as an array.
         *
         * Returns: Array of code block objects
         */

        // Extract all TabItem blocks using regex
        const tabItemRegex = /<TabItem\s+value=['"]([^'"]+)['"]>([\s\S]*?)<\/TabItem>/g;
        const tabItems = [...html.matchAll(tabItemRegex)];

        if (tabItems.length === 0) {
            console.warn('No TabItems found in Tabs component');
            return this.__create_text_block({ text: html });
        }

        const codeBlocks = [];

        for (const match of tabItems) {
            const value = match[1]; // Language value (e.g., "python", "java")
            const content = match[2].trim(); // Content inside TabItem

            // Extract code block from content (```lang\ncode\n```)
            const codeBlockMatch = content.match(/```(\w+)?\n([\s\S]*?)```/);

            if (codeBlockMatch) {
                const lang = codeBlockMatch[1] || value || 'plaintext';
                const code = codeBlockMatch[2];

                // Create a Feishu code block
                const langId = this.__get_lang_id(lang);

                codeBlocks.push({
                    block_type: this.block_type_map.code,
                    code: {
                        style: {
                            language: langId,
                            wrap: false
                        },
                        elements: [{
                            text_run: {
                                content: code,
                                text_element_style: {}
                            }
                        }]
                    }
                });
            } else {
                // If no code block found, treat content as plain text
                console.warn(`No code block found in TabItem with value="${value}"`);
                codeBlocks.push(this.__create_text_block({ text: content }));
            }
        }

        // Return all code blocks wrapped in a special marker object
        // The caller (__token_to_blocks) will detect __tabs_blocks and spread them
        if (codeBlocks.length === 0) {
            return this.__create_text_block({ text: html });
        }

        return {
            __tabs_blocks: codeBlocks  // Special marker for multiple blocks
        };
    }

    __parse_feishu_metadata(html) {
        /**
         * Parse Feishu metadata comments that preserve block types during round-trip conversion
         *
         * Supports:
         *   <!-- feishu-block: board, token: xyz123 -->
         *   <!-- feishu-block: iframe, url: ..., type: 8, caption: Design -->
         *   <!-- feishu-block: sheet, rows: 10, cols: 5 -->
         *
         * These comments are added by larkDocWriter to preserve block types that
         * would otherwise be lost when converting to markdown (e.g., boards become images).
         */

        // Extract metadata from HTML comment
        const metadataMatch = html.match(/<!-- feishu-block: (\w+),\s*([^>]+) -->/);
        if (!metadataMatch) {
            console.warn('No valid feishu-block metadata found');
            return this.__create_text_block({ text: html });
        }

        const blockType = metadataMatch[1]; // 'board', 'iframe', or 'sheet'
        const attrs = metadataMatch[2]; // 'token: xyz' or 'url: ..., type: 8'

        // Parse attributes into key-value pairs
        const attributes = {};
        const attrRegex = /(\w+):\s*([^,]+)/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrs)) !== null) {
            attributes[attrMatch[1]] = attrMatch[2].trim();
        }

        // Create appropriate Feishu block based on type
        switch (blockType) {
            case 'board':
                return this.__create_board_block(attributes);

            case 'iframe':
                return this.__create_iframe_block(attributes);

            case 'sheet':
                // Extract table HTML following the metadata comment
                const tableMatch = html.match(/<table[\s\S]*?<\/table>/);
                if (tableMatch) {
                    // Parse the table and create a sheet block instead of table block
                    const tableBlock = this.__create_table_block(tableMatch[0]);
                    // Convert table block to sheet block (change type 31 → 30)
                    if (tableBlock.block_type === this.block_type_map.table) {
                        const sheetBlock = {
                            block_type: this.block_type_map.sheet,
                            sheet: tableBlock.table  // Rename table → sheet
                        };
                        delete sheetBlock.table; // Remove old table field
                        return sheetBlock;
                    }
                }
                // If no table found, return placeholder
                return this.__create_text_block({
                    text: `<!-- Sheet block (${attributes.rows || '?'}x${attributes.cols || '?'}) - table data missing -->`
                });

            default:
                console.warn(`Unknown feishu-block type: ${blockType}`);
                return this.__create_text_block({ text: html });
        }
    }

    __create_board_block(attributes) {
        /**
         * Create a Feishu board block from metadata
         *
         * Note: Board blocks are interactive whiteboard elements.
         * We preserve the token but can't recreate the full interactive content.
         * The Feishu API may reject this during upload if token is invalid.
         */
        return {
            block_type: 43, // board block type
            board: {
                token: attributes.token
            }
        };
    }

    __create_iframe_block(attributes) {
        /**
         * Create a Feishu iframe block from metadata
         *
         * Note: Iframe blocks embed external content (Figma, etc.).
         * We preserve URL and type from the metadata comment.
         */
        return {
            block_type: this.block_type_map.iframe,
            iframe: {
                component: {
                    url: decodeURIComponent(attributes.url),
                    iframe_type: parseInt(attributes.type) || 8
                }
            }
        };
    }

    __parse_supademo(html) {
        /**
         * Parse Supademo component: <Supademo id="..." title="..." isShowcase />
         *
         * Creates a Feishu add_ons block with Supademo component type.
         *
         * Example:
         *   <Supademo id="abc123" title="Demo Title" isShowcase />
         *
         * Becomes:
         *   {
         *     block_type: 40,  // add_ons
         *     add_ons: {
         *       component_type_id: 'blk_682093ba9580c002363b9dc3',
         *       record: '{"id":"abc123","title":"Demo Title","isShowcase":true}'
         *     }
         *   }
         */
        // Parse using cheerio
        const $ = cheerio.load(html, { xmlMode: true });
        const supademo = $('Supademo');
        const id = supademo.attr('id') || '';
        const title = supademo.attr('title') || '';

        // Check for isShowcase attribute - cheerio handles boolean attributes
        // We also check the raw HTML as a fallback
        const hasIsShowcaseAttr = supademo.attr('isShowcase') !== undefined ||
                                   supademo.attr('isshowcase') !== undefined ||
                                   html.includes('isShowcase');

        // Build the record object
        const record = {
            id: id,
            title: title,
            isShowcase: hasIsShowcaseAttr
        };

        return {
            block_type: this.block_type_map.add_ons,
            add_ons: {
                component_type_id: 'blk_682093ba9580c002363b9dc3',  // Supademo component ID
                record: JSON.stringify(record)
            }
        };
    }

    __create_table_block(html) {
        const $ = cheerio.load(html);
        const rows = $('tr').toArray();

        let row_size = rows.length;
        let column_size = 0;
        const cells = [];
        const merge_info = [];

        rows.forEach((row, ridx) => {
            const cols = $(row).find('th, td').toArray();
            if (ridx === 0) column_size = cols.length;

            cols.forEach((col) => {
                const colspan = parseInt($(col).attr('colspan') || 1);
                const rowspan = parseInt($(col).attr('rowspan') || 1);
                const content = $(col).text();

                // Create cell block
                cells.push({
                    block_type: this.block_type_map.text,
                    text: {
                        elements: this.__parse_inline_markdown(content),
                        style: {}
                    }
                });

                // Add merge info
                if (colspan > 1 || rowspan > 1) {
                    merge_info.push({
                        row_span: rowspan,
                        col_span: colspan
                    });
                } else {
                    merge_info.push(null);
                }
            });
        });

        return {
            block_type: this.block_type_map.table,
            table: {
                property: {
                    row_size: row_size,
                    column_size: column_size,
                    merge_info: merge_info
                },
                cells: cells
            }
        };
    }

    __create_table_block_from_token(token) {
        // marked pipe-table token → native Feishu table block. Pipe tables
        // have no spans, so merge_info stays empty; cell content goes through
        // the same inline parser as the HTML-table path (escapes such as
        // `\_` are consumed here — the write side of the refetch fixed point).
        const header = token.header || [];
        const rows = token.rows || [];
        const columnSize = header.length;
        const cells = [];
        const mergeInfo = [];

        const pushCell = (cell) => {
            cells.push({
                block_type: this.block_type_map.text,
                text: {
                    elements: this.__parse_inline_markdown(cell ? String(cell.text ?? '') : ''),
                    style: {}
                }
            });
            mergeInfo.push(null);
        };

        header.forEach(pushCell);
        rows.forEach((row) => row.forEach(pushCell));

        return {
            block_type: this.block_type_map.table,
            table: {
                property: {
                    row_size: rows.length + (columnSize > 0 ? 1 : 0),
                    column_size: columnSize,
                    merge_info: mergeInfo
                },
                cells: cells
            }
        };
    }

    __create_blockquote_block(token) {
        const children = [];

        // Parse the tokens inside the blockquote
        if (token.tokens) {
            token.tokens.forEach(t => {
                const blocks = this.__token_to_blocks(t);
                children.push(...blocks);
            });
        }

        return {
            block_type: this.block_type_map.quote_container,
            quote_container: {},
            children: children
        };
    }

    __create_image_block(token) {
        /**
         * Create image block from markdown: ![alt](url "title")
         *
         * Creates block structure with metadata. The actual upload happens
         * in __process_image_blocks() before blocks are sent to Feishu.
         */
        const alt = token.text || '';
        const url = token.href || '';
        const title = token.title || alt;

        return {
            block_type: this.block_type_map.image,
            image: {
                token: '', // Will be populated after upload
                _metadata: {
                    url: url,
                    alt: alt,
                    title: title,
                    needs_upload: true
                }
            }
        };
    }

    async __process_image_blocks(blocks, document_id) {
        /**
         * Process all image blocks - upload images and set file_key tokens
         *
         * Must be called BEFORE create_blocks() to ensure images are uploaded
         * and tokens are populated.
         *
         * @param {Array} blocks - Array of block objects
         * @param {string} document_id - Document ID (required for upload)
         * @returns {Array} blocks with image tokens populated
         */
        const processedBlocks = [];

        for (const block of blocks) {
            if (block.block_type === this.block_type_map.image &&
                block.image?._metadata?.needs_upload) {

                const metadata = block.image._metadata;
                console.log(`Processing image: ${metadata.alt || metadata.url}`);

                try {
                    // Upload image and get file_key
                    const file_key = await this.__upload_image_to_feishu(
                        metadata.url,
                        document_id
                    );

                    // Create clean image block with token
                    processedBlocks.push({
                        block_type: this.block_type_map.image,
                        image: {
                            token: file_key
                        }
                    });
                } catch (error) {
                    console.error(`Failed to upload image: ${error.message}`);
                    // Skip failed images - create placeholder text
                    processedBlocks.push({
                        block_type: this.block_type_map.text,
                        text: {
                            elements: [{
                                text_run: {
                                    content: `[Image: ${metadata.alt || metadata.url}]`,
                                    text_element_style: {}
                                }
                            }],
                            style: {}
                        }
                    });
                }
            } else if (block.children && block.children.length > 0) {
                // Recursively process children (for callouts, quotes, etc.)
                const processedChildren = await this.__process_image_blocks(
                    block.children,
                    document_id
                );
                processedBlocks.push({
                    ...block,
                    children: processedChildren
                });
            } else {
                // Non-image block, keep as-is
                processedBlocks.push(block);
            }
        }

        return processedBlocks;
    }

    async __upload_image_to_feishu(imageUrl, document_id) {
        assertWriterMutation(this.governance, 'MarkdownToFeishu.__upload_image_to_feishu', document_id);
        /**
         * Upload image to Feishu and get file_key
         *
         * API: POST /open-apis/drive/v1/medias/upload_all
         *
         * Steps:
         * 1. Download image from URL (or read from local file)
         * 2. Upload to Feishu
         * 3. Return file_key
         *
         * Parameters:
         * - imageUrl: URL or file path of the image
         * - document_id: Parent document ID (required for docx_image type)
         *
         * Returns: file_key (string) to use as image token
         */
        const token = await this.tokenFetcher.token();
        const fs = require('fs');
        const path = require('path');
        const FormData = require('form-data');

        // Determine if it's a URL or local file
        let imageBuffer;
        let fileName;

        if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
            // Download from URL
            console.log(`Downloading image: ${imageUrl}`);
            const response = await fetch(imageUrl);
            if (!response.ok) {
                throw new Error(`Failed to download image: ${response.statusText}`);
            }
            imageBuffer = await response.buffer();
            fileName = path.basename(new URL(imageUrl).pathname) || 'image.png';
        } else {
            // Read from local file
            console.log(`Reading local image: ${imageUrl}`);
            imageBuffer = fs.readFileSync(imageUrl);
            fileName = path.basename(imageUrl);
        }

        // Create form data
        const formData = new FormData();
        formData.append('file_name', fileName);
        formData.append('parent_type', 'docx_image');
        formData.append('parent_node', document_id);
        formData.append('size', imageBuffer.length.toString());
        formData.append('file', imageBuffer, {
            filename: fileName,
            contentType: this.__get_mime_type(fileName)
        });

        // Upload to Feishu
        const uploadUrl = `${process.env.FEISHU_HOST}/open-apis/drive/v1/medias/upload_all`;
        console.log(`Uploading image to Feishu: ${fileName}`);

        const uploadResponse = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                ...formData.getHeaders()
            },
            body: formData
        });

        const data = await uploadResponse.json();

        if (data.code !== 0) {
            throw new Error(`Failed to upload image: ${data.msg}`);
        }

        console.log(`✅ Image uploaded successfully: ${data.data.file_key}`);
        return data.data.file_key;
    }

    __get_mime_type(fileName) {
        const ext = fileName.toLowerCase().split('.').pop();
        const mimeTypes = {
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'bmp': 'image/bmp',
            'webp': 'image/webp',
            'svg': 'image/svg+xml'
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }

    // ==================== Main Conversion Pipeline ====================

    __extract_frontmatter(markdown) {
        // Extract YAML frontmatter
        const match = markdown.match(/^---\n([\s\S]*?)\n---/);
        if (!match) return null;

        const frontmatter = {};
        const lines = match[1].split('\n');

        lines.forEach(line => {
            const colonIndex = line.indexOf(':');
            if (colonIndex > -1) {
                const key = line.substring(0, colonIndex).trim();
                const value = line.substring(colonIndex + 1).trim().replace(/^["']|["']$/g, '');
                frontmatter[key] = value;
            }
        });

        return frontmatter;
    }

    __remove_frontmatter(markdown) {
        return markdown.replace(/^---\n[\s\S]*?\n---\n/, '');
    }

    __token_to_blocks(token) {
        const blocks = [];

        switch (token.type) {
            case 'heading':
                blocks.push(this.__create_heading_block(token));
                break;
            case 'paragraph':
                // Check if paragraph contains special HTML components
                if (token.text && (token.text.includes('<Grid') || token.text.includes('<Tabs'))) {
                    const parsed = this.__parse_html_block(token);
                    // Check if it's a Tabs result with multiple blocks
                    if (parsed.__tabs_blocks) {
                        blocks.push(...parsed.__tabs_blocks);
                    } else {
                        blocks.push(parsed);
                    }
                }
                // Check if paragraph contains only an image
                else if (token.tokens && token.tokens.length === 1 && token.tokens[0].type === 'image') {
                    blocks.push(this.__create_image_block(token.tokens[0]));
                } else {
                    blocks.push(this.__create_text_block(token));
                }
                break;
            case 'list':
                blocks.push(...this.__create_list_blocks(token, token.ordered));
                break;
            case 'code':
                blocks.push(this.__create_code_block(token));
                break;
            case 'blockquote':
                blocks.push(this.__create_blockquote_block(token));
                break;
            case 'hr':
                blocks.push(this.__create_divider_block());
                break;
            case 'html':
                const parsed = this.__parse_html_block(token);
                // Check if it's a Tabs result with multiple blocks
                if (parsed.__tabs_blocks) {
                    blocks.push(...parsed.__tabs_blocks);
                } else if (parsed.__audience_blocks) {
                    blocks.push(...parsed.__audience_blocks);
                } else {
                    blocks.push(parsed);
                }
                break;
            case 'image':
                // Standalone image (shouldn't normally happen, but handle it)
                blocks.push(this.__create_image_block(token));
                break;
            case 'table':
                // Pipe tables arrive as marked `table` tokens and render as
                // native Feishu table blocks; silently dropping them used to
                // lose whole sections (api.markdown-block-fidelity).
                blocks.push(this.__create_table_block_from_token(token));
                break;
            case 'text':
                // Tight-context text token (e.g. inside a blockquote) — render
                // it like a paragraph instead of dropping it.
                blocks.push(this.__create_text_block(token));
                break;
            case 'space':
                // Skip empty space
                break;
            case 'def':
                // Link-reference definition ([ref]: url) — a structural
                // no-op, not content: it renders no block, and the inline
                // parser never consumes reference-style links, so skipping
                // loses nothing (explicitly whitelisted, unlike the
                // fail-closed default below).
                break;
            default:
                throw Object.assign(
                    new Error(`markdown token type "${token.type}" has no Feishu block representation; refusing to drop content (api.markdown-block-fidelity)`),
                    { code: 'MD_TOKEN_UNREPRESENTABLE', tokenType: token.type }
                );
        }

        return blocks;
    }

    async parse_markdown(markdown_content) {
        // Extract frontmatter
        const frontmatter = this.__extract_frontmatter(markdown_content);

        // Remove frontmatter from content
        let content = this.__remove_frontmatter(markdown_content);

        // Extract and store JSX components before parsing
        const jsxComponents = [];
        content = this.__extractJSXComponents(content, jsxComponents);

        // Parse markdown to tokens
        const tokens = marked.lexer(content);

        // Restore JSX components
        this.__restoreJSXComponents(tokens, jsxComponents);

        return {
            frontmatter,
            tokens
        };
    }

    __extractJSXComponents(content, componentsArray) {
        /**
         * Extract JSX components (Grid, Tabs, etc.) and replace with placeholders
         * so marked.js doesn't try to parse their contents.
         */

        // Extract top-level audience regions before marked.js tokenizes their
        // Markdown body. Without this protection, a heading immediately after
        // an opening marker is folded into one literal text block, exposing
        // strings such as "### CloudImportRequest" in the live Docx.
        content = content.replace(
            /^<(include|exclude)\s+target="([^"]+)">[ \t]*\r?\n([\s\S]*?)^<\/\1>[ \t]*$/gmi,
            (match, mode, target, body) => {
                const placeholder = `<!--JSX_COMPONENT_${componentsArray.length}-->`;
                componentsArray.push({
                    type: 'Audience',
                    mode: mode.toLowerCase(),
                    target,
                    body,
                    fullMatch: match,
                });
                return placeholder;
            },
        );

        // Extract Grid blocks
        content = content.replace(/<Grid([^>]*)>([\s\S]*?)<\/Grid>/g, (match, attrs, body) => {
            const placeholder = `<!--JSX_COMPONENT_${componentsArray.length}-->`;
            componentsArray.push({
                type: 'Grid',
                attrs,
                body,
                fullMatch: match
            });
            return placeholder;
        });

        // Extract Tabs blocks
        content = content.replace(/<Tabs([^>]*)>([\s\S]*?)<\/Tabs>/g, (match, attrs, body) => {
            const placeholder = `<!--JSX_COMPONENT_${componentsArray.length}-->`;
            componentsArray.push({
                type: 'Tabs',
                attrs,
                body,
                fullMatch: match
            });
            return placeholder;
        });

        return content;
    }

    __restoreJSXComponents(tokens, componentsArray) {
        /**
         * Restore JSX components from placeholders in tokens
         */
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];

            // Check if this token contains a placeholder
            if (token.type === 'html' || token.type === 'paragraph') {
                const text = token.text || '';
                const match = text.match(/<!--JSX_COMPONENT_(\d+)-->/);

                if (match) {
                    const componentIndex = parseInt(match[1]);
                    const component = componentsArray[componentIndex];

                    // Replace token with actual JSX component HTML
                    token.type = 'html';
                    token.text = component.fullMatch;
                }
            }
        }
    }

    async markdown_to_blocks(tokens) {
        const blocks = [];

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];

            // Lookahead for sheet metadata + table combination
            if (token.type === 'html' && token.text && token.text.includes('feishu-block: sheet')) {
                const nextToken = tokens[i + 1];
                if (nextToken && nextToken.type === 'html' && nextToken.text && nextToken.text.includes('<table')) {
                    // Combine metadata comment with table
                    const combinedHtml = token.text + nextToken.text;
                    const parsed = this.__parse_feishu_metadata(combinedHtml);
                    blocks.push(parsed);
                    i++; // Skip the next token since we already processed it
                    continue;
                }
            }

            const converted = this.__token_to_blocks(token);
            blocks.push(...converted);
        }

        return blocks;
    }

    // ==================== Feishu API Methods ====================

    async listFolder({ folderToken, type = 'all' }) {
        if (!folderToken) throw new TypeError('folderToken is required to list a folder');
        const token = await this.tokenFetcher.token();
        const files = [];
        let pageToken = null;
        do {
            const query = new URLSearchParams({ folder_token: folderToken, page_size: '200' });
            if (type !== 'all') query.set('type', type);
            if (pageToken) query.set('page_token', pageToken);
            const response = await fetch(`${FEISHU_HOST}/open-apis/drive/v1/files?${query.toString()}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await response.json();
            if (data.code !== 0) throw new Error(`Failed to list folder: ${data.msg}`);
            files.push(...(data.data?.files || []));
            pageToken = data.data?.has_more ? data.data?.next_page_token : null;
        } while (pageToken);
        return files;
    }

    async createFolder({ name, parentFolderToken }) {
        assertWriterMutation(this.governance, 'MarkdownToFeishu.createFolder');
        if (!name || !parentFolderToken) throw new TypeError('name and parentFolderToken are required to create a folder');
        const token = await this.tokenFetcher.token();
        const response = await fetch(`${FEISHU_HOST}/open-apis/drive/v1/files/create_folder`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ name, folder_token: parentFolderToken })
        });
        const data = await response.json();
        if (data.code !== 0) throw new Error(`Failed to create folder: ${data.msg}`);
        const folder = data.data?.folder || data.data || {};
        return {
            ...folder,
            token: folder.token || folder.folder_token || null,
            name: folder.name || name,
            parentFolderToken: folder.parent_token || parentFolderToken,
        };
    }

    async create_document({ title, folder_token = null, parent_node_token = null }) {
        assertWriterMutation(this.governance, 'MarkdownToFeishu.create_document');
        if (this.source_type === 'wiki') {
            return await this.__create_wiki_node({ title, parent_node_token });
        } else {
            return await this.__create_drive_document({ title, folder_token });
        }
    }

    // Rename a drive docx to the reviewed artifact title. Idempotent: a
    // no-op when the live title already matches. Restores the tool path for
    // title repair on UPDATE flows (the body patch never carries the title).
    async renameDocument({ token, name }) {
        assertWriterMutation(this.governance, 'MarkdownToFeishu.renameDocument', token);
        if (!token || !name) throw new TypeError('renameDocument requires token and name');
        const authToken = await this.tokenFetcher.token();
        const metaRes = await fetch(`${FEISHU_HOST}/open-apis/docx/v1/documents/${encodeURIComponent(token)}`, {
            method: 'get',
            headers: { Authorization: `Bearer ${authToken}` },
        });
        const meta = await metaRes.json();
        if (meta.code !== 0) throw new Error(`renameDocument could not read document meta: ${meta.msg}`);
        const current = meta.data?.document?.title;
        if (current === name) return { renamed: false, title: current };

        const res = await fetch(`${FEISHU_HOST}/open-apis/drive/v1/files/${encodeURIComponent(token)}?type=docx`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (data.code !== 0) {
            throw new Error(`Failed to rename document: ${data.msg}`);
        }
        return { renamed: true, from: current, to: name };
    }

    async copyDocument({ sourceDocumentToken, title, folderToken }) {
        assertWriterMutation(this.governance, 'MarkdownToFeishu.copyDocument', sourceDocumentToken);
        if (this.source_type === 'wiki') {
            throw new Error('copyDocument currently supports drive docx files only');
        }
        if (!sourceDocumentToken || !folderToken) {
            throw new Error('sourceDocumentToken and folderToken are required to copy a document');
        }
        const token = await this.tokenFetcher.token();
        const url = `${process.env.FEISHU_HOST}/open-apis/drive/v1/files/${sourceDocumentToken}/copy`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                name: title,
                type: 'docx',
                folder_token: folderToken
            })
        });

        const data = await response.json();

        if (data.code !== 0) {
            throw new Error(`Failed to copy document: ${data.msg}`);
        }

        const file = data.data?.file || {};
        return {
            token: file.token,
            documentToken: file.token,
            url: file.url,
            title: file.name || title,
            type: file.type,
            folderToken: file.parent_token || folderToken,
        };
    }

    async deleteFile({ fileToken, type }) {
        assertWriterMutation(this.governance, 'MarkdownToFeishu.deleteFile', fileToken);
        if (!fileToken) throw new Error('fileToken is required to delete a Drive file');
        if (!['docx', 'folder'].includes(type)) throw new Error(`Unsupported Drive file type: ${type || '(missing)'}`);
        const token = await this.tokenFetcher.token();
        const url = `${process.env.FEISHU_HOST}/open-apis/drive/v1/files/${fileToken}?type=${type}`;
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const data = await response.json();
        if (data.code !== 0) throw new Error(`Failed to delete ${type}: ${data.msg}`);
        return data.data || {};
    }

    async deleteDocument({ documentToken }) {
        assertWriterMutation(this.governance, 'MarkdownToFeishu.deleteDocument', documentToken);
        if (!documentToken) throw new Error('documentToken is required to delete a document');
        return this.deleteFile({ fileToken: documentToken, type: 'docx' });
    }

    async deleteFolder({ folderToken }) {
        assertWriterMutation(this.governance, 'MarkdownToFeishu.deleteFolder', folderToken);
        if (!folderToken) throw new Error('folderToken is required to delete a folder');
        return this.deleteFile({ fileToken: folderToken, type: 'folder' });
    }

    async __create_drive_document({ title, folder_token = null }) {
        assertWriterMutation(this.governance, 'MarkdownToFeishu.__create_drive_document');
        const token = await this.tokenFetcher.token();

        const url = `${process.env.FEISHU_HOST}/open-apis/docx/v1/documents`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                title: title,
                folder_token: folder_token || this.root_token
            })
        });

        const data = await response.json();

        if (data.code !== 0) {
            throw new Error(`Failed to create document: ${data.msg}`);
        }

        this.document_id = data.data.document.document_id;
        console.log(`Created document: ${title} (${this.document_id})`);

        return {
            document_id: data.data.document.document_id,
            revision_id: data.data.document.revision_id,
            title: title
        };
    }

    async __create_wiki_node({ title, parent_node_token = null }) {
        assertWriterMutation(this.governance, 'MarkdownToFeishu.__create_wiki_node');
        const token = await this.tokenFetcher.token();

        // space_id should come from environment variable (shared wiki space)
        const space_id = process.env.WIKI_SPACE_ID;

        if (!space_id) {
            throw new Error('WIKI_SPACE_ID environment variable is required for wiki node creation');
        }

        const url = `${process.env.FEISHU_HOST}/open-apis/wiki/v2/spaces/${space_id}/nodes`;

        const requestBody = {
            obj_type: 'docx',  // Create a docx type wiki node
            node_type: 'origin',
            origin_node_token: '',  // Empty for new nodes
            title: title
        };

        // Use parent_node_token from parameter, or fall back to root_token
        // root_token represents the parent node in the wiki hierarchy
        const parentToken = parent_node_token || this.root_token;
        if (parentToken) {
            requestBody.parent_node_token = parentToken;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (data.code !== 0) {
            throw new Error(`Failed to create wiki node: ${data.msg}`);
        }

        // For wiki, we need to use obj_token as the document_id
        this.document_id = data.data.node.obj_token;
        const node_token = data.data.node.node_token;

        console.log(`Created wiki node: ${title}`);
        console.log(`  Node token: ${node_token}`);
        console.log(`  Document token: ${this.document_id}`);

        return {
            document_id: this.document_id,
            node_token: node_token,
            obj_token: data.data.node.obj_token,
            title: title,
            wiki_url: `${process.env.FEISHU_HOST}/wiki/${node_token}`
        };
    }

    async __fetch_feishu_json(url, options, { retryNetworkErrors = false, attempts = 5 } = {}) {
        // 99991400 is Feishu's rate-limit rejection: the request is refused
        // before executing, so retrying it is side-effect free. Network-level
        // failures are only retried for idempotent GETs — a lost response on a
        // write may have landed, and retrying could double-apply it.
        for (let attempt = 1; attempt <= attempts; attempt++) {
            let data;
            try {
                const response = await fetch(url, options);
                data = await response.json();
            } catch (err) {
                if (retryNetworkErrors && attempt < attempts) {
                    await new Promise(r => setTimeout(r, 500 * attempt));
                    continue;
                }
                throw err;
            }
            if (data.code === 99991400 && attempt < attempts) {
                await new Promise(r => setTimeout(r, 500 * attempt));
                continue;
            }
            return data;
        }
        throw new Error('unreachable: retry loop must return or throw');
    }

    async get_document_blocks(document_id) {
        const token = await this.tokenFetcher.token();

        // The endpoint pages at 500 blocks per response (page_size default
        // AND max). Documents with native tables routinely exceed that, so a
        // single request silently truncated the block list for every consumer
        // — patch matching, delete ranges, and full-page digests alike.
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
        const items = [];
        let pageToken = null;
        do {
            const url = `${process.env.FEISHU_HOST}/open-apis/docx/v1/documents/${document_id}/blocks`
                + `?page_size=500${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`;
            const data = await this.__fetch_feishu_json(url, { method: 'GET', headers }, { retryNetworkErrors: true });
            if (data.code !== 0) {
                throw new Error(`Failed to get document blocks: ${data.msg}`);
            }
            items.push(...(data.data?.items || []));
            pageToken = data.data?.has_more ? data.data.page_token : null;
        } while (pageToken);
        return items;
    }

    __remove_children_recursively(blocks) {
        /**
         * Remove children field from blocks for create_blocks API
         * The /children endpoint doesn't accept blocks with children field
         */
        return blocks.map(block => {
            const cleanBlock = { ...block };
            delete cleanBlock.children;
            return cleanBlock;
        });
    }

    async getRawContent(documentId) {
        // Read-only raw_content refetch — the authoritative channel for
        // verbatim text postconditions (api.pr-verbatim-content).
        const token = await this.tokenFetcher.token();
        const url = `${FEISHU_HOST}/open-apis/docx/v1/documents/${documentId}/raw_content`;
        const res = await fetch(url, {
            method: 'get',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${token}`,
            },
        });
        const data = await res.json();
        if (data.code !== 0) {
            throw new Error(`Failed to read raw content: ${data.msg}`);
        }
        return data.data.content;
    }

    assertAbsoluteBlockLinks(blocks) {
        // Public pre-write validation for destructive flows: scripts that
        // delete-then-recreate a region must validate the replacement blocks
        // BEFORE the delete, or a rejected payload leaves the document
        // truncated (api.absolute-link-urls).
        this.__assert_absolute_block_links(blocks, 'MarkdownToFeishu.assertAbsoluteBlockLinks');
    }

    __collect_text_link_urls(value, found = []) {
        if (Array.isArray(value)) {
            value.forEach((item) => this.__collect_text_link_urls(item, found));
            return found;
        }
        if (!value || typeof value !== 'object') return found;
        for (const [key, child] of Object.entries(value)) {
            if (key === 'link' && child && typeof child === 'object' && typeof child.url === 'string') {
                found.push(child.url);
            } else if (key !== 'link') {
                this.__collect_text_link_urls(child, found);
            }
        }
        return found;
    }

    __assert_absolute_block_links(payload, method) {
        // The Feishu block API rejects non-absolute URLs in
        // text_element_style.link (schema mismatch 1770006), which used to
        // surface only as a partial execution after real writes landed. The
        // inline parser percent-encodes URLs, so compare decoded values and
        // refuse anything that is not an absolute http(s) URL before the
        // first writer call (api.absolute-link-urls).
        const offenders = [];
        for (const raw of this.__collect_text_link_urls(payload)) {
            let decoded = raw;
            try {
                decoded = decodeURIComponent(raw);
            } catch (_) {
                // Keep the raw form for the absolute check.
            }
            if (!/^https?:\/\//i.test(decoded)) offenders.push(decoded);
        }
        if (offenders.length > 0) {
            const unique = [...new Set(offenders)];
            throw Object.assign(
                new Error(`${method} refuses non-absolute text link URL(s): ${unique.join(', ')} — resolve repository-relative links to in-KB docx URLs before writing (api.absolute-link-urls)`),
                { code: 'RELATIVE_LINK_URL_REJECTED', urls: unique }
            );
        }
    }

    async create_blocks({ document_id, blocks, startIndex = 0, parentBlockId = null }) {
        assertWriterMutation(this.governance, 'MarkdownToFeishu.create_blocks', document_id);
        this.__assert_absolute_block_links(blocks, 'MarkdownToFeishu.create_blocks');
        const token = await this.tokenFetcher.token();

        // Determine parent block ID
        let parentId = parentBlockId;
        if (!parentId) {
            const existingBlocks = await this.get_document_blocks(document_id);
            const pageBlock = existingBlocks.find(b => b.block_type === 1);
            if (!pageBlock) {
                throw new Error('Page block not found');
            }
            parentId = pageBlock.block_id;
        }

        // Save children map before stripping (block index → children array)
        const childrenMap = new Map();
        blocks.forEach((block, idx) => {
            if (block.children && block.children.length > 0) {
                childrenMap.set(idx, block.children);
            }
        });

        // Save table cell content before stripping (block index → cells array)
        const tableCellsMap = new Map();
        blocks.forEach((block, idx) => {
            if (block.block_type === this.block_type_map.table && block.table?.cells) {
                tableCellsMap.set(idx, block.table.cells);
            }
        });

        // Remove children field - API doesn't accept inline children
        const cleanBlocks = this.__remove_children_recursively(blocks);

        // Strip cells and merge_info from table blocks — API creates empty cells, we populate after
        for (const block of cleanBlocks) {
            if (block.block_type === this.block_type_map.table && block.table) {
                delete block.table.cells;
                if (block.table.property) {
                    delete block.table.property.merge_info;
                }
            }
        }

        // Use children API to add blocks to the parent
        const url = `${process.env.FEISHU_HOST}/open-apis/docx/v1/documents/${document_id}/blocks/${parentId}/children`;

        const batchSize = 50;
        const results = [];
        const createdBlockIds = [];
        const createdBlocksByIndex = new Map();
        // Map block index → array of cell block IDs returned by API
        const tableCellIds = new Map();

        // Split blocks into segments: consecutive non-table blocks batched together,
        // each table block sent individually (tables auto-create many child cells)
        const segments = [];
        let currentBatch = [];
        let currentStartIdx = 0;
        for (let i = 0; i < cleanBlocks.length; i++) {
            if (cleanBlocks[i].block_type === this.block_type_map.table) {
                if (currentBatch.length > 0) {
                    segments.push({ blocks: currentBatch, startIdx: currentStartIdx });
                    currentBatch = [];
                }
                segments.push({ blocks: [cleanBlocks[i]], startIdx: i });
                currentStartIdx = i + 1;
            } else {
                if (currentBatch.length === 0) currentStartIdx = i;
                currentBatch.push(cleanBlocks[i]);
            }
        }
        if (currentBatch.length > 0) {
            segments.push({ blocks: currentBatch, startIdx: currentStartIdx });
        }

        let globalCreated = 0;
        for (const segment of segments) {
            const segBlocks = segment.blocks;
            const isTable = segBlocks.length === 1 && segBlocks[0].block_type === this.block_type_map.table;

            // Send in batches (tables go one at a time, non-tables in batches of 50)
            const segBatchSize = isTable ? 1 : batchSize;
            for (let i = 0; i < segBlocks.length; i += segBatchSize) {
                const batch = segBlocks.slice(i, i + segBatchSize);

                const data = await this.__fetch_feishu_json(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        children: batch,
                        index: startIndex + segment.startIdx + i
                    })
                });

                if (data.code !== 0) {
                    console.error(`Block creation failed. API response:`, JSON.stringify(data).slice(0, 300));
                    throw new Error(`Failed to create blocks: ${data.msg}`);
                }

                // Collect created block IDs and table cell IDs from response
                if (data.data?.children) {
                    for (let j = 0; j < data.data.children.length; j++) {
                        const child = data.data.children[j];
                        const globalIdx = segment.startIdx + i + j;
                        createdBlockIds.push(child.block_id);
                        createdBlocksByIndex.set(globalIdx, child);

                        if (child.block_type === this.block_type_map.table && child.table?.cells) {
                            tableCellIds.set(globalIdx, child.table.cells);
                        }
                    }
                }

                globalCreated += batch.length;
                results.push(data);
            }

            if (!parentBlockId && globalCreated > 0) {
                console.log(`Created blocks ${globalCreated}/${cleanBlocks.length}`);
            }

            // Small delay between segments to avoid rate limits
            if (isTable) {
                await new Promise(r => setTimeout(r, 200));
            }
        }

        // Populate table cells with content
        for (const [idx, cellContents] of tableCellsMap) {
            const cellIds = tableCellIds.get(idx);
            if (!cellIds) continue;

            const totalCells = Math.min(cellIds.length, cellContents.length);
            if (totalCells > 0 && !parentBlockId) {
                console.log(`Populating ${totalCells} table cells...`);
            }

            // Process cells with bounded concurrency and staggered launches
            const CELL_CONCURRENCY = 5;
            const executing = new Set();
            for (let i = 0; i < totalCells; i++) {
                const p = this.__populateTableCell(document_id, cellIds[i], cellContents[i], token)
                    .then(() => executing.delete(p), () => executing.delete(p));
                executing.add(p);
                if (executing.size >= CELL_CONCURRENCY) {
                    await Promise.race(executing);
                }
                // Stagger launches to avoid burst overload
                if (i % CELL_CONCURRENCY === CELL_CONCURRENCY - 1) {
                    await new Promise(r => setTimeout(r, 20));
                }
            }
            await Promise.all(executing);

            if (totalCells > 0 && !parentBlockId) {
                console.log(`Table cells populated (${totalCells} cells)`);
            }
        }

        // Recursively create children for blocks that had them
        for (const [idx, originalChildren] of childrenMap) {
            const blockId = createdBlockIds[idx];
            if (blockId) {
                let children = originalChildren;
                const automaticPopulation = this.__build_automatic_child_population({
                    createdBlock: createdBlocksByIndex.get(idx),
                    desiredChildren: children,
                });
                if (automaticPopulation.handled) {
                    if (automaticPopulation.updateRequests.length > 0) {
                        await this.__execute_batch_update(document_id, automaticPopulation.updateRequests);
                    }
                    if (automaticPopulation.remainingChildren.length === 0) continue;
                    children = automaticPopulation.remainingChildren;
                }
                // Small delay to avoid API rate limits on nested calls
                await new Promise(r => setTimeout(r, 200));
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        await this.create_blocks({
                            document_id,
                            blocks: children,
                            parentBlockId: blockId,
                            // The reused auto-created child occupies index 0 inside
                            // the callout; remaining children must be created after
                            // it or the index-0 insert reverses their order.
                            startIndex: automaticPopulation.handled ? 1 : 0,
                        });
                        break;
                    } catch (err) {
                        if (attempt < 3) {
                            console.log(`  Retry ${attempt}/3 for children of block ${blockId}: ${err.message}`);
                            await new Promise(r => setTimeout(r, 1000 * attempt));
                        } else {
                            throw err;
                        }
                    }
                }
            }
        }

        return results;
    }

    __build_automatic_child_population({ createdBlock, desiredChildren }) {
        const automaticChildren = createdBlock?.children || [];
        const firstDesired = desiredChildren?.[0];
        if (createdBlock?.block_type !== this.block_type_map.callout
            || automaticChildren.length === 0
            || firstDesired?.block_type !== this.block_type_map.text
            || !Array.isArray(firstDesired.text?.elements)) {
            return { handled: false, updateRequests: [], remainingChildren: desiredChildren || [] };
        }
        if (automaticChildren.length !== 1) {
            throw new Error(`Callout ${createdBlock.block_id || '(unknown)'} created ${automaticChildren.length} automatic children`);
        }
        return {
            handled: true,
            updateRequests: [{
                block_id: automaticChildren[0],
                update_text_elements: { elements: firstDesired.text.elements },
            }],
            remainingChildren: desiredChildren.slice(1),
        };
    }

    async __populateTableCell(document_id, cellBlockId, cellContent, token) {
        assertWriterMutation(this.governance, 'MarkdownToFeishu.__populateTableCell', document_id);
        const url = `${process.env.FEISHU_HOST}/open-apis/docx/v1/documents/${document_id}/blocks/${cellBlockId}/children`;
        for (let attempt = 1; attempt <= 5; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        children: [cellContent],
                        index: 0
                    })
                });
                const data = await response.json();
                if (data.code === 0) return data;
                if ((data.code === 99991400 || data.code === 1770001) && attempt < 5) {
                    await new Promise(r => setTimeout(r, 500 * attempt));
                    continue;
                }
                if (attempt === 5) {
                    console.warn(`Failed to populate cell ${cellBlockId}: ${data.msg}`);
                }
            } catch (err) {
                // Network error (truncated response, timeout, etc.)
                if (attempt < 5) {
                    await new Promise(r => setTimeout(r, 1000 * attempt));
                    continue;
                }
                console.warn(`Failed to populate cell ${cellBlockId}: ${err.message}`);
            }
        }
    }

    async update_document({ document_id, blocks }) {
        assertWriterMutation(this.governance, 'MarkdownToFeishu.update_document', document_id);
        // For updates, we need to delete existing blocks and recreate
        // This is a simplified approach - a more sophisticated one would do differential updates
        // Get existing blocks
        const existingBlocks = await this.get_document_blocks(document_id);
        const pageBlock = existingBlocks.find(b => b.block_type === 1);

        if (!pageBlock) {
            throw new Error('Page block not found');
        }

        // Delete all children of page block.
        await this.__delete_child_blocks_by_id({
            document_id,
            parentBlock: pageBlock,
            childBlockIds: pageBlock.children || [],
        });

        // Create new blocks
        return await this.create_blocks({ document_id, blocks });
    }

    __sanitize_api_patch_block(block) {
        if (Array.isArray(block)) return block.map(item => this.__sanitize_api_patch_block(item));
        if (!block || typeof block !== 'object') return block;
        return Object.fromEntries(Object.entries(block)
            .filter(([key]) => !['block_id', 'parent_id'].includes(key))
            .map(([key, value]) => [key, this.__sanitize_api_patch_block(value)]));
    }

    __api_patch_comparable_block(block, idMap = new Map()) {
        if (Array.isArray(block)) return block.map(item => this.__api_patch_comparable_block(item, idMap));
        if (!block || typeof block !== 'object') {
            if (typeof block !== 'string' || idMap.size === 0
                || !/(?:https?:\/\/|%3A%2F%2F|\/docx\/|\/wiki\/)/i.test(block)) return block;
            let normalized = block;
            for (const [sourceId, copyId] of idMap) normalized = normalized.split(sourceId).join(copyId);
            return normalized;
        }
        return Object.fromEntries(Object.entries(block)
            .filter(([key]) => !['block_id', 'parent_id', 'children', 'comment_ids'].includes(key))
            .map(([key, value]) => [key, this.__api_patch_comparable_block(value, idMap)]));
    }

    __api_patch_copy_id_map(sourceBlocks, copyBlocks, sourcePage, copyPage) {
        const sourceById = new Map(sourceBlocks.map(block => [block.block_id, block]));
        const copyById = new Map(copyBlocks.map(block => [block.block_id, block]));
        const idMap = new Map([[sourcePage.block_id, copyPage.block_id]]);
        const pairChildren = (sourceChildren = [], copyChildren = []) => {
            if (sourceChildren.length !== copyChildren.length) return false;
            for (let index = 0; index < sourceChildren.length; index += 1) {
                const sourceId = sourceChildren[index];
                const copyId = copyChildren[index];
                const sourceBlock = sourceById.get(sourceId);
                const copyBlock = copyById.get(copyId);
                if (!sourceBlock || !copyBlock) return false;
                idMap.set(sourceId, copyId);
                if (!pairChildren(sourceBlock.children || [], copyBlock.children || [])) return false;
            }
            return true;
        };
        return pairChildren(sourcePage.children || [], copyPage.children || []) ? idMap : null;
    }

    __api_patch_blocks_equivalent(sourceBlocks, copyBlocks, idMap) {
        const sourceById = new Map(sourceBlocks.map(block => [block.block_id, block]));
        const copyById = new Map(copyBlocks.map(block => [block.block_id, block]));
        return [...idMap].every(([sourceId, copyId]) => (
            JSON.stringify(this.__api_patch_comparable_block(sourceById.get(sourceId), idMap))
            === JSON.stringify(this.__api_patch_comparable_block(copyById.get(copyId)))
        ));
    }

    __api_patch_semantic_model_shape(model) {
        const topLevelIndex = new Map((model?.topLevelBlockIds || []).map((id, index) => [id, index]));
        return {
            profileId: model?.profileId || null,
            topLevelCount: model?.topLevelBlockIds?.length || 0,
            sections: (model?.sections || []).map(section => ({
                role: section.role,
                startIndex: section.startIndex,
                endIndex: section.endIndex,
                blockIndexes: (section.blockIds || []).map(id => topLevelIndex.get(id)),
                attachmentIndexes: (section.attachments || []).map(id => topLevelIndex.get(id)),
            })),
            preserved: (model?.preserved || []).map(item => ({
                blockIndex: topLevelIndex.get(item.blockId),
                blockType: item.blockType,
                attachedToRole: item.attachedToRole,
            })),
            signatures: (model?.signatures || []).map(item => ({
                blockIndex: topLevelIndex.get(item.blockId),
                role: item.role,
                normalized: item.normalized,
            })),
            errors: model?.errors || [],
            requiresReviewedRebuild: model?.requiresReviewedRebuild === true,
        };
    }

    __api_patch_approved_to_live_source_id_map(patchPlan, sourceBlocks, sourcePage) {
        const approvedModel = patchPlan.currentModel;
        const approvedIds = approvedModel?.topLevelBlockIds || [];
        const liveIds = sourcePage?.children || [];
        if (approvedIds.length !== liveIds.length) return null;

        const profile = layoutProfiles[patchPlan.profile?.id];
        if (!profile || profile.version !== patchPlan.profile?.version) return null;
        const liveModel = buildApiSectionModel(sourceBlocks, profile);
        if (JSON.stringify(this.__api_patch_semantic_model_shape(approvedModel))
            !== JSON.stringify(this.__api_patch_semantic_model_shape(liveModel))) return null;

        const idMap = new Map([[approvedModel.pageBlockId, sourcePage.block_id]]);
        approvedIds.forEach((approvedId, index) => idMap.set(approvedId, liveIds[index]));
        return idMap;
    }

    __rebind_api_patch_plan(patchPlan, idMap) {
        if (Array.isArray(patchPlan)) return patchPlan.map(item => this.__rebind_api_patch_plan(item, idMap));
        if (!patchPlan || typeof patchPlan !== 'object') {
            return typeof patchPlan === 'string' && idMap.has(patchPlan) ? idMap.get(patchPlan) : patchPlan;
        }
        return Object.fromEntries(Object.entries(patchPlan)
            .map(([key, value]) => [key, this.__rebind_api_patch_plan(value, idMap)]));
    }

    async apply_api_patch({ document_id, source_document_id, patchPlan }) {
        assertWriterMutation(this.governance, 'MarkdownToFeishu.apply_api_patch', document_id);
        this.__assert_absolute_block_links(patchPlan, 'MarkdownToFeishu.apply_api_patch');
        if (!patchPlan || patchPlan.validation?.valid !== true) {
            const error = new Error('A validated API patch plan is required');
            error.code = 'INVALID_API_PATCH_PLAN';
            throw error;
        }
        if (patchPlan.strategy === 'planning-blocked') {
            const error = new Error('A blocked API patch plan cannot be executed');
            error.code = 'INVALID_API_PATCH_PLAN';
            throw error;
        }
        const existingBlocks = await this.get_document_blocks(document_id);
        let pageBlock = existingBlocks.find(block => block.block_type === 1);
        const actualChildren = pageBlock?.children || [];
        const expectedChildren = patchPlan.currentModel?.topLevelBlockIds || [];
        let effectivePatchPlan = patchPlan;
        if (pageBlock && JSON.stringify(actualChildren) !== JSON.stringify(expectedChildren) && source_document_id) {
            const sourceBlocks = await this.get_document_blocks(source_document_id);
            const sourcePage = sourceBlocks.find(block => block.block_type === 1);
            const sourceChildren = sourcePage?.children || [];
            const sourceToCopyIdMap = sourcePage && pageBlock
                ? this.__api_patch_copy_id_map(sourceBlocks, existingBlocks, sourcePage, pageBlock)
                : null;
            const approvedToSourceIdMap = JSON.stringify(sourceChildren) === JSON.stringify(expectedChildren)
                ? new Map([[patchPlan.currentModel?.pageBlockId, sourcePage?.block_id], ...expectedChildren.map(id => [id, id])])
                : this.__api_patch_approved_to_live_source_id_map(patchPlan, sourceBlocks, sourcePage);
            const equivalentCopy = actualChildren.length === expectedChildren.length
                && sourceToCopyIdMap
                && approvedToSourceIdMap
                && this.__api_patch_blocks_equivalent(sourceBlocks, existingBlocks, sourceToCopyIdMap);
            if (equivalentCopy) {
                const approvedToCopyIdMap = new Map([...approvedToSourceIdMap].map(([approvedId, sourceId]) => (
                    [approvedId, sourceToCopyIdMap.get(sourceId)]
                )));
                effectivePatchPlan = this.__rebind_api_patch_plan(patchPlan, approvedToCopyIdMap);
            }
        }
        const effectiveExpectedChildren = effectivePatchPlan.currentModel?.topLevelBlockIds || [];
        if (!pageBlock || JSON.stringify(actualChildren) !== JSON.stringify(effectiveExpectedChildren)) {
            const error = new Error('Live API document blocks changed after patch approval');
            error.code = 'API_PATCH_PRECONDITION_FAILED';
            error.details = { expectedChildren, actualChildren };
            throw error;
        }

        const result = {
            updated: 0,
            created: 0,
            deleted: 0,
            unchanged: actualChildren.length,
            operations: effectivePatchPlan.operations.length,
            ...((effectivePatchPlan.preservedBlockIds || []).length > 0 && {
                preservedBlockIds: [...effectivePatchPlan.preservedBlockIds],
            }),
            ...((effectivePatchPlan.preservedPlacements || []).length > 0 && {
                preservedPlacements: effectivePatchPlan.preservedPlacements.map((placement) => ({ ...placement })),
            }),
        };
        const operationIndex = (operation) => {
            if (Number.isInteger(operation.insertAt)) return operation.insertAt;
            const indexes = (operation.deleteBlockIds || [])
                .map((id) => effectiveExpectedChildren.indexOf(id))
                .filter((index) => index >= 0);
            return indexes.length > 0 ? Math.min(...indexes) : Number.NEGATIVE_INFINITY;
        };
        const operations = [...effectivePatchPlan.operations].sort((left, right) => {
            const leftIndex = operationIndex(left);
            const rightIndex = operationIndex(right);
            return rightIndex - leftIndex;
        });

        if (effectivePatchPlan.strategy === 'ordered-section-replacement') {
            const deletionIndex = (operation) => {
                const indexes = (operation.deleteBlockIds || [])
                    .map((id) => effectiveExpectedChildren.indexOf(id))
                    .filter((index) => index >= 0);
                return indexes.length > 0 ? Math.min(...indexes) : Number.NEGATIVE_INFINITY;
            };
            const deletions = effectivePatchPlan.operations
                .filter((operation) => (operation.deleteBlockIds || []).length > 0)
                .sort((left, right) => deletionIndex(right) - deletionIndex(left));
            for (const operation of deletions) {
                const deleted = await this.__delete_child_blocks_by_id({
                    document_id,
                    parentBlock: pageBlock,
                    childBlockIds: operation.deleteBlockIds,
                });
                result.deleted += deleted;
                result.unchanged -= deleted;
                const refreshedBlocks = await this.get_document_blocks(document_id);
                pageBlock = refreshedBlocks.find(block => block.block_type === 1);
                if (!pageBlock) {
                    const error = new Error('Page block disappeared while applying API patch');
                    error.code = 'API_PATCH_PAGE_MISSING';
                    throw error;
                }
            }
            const insertions = effectivePatchPlan.operations
                .filter((operation) => (operation.blocks || []).length > 0)
                .sort((left, right) => left.insertAt - right.insertAt);
            const placements = [...(effectivePatchPlan.preservedPlacements || [])]
                .sort((left, right) => left.insertAt - right.insertAt);
            if (placements.length > 0) {
                const actualPreserved = pageBlock.children || [];
                const expectedPreserved = placements.map((placement) => placement.blockId);
                if (JSON.stringify(actualPreserved) !== JSON.stringify(expectedPreserved)) {
                    const error = new Error('Reviewed preserved blocks did not collapse into the approved order');
                    error.code = 'API_PATCH_PRESERVED_PLACEMENT_FAILED';
                    error.details = { expectedPreserved, actualPreserved };
                    throw error;
                }
                const desiredBlocks = [];
                let desiredIndex = 0;
                for (const operation of insertions) {
                    if (operation.insertAt !== desiredIndex) {
                        const error = new Error('Reviewed preserved placement requires a complete desired replacement');
                        error.code = 'INVALID_API_PATCH_PLAN';
                        error.details = { expectedInsertAt: desiredIndex, actualInsertAt: operation.insertAt };
                        throw error;
                    }
                    desiredBlocks.push(...this.__sanitize_api_patch_block(operation.blocks || []));
                    desiredIndex += operation.blocks.length;
                }
                let desiredCursor = 0;
                let preservedBefore = 0;
                for (const placement of placements) {
                    const segment = desiredBlocks.slice(desiredCursor, placement.insertAt);
                    if (segment.length > 0) {
                        await this.create_blocks({
                            document_id,
                            blocks: segment,
                            startIndex: desiredCursor + preservedBefore,
                        });
                        const refreshedBlocks = await this.get_document_blocks(document_id);
                        pageBlock = refreshedBlocks.find(block => block.block_type === 1);
                        if (!pageBlock) {
                            const error = new Error('Page block disappeared while applying API patch');
                            error.code = 'API_PATCH_PAGE_MISSING';
                            throw error;
                        }
                    }
                    desiredCursor = placement.insertAt;
                    preservedBefore += 1;
                }
                const tail = desiredBlocks.slice(desiredCursor);
                if (tail.length > 0) {
                    await this.create_blocks({
                        document_id,
                        blocks: tail,
                        startIndex: desiredCursor + preservedBefore,
                    });
                }
                result.created += desiredBlocks.length;
                return result;
            }
            for (const operation of insertions) {
                const blocks = this.__sanitize_api_patch_block(operation.blocks || []);
                await this.create_blocks({
                    document_id,
                    blocks,
                    startIndex: Math.min(operation.insertAt, (pageBlock.children || []).length),
                });
                result.created += blocks.length;
                const refreshedBlocks = await this.get_document_blocks(document_id);
                pageBlock = refreshedBlocks.find(block => block.block_type === 1);
                if (!pageBlock) {
                    const error = new Error('Page block disappeared while applying API patch');
                    error.code = 'API_PATCH_PAGE_MISSING';
                    throw error;
                }
            }
            return result;
        }

        for (const operation of operations) {
            let mutated = false;
            if (operation.type === 'rebuild-body'
                && !['reviewed-full-body-rebuild', 'copy-full-body-rebuild'].includes(effectivePatchPlan.strategy)) {
                const error = new Error('Full body rebuild requires an approved rebuild strategy');
                error.code = 'INVALID_API_PATCH_PLAN';
                throw error;
            }
            const deleteBlockIds = operation.deleteBlockIds || [];
            if (deleteBlockIds.length > 0) {
                const deleted = await this.__delete_child_blocks_by_id({
                    document_id,
                    parentBlock: pageBlock,
                    childBlockIds: deleteBlockIds,
                });
                result.deleted += deleted;
                result.unchanged -= deleted;
                mutated = true;
            }
            const blocks = this.__sanitize_api_patch_block(operation.blocks || []);
            if (blocks.length > 0) {
                const placements = operation.type === 'rebuild-body'
                    ? [...(operation.preservedPlacements || [])].sort((left, right) => left.insertAt - right.insertAt)
                    : [];
                if (placements.length === 0) {
                    await this.create_blocks({
                        document_id,
                        blocks,
                        startIndex: operation.type === 'rebuild-body'
                            ? 0
                            : Math.min(operation.insertAt, (pageBlock.children || []).length),
                    });
                } else {
                    let desiredCursor = 0;
                    let preservedBefore = 0;
                    for (const placement of placements) {
                        const segment = blocks.slice(desiredCursor, placement.insertAt);
                        if (segment.length > 0) {
                            await this.create_blocks({
                                document_id,
                                blocks: segment,
                                startIndex: desiredCursor + preservedBefore,
                            });
                        }
                        desiredCursor = placement.insertAt;
                        preservedBefore += 1;
                    }
                    const tail = blocks.slice(desiredCursor);
                    if (tail.length > 0) {
                        await this.create_blocks({
                            document_id,
                            blocks: tail,
                            startIndex: desiredCursor + preservedBefore,
                        });
                    }
                }
                result.created += blocks.length;
                mutated = true;
            }
            if (mutated) {
                const refreshedBlocks = await this.get_document_blocks(document_id);
                const refreshedPage = refreshedBlocks.find(block => block.block_type === 1);
                if (!refreshedPage) {
                    const error = new Error('Page block disappeared while applying API patch');
                    error.code = 'API_PATCH_PAGE_MISSING';
                    throw error;
                }
                pageBlock = refreshedPage;
            }
        }
        return result;
    }

    async patch_document({ document_id, blocks, strategy = 'smart' }) {
        assertWriterMutation(this.governance, 'MarkdownToFeishu.patch_document', document_id);
        this.__assert_absolute_block_links(blocks, 'MarkdownToFeishu.patch_document');
        /**
         * Sophisticated document update using PATCH API for non-destructive updates.
         *
         * Strategies:
         * - 'smart': Anchor-based matching — same-type blocks pair on exact
         *   or uniquely-contained anchor text only; edits update in place
         *   (containers rebuild at position), insertions land at explicit
         *   positions derived from the matched skeleton, preserve-only
         *   blocks (boards, sheets, bitables, grids, …) are never touched
         * - 'replace': Replace existing blocks in order (update first N, delete extras, create new)
         * - 'append': Keep existing blocks, only append new ones
         *
         * Uses PATCH /open-apis/docx/v1/documents/{document_id}/blocks/batch_update
         * for efficient updates without deleting and recreating everything.
         */
        const token = await this.tokenFetcher.token();

        // Get existing blocks
        const existingBlocks = await this.get_document_blocks(document_id);
        const pageBlock = existingBlocks.find(b => b.block_type === 1);

        if (!pageBlock) {
            throw new Error('Page block not found');
        }

        // Filter to only direct children of page block
        const existingChildren = existingBlocks.filter(
            b => b.parent_id === pageBlock.block_id && b.block_id !== pageBlock.block_id
        );

        const result = {
            updated: 0,
            created: 0,
            deleted: 0,
            unchanged: 0
        };

        // Anchor matching runs once up front so the type guard below and the
        // smart execution share the same plan. The matcher resolves nested
        // blocks (table cells, callout bodies) from the FULL flat block list,
        // not the direct-children subset.
        const anchorPlan = strategy === 'smart'
            ? this.__match_blocks_anchor(
                existingChildren,
                blocks,
                new Map(existingBlocks.map((b) => [b.block_id, b])),
            )
            : null;

        if (strategy === 'replace' || strategy === 'smart') {
            // Feishu block types are immutable: an in-place text update can
            // never change a block's structure, so an in-place update that
            // pairs blocks of different types garbles the layout. Replace
            // pairs positionally. Anchor matching pairs equal types by
            // construction — the guard stays as a hard stop.
            const inPlacePairings = strategy === 'replace'
                ? existingChildren
                    .slice(0, Math.min(existingChildren.length, blocks.length))
                    .map((existing, index) => ({ existing, new: blocks[index] }))
                : anchorPlan.matches.concat(anchorPlan.editedMatches, anchorPlan.rebuildPairs);
            const crossType = inPlacePairings.find((pair) => pair?.existing && pair?.new
                && pair.existing.block_type !== pair.new.block_type);
            if (crossType) {
                throw Object.assign(
                    new Error(`patch_document strategy "${strategy}" pairs an existing block_type ${crossType.existing.block_type} with a new block_type ${crossType.new.block_type}; block types are immutable so this in-place update would garble the layout — use strategy "rebuild" (api.pr-verbatim-content)`),
                    { code: 'REBUILD_REQUIRED_SHAPE_MISMATCH', strategy },
                );
            }
        }

        if (strategy === 'append') {
            // Simple append strategy: keep all existing, add new ones at the end
            if (blocks.length > 0) {
                // Calculate the index to append at (after all existing children)
                const startIndex = existingChildren.length;
                await this.create_blocks({
                    document_id,
                    blocks,
                    startIndex: startIndex
                });
                result.created = blocks.length;
                return result;
            }
            return result;
        }

        if (strategy === 'rebuild') {
            // Full-body replace. Feishu block types are immutable, so updating
            // an old block's text cannot change its structure (an H3 stays an
            // H3, a text block cannot become code) — in-place updates over a
            // differently-shaped body produce garbled documents. Rebuild
            // deletes every existing child block and creates the new block
            // list from scratch. Used for verbatim merged-PR pages.
            if (existingChildren.length > 0) {
                result.deleted += await this.__delete_child_blocks_by_id({
                    document_id,
                    parentBlock: pageBlock,
                    childBlockIds: existingChildren.map(block => block.block_id),
                    token,
                });
            }
            if (blocks.length > 0) {
                await this.create_blocks({ document_id, blocks });
                result.created = blocks.length;
            }
            return result;
        }

        if (strategy === 'replace') {
            // Replace strategy: update first N blocks, delete extras, create remaining
            const updateRequests = [];
            let blockIndex = 0;

            // Update existing blocks with new content
            for (let i = 0; i < Math.min(existingChildren.length, blocks.length); i++) {
                const existingBlock = existingChildren[i];
                const newBlock = blocks[i];

                // Build update request based on block type
                const updateRequest = this.__build_update_request(existingBlock, newBlock);
                if (updateRequest) {
                    updateRequests.push(updateRequest);
                }
                blockIndex = i + 1;
            }

            // Execute batch updates
            if (updateRequests.length > 0) {
                await this.__execute_batch_update(document_id, updateRequests);
                result.updated = updateRequests.length;
            }

            // Delete extra existing blocks
            if (existingChildren.length > blocks.length) {
                const childBlockIds = existingChildren
                    .slice(blocks.length)
                    .map(block => block.block_id);
                result.deleted += await this.__delete_child_blocks_by_id({
                    document_id,
                    parentBlock: pageBlock,
                    childBlockIds,
                    token,
                });
            }

            // Create new blocks if we have more than existing. The surplus is
            // the draft's tail, so it belongs after every surviving block —
            // the default startIndex 0 would insert it at the top of the page.
            if (blocks.length > existingChildren.length) {
                const newBlocks = blocks.slice(existingChildren.length);
                await this.create_blocks({ document_id, blocks: newBlocks, startIndex: existingChildren.length });
                result.created = newBlocks.length;
            }

            return result;
        }

        // Smart strategy: anchor-based matching — blocks pair only on exact
        // or uniquely-contained same-type text, never on similarity scores,
        // and every insertion carries an explicit position.
        const matches = anchorPlan.matches;
        result.preserved = anchorPlan.preserved;
        result.rebuilt = anchorPlan.rebuildPairs.length;

        // Step 1: in-place text updates for equal blocks that drifted at the
        // element level and for Tier-2 text edits.
        const updateRequests = [];
        for (const pair of matches.concat(anchorPlan.editedMatches)) {
            const updateRequest = this.__build_update_request(pair.existing, pair.new);
            if (updateRequest) {
                updateRequests.push(updateRequest);
                result.updated++;
            } else {
                result.unchanged++;
            }
        }
        if (updateRequests.length > 0) {
            await this.__execute_batch_update(document_id, updateRequests);
        }

        // Step 2: delete unmatched blocks plus rebuild pairs (edited
        // containers). Preserve-only blocks are never in this list — the
        // matcher excludes them from matching and from deletion.
        const toDelete = anchorPlan.toDelete;
        result.deleted += await this.__delete_child_blocks_by_id({
            document_id,
            parentBlock: pageBlock,
            childBlockIds: toDelete.map(block => block.block_id),
            token,
        });

        // Step 3: create new/replacement blocks at explicit positions.
        // Positions are survivor counts before the reference block, computed
        // AFTER the deletion set is known; groups at the same position keep
        // draft order, and groups execute back-to-front so earlier insertions
        // never shift later positions.
        const deletedIds = new Set(toDelete.map(block => block.block_id));
        const survivingBefore = (refIndex) => {
            let count = 0;
            for (let k = 0; k < refIndex; k++) {
                if (!deletedIds.has(existingChildren[k].block_id)) count += 1;
            }
            return count;
        };
        const endPosition = existingChildren.length - deletedIds.size;
        const createGroups = [];
        for (const entry of anchorPlan.toCreate) {
            const pos = entry.refIndex < 0
                ? endPosition
                : survivingBefore(entry.refIndex) + (entry.afterRef ? 1 : 0);
            const last = createGroups[createGroups.length - 1];
            if (last && last.pos === pos) {
                last.blocks.push(entry.block);
            } else {
                createGroups.push({ pos, blocks: [entry.block] });
            }
        }
        for (const group of createGroups.slice().sort((a, b) => b.pos - a.pos)) {
            await this.create_blocks({ document_id, blocks: group.blocks, startIndex: group.pos });
            result.created += group.blocks.length;
        }

        // Structural postcondition: preserve-only blocks are never matched,
        // so any disappearance is a bug — assert survival after the writes.
        if (anchorPlan.preserved > 0) {
            const afterBlocks = await this.get_document_blocks(document_id);
            const afterIds = new Set(afterBlocks.map((b) => b.block_id));
            const missing = existingChildren
                .filter((b) => this.__should_preserve_block(b))
                .map((b) => b.block_id)
                .filter((id) => !afterIds.has(id));
            if (missing.length > 0) {
                throw new Error(`smart patch lost preserve-only block(s): ${missing.join(', ')} — refetch and inspect before writing again`);
            }
        }

        console.log(`Patch complete: ${result.updated} updated, ${result.created} created, ${result.deleted} deleted, ${result.unchanged} unchanged, ${result.rebuilt} rebuilt, ${result.preserved} preserved`);
        return result;
    }

    __extract_live_anchor_text(block, byId, seen = new Set()) {
        /**
         * Anchor text of a live block (API shape): its own text plus the text
         * of nested children (callout bodies, table cell text, quote bodies),
         * each part trimmed and joined with newlines. Container content must
         * be covered or an edited table cell would look unchanged.
         */
        const parts = [];
        const own = this.__extract_block_text(block);
        if (own.trim()) parts.push(own.trim());
        const childIds = [];
        if (block.block_type === this.block_type_map.table && Array.isArray(block.table?.cells)) {
            childIds.push(...block.table.cells);
        }
        if (Array.isArray(block.children)) {
            childIds.push(...block.children);
        }
        for (const childId of childIds) {
            if (seen.has(childId)) continue;
            seen.add(childId);
            const child = byId.get(childId);
            if (child) parts.push(this.__extract_live_anchor_text(child, byId, seen));
        }
        return parts.join('\n');
    }

    __extract_structure_anchor_text(block) {
        /**
         * Anchor text of a draft block (markdown_to_blocks shape): same
         * contract as __extract_live_anchor_text. Draft tables carry cells
         * inline (row-major text blocks), callouts/quotes carry children.
         */
        const parts = [];
        const own = this.__extract_block_text_from_structure(block);
        if (own.trim()) parts.push(own.trim());
        if (block.block_type === this.block_type_map.table && Array.isArray(block.table?.cells)) {
            for (const cell of block.table.cells) {
                parts.push(this.__extract_structure_anchor_text(cell));
            }
        }
        if (Array.isArray(block.children)) {
            for (const child of block.children) {
                parts.push(this.__extract_structure_anchor_text(child));
            }
        }
        return parts.join('\n');
    }

    __match_blocks_anchor(existingBlocks, newBlocks, nestedById = null) {
        /**
         * Anchor-based block matching for the smart strategy
         * (replaces the similarity-score pairing, which matched any
         * common-prefix boilerplate above 0.5, permuted content across
         * positions, and gave created blocks no position):
         * - Tier 1 pairs blocks of the same type with equal anchor text via
         *   a longest-common-subsequence walk — order-preserving, because
         *   in-place updates cannot reorder blocks, so a cross-order pairing
         *   would land content in the wrong sequence.
         * - Tier 2 pairs a draft block with the SINGLE same-type live block
         *   whose anchor text contains it or is contained by it, so an
         *   edited block keeps its identity for in-place update. Zero or
         *   multiple candidates never match, and the pair is only taken when
         *   it preserves the monotonic order of the existing skeleton.
         * - Text-block edits update in place; container blocks (table,
         *   callout, quote_container) and blocks with nested children cannot
         *   take in-place text updates, so their edited pairs rebuild
         *   (delete + insert at their own position) instead of silently
         *   dropping the change.
         * - Preserve-only blocks (boards, sheets, bitables, grids, …) sit
         *   outside matching AND deletion entirely.
         * Every unpaired draft block goes to toCreate with an explicit
         * position: refIndex is the index into existingBlocks to insert
         * before (afterRef=false) or after (afterRef=true); refIndex -1
         * means the end of the page. Positions derive from the matched
         * skeleton, so insertions land where the draft has them.
         * Returns { matches, editedMatches, rebuildPairs, toCreate, toDelete, preserved }
         */
        const ANCHOR_MIN_LENGTH = 10;

        const byType = new Map();
        for (let j = 0; j < existingBlocks.length; j++) {
            if (this.__should_preserve_block(existingBlocks[j])) continue;
            const type = existingBlocks[j].block_type;
            if (!byType.has(type)) byType.set(type, []);
            byType.get(type).push(j);
        }
        // nestedById carries the full flat block list so anchor text can
        // resolve nested children (table cells, callout bodies) that are not
        // direct page children; callers without it fall back to the subset.
        const liveById = nestedById || new Map(existingBlocks.map((b) => [b.block_id, b]));
        const liveTexts = existingBlocks.map((b) => this.__extract_live_anchor_text(b, liveById));
        const draftTexts = newBlocks.map((b) => this.__extract_structure_anchor_text(b));
        const candidatesOfType = (type) => byType.get(type) || [];

        const matches = [];
        const editedMatches = [];
        const rebuildPairs = [];
        const toCreate = [];
        const usedExisting = new Set();
        const usedNew = new Set();
        let preserved = 0;
        for (const block of existingBlocks) {
            if (this.__should_preserve_block(block)) preserved += 1;
        }

        // Tier 1: order-preserving exact equality via LCS on (type, anchor
        // text). Identical blocks are interchangeable, so pairing along the
        // common subsequence is canonical — and it never pairs blocks that
        // would require a reorder the in-place API cannot express.
        const n = newBlocks.length;
        const m = existingBlocks.length;
        const sameIdentity = (i, j) => newBlocks[i].block_type === existingBlocks[j].block_type
            && draftTexts[i] === liveTexts[j];
        const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                lcs[i][j] = sameIdentity(i, j)
                    ? lcs[i + 1][j + 1] + 1
                    : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
            }
        }
        for (let i = 0, j = 0; i < n && j < m;) {
            if (sameIdentity(i, j)) {
                matches.push({ existing: existingBlocks[j], new: newBlocks[i], liveIndex: j, draftIndex: i });
                usedExisting.add(j);
                usedNew.add(i);
                i += 1;
                j += 1;
            } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
                i += 1;
            } else {
                j += 1;
            }
        }
        const skeletonLive = new Map(matches.map((pair) => [pair.draftIndex, pair.liveIndex]));

        // Tier 2: unique containment within the same type. Both sides must
        // carry at least ANCHOR_MIN_LENGTH characters so short boilerplate
        // ("Notes", a bare signature line) cannot anchor, and the pair must
        // slot monotonically into the skeleton above.
        for (let i = 0; i < n; i++) {
            if (usedNew.has(i)) continue;
            if (draftTexts[i].length < ANCHOR_MIN_LENGTH) continue;
            const hits = candidatesOfType(newBlocks[i].block_type).filter((j) => {
                if (usedExisting.has(j)) return false;
                const liveText = liveTexts[j];
                if (liveText.length < ANCHOR_MIN_LENGTH) return false;
                return liveText.includes(draftTexts[i]) || draftTexts[i].includes(liveText);
            });
            if (hits.length !== 1) continue;
            const j = hits[0];
            let prevLive = -1;
            let nextLive = m;
            for (const [draftIdx, liveIdx] of skeletonLive) {
                if (draftIdx < i) prevLive = Math.max(prevLive, liveIdx);
                if (draftIdx > i) nextLive = Math.min(nextLive, liveIdx);
            }
            if (j <= prevLive || j >= nextLive) continue;
            editedMatches.push({ existing: existingBlocks[j], new: newBlocks[i], liveIndex: j, draftIndex: i });
            usedExisting.add(j);
            usedNew.add(i);
            skeletonLive.set(i, j);
        }

        // Split edited pairs: nested/container content cannot be updated by
        // update_text_elements — those rebuild at position; plain text blocks
        // update in place.
        const TEXT_UPDATABLE_TYPES = new Set([
            this.block_type_map.text, this.block_type_map.heading1, this.block_type_map.heading2,
            this.block_type_map.heading3, this.block_type_map.heading4, this.block_type_map.heading5,
            this.block_type_map.heading6, this.block_type_map.heading7, this.block_type_map.heading8,
            this.block_type_map.heading9, this.block_type_map.bullet, this.block_type_map.ordered,
            this.block_type_map.code, this.block_type_map.quote, this.block_type_map.todo,
        ]);
        const CONTAINER_TYPES = new Set([
            this.block_type_map.callout, this.block_type_map.table, this.block_type_map.quote_container,
        ]);
        for (const pair of editedMatches) {
            const hasNestedChildren = (Array.isArray(pair.new.children) && pair.new.children.length > 0)
                || (Array.isArray(pair.existing.children) && pair.existing.children.length > 0);
            const updatable = TEXT_UPDATABLE_TYPES.has(pair.existing.block_type)
                && !CONTAINER_TYPES.has(pair.existing.block_type)
                && !hasNestedChildren;
            if (!updatable) rebuildPairs.push(pair);
        }
        const inPlaceEdits = editedMatches.filter((pair) => !rebuildPairs.includes(pair));

        // Position skeleton: draft blocks paired with a SURVIVING live block
        // (matches + inPlaceEdits — rebuild pairs delete their live block, so
        // they cannot anchor others; each rebuild draft self-anchors at its
        // own live position instead). Runs of unpaired draft blocks insert
        // before the next surviving ref, else after the previous one, else at
        // the end of the page.
        const rebuildSelfRef = new Map(rebuildPairs.map((pair) => [pair.draftIndex, pair.liveIndex]));
        const sortedMatched = [...skeletonLive.keys()].sort((a, b) => a - b);

        const emitRun = (start, end) => {
            const nextRef = sortedMatched.find((i) => i >= end);
            const prevRef = [...sortedMatched].reverse().find((i) => i < start);
            let refIndex = -1;
            let afterRef = false;
            if (nextRef !== undefined) {
                refIndex = skeletonLive.get(nextRef);
            } else if (prevRef !== undefined) {
                refIndex = skeletonLive.get(prevRef);
                afterRef = true;
            }
            for (let i = start; i < end; i++) {
                toCreate.push({ block: newBlocks[i], refIndex, afterRef });
            }
        };
        let runStart = null;
        for (let i = 0; i <= newBlocks.length; i++) {
            if (i < newBlocks.length && rebuildSelfRef.has(i)) {
                if (runStart !== null) {
                    emitRun(runStart, i);
                    runStart = null;
                }
                toCreate.push({ block: newBlocks[i], refIndex: rebuildSelfRef.get(i), afterRef: false });
            } else if (i < newBlocks.length && skeletonLive.has(i)) {
                if (runStart !== null) {
                    emitRun(runStart, i);
                    runStart = null;
                }
            } else if (runStart === null) {
                runStart = i;
            }
        }
        if (runStart !== null) emitRun(runStart, newBlocks.length);

        // Unmatched live blocks are deleted — except preserve-only ones,
        // which the patch has no authority over. Rebuild pairs re-add their
        // live block here: they were matched, but their replacement inserts
        // as a new block at the same position.
        const toDelete = existingBlocks
            .filter((_, idx) => !usedExisting.has(idx))
            .filter((block) => !this.__should_preserve_block(block))
            .concat(rebuildPairs.map((pair) => pair.existing));

        return { matches, editedMatches: inPlaceEdits, rebuildPairs, toCreate, toDelete, preserved };
    }

    __should_preserve_block(existingBlock) {
        /**
         * Determine if an existing block should be preserved as-is
         * (never matched for update, never deleted).
         *
         * These block types cannot be recreated from markdown, so a patch
         * must keep them regardless of what the draft contains:
         * - board (43): Whiteboard drawings
         * - iframe (26): Figma embeds
         * - sheet (30): Embedded spreadsheets
         * - source_synced (49): Synced content blocks
         * - bitable (18): Live database embeds
         * - grid (24): User column layouts
         * - add_ons (40): Third-party widgets
         */
        const PRESERVE_ONLY_TYPES = [43, 26, 30, 49, 18, 24, 40];
        return PRESERVE_ONLY_TYPES.includes(existingBlock.block_type);
    }

    __get_block_type_name(blockType) {
        /**
         * Get human-readable block type name from block_type number
         */
        const names = {
            1: 'page', 2: 'text', 3: 'heading1', 4: 'heading2', 5: 'heading3',
            6: 'heading4', 7: 'heading5', 8: 'heading6', 9: 'heading7',
            10: 'heading8', 11: 'heading9', 12: 'bullet', 13: 'ordered',
            14: 'code', 15: 'quote', 17: 'todo', 18: 'bitable', 19: 'callout',
            22: 'divider', 23: 'file', 24: 'grid', 25: 'grid_column',
            26: 'iframe', 27: 'image', 30: 'sheet', 31: 'table',
            32: 'table_cell', 34: 'quote_container', 40: 'add_ons',
            43: 'board', 49: 'source_synced'
        };
        return names[blockType] || `unknown(${blockType})`;
    }

    __extract_block_text(block) {
        /**
         * Extract plain text from an existing block (from API response)
         * Handles special cases for image/board/iframe/table/sheet
         */
        const blockType = block.block_type;

        // Handle image blocks - extract caption
        if (blockType === 27 && block.image) {
            return block.image.caption?.content || block.image.token || '';
        }

        // Handle board blocks - use token as identifier
        if (blockType === 43 && block.board) {
            return block.board.token || '';
        }

        // Handle iframe blocks - extract from component URL or caption
        if (blockType === 26 && block.iframe) {
            // Iframe blocks don't have easily extractable text
            // Return empty - we'll match by position instead
            return '';
        }

        // Handle sheet blocks - can't easily extract text
        if (blockType === 30 && block.sheet) {
            return '';
        }

        // Handle table blocks - extract cell text
        if (blockType === 31 && block.table) {
            // Could extract cell contents but it's complex
            // For now, return empty - match by position
            return '';
        }

        const blockTypeName = Object.keys(this.block_type_map).find(
            key => this.block_type_map[key] === block.block_type
        );

        if (!blockTypeName || !block[blockTypeName]) return '';

        const content = block[blockTypeName];
        if (content.elements) {
            return content.elements
                .map(el => {
                    if (el.text_run) return el.text_run.content;
                    if (el.equation) return el.equation.content;
                    return '';
                })
                .join('');
        }

        return '';
    }

    __extract_block_text_from_structure(block) {
        /**
         * Extract plain text from a block structure (before API submission)
         * Handles special cases for image/table blocks from markdown conversion
         */
        const blockType = block.block_type;

        // Handle image blocks - extract alt text from metadata
        if (blockType === 27 && block.image) {
            // New image blocks have _metadata with alt/title
            if (block.image._metadata) {
                return block.image._metadata.alt || block.image._metadata.title || '';
            }
            return block.image.token || '';
        }

        // Handle table blocks - extract first cell text
        if (blockType === 31 && block.table) {
            // Could extract cell contents but it's complex
            return '';
        }

        const blockTypeName = Object.keys(this.block_type_map).find(
            key => this.block_type_map[key] === block.block_type
        );

        if (!blockTypeName || !block[blockTypeName]) return '';

        const content = block[blockTypeName];
        if (content.elements) {
            return content.elements
                .map(el => {
                    if (el.text_run) return el.text_run.content;
                    if (el.equation) return el.equation.content;
                    return '';
                })
                .join('');
        }

        return '';
    }

    __build_update_request(existingBlock, newBlock, preserveType = false) {
        /**
         * Build a PATCH batch_update request for a single block.
         * Returns null if no update is needed.
         *
         * @param existingBlock - The existing block from Feishu
         * @param newBlock - The new block structure from markdown
         * @param preserveType - If true, we matched equivalent types (e.g., image↔board)
         */
        // If preserving type with image-like blocks, don't try to update
        // (we already handled this in patch_document, but double-check)
        if (preserveType) {
            const IMAGE_TYPES = [27, 43, 26]; // image, board, iframe
            const TABLE_TYPES = [31, 30];      // table, sheet
            if (IMAGE_TYPES.includes(existingBlock.block_type) ||
                TABLE_TYPES.includes(existingBlock.block_type)) {
                console.log(`Preserving original ${this.__get_block_type_name(existingBlock.block_type)} block`);
                return null;
            }
        }

        // Only update if content has changed
        const existingText = this.__extract_block_text(existingBlock);
        const newText = this.__extract_block_text_from_structure(newBlock);

        if (existingText === newText) return null; // No change needed

        const blockTypeName = Object.keys(this.block_type_map).find(
            key => this.block_type_map[key] === newBlock.block_type
        );

        // Only support updating text-based blocks
        const textBlockTypes = ['text', 'heading1', 'heading2', 'heading3', 'heading4',
                                'heading5', 'heading6', 'heading7', 'heading8', 'heading9',
                                'bullet', 'ordered', 'code', 'quote', 'todo'];

        if (!textBlockTypes.includes(blockTypeName)) {
            return null; // Can't update this block type
        }

        // Build update request
        const updateRequest = {
            block_id: existingBlock.block_id,
            update_text_elements: {
                elements: newBlock[blockTypeName].elements
            }
        };

        // Note: update_text_style is separate from update_text_elements
        // For now, we only update text content, not style
        // Text element styles (bold, italic, etc.) are already in the elements

        return updateRequest;
    }

    async __execute_batch_update(document_id, updateRequests) {
        assertWriterMutation(this.governance, 'MarkdownToFeishu.__execute_batch_update', document_id);
        /**
         * Execute PATCH batch_update API call.
         * Handles batching (max 200 requests per call).
         */
        const token = await this.tokenFetcher.token();
        const url = `${process.env.FEISHU_HOST}/open-apis/docx/v1/documents/${document_id}/blocks/batch_update`;

        const batchSize = 200; // API limit
        const results = [];

        for (let i = 0; i < updateRequests.length; i += batchSize) {
            const batch = updateRequests.slice(i, i + batchSize);

            const data = await this.__fetch_feishu_json(url, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    requests: batch
                })
            });

            if (data.code !== 0) {
                throw new Error(`Failed to batch update blocks: ${data.msg}`);
            }

            results.push(data);
            console.log(`Updated blocks ${i + 1}-${Math.min(i + batchSize, updateRequests.length)} of ${updateRequests.length}`);
        }

        return results;
    }

    __build_child_delete_ranges(parentBlock, childBlockIds) {
        /**
         * Convert direct child block ids to bottom-up contiguous ranges for
         * /children/batch_delete. Deleting from the end prevents earlier
         * indexes from shifting before later deletes run.
         */
        if (!childBlockIds || childBlockIds.length === 0) {
            return [];
        }

        const children = parentBlock.children || [];
        const indexes = [...new Set(childBlockIds)]
            .map(id => {
                const index = children.indexOf(id);
                if (index === -1) {
                    throw new Error(`Cannot delete block ${id}: not a direct child of ${parentBlock.block_id}`);
                }
                return index;
            })
            .sort((a, b) => a - b);

        const ranges = [];
        let start = indexes[0];
        let end = start + 1;

        for (let i = 1; i < indexes.length; i++) {
            const index = indexes[i];
            if (index === end) {
                end++;
            } else {
                ranges.push({ start_index: start, end_index: end });
                start = index;
                end = index + 1;
            }
        }
        ranges.push({ start_index: start, end_index: end });

        return ranges.reverse();
    }

    async __delete_child_blocks_by_id({ document_id, parentBlock, childBlockIds, token = null }) {
        assertWriterMutation(this.governance, 'MarkdownToFeishu.__delete_child_blocks_by_id', document_id);
        if (!childBlockIds || childBlockIds.length === 0) {
            return 0;
        }

        const authToken = token || await this.tokenFetcher.token();
        const ranges = this.__build_child_delete_ranges(parentBlock, childBlockIds);
        const url = `${process.env.FEISHU_HOST}/open-apis/docx/v1/documents/${document_id}/blocks/${parentBlock.block_id}/children/batch_delete`;

        let deleted = 0;
        for (const range of ranges) {
            const data = await this.__fetch_feishu_json(url, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`,
                },
                body: JSON.stringify(range),
            });
            if (data.code !== 0) {
                throw new Error(`batch_delete failed for children [${range.start_index}, ${range.end_index}): ${data.msg} (code ${data.code})`);
            }
            deleted += range.end_index - range.start_index;
        }

        return deleted;
    }

    async push_markdown({
        markdown_content,
        document_id = null,
        title = null,
        folder_token = null,
        parent_node_token = null,
        skip_image_upload = false
    }) {
        assertWriterMutation(this.governance, 'MarkdownToFeishu.push_markdown', document_id);
        // Parse markdown
        const { frontmatter, tokens } = await this.parse_markdown(markdown_content);

        // Convert to blocks
        let blocks = await this.markdown_to_blocks(tokens);

        // Create document if needed
        let doc_info = null;
        if (!document_id) {
            const doc_title = title || frontmatter?.title || 'Untitled Document';
            doc_info = await this.create_document({
                title: doc_title,
                folder_token: folder_token,
                parent_node_token: parent_node_token
            });
            document_id = doc_info.document_id;
        }

        // Process images - upload and get file_keys
        if (!skip_image_upload) {
            blocks = await this.__process_image_blocks(blocks, document_id);
        }

        // Upload blocks
        const result = await this.create_blocks({ document_id, blocks });

        return {
            document_id,
            blocks_created: blocks.length,
            result,
            ...(doc_info && { node_token: doc_info.node_token, wiki_url: doc_info.wiki_url })
        };
    }
}

// The canonical end-of-cell `<br>` fixed point lives in verbatim-content.js
// (api.pr-verbatim-content canonicalization); re-exported for compatibility.
module.exports = MarkdownToFeishu;
module.exports.normalizeRefetchedMarkdown = require('./sdk-doc-sync/verbatim-content').normalizeRefetchedMarkdown;
