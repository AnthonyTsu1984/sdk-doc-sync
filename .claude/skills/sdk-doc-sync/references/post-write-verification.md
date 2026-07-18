# SDK Documentation Post-Write Verification

Use these checks after document creation, a full rewrite, category movement, or version migration.

## Document Checks

1. Refetch the live Docx blocks rather than trusting the local Markdown draft.
2. Verify exactly one title/H1 and no duplicated old fragments.
3. Verify request syntax, parameters, builder methods, returns, exceptions, examples, and response types remain in their normal sections.
4. Confirm code block languages and visible line breaks.
5. For list-sensitive pages, inspect the block tree. Markdown export may flatten correct parent/child list blocks.

Builder signatures, typed return fields, and exception labels must not be joined to their descriptions in one rendered text run.

## Record And Folder Checks

1. Use `bitable-show` to verify `Docs.link`, `父记录`, type, version metadata, `Targets`, and `Progress`.
2. For every edited record, verify `Targets` is blank and `Progress` is `WIP`.
3. Use `list-folder` to verify the target document exists under the intended canonical version folder.
4. When moving a version-local document, verify it is absent from the old folder.
5. When copying across versions, verify the older snapshot still exists and remains unchanged.
6. After creating a category folder, update the matching VirtualNode or Module record so its `Docs` field contains the folder URL.

## Repair Utilities

Always run broad repair tools in dry-run mode first and scope them to touched documents when possible.

```bash
node .claude/skills/sdk-doc-sync/scripts/fix-leading-spaces.js --bitable <token> --dry-run
node .claude/skills/sdk-doc-sync/scripts/add-type-links.js --bitable <token> --title <touched-title> --dry-run
node .claude/skills/sdk-doc-sync/scripts/post-fix-links.js --bitable <token> --dry-run
```

- `fix-leading-spaces.js` reports text runs with unwanted leading indentation.
- `add-type-links.js` adds exact Class/Enum references while skipping code and self-links.
- `post-fix-links.js` reports links to deleted document tokens and repairs them only when title matching is unambiguous.

For C++ pointer aliases such as `XxxPtr`, use `cpp-add-ptr-type-links.js` after the general type-link pass.

## Completion Evidence

Record the commands, document IDs, record IDs, folder tokens, counts, and unresolved findings in the final report. Do not report a successful migration based only on a generated URL or local Markdown file.
