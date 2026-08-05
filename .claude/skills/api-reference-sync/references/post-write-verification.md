# SDK Documentation Post-Write Verification

Use these checks after document creation, a full rewrite, category movement, or version migration.

## Document Checks

1. Refetch the live Docx blocks rather than trusting the local Markdown draft.
2. Verify the title exists only as Feishu document metadata; the API-reference body contains no H1 and no duplicated old fragments.
3. Verify request syntax, parameters, builder methods, returns, exceptions, examples, and response types remain in their normal sections.
4. Confirm code block languages and visible line breaks.
5. For list-sensitive pages, inspect the block tree. Markdown export may flatten correct parent/child list blocks.
6. Rebuild the live semantic section model and verify its role sequence, signature cardinality, code fences, and preserved rich block IDs against the approved language profile and patch plan.
7. For Java builder lists, verify each bullet's own text contains only the inline-code signature and each description is a child paragraph block. Markdown export may concatenate them visually and is not sufficient evidence.
8. For Java prose, inspect rich-text runs to confirm SDK identifiers and literal values use inline code, canonical type references link to the exact current/owning document when available, and user-significant numeric defaults or limits are bold. Carry every resolved canonical reference into the operational manifest as a `linkedInlineCodeRequirements` entry so the harness verifies the exact text, link, and inline-code style together. The harness also rejects linked API identifiers without inline-code styling even if the declared inventory is incomplete.
9. For each unlinked Java type reference, verify the execution evidence records a canonical lookup result of `no exact target`; absence of a lookup is a blocker.
10. For platform-specific Java builder methods, verify the signature and all associated prose/examples are inside the same audience region so no platform-only signature leaks into another target.

Builder signatures, typed return fields, and exception labels must not be joined to their descriptions in one rendered text run.

Failure patterns that must block completion:

- visible backslash escapes in identifiers, for example `dump\_messages`;
- visible internal workflow text, for example `Reviewed grouping approved`;
- generic generated content, for example `Return value for <symbol>`;
- extra `Notes` sections added only to carry internal release context;
- changed inherited docs still pointing to older version folders after execution;
- bot/API fetch succeeds but human-visible access is unverified;
- the execution journal lacks a result for any approved action or lacks its completion sentinel;
- a Java page contains a nested `Java example` heading beneath `Example`;
- a linked Java identifier renders with literal backticks, lacks the inline-code rich-text style, or loses its canonical link;
- an embedded helper identity still has a standalone Bitable record or document.

## Record And Folder Checks

1. Use `bitable-show` to verify `Docs.link`, `父记录`, type, version metadata, `Targets`, and `Progress`.
2. For every edited interface-document record, verify `Targets` is blank and `Progress` is `WIP`. For structural VirtualNode or Module records, verify the approved structural metadata instead: repoints preserve existing `Targets`, `Progress`, `Slug`, and type; creates match the explicit resource-plan values.
3. Use `list-folder` to verify the target document exists under the intended canonical version folder.
4. When moving a version-local document, verify it is absent from the old folder.
5. When copying across versions, verify the older snapshot still exists and remains unchanged.
6. After creating a category folder, update the matching VirtualNode or Module record so its `Docs` field contains the folder URL.

## Acceptance Finalization

Post-write verification ends with touched records at `WIP` and `scanStateUpdated: false`. After the user explicitly accepts all touched documentation:

1. Update every touched record from `Progress: WIP` to `Progress: Draft` without changing unrelated fields.
2. Refetch every record and verify the exact `Draft` value.
3. Record `userConfirmed: true` and one verified `WIP` to `Draft` transition per touched record in the operational manifest.
4. Update `scan-state.json` only after all transitions pass. If acceptance is partial or any record is not verified as `Draft`, leave scan state unchanged.
5. Run the operational harness again. `ACCEPTANCE_NOT_CONFIRMED`, `MISSING_DRAFT_ACCEPTANCE_EVIDENCE`, or `ACCEPTED_SCAN_STATE_NOT_UPDATED` blocks final completion.

## Repair Utilities

Always run broad repair tools in dry-run mode first and scope them to touched documents when possible.

```bash
node .claude/skills/api-reference-sync/scripts/fix-leading-spaces.js --bitable <token> --dry-run
node .claude/skills/api-reference-sync/scripts/add-type-links.js --bitable <token> --title <touched-title> --dry-run
node .claude/skills/api-reference-sync/scripts/post-fix-links.js --bitable <token> --dry-run
```

- `fix-leading-spaces.js` reports text runs with unwanted leading indentation.
- `add-type-links.js` adds exact Class/Enum references while skipping code and self-links.
- `post-fix-links.js` reports links to deleted document tokens and repairs them only when title matching is unambiguous.

For C++ pointer aliases such as `XxxPtr`, use `cpp-add-ptr-type-links.js` after the general type-link pass.

## Completion Evidence

Run the operational harness against the run-local manifest before declaring completion:

```bash
node .claude/skills/api-reference-sync/scripts/verify-operational-harness.js \
  --manifest tmp/sdk-doc-sync-runs/<language>-<track>/<run-id>/operational-manifest.json
```

Any finding blocks completion. Set the manifest `language` explicitly. The manifest must include the approved-action journal and completion sentinel, canonical tenant host and folder evidence, explicit human-visible access evidence, and—when `language` is `java`—one refetched Java post-write block entry for every document token in `publicationAccess`, plus applicable embedded-helper ownership/standalone-record results.

Record the commands, document IDs, record IDs, folder tokens, counts, and unresolved findings in the final report. Do not report a successful migration based only on a generated URL or local Markdown file.
