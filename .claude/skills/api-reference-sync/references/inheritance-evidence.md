# Inheritance Evidence and Shared-Token Enforcement

Use this reference for any governed UPDATE run on a versioned SDK track. It describes the fail-closed evidence chain that prevents in-place patches of documents another track still references (the ConnectParam lesson, codified by the versioned-tree delta model).

## Authority model

- The authoritative carriers of version belonging are the Bitable record pointers (`Docs` links) of every track, not physical Drive placement.
- A document token is `shared` when any record other than the current record — in any enumerated track, older or newer — points at it. `unshared` means exactly the current record points at it. Anything else is `unknown`, and `unknown` blocks planning and execution.
- `UPDATE_IN_PLACE` is only eligible for a verified target-local, `unshared` document. Everything else routes to `COPY_PATCH_AND_REPOINT` with copy-source evidence.

## Evidence chain

1. **Collection** — `scripts/build-current-placement-audit.js` is the canonical read-only evidence collector. It combines recursive Drive ancestry with fully paginated Bitable enumeration of the target track and every adjacent track, then emits a digest-bound `inheritanceEvidence` object per entry. Enumeration completeness is checked against a **required track set derived independently of what the caller supplied** — the target version, every declared source root, every registered track of the language in registry mode, and any explicit `--required-track <version>` manifest entries. Missing coverage (`TRACK_COVERAGE_MISSING`), duplicate track entries (`TRACK_COVERAGE_DUPLICATE`), unresolved bases, or listing failures mark the run incomplete, and an incomplete run classifies every entry as `unknown` and emits no evidence — a partial enumeration can never produce digest-valid `unshared` evidence. Each evidence object carries:
   - `current` / `target` placement bindings (record, document token, version, folder, version root, verification flags);
   - `sharedToken.status` (`shared` | `unshared` | `unknown`) plus the complete `referencedRecordIds` set (current record included);
   - `trackInventoryDigests` for every enumerated track (both the track holding the document and the track being planned must be present);
   - `collectedAt` and a tamper-evident `evidenceDigest`.
   Entries whose evidence cannot be constructed stay `null` and list `inheritanceEvidenceBlockers`; the artifact reports `inheritanceEvidenceStatus: evidence_blocked`.
2. **Reviewed context** — `scripts/build-reviewed-release-context.js` rejects any UPDATE candidate without valid evidence (`SHARED_TOKEN_EVIDENCE_REQUIRED`). Naked `ancestryVerified` / `placementVerified` / `referencedByOlderVersions` booleans are no longer accepted as input; the builder derives `referencedByOlderVersions` from the evidence.
3. **Planning** — `SyncPlanner` revalidates the evidence against the action identity, current source, and target before producing a plan, binds `evidenceDigest` into the `SHARED_TOKEN` precondition, and carries the evidence on the immutable plan so the approved batch digest covers it.
4. **Execution** — immediately before the first document mutation of `UPDATE_IN_PLACE` or `COPY_PATCH_AND_REPOINT`, `SyncExecutor` revalidates the plan's evidence and requeries live cross-track references through its `tokenReferenceReader`:
   - evidence missing, tampered, inconsistent, or incomplete → blocked (`SHARED_TOKEN_EVIDENCE_REQUIRED`, `INHERITANCE_EVIDENCE_DIGEST_INVALID`, `SHARED_TOKEN_EVIDENCE_REFERENCES_INCONSISTENT`, `INHERITANCE_EVIDENCE_INVENTORY_REQUIRED`, …);
   - `UPDATE_IN_PLACE` with non-`unshared` evidence → `SHARED_TOKEN_INPLACE_PATCH_BLOCKED`;
   - no live reader wired → `SHARED_TOKEN_REVALIDATION_REQUIRED`;
   - live reference set differs from the approved `referencedRecordIds` → `SHARED_TOKEN_REFERENCES_DRIFTED`.
   All of these fail with zero writer calls (`failedStep: verifySharedTokenEvidence`); re-run the placement audit and replan instead of retrying.

Scope note: the executor requeries the token reference set live; it does not yet re-digest full track inventories. Inventory freshness beyond the reference set is Phase 2 work (policy kernel + attestation binding) in `.claude/plans/2026-09-23-skill-harness-rule-enforcement.md`.

## Release-track registry

`config/release-tracks.json` is the machine-readable registry of per-track Bitable bases, configured Drive roots, actual release-root resolution (`configured-root` vs `explicit-child`, e.g. the cpp v2.6.x multi-version container), and track order (oldest first; adjacency is implicit in order). Identities mirror the published tables in `sdk-*.md`; `tests/release-track-registry.test.js` pins the cpp values against `sdk-cpp.md`. Values may be literals or `{ "env": "VAR" }` references.

## Audit CLI

```bash
node .claude/skills/api-reference-sync/scripts/build-current-placement-audit.js \
  --proposal tmp/.../proposal.json \
  --language cpp \
  --version v3.0.x \
  --output tmp/.../placement-audit.json
```

- `--language` + `--version` resolve the release root, the target Bitable, every adjacent Bitable, the required track coverage set, and older-track source roots from the registry (`--registry <path>` overrides the registry file).
- Explicit flags override or supplement the registry: `--version-root`, `--target-bitable <baseToken>[:<tableId>]`, `--adjacent-bitable <version>:<baseToken>[:<tableId>]` (repeatable), `--source-version-root <version>:<rootToken>` (repeatable), and `--required-track <version>` (repeatable) to declare additional participating versions whose Bitables must be enumerated.
- Without complete coverage of the required track set the audit still produces Drive placement, but every entry stays `unknown` for sharing and emits no evidence — planning with such entries blocks fail-closed.
- The script is GET-only and stays classified `read-only` in `doc-ops-core/write-entrypoints.json`.

## Live executor wiring

`bin/sdk-doc-sync.js` resolves the registry for live runs and enables cross-track enumeration only when the live `BASE_TOKEN` matches the registered base for the requested language/track, so foreign-token and dry runs never enumerate unrelated live bases. `SdkDocSync` additionally accepts `tokenReferenceReader` (full injection) and `tokenReferenceTracks` (adjacent `{version, baseToken, tableId}` tracks enumerated through fresh `BitableWriter` reads).
