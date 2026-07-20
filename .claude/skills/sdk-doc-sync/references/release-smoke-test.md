# Release Smoke Test

This procedure is manual, mutating, disposable, and approval-required. It validates that a release candidate can create, patch, refetch, and verify Feishu SDK/API documentation without damaging production content.

Do not run this procedure in CI. Do not run it against production folders, production documents, or production bitable records.

## Approval Gates

Get explicit approval before:

1. Creating the disposable folder, document, or bitable record.
2. Patching the disposable document.
3. Cleaning up or deleting any disposable resource.

Approval must name the target disposable folder/base and the exact resources or actions being approved.

## Inputs

Use disposable Feishu resources only:

- `APP_ID`
- `APP_SECRET`
- `FEISHU_HOST`
- `ROOT_TOKEN` for a disposable Drive parent folder
- `BASE_TOKEN` for a disposable Bitable base
- table ID or confirmed single-table disposable base

Create a smoke log before running any mutation. Record:

- operator and date;
- release candidate branch/commit;
- disposable Drive parent token;
- disposable Bitable base and table ID;
- created folder token;
- created document token and URL;
- created record ID;
- every command run;
- verification result;
- cleanup decision.

## Smoke Document Content

The disposable document must include all formatting-sensitive cases below:

````markdown
# SDK Doc Sync Release Smoke

## C++ Example

```cpp
#include <vector>
#include "milvus/MilvusClient.h"

int main() {
    std::vector<int> ids{1, 2, 3};
    return static_cast<int>(ids.size());
}
```

## Nested List

- parent item
  - child item
    1. grandchild item
  - sibling child
- second parent

## Includes

<include target="milvus">
Milvus-only include body.
</include>

<include target="zilliz">
Zilliz-only include body.
</include>

## Citation

See [Milvus API reference](https://milvus.io/docs) for the published reference surface.
````

If the release changes SDK renderer output, create one representative disposable page for each affected language profile. Each page must omit a body H1 and include that language's canonical/request signature pattern. Across the smoke set, retain the same C++ code, nested-list, include, citation, and rich-block coverage.

## Procedure

### 1. Run Offline Validation

```bash
npm run validate:skills
npm test
```

Stop on failure. Fix or defer the failure before requesting live smoke approval.

### 2. Request Creation Approval

Ask for approval to create a disposable folder, document, and bitable record under the named disposable tokens.

Do not proceed until approval is explicit.

### 3. Create Disposable Resources

Create or identify a disposable child folder under `ROOT_TOKEN`. Create the smoke document in that folder from the smoke Markdown. Create a matching disposable bitable record that points at the document.

The exact helper commands depend on the available disposable base and folder setup. Inspect the helper first:

```bash
node .claude/skills/sdk-doc-sync/scripts/feishu-doc.js --help
```

Record all returned tokens and URLs in the smoke log.

### 4. Refetch And Verify Initial Render

Refetch raw Docx blocks and Markdown:

```bash
node .claude/skills/sdk-doc-sync/scripts/feishu-doc.js get-blocks <document-token>
node .claude/skills/sdk-doc-sync/scripts/feishu-doc.js bitable-show <base-token> <record-id>
```

Verify:

- the C++ fence is still C++ and contains both `#include` lines;
- nested list items are present once each and keep parent/child/grandchild structure;
- include bodies are preserved or filtered according to the requested target behavior;
- citation link text and URL are present;
- the bitable record points to the disposable document URL;
- the record parent and version metadata match the smoke setup.

### 5. Request Patch Approval

Ask for approval to patch only the disposable smoke document. Include the document token and the exact patch intent.

### 6. Patch And Refetch

Patch each disposable SDK document with one small section change that exercises the reviewed semantic API patch plan. Do not use generic smart matching. For example:

- add one C++ statement inside the code block;
- add one nested-list sibling;
- add one citation sentence.

Refetch the document blocks and bitable record again.

Verify:

- the C++ language remains C++;
- existing `#include` lines remain intact;
- old nested-list items are not duplicated;
- the new nested-list item appears once;
- citation links remain links;
- the bitable record still points to the same disposable document unless the approved plan intentionally repointed it.

### 7. Verify Recovery Notes

If any create, patch, or refetch step fails, stop and record:

- failed command;
- failed step;
- created resources that still exist;
- whether a document was created without a record;
- whether a record points at a partially verified document;
- recommended recovery or cleanup action.

Do not clean up automatically.

### 8. Request Cleanup Approval

Report the exact disposable resources to clean up:

- folder token;
- document token and URL;
- record ID;
- any copied or replacement document tokens.

Ask for explicit approval before deleting, archiving, moving, or editing those resources.

If cleanup is approved, perform cleanup and refetch/list the parent folder and bitable record location to confirm removal or archival. If cleanup is not approved, leave the resources in place and report them as unresolved disposable resources.

## Pass Criteria

The smoke passes only when:

- offline validation passed before live mutation;
- creation approval, patch approval, and cleanup approval or cleanup deferral were recorded;
- disposable folder, document, and record were created or identified successfully;
- C++ code, nested lists, includes, and citations survived create/refetch;
- patch/refetch preserved existing content and applied the approved change;
- bitable record state matched the expected disposable document link and metadata;
- cleanup was completed or explicitly deferred with tokens recorded.
