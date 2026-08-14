# RESTful API Reference (Milvus server)

Use this reference for Milvus data-plane REST/OpenAPI release tracking. It is separate from generic SDK/Feishu documentation synchronization: REST spec-file publication does not use the Feishu document execution state machine.

## Ownership and Target

The canonical public REST fragments live in zdoc:

```text
packages/docs-tooling/src/reference/rest/meta/openapi/
```

`api-reference-sync` owns Milvus source discovery, minor-track comparison, lifecycle proposal generation, and deterministic REST review manifests. It must not write zdoc fragments, track snapshots, Feishu records, S3 objects, or `scan-state.json`; those writes are executed by the separately approved zdoc bootstrap migration.

Milvus data-plane REST is scanned independently from Zilliz Cloud control-plane REST. `2.6.x` and `3.0.x` are initially supported Milvus tracks.

## Track Model

- Each track keeps only the latest patch contract. For example, `2.6.x` means the latest available Milvus 2.6 shape.
- Patch history is not retained.
- `2.6.x` is the managed-history floor. An element that predates Milvus 2.6 is recorded as `2.6.x`, meaning it is present at the earliest managed baseline.
- Track identifiers accept only `major.minor.x`, such as `2.6.x` and `3.0.x`. Patch versions and free-form names are rejected.
- Deprecated elements remain present and use standard OpenAPI `deprecated: true`. Do not implement `x-removed-since`.

## Lifecycle Extensions

Lifecycle metadata is required on every Milvus data-plane operation and public contract element:

```json
{
  "x-added-at": "2.6.x",
  "x-last-modified": "3.0.x",
  "x-deprecated-since": null
}
```

Meanings:

- `x-added-at`: first managed minor track where the element exists.
- `x-last-modified`: most recent managed minor track where its public contract changed; used for audit only and does not control visibility.
- `x-deprecated-since`: first managed minor track where the element is deprecated, or `null`.

Managed scopes:

- HTTP operations identified by `(endpoint, method)`.
- Path, query, header, and cookie parameters.
- Request and response schema properties.
- Reusable parameters, headers, request bodies, responses, schemas, and public schema properties.
- Object-valued `oneOf`, `anyOf`, and `allOf` branches when the branch itself is version-sensitive.

Do not attach lifecycle metadata to structural containers such as `paths`, `content`, `application/json`, `schema`, or `properties`. Scalar enum members do not receive lifecycle attributes.

## Review Unit

The review unit is exactly:

```text
(versionTrack, endpoint, method)
```

The method is normalized to lowercase. Shared components are not standalone review units. A changed shared component is expanded beneath every affected operation, while the manifest retains one deduplicated component record and digest.

The CLI scans each track and emits the deterministic grouping manifest:

```bash
node .claude/skills/api-reference-sync/bin/rest-track-review.js \
  --track-spec 2.6.x=.claude/skills/api-reference-sync/tests/fixtures/rest-track/2.6.x.json \
  --track-spec 3.0.x=.claude/skills/api-reference-sync/tests/fixtures/rest-track/3.0.x.json \
  --source-revision 2.6.x=milvus-io/milvus@v2.6.22 \
  --source-revision 3.0.x=milvus-io/milvus@v3.0.0 \
  --managed-floor 2.6.x \
  --output tmp/rest-track-review/manifest.json \
  --json
```

The manifest is sorted by numeric track, endpoint, and method, and its `manifestDigest` is a semantic SHA256. Grouping approval authorizes only deterministic execution-batch planning; canonical fragment and track-snapshot writes require a separate, exact batch-digest approval.

## Workflow

1. **Scan** each supported track independently with `rest-track-review.js`.
2. **Inventory** operations, request/response fields, parameters, headers, request bodies, responses, schemas, public schema properties, and version-sensitive branches.
3. **Compare** adjacent track inventories and assign shared-component changes to operation owners.
4. **Validate** lifecycle formats, ordering, deprecation metadata, component ownership, and duplicate review units.
5. **Approve** the exact grouping digest only after reviewing the complete dry-run.
6. **Hand off** the fixture or real-source manifest to the zdoc session without writing production data.

Do not perform Milvus lifecycle backfill, write production track snapshots, or interact with Feishu/S3 during scanning.

## Deterministic Contracts

- Review unit ID format: `rest:<versionTrack>:<method>:<percent-encoded-endpoint>`.
- Lifecycle values are only `major.minor.x`.
- `x-last-modified` is audit-only and never selects visibility.
- Each minor track retains only its latest patch contract.
- `2.6.x` is the managed-history floor.
- `x-removed-since` is not implemented.
- Generic SDK/Feishu document synchronization remains unchanged; REST is an explicit review-unit exception.
