# Localized Doc Sync Full-Scan and Review Design

## Objective

Define the second-stage operating model for `localized-doc-sync`: dynamically discover both Bases, construct valid English-Chinese translation work from live table and record structure, produce a complete issue queue, process issues individually under exact approval, and finish only after a fresh full scan.

This design assumes table count, table names, field schemas, record counts, hierarchy, and locale-specific applicability can change between runs. Static references provide reviewed policy but never prove current completeness.

## Scope

The workflow covers:

- complete source and target Base discovery;
- dynamic table mapping;
- active-field schema validation;
- placement-aware record identity;
- English-Chinese canonical translation pairs;
- locale-specific metadata and hierarchy;
- internal and external link records;
- validation-only ref records;
- immutable issue planning;
- per-unit approval, execution, acceptance, rollback, and reconciliation;
- final full-Base verification.

It does not align the hidden legacy `Chapter` fields, infer Chinese product applicability from English metadata, or create a second translation-pair concept for ref rows.

## Terminology

### Translation pair

A translation pair contains:

- `translation source`: the English document or record;
- `translation target`: the corresponding Chinese document or record.

For document content, only canonical documents form executable translation pairs.

### Reference source

A reference source is the object a `ref` record points to in the current locale.

- An English ref points to the English member of an existing translation pair.
- A Chinese ref points to the Chinese member of the same translation pair.

The ref record does not create another translation pair and does not create a review unit. If a referenced Chinese member is absent or outdated, work belongs to the underlying canonical translation pair.

### Locale source meta

Metadata is owned by the source for that locale. English metadata is validated against the English source; Chinese metadata is validated against the Chinese source. Cross-language inequality is not itself drift.

### Scan epoch

A scan epoch is one immutable full discovery result. It binds Base revisions, inventories, schemas, records, mappings, policies, and issues under one semantic digest.

## Placement Contract

| Placement Type | Slug | Targets | Content work | Identity | Processing behavior |
| --- | --- | --- | --- | --- | --- |
| `canonical` | required | required | yes | `canonical:<slug>` | Forms a translation pair and may produce content, metadata, hierarchy, or publication work. |
| `section` | required | absent | no | `section:<slug>` | Structural record; may pair across locales without requiring identical Parent. |
| `link` | absent | absent | no | typed link target | Validate or reconcile link metadata; never create a translated document. |
| `ref` | absent | absent | no | underlying translation-pair member | Validation-only no-op when it points to the correct locale member. |

The same Slug may validly appear once as `section` and once as `canonical`. Duplicate identity is an error only within the same placement-derived identity namespace.

## Link Contract

Classify `Ref Target Doc` before matching:

| Prefix | Kind | Stable identity |
| --- | --- | --- |
| `/` | internal-site link | `link:internal:<path>` |
| `http` | external link | `link:external:<url>` |
| anything else | unsupported | `LINK_TARGET_INVALID` |

Internal paths and external URLs are semantic values. Normalization may remove representational noise but must not drop path segments, query parameters, fragments, hostnames, or protocol differences that can change routing.

## Metadata Ownership

`Targets` is publication-critical and exists only on canonical records. Chinese publication scope is determined by the Chinese locale source and reviewed Chinese applicability policy, not by blindly copying English values.

The following fields follow the source for their own locale:

- `Labels`
- `Keywords`
- `Progress`
- `Notebook`
- `Beta`
- `Book`
- `Alias1`
- `Alias2`

`Docs` preserves the locale-specific document or display link. A Chinese record must not receive an English document URL.

`Parent` follows the hierarchy of its own locale. English and Chinese Parent are allowed to differ.

Hidden unconfigured fields, including the current Chinese `Chapter` fields, are inventory-only. They do not participate in comparison, approval, or writes.

## End-to-End State Flow

```text
DISCOVER_BASES
  -> PROFILE_SCHEMAS
  -> MAP_TABLES
  -> RESOLVE_IDENTITIES
  -> BUILD_TRANSLATION_PAIRS
  -> CLASSIFY_ISSUES
  -> QUEUE_READY | DISCOVERY_BLOCKED
  -> PREPARE_REVIEW_UNIT
  -> APPROVED
  -> EXECUTED
  -> ACCEPTED | CHANGES_REQUESTED | ROLLED_BACK
  -> RESCAN_AFFECTED_SCOPE
  -> QUEUE_READY
  -> FINAL_FULL_SCAN
  -> FINAL_CONFIRMATION
  -> FINALIZED
```

No partial-table or pasted-view scan may enter `FINAL_CONFIRMATION`.

## Phase 1: Dynamic Discovery

For both Bases, fetch and canonicalize:

1. Base token, title, revision, and timezone.
2. Complete table inventory.
3. Table ID, name, and primary field.
4. Complete field schema.
5. Complete view inventory and active filters/sorts.
6. Complete record count and record projection.

The scanner must not:

- select the first table by default;
- treat a configured table list as complete;
- infer full coverage from one view;
- ignore source-only or target-only tables;
- hardcode the current 9-to-8 inventory or 16-field schema.

Each inventory entry receives a stable digest. A new, removed, renamed, split, merged, or recreated table appears as a mapping issue.

## Phase 2: Active Schema Profiling

Resolve configured business roles from live fields:

- placement;
- slug;
- docs;
- ref target;
- targets;
- parent;
- locale-owned metadata fields.

Profile hidden fields for audit completeness but only enforce configured active roles.

Blocking schema conditions include:

- missing Placement Type;
- missing Slug capability for canonical or section records;
- missing or incompatible Targets capability for canonical records;
- broken Parent self-link configuration when hierarchy is in scope;
- ambiguous field-role resolution;
- a filtered view being mistaken for the full table.

Option drift is evaluated by business effect. An unused option is not automatically a blocker; an invalid option currently used by a canonical `Targets` value is publication-blocking.

## Phase 3: Dynamic Table Mapping

Map every discovered table using one of:

- `mapped`;
- `source-only`;
- `target-only`;
- `split`;
- `merged`;
- `ignored-by-policy`;
- `unresolved`.

Stable table IDs identify a table within the current Base. Names support human review but are not sufficient identity after recreation.

An unmapped table creates one table-level issue first. Record-level `NEW` work must not be generated until the table decision establishes whether the table is mapped, split, merged, intentionally source-only, or ignored.

The current Deployment table is an instance of this generic mechanism. Its 20 records must not become 20 translation tasks before the table-level policy is resolved.

## Phase 4: Placement-Aware Identity

### Canonical

Pair English and Chinese canonical records by `canonical:<slug>` plus configured table mapping. Missing or duplicate canonical Slug blocks that identity.

### Section

Pair section records by `section:<slug>`. Section and canonical records may share the same Slug. Section pairing does not require the same Parent path across locales.

### Link

Pair link records by typed internal path or external URL. Link metadata may be localized, but the link target identity must remain semantically correct.

### Ref

Do not pair ref rows as independent translation work. Resolve the referenced object to an existing canonical translation pair and confirm:

- English ref points to the English member;
- Chinese ref points to the Chinese member.

A valid ref becomes `NOOP`. A missing or outdated member creates or reopens work on the underlying canonical translation pair.

## Phase 5: Hierarchy Resolution

Build separate English and Chinese hierarchy graphs from Parent links.

Validate within each locale:

- Parent exists;
- no self-parent;
- no cycle;
- parent placement is allowed;
- every child can be processed after its required parent.

Cross-locale Parent equality is not required. A reviewed locale policy may map one English parent subtree to a different Chinese parent subtree.

Hierarchy processing order is computed from the target graph and planned changes:

1. target parent section or canonical parent;
2. target child canonical record/document;
3. link metadata under the resolved target parent;
4. ref validation after the underlying canonical pair is available.

## Phase 6: Translation Provenance and Content Change Detection

Do not use absent or unreliable Bitable date fields to infer content freshness. Every accepted canonical translation pair needs a durable translation receipt containing:

```json
{
  "schemaVersion": 1,
  "translationPairId": "translation-pair:<table-map>:<slug>",
  "englishDocumentIdentity": {},
  "chineseDocumentIdentity": {},
  "englishSourceDigest": "sha256:...",
  "chineseTargetDigest": "sha256:...",
  "englishMetaDigest": "sha256:...",
  "chineseMetaDigest": "sha256:...",
  "acceptedExecutionJournalDigest": "sha256:...",
  "acceptedDecisionDigest": "sha256:..."
}
```

Normalize both documents through the same structural representation used by the round-trip guard. Digests must include visible prose and protected structural/media identity while excluding runtime timestamps and request IDs.

Compare live state with the latest accepted receipt:

| English source | Chinese target | Classification |
| --- | --- | --- |
| unchanged | unchanged | `NOOP` |
| changed | unchanged | `UPDATE_CONTENT` |
| unchanged | changed | `TARGET_LOCAL_EDIT` |
| changed | changed | `TRANSLATION_DIVERGED` |
| no accepted receipt | any | `TRANSLATION_BASELINE_REQUIRED` |

`TARGET_LOCAL_EDIT` must preserve the Chinese edit and request review; it is not permission to overwrite from English. `TRANSLATION_DIVERGED` requires a reviewed merge or retranslation plan that binds both live digests.

For pre-existing pairs without receipts, the first managed run cannot claim that content is current. It must either:

- create an accepted no-write baseline after reviewing the current pair; or
- create a content update unit and establish the first receipt after acceptance.

Baseline acceptance may be batched only when the batch exposes every pair identity and both content digests and the user explicitly accepts current content as the starting point. It does not authorize document mutation.

## Phase 7: Issue Classification

### Discovery blockers

- `UNMAPPED_TABLE`
- `TABLE_MISSING`
- `SCHEMA_DRIFT`
- `PLACEMENT_METADATA_INVALID`
- `IDENTITY_AMBIGUOUS`
- `LINK_TARGET_INVALID`
- `HIERARCHY_UNRESOLVED`

These issues prevent executable units for their affected scope but do not stop scanning unrelated tables.

### Executable work

- `NEW`
- `UPDATE_CONTENT`
- `TARGET_LOCAL_EDIT`
- `TRANSLATION_DIVERGED`
- `TRANSLATION_BASELINE_REQUIRED`
- `LOCAL_META_DRIFT`
- `META_ONLY`
- `PUBLICATION_SCOPE_MISMATCH`
- target hierarchy change
- approved link metadata change

### Policy decisions

- `SOURCE_ONLY_TABLE`
- `TARGET_ONLY`
- `POLICY_EXCLUDED`
- `LOCALE_EQUIVALENT`
- split or merged table decision

### No-op validation

- aligned canonical pair;
- aligned section pair;
- valid link;
- valid ref;
- empty mapped table pair.

Each issue has a stable ID derived from scan epoch, table mapping, placement identity, issue class, and relevant semantic values.

## Phase 8: Queue Ordering

Order issues by dependency rather than discovery position:

1. table mapping and active schema blockers;
2. identity and locale-policy decisions;
3. required target parents and sections;
4. canonical translation baselines, updates, local edits, and divergences;
5. canonical publication-scope metadata;
6. other locale-owned metadata;
7. link validation or metadata;
8. target-only decisions;
9. ref validation;
10. final reconciliation issues.

The user sees the complete queue before the first write. Processing remains one issue or one approved homogeneous metadata batch at a time.

## Scan Manifest

The immutable scan manifest contains:

```json
{
  "schemaVersion": 1,
  "scanEpochId": "scan:localized-doc-sync:<digest-prefix>",
  "sourceBase": {},
  "targetBase": {},
  "inventoryDigest": "sha256:...",
  "schemaDigest": "sha256:...",
  "recordSetDigest": "sha256:...",
  "tableMappings": [],
  "placementIdentities": [],
  "translationPairs": [],
  "translationReceiptDigests": [],
  "hierarchyPolicies": [],
  "localePolicyDigest": "sha256:...",
  "issues": [],
  "semanticDigest": "sha256:..."
}
```

Runtime timestamps, API request IDs, retry counts, and local paths stay outside the semantic digest.

## Review Units

### Canonical content unit

One canonical translation pair per review unit. It binds:

- English translation source;
- Chinese translation target or creation destination;
- source and target content digests;
- latest accepted translation receipt or explicit missing-baseline state;
- target Parent decision;
- media inventory;
- target Bitable mutation;
- exact before-state and rollback evidence.

Execution stops for document acceptance before the next content unit.

### Publication-scope unit

A canonical Targets change must display:

- current Chinese Targets;
- proposed Chinese Targets;
- Chinese source evidence;
- publication destinations added or removed;
- locale-policy rule applied.

Targets authority cannot be broadened automatically by a learned rule.

### Metadata batch

Multiple `META_ONLY` records may share one unit only when all have the same:

- table mapping;
- placement type;
- locale-source ownership;
- changed field set;
- publication effect;
- risk class;
- precondition schema;
- locale-policy decision.

### Structural or policy unit

Table mapping, target-only handling, split/merge, or locale hierarchy exceptions use explicit reviewed decisions. They do not imply document-write authority.

### Ref behavior

Ref never creates a review unit. A ref remains validation-only and follows the state of its underlying canonical translation pair.

## Execution, Acceptance, and Rollback

Every executable unit:

1. binds the parent scan-manifest digest and issue IDs;
2. refetches live table, record, document, Parent, Targets, and media preconditions;
3. invalidates approval when affected state drifted;
4. appends a prepared journal entry before mutation;
5. performs only approved target-side operations;
6. refetches and verifies the result;
7. waits for required acceptance;
8. appends the accepted or rollback result;
9. writes a new translation receipt only after accepted live verification.

Rollback restores only state proven to belong to that unit. It must not delete target-only records or resources without separate authority.

## Re-scan and Drift Handling

After an accepted unit, re-scan:

- the affected table pair;
- the changed record identities;
- target Parent dependencies;
- canonical Targets publication state;
- canonical pairs referenced by affected ref rows.
- translation receipt lineage for affected canonical pairs.

Close an issue only when live state proves resolution. New findings enter the same queue with new issue IDs.

Drift invalidation is scoped:

- table or active-schema drift invalidates all unexecuted units for that table;
- mapping or locale-policy drift invalidates dependent units;
- record or document drift invalidates only units that bind that object;
- unrelated Base revision changes trigger inventory delta review but do not automatically discard proven unaffected units.

## Final Full Scan

Overall completion requires a new scan epoch that re-enumerates both Bases from zero.

Finalization checks:

- every discovered table is mapped or covered by reviewed policy;
- active schemas are understood;
- no placement metadata violation remains;
- every canonical pair is accepted, no-op, excluded, or explicitly carried forward;
- every managed canonical pair has an accepted translation receipt or an explicitly reviewed missing-baseline disposition;
- canonical Chinese Targets match approved Chinese publication scope;
- locale-owned metadata matches its own source;
- locale-specific Parent graphs are valid;
- all links have valid typed targets;
- every ref points to the locale-appropriate member of an existing translation pair;
- all target-only records remain preserved unless separately approved otherwise;
- every executed unit has journal, verification, and acceptance or rollback evidence.

The final confirmation binds the final scan digest and complete issue disposition list.

## Governed Learning Integration

Review outcomes may generate candidate rules for:

- table mapping;
- split or merge behavior;
- locale-specific hierarchy;
- locale applicability;
- link classification or normalization;
- metadata ownership;
- translation-pair identity exceptions.

Ref rows do not create a separate rule domain.

Learned rules remain scoped and reviewed. Rules affecting Targets, permissions, deletion, publication scope, or approval gates cannot be automatically promoted. Ordinary promotion-ready candidates follow the agreed batched reminder threshold of five; conflicts and high-risk candidates notify immediately.

## Required Harness Fixtures from the Current Bases

At minimum preserve fixtures for:

- source Base with 9 tables and target Base with 8, without treating those counts as constants;
- a newly added table appearing after a prior scan;
- Deployment as an unresolved source-only table-level decision;
- `section:database` and `canonical:database` sharing one Slug;
- internal `/reference/...` link;
- external `http...` link;
- slugless ref rows in Management and AI Models;
- a ref pointing to the correct locale member of a canonical translation pair;
- English and Chinese Parent differences that are both valid;
- canonical Targets differences justified by Chinese publication scope;
- an existing translation pair with no receipt producing `TRANSLATION_BASELINE_REQUIRED`;
- English-only content drift producing `UPDATE_CONTENT`;
- Chinese-only content drift producing `TARGET_LOCAL_EDIT` without overwrite authority;
- concurrent English and Chinese drift producing `TRANSLATION_DIVERGED`;
- hidden Chapter fields producing no issue;
- active-field type or option drift producing a typed issue;
- an unrelated Base revision change that does not invalidate an unaffected accepted unit;
- a new issue discovered by the final full scan.

## Acceptance Criteria

The design is implemented when:

1. No table can be omitted because of a stale map or default table selection.
2. No record is overwritten or lost through a global slug map.
3. Placement-specific required and absent fields are enforced.
4. Ref rows never become independent translation work.
5. Parent differences are evaluated per locale.
6. Locale-owned metadata is not compared as if English were authoritative.
7. Canonical Targets changes are publication-aware and exactly approved.
8. Every write is resumable, verifiable, acceptable, and rollback-aware.
9. Processing one issue does not hide newly introduced drift.
10. Final success is impossible without a fresh complete scan.
