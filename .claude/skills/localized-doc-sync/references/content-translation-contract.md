# Content Translation Contract

Load this reference for every `NEW`, `UPDATE_CONTENT`, `TARGET_LOCAL_EDIT`, or `TRANSLATION_DIVERGED` content unit.

## Runtime boundary

1. Load `zh-CN-localization-contract.json` with an explicit audience and product profile by calling `loadTranslationContract()` from `src/translation-contract.js`.
2. Call `prepareTranslationContent()` from `src/translation-content.js`. Send the complete protected document as context, but send only its stable semantic units as editable input.
3. Accept only an exact ID-addressed JSON response. `applyTranslationResponse()` restores protected bytes and rejects missing, duplicate, or invented markers. Run `validateLocaleContractUnits()` before model review so mandatory and forbidden terminology is enforced deterministically.
4. Review the source and draft units with `prompts/review-agent.zh-CN.md`. Pass the response through `parseAndAuthorizeReview()` from `src/review-evidence.js`.
5. Send only `authorizedUnitIds` and their validated issues to the Correction Agent. A reviewer allegation is not correction authority.
6. Rebuild the complete target, validate protected bytes and Feishu block structure, then create a new exact action batch.

Never execute a whole-document model response directly. Never reuse approval after content, semantic units, source/target revisions, prompts, locale policy, product profile, audience profile, model, or adapter version changes.

## Receipt identity

Every accepted content write records schema-v2 fields:

- `sourceRevision` and `targetRevision`;
- source, target, metadata, and semantic-unit digests;
- `translationContractDigest` and `promptContractDigest`;
- translator adapter version and model;
- accepted action, decision, and journal lineage.

A changed or missing contract digest is `TRANSLATION_CONTRACT_STALE`, not `NOOP`. `TARGET_LOCAL_EDIT` and `TRANSLATION_DIVERGED` require an explicit preservation or merge decision; never overwrite target-local prose implicitly.
