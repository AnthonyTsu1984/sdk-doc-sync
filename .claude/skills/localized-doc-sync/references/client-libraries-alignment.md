# Client Libraries -> 客户端参考 Alignment

Use this maintained alignment file when syncing English source table `Client Libraries` (`tblgHPdSvZP8gUz6`) to Chinese target table `客户端参考` (`tbloC4PVprwYo0P0`).

Last inspected: 2026-06-18.

## Sources

- English base: `Ac7xbs2k1ad7bjsCXr0ccHe9nMh`
- English table: `tblgHPdSvZP8gUz6`
- Chinese base: `I6YUb1M0JajHrqsJGcLcZNh7neP`
- Chinese table: `tbloC4PVprwYo0P0`
- English wiki root: `https://zilliverse.feishu.cn/wiki/OUWXw5c4gia34ZkQUcEcMFbWn6s`
- Chinese wiki root: `https://zilliverse.feishu.cn/wiki/XyeFwdx6kiK9A6kq3yIcLNdEnDd`

## Current State

- Source table snapshot: `7` records.
- Target table snapshot: `0` records.
- Six source rows are `link` placement rows for API/SDK reference entries.
- One source row is canonical: `install-sdks` / Install SDKs.
- Existing Chinese counterpart for `install-sdks`: `安装 SDK`, `https://zilliverse.feishu.cn/wiki/Jo4bwNi6zi4zlHkN2bWcewFYnDc`.
- Target `Chapter` options are not aligned for Client Libraries. They currently look like Deployment/BYOC options:
  - `Deploy BYOC on AWS`
  - `Deploy BYOC-I on AWS`
  - `Deploy BYOC on GCP`
  - `Deploy BYOC-I on Microsoft Azure`
- Do not populate `Chapter` for Client Libraries records until the target field options are corrected or the user explicitly approves blank/unaligned Chapter handling.

## Record Mapping

| Target Seq | Target title | Source slug/title | Placement | Docs |
|---:|---|---|---|---|
| 1 | RESTful API | `restful-api` / RESTful API | `link` | `[RESTful API](http://RESTful API)` |
| 2 | Python | `python` / Python | `link` | `[Python](http://Python)` |
| 3 | Java | `java` / Java | `link` | `[Java](http://Java)` |
| 4 | Go | `go` / Go | `link` | `[Go](http://Go)` |
| 5 | Node.js | `nodejs` / Node.js | `link` | `[Node.js](http://Node.js)` |
| 6 | C++ | `cpp` / C++ | `link` | `[C++](http://C++)` |
| 7 | 安装 SDK | `install-sdks` / Install SDKs | `canonical` | `[安装 SDK](https://zilliverse.feishu.cn/wiki/Jo4bwNi6zi4zlHkN2bWcewFYnDc)` |

## Metadata Sync Rules

- Do not write `Seq. ID` because it is an auto-number field.
- For link rows, preserve source `Ref Target Doc`, `Slug`, `Labels`, `Placement Type`, and pseudo `Docs` link.
- For `install-sdks`, use Chinese target title `安装 SDK` for `Labels` and preserve the Chinese target doc URL.
- Copy source-controlled metadata into target records where present:
  - `Slug`
  - `Labels`
  - `Ref Target Doc`
  - `Targets`
  - `Placement Type`
  - `Keywords`
  - `Progress`
  - `Notebook`
  - `Beta`
- There are no parent links in the current source snapshot.
- Leave `Chapter` blank until the target options are corrected.

## 2026-06-18 Dry Run

| Class | Count | Notes |
|---|---:|---|
| `NEW_META_FROM_EXISTING_DOC` | 1 | Create `install-sdks` target record pointing to existing Chinese doc `安装 SDK`. |
| `NEW_LINK_META` | 6 | Create link records for RESTful API, Python, Java, Go, Node.js, and C++. |
| `UPDATE_DOC` | 0 | No Feishu document content changes are needed. |
| `META_ONLY` | 0 | Target table is empty. |
| `ORPHAN` | 0 | Target table is empty. |
| `MISSING_PARENT` | 0 | No source parent links are present. |

Before live writes, ask for explicit approval to create the `7` target records in table `tbloC4PVprwYo0P0`.
