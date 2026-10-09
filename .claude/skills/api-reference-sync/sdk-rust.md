# Rust SDK Reference (milvus-sdk-rust)

**Ownership:** web-content `API_Reference/milvus-sdk-rust/` is the **base** — milvus-scope truth written by the maintainers' `update-milvus-sdk-docs` skill. The Feishu tree below is the **Zilliz library**: compiled output of `base@pin + overlay/` via `bin/sdk-derive.js` (see `docs/rust-overlay-pilot.md`). Feishu-side SDK reference pages for rust are pipeline-owned; hand edits belong in `overlay/rust/<track>/` (pages/patches/rules), never on the Feishu page.

**Scanner:** `src/sdk-doc-sync/scanners/rust-scanner.js`
**Root dir:** `repos/milvus-sdk-rust`; source dir: `src/v2/` (v1 and proto are excluded — legacy/generated)
**Release scout sdk-name:** `milvus-sdk-rust`
**Tag format:** plain `vX.Y.Z` (no prefix — unlike go's `client/vX.Y.Z`). Observed: v2.6.0/v2.6.1, v3.0.0/v3.0.1/v3.0.2.
**Public roots:** `src/v2/` and `Cargo.toml`.
**Overlay:** `overlay/rust/<track>/` — `manifest.json`, `rules.json`, `patches/*.json`, `targets.json`, `pages/`. Schema: `overlay/schema/overlay.schema.json` (closed vocabulary; the validator in `src/sdk-doc-sync/derive/overlay-schema.js` is the authority).

| Version | Bitable Token | Release Root (explicit child) | web-content pin |
|---------|---------------|-------------------------------|-----------------|
| v2.6.x  | HmCmbiQEcawJzxszPj1cBH7Gnwd | `NnYMfAqtJlzJ8zdwpiNcJOuGnF9` | d76ba1bc4a7546f12d172967b9756cf549d35e2d (2026-09-29, PR #1166) |
| v3.0.x  | ONBTbsAdha3UNvsfnG5cEISvnBZ | `XiM3fDXSBldV2IdN0r9cXCe6nqw` | cac4d07418f58954fc5bd39f8763cae3011be173 (2026-09-23, reconcile) |

The configured Drive root for both tracks is the `RUST` multi-version container `PeN4ftfCglBs4AdS8CTcjtdOnPJ`; each release root is its explicit `v2.6.x` / `v3.0.x` child folder (verified by drive enumeration 2026-10-08).

## Page Anatomy (six kinds; web-content census 2026-10-08)

- **method** (121 pages in v3.0.x): `# Method()` → prose → `pub async fn` fence → `## Request Syntax` (builder chain fence) → `**REQUEST FIELDS:**` flat bullets `` - `name: Type` `` + 4-space descriptions → `**RETURNS:**` italic type + prose → `## Example`.
- **struct** (16): `pub struct` fence → `**PARAMETERS:**` bullets → optional `**METHODS:**` compact bullets.
- **enum** (7): `pub enum` fence → `**VARIANTS:**` bullets.
- **container** (MilvusClientV2 / Session): `## Constructor` → `## Runtime configuration` → `## Method index`.
- **module** (DataImport/BulkImport): struct + Constructor + nested struct sections.
- **overview** (About.md): README-style.

REQUEST FIELDS are flat everywhere (zero nested bullets measured). Source method names are snake_case; page titles are PascalCase — the scanner carries the evidence-derived `pageName` bridge (exceptions: `server_version`→GetServerVersion, `sdk_version`→SDKVersion, `ClientV2`→MilvusClientV2). `CreateSimpleCollectionRequest` owns a method-style page (convenience request type dispatched via `create_collection`).

## Doc Format (zilliz compiled flavor)

Inherits GLOBAL_LAYOUT_RULES v4 (five content rules, deprecation two-line callout, type-link requirement) plus the rust profile declarations: `returnSections: {split: true}` + `returnsProseRequired` (java 2026-10-01 family — first adopting track) and the `builderSignature` slot (prefix baseline pending golden fixtures from the first campaign). RETURNS shape targets follow `docs/sdk-doc-style-rubric.md` (rust = go variant: `*Result<T>*` + Rust fence struct + PARAMETERS + accessor METHODS).

## Known audit findings (2026-10-08 census)

- `list_compaction_tasks` (master) has no web-content page — surfaced by `COVERAGE_UNTRACKED_METHODS`.
- v2.6.x web-content lacks the DataImport category and `CreateSimpleCollection` (source superset — R&D doc gap).
- No `<!-- category/action/addedSince -->` footers on rust pages; derive change detection is pin-SHA git diff.
- 37 relative `.md` links — overlay rules must keep covering same-directory relative links (pre-first-campaign blocker, blueprint §6½ P1-2).
- Cross-struct page flattening is mapped in the scanner: `REQUEST_FIELD_UNIONS` (HybridSearch ↔ SubSearchRequest) and `TYPE_FIELD_UNIONS` (BulkImport module page ↔ BulkImportRequest/BulkImportConfig/constructor param) — evidence tables, extend rather than special-case (review r1 P0-2).
