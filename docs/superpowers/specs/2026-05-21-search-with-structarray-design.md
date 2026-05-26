# Design Spec: Search with StructArray (Dual-Target)

Date: 2026-05-21
Status: Approved-for-spec-review
Owner: Claude + User

## 1) Objective

Create a new documentation page, **Search with StructArray**, as a **hands-on recipe** for end-to-end StructArray search workflows, with dual-target support for **Milvus** and **Zilliz Cloud**.

The page should prioritize task completion over deep theory, while linking to existing foundational pages for full semantics.

## 2) Placement and IA

- Primary location: **Search guides**.
- Discovery links from:
  - `use-array-of-structs`
  - `struct-array-filtering`
- Page role: execution-focused search guide that sits between schema setup and advanced filtering references.

## 3) Audience and Scope

### Audience
- Users who already have (or can create) StructArray collections and need practical search patterns.

### In scope
- End-to-end StructArray search flow.
- Dual-target behavior notes (Milvus vs Zilliz Cloud).
- Inline examples for **all SDKs**:
  - Python
  - Java
  - Go
  - Node
  - REST
  - C++

### Out of scope
- Rewriting complete schema tutorial (link out instead).
- Rewriting complete operator semantics tutorial (link out instead).
- Product release-policy details beyond concise availability notes.

## 4) Source of Truth

Use existing Feishu pages as canonical source content and normalize for doc-site style:

- StructArray: `https://zilliverse.feishu.cn/wiki/LIMbwXk1OiS5SykUyNhc5FtSnPb`
- StructArray Operators: `https://zilliverse.feishu.cn/wiki/VmGMwsTliiGZdFkzzeBckRNlnCh`

Target-gated content (`<include target="...">`) remains authoritative and must be preserved in transformation logic.

## 5) Page Structure

1. **When to use this guide**
   - Quick criteria and expected outcomes.
2. **Prerequisites**
   - Existing StructArray collection and index readiness.
   - Target note: Cloud defaults to `AUTOINDEX`; Milvus may also use `HNSW` where applicable.
3. **Step 1: Choose search mode**
   - Embedding List search.
   - Element-level vector search.
4. **Step 2: Configure index + metric correctly**
   - Dual-target callouts and compatibility checks.
5. **Step 3: Run single-query search**
   - Full snippet coverage (all SDKs).
6. **Step 4: Run multi-query search (multiple EmbeddingList entries)**
   - Full snippet coverage (all SDKs).
7. **Step 5: Add StructArray scalar filtering to search**
   - `element_filter` ordering rule.
   - `MATCH_*` quick usage and links to operator page.
8. **Step 6: Interpret and validate results**
   - Row-level vs element-level expectation guidance.
9. **Common pitfalls**
   - `element_filter` placement, metric/index mismatches, target confusion.
10. **Next steps**
   - Links to `use-array-of-structs` and `struct-array-filtering`.

## 6) Dual-Target Content Rules

- Keep one unified narrative; use target-gated callouts and snippet deltas.
- **Zilliz Cloud** path:
  - Recommend `AUTOINDEX` for StructArray vector sub-fields.
- **Milvus** path:
  - Include optional `HNSW` path where supported.
- Never present HNSW as Cloud default.
- Add explicit availability notes where behavior may differ by target/version.

## 7) SDK Example Policy

- All six SDK families appear inline in key execution steps.
- Use consistent parameter naming and field references (`anns_field`, `output_fields`, struct-subfield syntax).
- Keep examples minimal, runnable, and aligned across languages.

## 8) Doc Update Tasks

### A. New page creation
1. Create new page: **Search with StructArray** under Search guides.
2. Initialize with dual-target top callout and scope statement.
3. Insert step-oriented structure from this spec.

### B. Content migration and composition
4. Pull canonical snippets from Feishu StructArray and StructArray Operators pages.
5. Split/annotate target-specific parts:
   - Cloud (`AUTOINDEX` default)
   - Milvus (`AUTOINDEX` + optional `HNSW` path)
6. Normalize Feishu constructs (`<include>`, `callout`, `synced-source`, `cite`) to doc-site format.

### C. SDK examples
7. Add all-SDK snippets for:
   - single-query search,
   - multi-query search,
   - filtered search with StructArray.
8. Verify snippet parity across SDKs (same intent, parameters, and expected outcome).

### D. Cross-page updates
9. Update `use-array-of-structs` to link to the new Search guide in “Next steps”.
10. Update `struct-array-filtering` to link to the new Search guide for end-to-end usage.
11. Ensure no duplicated deep semantics; keep reference pages authoritative.

### E. Quality checks
12. Validate dual-target statements are non-contradictory.
13. Validate `element_filter` ordering rule and examples.
14. Validate all links and anchors.
15. Confirm Cloud examples never imply HNSW as default.

## 9) Consistency and Anti-Drift Rules

- Do not duplicate complete operator theory from `struct-array-filtering`; summarize and link.
- Do not duplicate full schema design tutorial from `use-array-of-structs`; summarize prerequisites and link.
- Ensure all product-difference statements are expressed once in clear callouts to avoid contradictory language.

## 10) Acceptance Criteria

The page is complete when all conditions hold:

1. New page exists under Search guides with dual-target framing.
2. All SDK examples are present for single-query and multi-query flows.
3. Cloud vs Milvus index guidance is explicit and non-contradictory.
4. `element_filter` ordering rule is documented with correct/incorrect examples.
5. Pitfalls section includes at least:
   - filter order issue,
   - index/metric mismatch,
   - target capability confusion.
6. Cross-links to foundational StructArray docs are present and valid.

## 11) Risks and Mitigations

- **Risk:** content drift between this recipe page and foundational pages.
  - **Mitigation:** keep this page procedural; link out for full semantics.
- **Risk:** target-specific confusion.
  - **Mitigation:** explicit dual-target callouts and per-target defaults.
- **Risk:** oversized page due to all-SDK requirement.
  - **Mitigation:** concise snippets and strict step-oriented organization.

## 12) Implementation Notes (for planning phase)

- Reuse existing Feishu→Markdown transformation pipeline and target include handling.
- Normalize Feishu-specific constructs (callouts/cites/synced-source) to site conventions during publish.
- Validate snippet language labels and formatting consistency before publish.