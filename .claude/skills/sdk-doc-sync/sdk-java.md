# Java SDK Reference (milvus-sdk-java)

**Scanner:** `src/sdk-doc-sync/scanners/java-scanner.js`
**Root dir:** `repos/milvus-sdk-java/sdk-core/src/main/java/io/milvus`
**Latest release:** `v2.6.18` (as of 2026-05-02). v3.0.x doc set tracks master commit `80b4f555` as the would-be `v3.0.x` tag.
**Note:** 2-phase scan — MilvusClientV2.java methods → Req class builder fields as params. Skip Lombok setter methods (`set[A-Z]*`).

| Version | Bitable Token              | Drive Folder          |
|---------|----------------------------|-----------------------|
| v2.3.x  | Bp72bJ9wEazV1SsA30lcsuJgnfe | `O4sRfb29olHnoid8hJMcxfhHnud` |
| v2.4.x  | WqHJb3zimaxXjssk4Kic4GEDnte |                       |
| v2.5.x  | Hsq1bRcqraeQW0sGFJbcI3YIn3d |                       |
| v2.6.x  | Sbtcbm660abngWsXryKct5nOn2e |                       |
| v3.0.x  | AOFDbSmwma9XrNsLa8KcQgt9ngc | `C4Ckfsx5qlKHbnd5PVrcpxvTn2d` |

**Doc format:**

```
[Description]

```java
public ReturnType methodName(RequestClass request)
```

## Request Syntax{#request-syntax}

```java
methodName(RequestClass.builder()
    .field1(Type paramName)
    .field2(Type paramName)
    .build()
)
```

**BUILDER METHODS:**

- `field1(Type paramName)`
Description of what this sets.

**RETURNS:**

*ReturnType*

**EXCEPTIONS:**

- **MilvusClientExceptions**
This exception will be raised when any error occurs during this operation.

## Example{#example}

```java
[Realistic, runnable usage example]
```
```

**Method wrappers (do not create separate docs):**

| Wrapper method | Delegates to | Bitable slug (already documented) |
|---------------|-------------|-----------------------------------|
| `alterCollection` | `alterCollectionProperties` | `v2-Collections-alterCollectionProperties` |
| `alterIndex` | `alterIndexProperties` | `v2-Management-alterIndexProperties` |
| `alterDatabase` | `alterDatabaseProperties` | `v2-Database-alterDatabaseProperties` |

**Category mapping (scanner parentClass → bitable category):**

The scanner returns `parentClass: 'MilvusClientV2'` for all methods. Category must be derived from request class name:

| Method | Request class | Bitable category |
|--------|--------------|-----------------|
| `loadCollection` | `LoadCollectionReq` | `v2-Management` (not Collections) |
| `releaseCollection` | `ReleaseCollectionReq` | `v2-Management` (not Collections) |
| `describeReplicas` | `DescribeReplicasReq` | `v2-Collections` (not Management) |
| `updatePassword` | `UpdatePasswordReq` | `v2-Authentication` |

**Notes:**
- Methods without a Req parameter skip the Request Syntax and BUILDER METHODS sections
- Builder method signatures use inline code (`` `method(Type param)` ``), NOT bold
- Skip Lombok setter methods — JavaScanner filters them via `_isSetterMethod()`
- Enum docs use Constants as h3 headings: `### CONSTANT_NAME(code){#anchor}` + one-line description
- When a class doc references another enum/class, do NOT list enum values inline — say "For available values, refer to TypeName."

**Scripts:**
- `scripts/java-v26-update.js` — v2.6.x create/update run
- `scripts/java-v26-examples-update.js` — add real SDK repo examples
- `scripts/java-v2614-update.js`, `scripts/java-v2614-indexfix.js` — v2.6.14 patch runs
- `scripts/java-v30-update.js` — v3.0.x delta sync (master `80b4f555`); 4 UPDATEs + 6 CREATEs + new `File Resources` category, plus Phase 2b: 2 nested-builder Class UPDATEs (`CollectionSchema`, `FieldSchema`) regenerated with v3.0 builders + drift backfill
