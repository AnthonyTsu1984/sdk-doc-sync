'use strict';

class DocxReaderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DocxReaderError';
    this.code = code;
  }
}

class DocxReader {
  constructor({ client, sourceType = 'drive' }) {
    if (!client || typeof client !== 'object') {
      throw new TypeError('DocxReader requires a client');
    }
    if (!['drive', 'wiki'].includes(sourceType)) {
      throw new TypeError('DocxReader sourceType must be drive or wiki');
    }
    this.client = client;
    this.sourceType = sourceType;
  }

  async resolveWikiToken(token) {
    if (this.sourceType === 'drive') return token;
    const query = new URLSearchParams({ token });
    const envelope = await this.client.request({
      path: `/open-apis/wiki/v2/spaces/get_node?${query}`,
    });
    const documentToken = envelope?.data?.node?.obj_token;
    if (typeof documentToken !== 'string' || documentToken === '') {
      throw new DocxReaderError(
        'DOCX_WIKI_TOKEN_INVALID',
        `Wiki token ${token} did not resolve to a document token`,
      );
    }
    return documentToken;
  }

  async readBlocks(documentToken) {
    const resolvedToken = await this.resolveWikiToken(documentToken);
    return this._readDocumentBlocks(resolvedToken);
  }

  async _readDocumentBlocks(documentToken) {
    if (typeof this.client.paginate !== 'function') {
      throw new TypeError('DocxReader client must provide paginate() to read blocks');
    }
    return this.client.paginate({
      path: `/open-apis/docx/v1/documents/${encodeURIComponent(documentToken)}/blocks?page_size=500`,
    });
  }

  async expandReferences(blocks) {
    if (!Array.isArray(blocks)) {
      throw new TypeError('DocxReader expandReferences requires an array of blocks');
    }

    const context = {
      documents: new Map(),
      targets: new Map(),
      rootParents: new Map(),
    };
    const replacements = new Map();
    const available = new Map();
    const descendants = [];
    const output = [];
    const emitted = new Set();

    for (const original of blocks) {
      if (!this._isReference(original)) {
        const clone = this._cloneBlock(original);
        if (!emitted.has(clone.block_id)) {
          output.push(clone);
          emitted.add(clone.block_id);
        }
        continue;
      }

      const materialized = await this._materializeReference(original, context, []);
      const rootId = materialized[0].block_id;
      replacements.set(original.block_id, rootId);
      for (const block of materialized) {
        if (!available.has(block.block_id)) available.set(block.block_id, block);
      }

      const root = available.get(rootId);
      if (!emitted.has(rootId)) {
        output.push(root);
        emitted.add(rootId);
      }
      descendants.push(...materialized.slice(1));
    }

    for (const block of descendants) {
      const canonical = available.get(block.block_id) || block;
      if (!emitted.has(canonical.block_id)) {
        output.push(canonical);
        emitted.add(canonical.block_id);
      }
    }

    const replacementRoots = new Set(replacements.values());
    for (const block of output) {
      if (Array.isArray(block.children)) {
        const seenReplacementRoots = new Set();
        block.children = block.children
          .map((id) => replacements.get(id) || id)
          .filter((id) => {
            if (!replacementRoots.has(id)) return true;
            if (seenReplacementRoots.has(id)) return false;
            seenReplacementRoots.add(id);
            return true;
          });
      }
    }
    return output;
  }

  async _materializeReference(reference, context, stack) {
    const source = reference.reference_synced;
    const documentId = source?.source_document_id;
    const blockId = source?.source_block_id;
    if (typeof documentId !== 'string' || !documentId || typeof blockId !== 'string' || !blockId) {
      throw new DocxReaderError(
        'DOCX_REFERENCE_INVALID',
        `Reference block ${reference?.block_id || '(unknown)'} is missing source document or block IDs`,
      );
    }

    const materialized = await this._materializeTarget(documentId, blockId, context, stack);
    const clones = materialized.map((block) => this._cloneBlock(block));
    const rootId = clones[0].block_id;
    const parentId = reference.parent_id;
    if (context.rootParents.has(rootId) && context.rootParents.get(rootId) !== parentId) {
      throw new DocxReaderError(
        'DOCX_REFERENCE_MULTI_PARENT',
        `Materialized reference root ${rootId} cannot be attached to both ${context.rootParents.get(rootId)} and ${parentId}`,
      );
    }
    context.rootParents.set(rootId, parentId);
    clones[0].parent_id = parentId;
    return clones;
  }

  async _materializeTarget(documentId, blockId, context, stack) {
    const key = `${documentId}:${blockId}`;
    if (stack.includes(key)) {
      throw new DocxReaderError(
        'DOCX_REFERENCE_CYCLE',
        `Reference cycle detected: ${[...stack, key].join(' -> ')}`,
      );
    }
    if (context.targets.has(key)) return context.targets.get(key);

    const promise = (async () => {
      const blocks = await this._loadDocument(documentId, context);
      const byId = new Map(blocks.map((block) => [block.block_id, block]));
      const target = byId.get(blockId);
      if (!target) {
        throw new DocxReaderError(
          'DOCX_REFERENCE_NOT_FOUND',
          `Referenced block ${blockId} was not found in document ${documentId}`,
        );
      }

      const nextStack = [...stack, key];
      if (this._isReference(target)) {
        return this._materializeReference(target, context, nextStack);
      }

      const collected = [];
      const visited = new Set();
      const visit = async (currentId) => {
        if (visited.has(currentId)) return currentId;
        const current = byId.get(currentId);
        if (!current) return currentId;
        visited.add(currentId);

        if (this._isReference(current)) {
          const nested = await this._materializeReference(current, context, nextStack);
          collected.push(...nested);
          return nested[0].block_id;
        }

        const clone = this._cloneBlock(current);
        collected.push(clone);
        if (Array.isArray(clone.children)) {
          const childIds = [];
          for (const childId of clone.children) childIds.push(await visit(childId));
          clone.children = childIds;
        }
        return clone.block_id;
      };

      await visit(blockId);
      const unique = [];
      const seen = new Set();
      for (const block of collected) {
        if (!seen.has(block.block_id)) {
          unique.push(block);
          seen.add(block.block_id);
        }
      }
      return unique;
    })();

    context.targets.set(key, promise);
    try {
      return await promise;
    } catch (error) {
      context.targets.delete(key);
      throw error;
    }
  }

  async _loadDocument(documentId, context) {
    if (!context.documents.has(documentId)) {
      context.documents.set(documentId, Promise.resolve(this._readDocumentBlocks(documentId)));
    }
    return context.documents.get(documentId);
  }

  _isReference(block) {
    return block?.block_type === 50 && block.reference_synced;
  }

  _cloneBlock(block) {
    if (Array.isArray(block)) return block.map((value) => this._cloneBlock(value));
    if (!block || typeof block !== 'object') return block;
    return Object.fromEntries(
      Object.entries(block).map(([key, value]) => [key, this._cloneBlock(value)]),
    );
  }
}

module.exports = DocxReader;
module.exports.DocxReader = DocxReader;
module.exports.DocxReaderError = DocxReaderError;
