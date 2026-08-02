# Patch Feishu Code Feature Cases

Read only the section matching the procedure being patched. Always re-verify current public APIs because these cases record reusable search paths and semantic cautions, not permanent API guarantees.

## Zilliz Cloud Import Jobs

Python examples may use `pymilvus.bulk_writer.bulk_import(...)` and `get_import_progress(...)`. Equivalent support can live outside the primary client package:

- Java: inspect `milvus-sdk-java/sdk-bulkwriter`, including `BulkImportUtils`, `CloudImportRequest`, and `CloudDescribeImportRequest`.
- Node.js: inspect public `HttpClient` import-job methods.
- Zilliz CLI: inspect current `zilliz import` commands and models.
- REST: verify the current Cloud import-job routes and schemas.

Do not classify Java as unsupported merely because the API is absent from `sdk-core`.

## On-Demand Search Cluster Routing

Normal search support is not equivalent to on-demand cluster routing. Verify a public routing mechanism for every language:

- Python may route through a cluster-scoped client session.
- REST may carry a cluster identifier in the search request.
- Java and Node.js may expose reserved connection options.
- Zilliz CLI may use an active cluster context.

If Go or C++ lacks a public cluster/session equivalent, skip the block and report the gap rather than adding a normal search example that silently omits routing.

## StructArray And EmbeddingList Search

- Define EmbeddingList search by the `MAX_SIM*` metric family, not merely by multiple query vectors.
- Distinguish list-level scoring from element-level vector scoring and grouping.
- Use "element offset" for result positions to avoid confusion with pagination `offset`.
- Do not claim `element_filter` makes results row-level by itself.
- Prefer explicit embeddings over random vectors in cross-language docs.
- Verify serialization paths for non-float vector types, not only public enum declarations.
- Do not invent helpers such as `add_batch` in SDKs that do not provide them.
- Verify current REST routes and CLI flags before using nested-array examples.

## Patching Mechanics

1. Refetch the document and record anchor block IDs.
2. Generate XML code blocks under `tmp/patch-feishu-code/`.
3. Insert from the highest child index to the lowest.
4. Refetch the live document after structural changes.
5. Report inserted blocks, intentional omissions, revision evidence, and verifier caveats.
