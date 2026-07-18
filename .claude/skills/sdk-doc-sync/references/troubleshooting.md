# SDK Doc Sync Troubleshooting

## Diff Category False Positives

If a changed method is falsely classified as CREATE, verify that the diff engine indexes every existing category prefix. Search all non-Collection prefixes before deciding the record is missing.

## Drive URL Construction

`push_markdown()` may return an empty `wiki_url` for Drive documents. Construct the document URL from `document_id` using the configured Feishu tenant host before updating the bitable.

## Code Block Updates

Feishu does not support `replace_code` in `batch_update`. Update code block content with `update_text_elements` on the code block's elements.

## Nested Child Insertion

The Docx children API rejects new blocks containing nested `children` inline. Insert the parent, capture its block ID, then insert children in a second request.

## Environment Loading

If a helper reports that only absolute URLs are supported, confirm where it loads `.env` and ensure `FEISHU_HOST`, `APP_ID`, and `APP_SECRET` are available without printing their values.

## Shared Tokens Across Versions

When multiple version bitables reference one document token, never patch that token for a newer release. Create or copy a target-version document and repoint only the newer record.

## Flattened Markdown Lists

Markdown export can flatten correct Docx parent/child list structures. Inspect live blocks before repairing a page solely because its export appears joined.

## Stale Module Folder Links

Treat canonical version-root mappings as authoritative. If a Module or VirtualNode link points outside the target version root, create or resolve the correct folder and update the record in the same approved run.

## Broad Repair Noise

When post-write dry-runs find unrelated issues, scope repair utilities to the current document titles. Report pre-existing findings separately rather than silently modifying them.
