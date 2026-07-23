# Java SDK Reference (milvus-sdk-java)

**Scanner:** `src/sdk-doc-sync/scanners/java-scanner.js`
**Root dir:** `repos/milvus-sdk-java`
**Target selection:** resolve released tracks from tags and supply an explicit reviewed commit for unreleased tracks. Do not treat this guide as live release state.
**Note:** 2-phase scan — `sdk-core` `MilvusClientV2.java` methods → Req class builder fields as params; plus selected `sdk-bulkwriter` manager/writer methods and request/model/param classes. Skip Lombok setter methods (`set[A-Z]*`).

| Version | Bitable Token              | Drive Folder          |
|---------|----------------------------|-----------------------|
| v2.3.x  | Bp72bJ9wEazV1SsA30lcsuJgnfe | `GYfPfBbdglDhh5dzLH3cYaV1nDf` |
| v2.4.x  | WqHJb3zimaxXjssk4Kic4GEDnte | `Sg3EfIgVtlTkeBdtguJchE9ynne` |
| v2.5.x  | Hsq1bRcqraeQW0sGFJbcI3YIn3d | `LJ6MfN5wzlHjz8dB642cjUh8nqq` |
| v2.6.x  | Sbtcbm660abngWsXryKct5nOn2e | `B1agfRbPglv4tpdTkjlcUMgVnRV` |
| v3.0.x  | AOFDbSmwma9XrNsLa8KcQgt9ngc | `C4Ckfsx5qlKHbnd5PVrcpxvTn2d` |

Shared Java root folder: `O4sRfb29olHnoid8hJMcxfhHnud`.

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

**Platform-aware request variants:**

- Mark reviewed Milvus request variants and examples with `audience: milvus`; mark Zilliz Cloud variants with `audience: zilliz`.
- Java prose for Milvus-only request headings, parameter lists, builder-method descriptions, and example descriptions renders inside `<exclude target="zilliz">` regions.
- Java prose for Zilliz Cloud-only request headings, parameter lists, builder-method descriptions, and example descriptions renders inside `<include target="zilliz">` regions.
- Distinct request syntax and example variants share one Java code block. Use complete-line `// include-start milvus` / `// include-end` and `// include-start zilliz` / `// include-end` directives; never put HTML-like audience tags inside a code block.
- Shared Java content remains directive-free.

**Category mapping (scanner parentClass → bitable category):**

The scanner returns `parentClass: 'MilvusClientV2'` for all methods. Category must be derived from request class name:

| Method | Request class | Bitable category |
|--------|--------------|-----------------|
| `loadCollection` | `LoadCollectionReq` | `v2-Management` (not Collections) |
| `releaseCollection` | `ReleaseCollectionReq` | `v2-Management` (not Collections) |
| `describeReplicas` | `DescribeReplicasReq` | `v2-Collections` (not Management) |
| `updatePassword` | `UpdatePasswordReq` | `v2-Authentication` |

**v2.6.x first-level folders verified under the version root:** `Client`, `Collections`, `Data Import`, `Database`, `Management`, `Partitions`, `Vector`, `Volume`. User-approved first-level planning categories also include `Authentication` and `CDC`; create or resolve those physical folders before executing Authentication/CDC document writes. `sdk-bulkwriter` data-import APIs belong under `Data Import`; volume manager and volume request/model APIs belong under `Volume`.

**Canonical identity maps:** load the track-specific map from `references/identity/`. Map request, parameter, and return helper classes to their owning interface record rather than standalone helper pages. When one helper affects multiple interface pages, use the map's `targets` array so release scope carries one source-backed action to each owner. Keep exact helper-to-owner mappings in the identity map and run evidence, not duplicated in this guide.

**Notes:**
- Methods without a Req parameter skip the Request Syntax and BUILDER METHODS sections
- Java API pages must not render a nested `Java example` heading beneath `Example`; the Java code fence already identifies the language.
- Builder method signatures use inline code (`` `method(Type param)` ``), NOT bold
- Every builder method must have a source-backed description in a following child paragraph. In Feishu, the bullet block contains only the inline-code signature; its description is a child text block. Do not flatten the signature and description into one text run.
- In Java prose, render SDK identifiers and literal values as inline code: class/interface/enum/request types, nested types, enum constants, method names, configuration keys, and literal endpoints or paths. Examples include `CollectionSchemaParam`, `CreateCollectionReq.CollectionSchema`, `BulkFileType`, `ConnectType.AUTO`, `sep`, and `https://api.cloud.zilliz.com`.
- Link an inline-code type reference to its canonical API-reference document when an exact or approved owning record exists. Resolve the destination from the current version Bitable or canonical identity map; do not link a legacy/helper name to an approximate page. Embedded helper and nested types link to their owning interface page when that is the approved documentation identity.
- Record the canonical-link lookup result in the patch plan or verification evidence: exact record and document token, approved owning record, or `no exact target`. “When available” does not permit silently skipping the lookup.
- For direct Feishu XML patches, follow the `lark-doc` XML nesting rules. A linked inline-code type is `<a href="canonical-doc-url"><code>TypeName</code></a>`; a bold numeric value is `<b>134,217,728</b>`; and a builder bullet is `<li><code>signature</code><p>description</p></li>` semantically, with the description verified as a child block after writing.
- Bold numeric defaults, limits, capacities, and counts in prose when they are user-significant. Keep a unit with the number when it forms one displayed value, for example **134,217,728** bytes and **128 MB**. Do not bold numbers inside signatures or code blocks.
- Derive default values from the target source revision's field initializers, constants, or Javadocs. Do not copy a default from an older SDK document without source verification.
- Derive exact builder names, overloads, parameter names, and types from the target scanner output or target source revision. Do not normalize `withCollectionSchema` into a guessed generic name such as `withSchema`.
- When a builder method is platform-specific, wrap the complete variant, including its signature, description, parameter prose, and relevant example usage. Do not wrap only the description and leave a platform-only signature visible to the other audience.
- Skip Lombok setter methods — JavaScanner filters them via `_isSetterMethod()`
- Enum docs use Constants as h3 headings: `### CONSTANT_NAME(code){#anchor}` + one-line description
- When a class doc references another enum/class, do NOT list enum values inline — say "For available values, refer to TypeName."

**Scripts:**
- `scripts/java-v26-update.js` — v2.6.x create/update run
- `scripts/java-v26-examples-update.js` — add real SDK repo examples
- `scripts/java-v2614-update.js`, `scripts/java-v2614-indexfix.js` — v2.6.14 patch runs
- `scripts/java-v30-update.js` — historical v3.0.x delta sync against master `80b4f555`; 4 UPDATEs + 6 CREATEs + new `File Resources` category, plus Phase 2b: 2 nested-builder Class UPDATEs (`CollectionSchema`, `FieldSchema`) regenerated with v3.0 builders + drift backfill
