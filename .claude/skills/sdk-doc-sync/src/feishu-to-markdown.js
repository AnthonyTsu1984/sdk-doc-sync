const larkDocWriter = require('../lib/lark-docs/larkDocWriter');

class FeishuToMarkdown extends larkDocWriter {
    constructor({ sourceType, rootToken, baseToken, targets = 'all' }) {
        super(rootToken, baseToken, null, null, '', targets, true, false);
        this.source_type = sourceType;
        this.base_token = baseToken;
        this.root_token = rootToken;
        this.tokens = [];
    }

    async list_documents() {
        if (!this.records) {
            await this.__listed_docs();
        }

        return this.records.map(record => {
            return {
                id: record.id,
                metadata: {
                    title: record.fields.Docs?.text,
                    link: record.fields.Docs?.link,
                    slug: typeof record.fields.Slug === 'string' ? record.fields.Slug : record.fields.Slug[0][record.fields.Slug[0]?.type],
                    token: record.fields.Docs?.link.split('/').pop(),
                    labels: record.fields.Labels,
                    type: record.fields.Type,
                    added_since: record.fields['Added Since'],
                    last_modified: record.fields['Last Modified At'],
                    deprecate_since: record.fields['Deprecate Since'],
                    progress: record.fields.Progress,
                    keywords: record.fields.Keywords,
                    beta: record.fields.Beta,
                    notebook: record.fields.Notebook,
                    targets: record.fields.Targets,
                },
                parent: record.fields['父记录']?.[0]?.record_ids?.[0] || record.fields['Parent']?.[0]?.record_ids?.[0]
            }
        });
    }

    async describe_document({ id, slug }) {
        if (!this.records) {
            await this.__listed_docs();
        }

        var record = null;

        if (id) {
            record = this.records.find(r => r.id === id);
        } else if (slug) {
            record = this.records.find(r => r.fields.Slug[0][r.fields.Slug[0]?.type] === slug);
        }

        if (!record) return null;

        return {
            id: record.id,
            metadata: {
                title: record.fields.Docs?.text,
                link: record.fields.Docs?.link,
                slug: typeof record.fields.Slug === 'string' ? record.fields.Slug : record.fields.Slug[0][record.fields.Slug[0]?.type],
                token: record.fields.Docs?.link.split('/').pop(),
                labels: record.fields.Labels,
                type: record.fields.Type,
                added_since: record.fields['Added Since'],
                last_modified: record.fields['Last Modified At'],
                deprecate_since: record.fields['Deprecate Since'],
                progress: record.fields.Progress,
                keywords: record.fields.Keywords,
                beta: record.fields.Beta,
                notebook: record.fields.Notebook,
                targets: record.fields.Targets,
            },
            parent: record.fields['父记录']?.[0]?.record_ids?.[0] || record.fields['Parent']?.[0]?.record_ids?.[0]
        }
    }

    async get_markdown({ id, slug }) {
        const doc = await this.describe_document({ id, slug });
        if (!doc) return null;

        console.log(`\n1. Fetching document: ${doc.metadata.title} (${doc.metadata.link})`);
        let page_token = doc.metadata.token;
        if (this.source_type === "wiki") page_token = await this.__convert_wiki_token(page_token);

        this.page_blocks = await this.__fetch_doc_blocks(page_token);
        this.page_blocks = await this.__get_reference_syncd_blocks(this.page_blocks);

        if (!this.page_blocks) console.log("Failed to fetch the source") && process.exit(1);

        console.log(`\n2. Converting document to markdown format`);
        const summary = await this.__raw_content(this.page_blocks.find(block => block.block_type === 2).text.elements);
        const front_matters = this.__front_matters(
            doc.metadata.title,
            '',
            doc.metadata.slug,
            doc.metadata.beta,
            doc.metadata.notebook,
            doc.metadata.type,
            doc.metadata.token,
            0,
            doc.metadata.labels,
            doc.metadata.keywords,
            '',
            summary
        )

        let content = `${front_matters}\n\n`;
        content += await this.__markdown(this.page_blocks);
        return content;
    }

    async __raw_content(elements) {
        let paragraph = "";
        for (let element of elements) {
            if ('text_run' in element) {
                paragraph += await this.__text_run(element, elements, true);
            }
            if ('mention_doc' in element) {
                paragraph += await this.__mention_doc(element, true);
            }
        }

        if (this.docs) {
            paragraph = await this.__auto_link(paragraph, this.docs)
        }

        paragraph = this.__filter_content(paragraph, this.targets)

        return paragraph;        
    }

    async __get_reference_syncd_blocks(blocks) {
        const replacements = [];
        const append_blocks = [];

        if (!blocks) throw new Error("No blocks provided");
        
        for (let block of blocks) {
            if (block.block_type === 50 && block.reference_synced) {
                const { source_document_id, source_block_id } = block.reference_synced
                const source_blocks = await this.__fetch_doc_blocks(source_document_id);
                const source_block = source_blocks.find(b => b.block_id == source_block_id)
                if (source_block) {
                    const reference_block_id = block.block_id
                    const parent_id = block.parent_id
                    const replacement_block = { ...source_block, parent_id }
                    const pending_children = [...(source_block.children || [])]
                    const collected_ids = new Set()

                    while (pending_children.length > 0) {
                        const child_id = pending_children.shift()
                        if (collected_ids.has(child_id)) continue
                        const child = source_blocks.find(b => b.block_id == child_id)
                        if (!child) continue
                        collected_ids.add(child_id)
                        append_blocks.push(child)
                        pending_children.push(...(child.children || []))
                    }

                    replacements.push({
                        parent_id,
                        reference_block_id,
                        source_block_id: source_block_id,
                        replacement_block,
                    })

                    // save source document if not already saved
                    console.log(`6. Fetched referenced_synced block ${source_document_id} - ${source_block_id}`)
                }               
            }

        }

        for (let replacement of replacements) {
            const parent = blocks.find(b => b.block_id == replacement.parent_id)
            if (parent) {
                const index = parent.children.findIndex(child => child == replacement.reference_block_id)
                if (index !== -1) {
                    parent.children[index] = replacement.source_block_id
                }
            }
        }

        if (replacements.length > 0) {
            const replacements_by_id = new Map(
                replacements.map(replacement => [replacement.reference_block_id, replacement.replacement_block])
            )
            blocks = blocks.map(block => replacements_by_id.get(block.block_id) || block)
            console.log(`8. Replaced ${replacements.length} reference_synced blocks in the current document`)
        }

        if (append_blocks.length > 0) {
            console.log(`7. Appending ${append_blocks.length} blocks to the current document`)
            blocks = blocks.concat(append_blocks)
        }

        const seen = new Set()
        blocks = blocks.filter(block => {
            if (!block || seen.has(block.block_id)) {
                return false
            }
            seen.add(block.block_id)
            return true
        })

        return blocks;
    } 

    async __fetch_doc_blocks(document_id, page_token=null, blocks=[]) {
        console.log(document_id)
        const token = await this.tokenFetcher.token()
        let document_token = document_id

        if (this.source_type === "wiki") {
            document_token = await this.__convert_wiki_token(document_token)
        }

        let url = `${process.env.FEISHU_HOST}/open-apis/docx/v1/documents/${document_token}/blocks` + (page_token? `?page_token=${page_token}` : "")
        let response = await fetch(url, {
            method: "get",
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${token}`
            }
        });

        let status = response.status;
        let headers = response.headers;
        response = await response.json();

        if (response.code === 0) {
            blocks.push(...response.data.items);
            if (response.data.has_more) {
                await this.__fetch_doc_blocks(document_id, response.data.page_token, blocks);
            }

            return blocks;
        } else if (status == 429) {
            const timeout = headers['x-ogw-ratelimit-reset']
            await this.__wait(timeout * 1000)
            await this.__fetch_doc_blocks(document_id, page_token, blocks)
        } else {
            return null;
        }
    }

    async __convert_wiki_token(page_token) {
        let obj_token = this.tokens.find(token => token.wiki === page_token)?.obj;

        if (!obj_token) {
            const token = await this.tokenFetcher.token()
            let url = `${process.env.FEISHU_HOST}/open-apis/wiki/v2/spaces/get_node?token=${page_token}`
            let response = await fetch(url, {
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Authorization': `Bearer ${token}`
                }
            });
    
            let status = response.status;
            let headers = response.headers;
            response = await response.json();
    
            if (response.code === 0) {
                this.tokens.push({
                    wiki: page_token,
                    obj: response.data.node.obj_token
                });
    
                return response.data.node.obj_token;
            } else if (status === 429) {
                const timeout = headers['x-ogw-ratelimit-reset']
                await this.__wait(timeout * 1000)
                return await this.__convert_wiki_token(page_token)
            } else {
                return page_token;
            }
        } else {
            return obj_token;
        }
    }

    async __wait(duration) {
        return new Promise((resolve, _) => {
            setTimeout(() => {
                resolve()
            }, duration)
        })
    }
}

module.exports = FeishuToMarkdown;
