# Wiki Sync Mapping

`wiki-node-map.json` is the canonical mapping file for syncing content from `Cloud Docs` to `Cloud Docs (Redesign)`.

Use it to derive cross-reference replacements before each section sync:

- `source.node_token` -> `target.node_token`
- `source.obj_token` -> `target.obj_token`

After syncing a section, append any new mappings and scan synced target docs for remaining source tokens from this file.

## Embed Block Repair

The XML overwrite path can drop readonly embed blocks, leaving an empty target paragraph where the embed should be. Run the embed repair utility after a content sync to detect and restore those blocks.

Dry-run report:

```bash
node sync/embed-block-sync.mjs --section "Development"
```

Dry-run with raw source block probes for payload validation:

```bash
node sync/embed-block-sync.mjs --section "Development" --probeRaw
```

Apply repairs:

```bash
node sync/embed-block-sync.mjs --section "Development" --apply
```

The utility currently handles:

- Figma iframe blocks: iframe component type `8`
- Supademo custom add-on blocks: block type ID `blk_682093ba9580c002363b9dc3`

The default mode only writes a report to `tmp/wiki-sync/embed-block-sync-report.json`. The `--apply` mode deletes the empty placeholder paragraph in the target doc, recreates the missing embed at the same top-level index through the Docx block API, and preserves cross-reference token replacements from `wiki-node-map.json`.
