# Bitable Organization And Language Layout Sampling

Use this reference before grouping, creating, reparenting, or regenerating SDK API-reference records.

## Separate The Three Structures

Never collapse these into one concept:

1. **Bitable navigation:** `Type` and `父记录` determine the API-reference hierarchy.
2. **Document resource:** `Docs` points to a `docx` landing/content page or, for a structural record, a Drive folder.
3. **Drive placement:** the physical release/category folder that contains a document token.

A `Class` record normally points to a Docx landing page. It may be the `父记录` of public method `Function` records without becoming a `VirtualNode`. This says nothing by itself about physical placement: a language profile may require a same-named Drive folder containing the landing page and method pages. Use `VirtualNode` or `Module` only for a real Bitable navigational directory or module layer established by that SDK.

## Bitable Audit Contract

Before deciding a hierarchy:

1. Resolve the exact version Base and table IDs.
2. Read the field schema, then paginate records until `has_more=false`.
3. Capture at minimum `Docs`, `Type`, `父记录`, `Slug`, `Description`, `Added Since`, `Targets`, and `Progress`.
4. Resolve every parent ID to its title and type; report missing parents, roots, record-type counts, resource types, and every parent-child type pair.
5. Inspect all Class records and their complete child inventories. A first page or a few known records cannot support a global hierarchy conclusion.
6. Treat the current Bitable as evidence of present state, not automatically as the desired rule. A flat legacy tree may itself be the structure that a reviewed sync must repair.

## Language-Specific Layout Sampling

Bitable organization is shared infrastructure, but page bodies are language-specific. Before writing for a language or a materially new interface kind, read representative live documents from that same SDK.

Sample every applicable profile:

- ordinary function or method;
- no-request function;
- complex or multi-shape request;
- SDK-owned structured return;
- class landing or constructor page;
- public class method page;
- enum;
- input/config/schema type;
- output/result/entity type;
- module-level function or constructor/factory function.

For every sample, retain the document token, revision, parent record, headings, fixed labels, code-block languages, callouts, lists, tables, and links. Record both the observed structure and the decision about whether it is canonical, an allowed variant, or legacy debt.

Do not transfer a body template across languages merely because the Bitable relationship looks similar. For example, a Python Class landing page may retain Members while its methods have child pages; a Node.js class landing page may be constructor-focused; a Go entity page may be field-only; and a C++ method page may embed request/result helper types instead of creating child records.

## Class Grouping Decision

When a public class owns callable public methods:

1. Verify the language profile and comparable existing classes.
2. Build the complete constructor and public-method inventory from the pinned source.
3. Decide whether methods are child records, embedded members, or not independently documented for that language.
4. If child records are established, keep the Class record as the Docx landing page and set each method record's `父记录` to that Class record.
5. Resolve the language-specific physical placement. If the profile uses a class directory, create or reuse the same-named Drive folder and place the landing Docx plus all method Docx pages inside it.
6. Review the class folder, landing page, every child identity, and all parent changes as one grouping decision before write approval.

### Deterministic Stateful-Class Contract

Do not leave an approved stateful-class grouping only in prose. The scanner and identity map must expose the class landing identity and each independently documented public method as separate symbols. The reviewed candidate spec must then include one `organizations[]` entry using the versioned `node-stateful-class` profile (or the applicable future language profile).

The contract records, and the validator enforces:

- the landing record is `Class`, its `Docs` resource is `docx`, and it is not a `VirtualNode`;
- the class parent is the reviewed module/category record;
- the Drive layout is `same_named_class_folder`, with the landing and every method Docx inside it;
- the source-derived public-method inventory is complete and exactly matches the declared child methods;
- every child record is `Function` and targets the Class record as `父记录`;
- no same-named VirtualNode resource is planned for the class.

The public-method list must come from the target revision scanner output, not from the reviewed contract itself. Carry the resulting `organizationInventory` and `inventoryDigest` through release scope, reviewed context, immutable plan, and approval artifact. Both the reviewed-context builder and planner validate the contract against that source inventory so a caller cannot omit methods while claiming the list is complete.

Set `groupingChange: true` when the run creates or repairs the Class-to-method hierarchy; that mode requires the Class action and the complete method action inventory in one reviewed batch. Set `groupingChange: false` for a later content-only update to an already verified member; the contract still carries the complete inventory, but the action batch may contain only the touched member.

`build-reviewed-release-context.js` fails closed with stable codes such as `ORGANIZATION_REVIEW_REQUIRED`, `METHOD_INVENTORY_INCOMPLETE`, `CLASS_FOLDER_TARGET_MISMATCH`, and `METHOD_PARENT_TARGET_MISMATCH`. `sync-planner.js` binds the reviewed organization object into every immutable plan and adds a `TARGET_RECORD_TYPE` postcondition.

If an inherited Docx body is unchanged and only the Bitable hierarchy is wrong, plan `UPDATE_RECORD_METADATA`. This action preserves the existing Docx token, creates no copy, applies no content patch, and verifies the resulting link, parent, record type, and `docx` resource type. A content delta must still use the version-aware copy/patch flow.

## Durable Evidence Manifest

Before an organization rule can gate approval, retain a small tracked evidence manifest under `references/evidence/`. It must include:

- SDK and release track, exact Base token and table ID;
- current and inherited release/category folder tokens;
- representative record IDs, titles, Types, parent IDs, and Docs tokens;
- Docx revisions and stable content hashes;
- collection timestamp, actual verified identity, and read-only replay commands using that identity;
- observed legacy state separately from the required target contract.

The manifest is durable decision evidence, not a full scan cache. Large record dumps, dry-runs, candidate artifacts, and temporary structure studies remain rebuildable and untracked.

## Cross-Release Placement Audit

Use [versioning.md](versioning.md) for mutation behavior. For evidence collection:

1. Resolve the actual release folder. Some configured Drive tokens are SDK containers with version-named child folders, not the release folder itself.
2. Compare adjacent complete Bitables by canonical slug or reviewed stable identity.
3. Compare `Docs` tokens before comparing folder paths. The same token proves document inheritance even if the current Bitable parent changed.
4. Recursively inventory both actual release folders and map every document token to its physical path.
5. Classify matched records as unchanged inherited token, current-release local token, repointed older/external token, newly added, or removed.
6. Do not create duplicates merely because a complete current-version Bitable points to documents outside the sparse current-version folder.

Store one-run counts, examples, tokens, and dated conclusions under the run root. Keep only durable decision rules in this reference and the per-language profiles.
