'use strict';

const { documentTokenFromLink } = require('./inheritance-evidence');

function recordFields(record) {
  return record?.fields || record?.data?.record?.fields || {};
}

function recordIdOf(record) {
  return record?.record_id || record?.recordId || record?.id || record?.data?.record?.record_id || null;
}

function docsLinkOf(record) {
  const docs = recordFields(record).Docs;
  if (Array.isArray(docs)) {
    const first = docs[0] || {};
    return first.link || first.url || null;
  }
  return docs?.link || docs?.url || null;
}

// Maps raw Bitable records to the {recordId, documentToken} pairs a track
// enumeration needs. VirtualNode records point at /drive/folder/ links and
// therefore never resolve to a document token.
function bitableRecordTokens(records) {
  const entries = [];
  for (const record of records || []) {
    const id = recordIdOf(record);
    const documentToken = documentTokenFromLink(docsLinkOf(record));
    if (id && documentToken) entries.push({ recordId: id, documentToken });
  }
  return entries;
}

// Live cross-track token reference reader. Every track must be enumerated on
// each call: the executor uses this immediately before a mutation to compare
// the live reference set with the approved inheritance evidence, so cached or
// partial enumeration would silently weaken the guard.
function createTokenReferenceReader({ tracks }) {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new TypeError('createTokenReferenceReader requires at least one track');
  }
  for (const track of tracks) {
    if (typeof track?.listDocumentTokens !== 'function') {
      throw new TypeError('each track must expose listDocumentTokens()');
    }
  }
  const frozenTracks = tracks.map((track) => ({
    version: track.version || null,
    baseToken: track.baseToken || null,
    listDocumentTokens: track.listDocumentTokens,
  }));
  return {
    tracks: Object.freeze(frozenTracks.map((track) => ({ version: track.version, baseToken: track.baseToken }))),
    async listTokenReferences({ documentToken } = {}) {
      if (typeof documentToken !== 'string' || documentToken.length === 0) {
        throw new TypeError('listTokenReferences requires a documentToken');
      }
      const references = [];
      for (const track of frozenTracks) {
        for (const entry of await track.listDocumentTokens()) {
          if (entry?.documentToken === documentToken && entry?.recordId) {
            references.push({
              recordId: entry.recordId,
              version: track.version,
              baseToken: track.baseToken,
            });
          }
        }
      }
      return references;
    },
  };
}

module.exports = {
  bitableRecordTokens,
  createTokenReferenceReader,
};
