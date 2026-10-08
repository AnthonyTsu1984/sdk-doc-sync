# Surgical Patch — Hand-Authored apiPatchPlan for Operator-Authored Pages

This contract defines when and how a page lands through a hand-authored surgical `apiPatchPlan` (the UPDATE path) instead of the schema-first regeneration render, and the mechanics its plan must follow to pass the executor's fail-closed chain.

## When This Route Is Mandatory

Route a page through a hand-authored surgical `apiPatchPlan` when the live page's content cannot be reproduced faithfully by the schema-first regeneration render. Signals:

- dense operator-authored `<include target="...">` conditional markers (flat inline markers, or include-wrapped sibling parameter groups — a structure the context params schema cannot express);
- callouts nested inside parameter bullets, or callouts wrapped by include regions;
- any operator-authored structure whose regeneration would delete or rewrite user content beyond the reviewed delta.

The literal-include invariant (`api.literal-include-preserved`) already forbids whole-body rebuilds over marker-bearing content. This reference generalizes the rule: on these pages the plan's desired blocks are **the live blocks plus the reviewed delta** — unchanged content is never regenerated, so fidelity holds by construction. The schema-first artifact still exists (the provider builds it from the reviewed context and it drives the gate preview); disclose in the gate materials that the preview shows the desired shape while the landing is the surgical delta.

## Wiring

Attach the plan to the scope action's `planningContext.apiPatchPlan` — the planning-context resolution prefers the action context, so the planner digests it into the batch (artifact bytes + plan) and the executor dispatches it through `applyApiPatch` → `apply_api_patch`. Keep the artifact carrying `layout` (profile id/version): the layout gates the plan attachment and the post-landing verification.

## Authoring the Plan

1. Fetch the live blocks (`MarkdownToFeishu#get_document_blocks`). The payload is flat: a block's `children` are **ID strings**, and the payload anchors a page block (block_type 1).
2. Rebuild every replacement subtree through an id → block-object map. A child left as an ID string becomes an invalid create payload (`field_violations: children[*].block_type`). Self-validate the result: every node is an object with a numeric `block_type`, no `block_id`/`parent_id` remnants, and no ID-string children anywhere in the tree.
3. New content blocks: clone proven live-page shapes and edit the runs (links live at `text_element_style.link.url`, percent-encoded; italic+link is the parameter-type convention). Do not route insertion content through `parse_markdown` — a fresh parser instance can yield different block counts than the post-fetch instance, and emphasis inside link text renders literal asterisks (put emphasis outside the link: `[*X*](url)`).
4. `desiredRoleSequence` must equal the page's ACTUAL section roles from `buildApiSectionModel` (note: `RETURN TYPE:` is its own `result-type` role — it is not `returns`).
5. `insertAt` values are **post-deletion positions**. The executor deletes first (back-to-front by position), then inserts ascending by `insertAt`; state your values on the post-deletion list and order multi-inserts ascending.
6. `deleteBlockIds` must be **direct page children only**. Deleting a parent cascades its descendants (verified), so a replacement subtree needs only the parent's id in the delete list.

## Executor Safety Chain

- Create-side field validation runs **before** any deletion — a refusal is zero-side-effect.
- `verifyDocument` (section model + layout conformance over the post-patch page) runs **before** the Bitable mutation; a failure triggers `rollbackRevert`, which restores the page to its pre-patch state.
- The record mutates only after both pass. Every failure journal occupies its batch digest slot — re-execution under the same digest requires the operator ruling `RECONCILE_ARCHIVE_FAILED_JOURNAL <review-unit-id> sha256:<journal-semantic-digest>` (verify the semantic digest with `digestSemantic` over the parsed entries, byte-copy the journal to the archive, then remove it from the slot).

## Whole-Page Layout Checks the Plan Must Satisfy

`verifyDocument` runs the section model and layout conformance over the **post-patch page**. Pre-existing page traits trip it exactly like plan defects:

- `PARAM_DESC_REQUIRED` — a parameter bullet without a description (add a description op; source docstrings are the faithful source).
- `SECTION_SEQUENCE_MISMATCH` — `desiredRoleSequence` must be the actual roles, not an assumed list.
- `INTERNAL_NOTE_LEAK` — a bare `Notes` line outside a governed callout. The pageFacts walk follows the real hierarchy through the page block (flat-format aware since 538a285), so callouts nested inside parameter bullets are correctly governed; a genuinely bare Notes line is a content fix.

## Local Simulation Before the Gate

Replicate the executor semantics locally before requesting approval: apply deletions back-to-front, insertions ascending, on a copy of the live block list; then run `buildApiSectionModel` and `checkLayoutConformance` over the predicted flat page (anchor the page block's children to the simulated list). Iterate until the model reports zero errors and conformance reports zero violations — the executor's own verification runs the same checks and fails closed.

## Relationship to Other Paths

- Schema-first regeneration (the default UPDATE render) stays the path for campaign-generated pages whose content the context fully describes.
- REBUILD is whole-body replacement and is refused for marker-bearing content.
- The verified-doc surgical anchor mode (`VERIFIED_DOC_SURGICAL`) is the verified-doc-authoring analogue for pages outside this skill.
