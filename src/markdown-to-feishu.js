const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher.js');
const fetch = require('node-fetch');
const marked = require('marked');
const cheerio = require('cheerio');

require('dotenv').config();

class MarkdownToFeishu {
    constructor({ sourceType = 'drive', rootToken, baseToken, document_id = null }) {
        this.source_type = sourceType;
        this.root_token = rootToken;
        this.base_token = baseToken;
        this.document_id = document_id;
        this.tokenFetcher = new larkTokenFetcher();

        // Reverse mappings from larkDocWriter
        this.block_type_map = this.__create_block_type_map();
        this.lang_map = this.__create_lang_map();
        this.lang_id_map = this.__create_lang_id_map();
    }

    __create_block_type_map() {
        return {
            'page': 1,
            'text': 2,
            'heading1': 3,
            'heading2': 4,
            'heading3': 5,
            'heading4': 6,
            'heading5': 7,
            'heading6': 8,
            'heading7': 9,
            'heading8': 10,
            'heading9': 11,
            'bullet': 12,
            'ordered': 13,
            'code': 14,
            'quote': 15,
            'todo': 17,
            'bitable': 18,
            'callout': 19,
            'divider': 22,
            'file': 23,
            'grid': 24,
            'grid_column': 25,
            'iframe': 26,
            'image': 27,
            'sheet': 30,
            'table': 31,
            'table_cell': 32,
            'quote_container': 34,
            'add_ons': 40
        };
    }

    __create_lang_map() {
        return [
            null,
            "PlainText",
            "ABAP",
            "Ada",
            "Apache",
            "Apex",
            "Assembly",
            "Bash",
            "CSharp",
            "C++",
            "C",
            "COBOL",
            "CSS",
            "CoffeeScript",
            "D",
            "Dart",
            "Delphi",
            "Django",
            "Dockerfile",
            "Erlang",
            "Fortran",
            "FoxPro",
            "Go",
            "Groovy",
            "HTML",
            "HTMLBars",
            "HTTP",
            "Haskell",
            "JSON",
            "Java",
            "JavaScript",
            "Julia",
            "Kotlin",
            "LateX",
            "Lisp",
            "Logo",
            "Lua",
            "MATLAB",
            "Makefile",
            "Markdown",
            "Nginx",
            "Objective",
            "OpenEdgeABL",
            "PHP",
            "Perl",
            "PostScript",
            "Power",
            "Prolog",
            "ProtoBuf",
            "Python",
            "R",
            "RPG",
            "Ruby",
            "Rust",
            "SAS",
            "SCSS",
            "SQL",
            "Scala",
            "Scheme",
            "Scratch",
            "Shell",
            "Swift",
            "Thrift",
            "TypeScript",
            "VBScript",
            "Visual",
            "XML",
            "YAML",
            "CMake",
            "Diff",
            "Gherkin",
            "GraphQL",
            "OpenGL Shading Language",
            "Properties",
            "Solidity",
            "TOML"
        ];
    }

    __create_lang_id_map() {
        // Create reverse lookup: language name -> ID
        const map = {};
        this.lang_map.forEach((lang, idx) => {
            if (lang) {
                map[lang.toLowerCase()] = idx;
            }
        });
        // Add common aliases
        map['js'] = 30;  // JavaScript
        map['ts'] = 64;  // TypeScript
        map['py'] = 50;  // Python
        map['bash'] = 7;
        map['shell'] = 62;
        map['plaintext'] = 1;
        map['text'] = 1;
        return map;
    }

    __get_lang_id(lang_name) {
        if (!lang_name) return 1; // PlainText
        const normalized = lang_name.toLowerCase();
        return this.lang_id_map[normalized] || 1;
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
                        children.push(this.__create_text_block(childToken));
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
                // Tight list: item.text has all content joined by \n.
                // First line becomes bullet text; remaining lines become child text blocks.
                const lines = (item.text || '').split('\n');
                const bulletText = lines[0];
                const childLines = lines.slice(1).filter(l => l.trim() !== '');

                const block = {
                    block_type: block_type,
                    [ordered ? 'ordered' : 'bullet']: {
                        elements: this.__parse_inline_markdown(bulletText),
                        style: {}
                    }
                };

                const children = [];
                for (const line of childLines) {
                    children.push(this.__create_text_block({ text: line }));
                }

                // Also handle nested list tokens
                for (const childToken of (item.tokens || [])) {
                    if (childToken.type === 'list') {
                        children.push(...this.__create_list_blocks(childToken, childToken.ordered));
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

        // Check if it's a Supademo component
        if (html.includes('<Supademo')) {
            return this.__parse_supademo(html);
        }

        // Check if it's an Admonition
        if (html.includes('<Admonition')) {
            return this.__parse_admonition(html);
        }

        // Check if it's a table
        if (html.includes('<table')) {
            return this.__create_table_block(html);
        }

        // Check if it's an include/exclude tag - preserve as-is in a text block
        if (html.includes('<include') || html.includes('<exclude')) {
            return {
                block_type: this.block_type_map.text,
                text: {
                    elements: [this.__create_text_element(html)],
                    style: {}
                }
            };
        }

        // Default: create text block with HTML
        return this.__create_text_block({ text: html });
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
            const contentText = $.text();
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
                emoji_id: emoji_map[icon] || 'blue_book'
            },
            children: children
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
                // Check if paragraph contains only an image
                if (token.tokens && token.tokens.length === 1 && token.tokens[0].type === 'image') {
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
                blocks.push(this.__parse_html_block(token));
                break;
            case 'image':
                // Standalone image (shouldn't normally happen, but handle it)
                blocks.push(this.__create_image_block(token));
                break;
            case 'space':
                // Skip empty space
                break;
            default:
                console.log(`Unsupported token type: ${token.type}`);
        }

        return blocks;
    }

    async parse_markdown(markdown_content) {
        // Extract frontmatter
        const frontmatter = this.__extract_frontmatter(markdown_content);

        // Remove frontmatter from content
        const content = this.__remove_frontmatter(markdown_content);

        // Parse markdown to tokens
        const tokens = marked.lexer(content);

        return {
            frontmatter,
            tokens
        };
    }

    async markdown_to_blocks(tokens) {
        const blocks = [];

        for (let token of tokens) {
            const converted = this.__token_to_blocks(token);
            blocks.push(...converted);
        }

        return blocks;
    }

    // ==================== Feishu API Methods ====================

    async create_document({ title, folder_token = null, parent_node_token = null }) {
        if (this.source_type === 'wiki') {
            return await this.__create_wiki_node({ title, parent_node_token });
        } else {
            return await this.__create_drive_document({ title, folder_token });
        }
    }

    async __create_drive_document({ title, folder_token = null }) {
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

    async get_document_blocks(document_id) {
        const token = await this.tokenFetcher.token();

        const url = `${process.env.FEISHU_HOST}/open-apis/docx/v1/documents/${document_id}/blocks`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.code !== 0) {
            throw new Error(`Failed to get document blocks: ${data.msg}`);
        }

        return data.data.items;
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

    async create_blocks({ document_id, blocks, startIndex = 0, parentBlockId = null }) {
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

        // Remove children field - API doesn't accept inline children
        const cleanBlocks = this.__remove_children_recursively(blocks);

        // Use children API to add blocks to the parent
        const url = `${process.env.FEISHU_HOST}/open-apis/docx/v1/documents/${document_id}/blocks/${parentId}/children`;

        const batchSize = 50;
        const results = [];
        const createdBlockIds = [];

        for (let i = 0; i < cleanBlocks.length; i += batchSize) {
            const batch = cleanBlocks.slice(i, i + batchSize);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    children: batch,
                    index: startIndex + i
                })
            });

            const data = await response.json();

            if (data.code !== 0) {
                throw new Error(`Failed to create blocks: ${data.msg}`);
            }

            // Collect created block IDs from response
            if (data.data?.children) {
                for (const child of data.data.children) {
                    createdBlockIds.push(child.block_id);
                }
            }

            results.push(data);
            if (!parentBlockId) {
                console.log(`Created blocks ${i + 1}-${Math.min(i + batchSize, cleanBlocks.length)} of ${cleanBlocks.length}`);
            }
        }

        // Recursively create children for blocks that had them
        for (const [idx, children] of childrenMap) {
            const blockId = createdBlockIds[idx];
            if (blockId) {
                // Small delay to avoid API rate limits on nested calls
                await new Promise(r => setTimeout(r, 200));
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        await this.create_blocks({
                            document_id,
                            blocks: children,
                            parentBlockId: blockId,
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

    async update_document({ document_id, blocks }) {
        // For updates, we need to delete existing blocks and recreate
        // This is a simplified approach - a more sophisticated one would do differential updates
        const token = await this.tokenFetcher.token();

        // Get existing blocks
        const existingBlocks = await this.get_document_blocks(document_id);
        const pageBlock = existingBlocks.find(b => b.block_type === 1);

        // Delete all children of page block
        for (let block of existingBlocks) {
            if (block.block_id !== pageBlock.block_id && block.parent_id === pageBlock.block_id) {
                const deleteUrl = `${process.env.FEISHU_HOST}/open-apis/docx/v1/documents/${document_id}/blocks/${block.block_id}`;
                await fetch(deleteUrl, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
            }
        }

        // Create new blocks
        return await this.create_blocks({ document_id, blocks });
    }

    async patch_document({ document_id, blocks, strategy = 'smart' }) {
        /**
         * Sophisticated document update using PATCH API for non-destructive updates.
         *
         * Strategies:
         * - 'smart': Intelligently match blocks by type and content, update/delete/create as needed
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
                for (let i = blocks.length; i < existingChildren.length; i++) {
                    const deleteUrl = `${process.env.FEISHU_HOST}/open-apis/docx/v1/documents/${document_id}/blocks/${existingChildren[i].block_id}`;
                    await fetch(deleteUrl, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    result.deleted++;
                }
            }

            // Create new blocks if we have more than existing
            if (blocks.length > existingChildren.length) {
                const newBlocks = blocks.slice(existingChildren.length);
                await this.create_blocks({ document_id, blocks: newBlocks });
                result.created = newBlocks.length;
            }

            return result;
        }

        // Smart strategy: match blocks intelligently (with type preservation)
        const { matches, toCreate, toDelete } = this.__match_blocks_smart(existingChildren, blocks);

        // Step 1: Update matched blocks
        const updateRequests = [];
        for (const { existing, new: newBlock, preserveType } of matches) {
            // If preserveType is set, the existing block type should be preserved
            // (e.g., board/iframe/sheet cannot be recreated from markdown)
            if (preserveType && this.__should_preserve_block(existing)) {
                // Don't update these blocks - they're preserved as-is
                console.log(`Preserving ${this.__get_block_type_name(existing.block_type)} block: ${existing.block_id}`);
                result.unchanged++;
                continue;
            }

            const updateRequest = this.__build_update_request(existing, newBlock, preserveType);
            if (updateRequest) {
                updateRequests.push(updateRequest);
                result.updated++;
            } else {
                result.unchanged++;
            }
        }

        // Execute batch updates (max 200 per batch)
        if (updateRequests.length > 0) {
            await this.__execute_batch_update(document_id, updateRequests);
        }

        // Step 2: Delete unmatched blocks
        for (const block of toDelete) {
            const deleteUrl = `${process.env.FEISHU_HOST}/open-apis/docx/v1/documents/${document_id}/blocks/${block.block_id}`;
            await fetch(deleteUrl, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            result.deleted++;
        }

        // Step 3: Create new blocks
        if (toCreate.length > 0) {
            await this.create_blocks({ document_id, blocks: toCreate });
            result.created = toCreate.length;
        }

        console.log(`Patch complete: ${result.updated} updated, ${result.created} created, ${result.deleted} deleted, ${result.unchanged} unchanged`);
        return result;
    }

    __match_blocks_smart(existingBlocks, newBlocks) {
        /**
         * Smart block matching algorithm with HYBRID TYPE PRESERVATION:
         * - Match blocks by type and content similarity
         * - IMPORTANT: Match equivalent types that become the same markdown:
         *   - image (27) ↔ board (43) ↔ iframe (26) → all become ![caption](url)
         *   - table (31) ↔ sheet (30) → both become <table> HTML
         * - Preserve original block types when updating existing documents
         * - Return: { matches: [{existing, new, preserveType}], toCreate: [], toDelete: [] }
         */
        const matches = [];
        const usedExisting = new Set();
        const usedNew = new Set();

        // Define equivalent type groups (types that become identical in markdown)
        const IMAGE_TYPES = [27, 43, 26];  // image, board, iframe
        const TABLE_TYPES = [31, 30];       // table, sheet

        const areEquivalentTypes = (type1, type2) => {
            if (type1 === type2) return true;
            if (IMAGE_TYPES.includes(type1) && IMAGE_TYPES.includes(type2)) return true;
            if (TABLE_TYPES.includes(type1) && TABLE_TYPES.includes(type2)) return true;
            return false;
        };

        // First pass: exact matches (same/equivalent type and similar content)
        for (let i = 0; i < newBlocks.length; i++) {
            if (usedNew.has(i)) continue;

            for (let j = 0; j < existingBlocks.length; j++) {
                if (usedExisting.has(j)) continue;

                const existing = existingBlocks[j];
                const newBlock = newBlocks[i];

                // Check if types are equivalent (can be matched)
                if (!areEquivalentTypes(existing.block_type, newBlock.block_type)) continue;

                // Check content similarity
                const similarity = this.__calculate_block_similarity(existing, newBlock);
                if (similarity > 0.5) { // 50% similarity threshold
                    // Mark if we need to preserve the original type
                    const preserveType = existing.block_type !== newBlock.block_type;
                    matches.push({ existing, new: newBlock, preserveType });
                    usedExisting.add(j);
                    usedNew.add(i);
                    break;
                }
            }
        }

        // Second pass: match remaining blocks by position and equivalent type
        let newIdx = 0;
        for (let i = 0; i < newBlocks.length; i++) {
            if (usedNew.has(i)) continue;

            // Find next unused existing block of same/equivalent type
            for (let j = newIdx; j < existingBlocks.length; j++) {
                if (usedExisting.has(j)) continue;

                const existing = existingBlocks[j];
                const newBlock = newBlocks[i];

                if (areEquivalentTypes(existing.block_type, newBlock.block_type)) {
                    const preserveType = existing.block_type !== newBlock.block_type;
                    matches.push({ existing, new: newBlock, preserveType });
                    usedExisting.add(j);
                    usedNew.add(i);
                    newIdx = j + 1;
                    break;
                }
            }
        }

        // Collect unmatched blocks
        const toDelete = existingBlocks.filter((_, idx) => !usedExisting.has(idx));
        const toCreate = newBlocks.filter((_, idx) => !usedNew.has(idx));

        return { matches, toCreate, toDelete };
    }

    __should_preserve_block(existingBlock) {
        /**
         * Determine if an existing block should be preserved as-is
         * (not updated, just kept in place).
         *
         * These block types cannot be recreated from markdown:
         * - board (43): Whiteboard drawings
         * - iframe (26): Figma embeds
         * - sheet (30): Embedded spreadsheets
         * - source_synced (49): Synced content blocks
         */
        const PRESERVE_ONLY_TYPES = [43, 26, 30, 49]; // board, iframe, sheet, source_synced
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

    __calculate_block_similarity(existingBlock, newBlock) {
        /**
         * Calculate similarity score between two blocks (0-1)
         * Higher score = more similar
         */

        // Define equivalent type groups
        const IMAGE_TYPES = [27, 43, 26]; // image, board, iframe
        const TABLE_TYPES = [31, 30];      // table, sheet

        // Check if types are equivalent before rejecting
        const areEquivalent =
            (IMAGE_TYPES.includes(existingBlock.block_type) && IMAGE_TYPES.includes(newBlock.block_type)) ||
            (TABLE_TYPES.includes(existingBlock.block_type) && TABLE_TYPES.includes(newBlock.block_type));

        if (existingBlock.block_type !== newBlock.block_type && !areEquivalent) return 0;

        // Extract text content from both blocks
        const existingText = this.__extract_block_text(existingBlock);
        const newText = this.__extract_block_text_from_structure(newBlock);

        // Special handling for image-like blocks (image, board, iframe)
        if (IMAGE_TYPES.includes(existingBlock.block_type) &&
            IMAGE_TYPES.includes(newBlock.block_type)) {
            // If both have text, compare them
            if (existingText && newText) {
                const maxLen = Math.max(existingText.length, newText.length);
                let matches = 0;
                for (let i = 0; i < Math.min(existingText.length, newText.length); i++) {
                    if (existingText[i].toLowerCase() === newText[i].toLowerCase()) matches++;
                }
                return matches / maxLen;
            }
            // If no text to compare, return moderate similarity (match by position later)
            return 0.6;
        }

        // Special handling for table/sheet blocks
        if (TABLE_TYPES.includes(existingBlock.block_type) &&
            TABLE_TYPES.includes(newBlock.block_type)) {
            // Tables are hard to compare - return moderate similarity
            // Will match by position in second pass
            return 0.6;
        }

        if (!existingText || !newText) return 0;

        // Simple similarity: ratio of common characters
        const maxLen = Math.max(existingText.length, newText.length);
        if (maxLen === 0) return 1;

        // Count matching prefix characters
        let matches = 0;
        for (let i = 0; i < Math.min(existingText.length, newText.length); i++) {
            if (existingText[i] === newText[i]) matches++;
        }

        return matches / maxLen;
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

            const response = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    requests: batch
                })
            });

            const data = await response.json();

            if (data.code !== 0) {
                throw new Error(`Failed to batch update blocks: ${data.msg}`);
            }

            results.push(data);
            console.log(`Updated blocks ${i + 1}-${Math.min(i + batchSize, updateRequests.length)} of ${updateRequests.length}`);
        }

        return results;
    }

    async push_markdown({
        markdown_content,
        document_id = null,
        title = null,
        folder_token = null,
        parent_node_token = null,
        skip_image_upload = false
    }) {
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

module.exports = MarkdownToFeishu;
