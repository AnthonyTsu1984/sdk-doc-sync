# Get Started -> 从这里开始 Alignment

Use this maintained alignment file when syncing English source table `Get Started` (`tbl9BeCMjBmalJVb`) to Chinese target table `从这里开始` (`tblsw6S3J0ekcgNB`).

Last inspected: 2026-06-18.

## Sources

- English base: `Ac7xbs2k1ad7bjsCXr0ccHe9nMh`
- English Get Started table: `tbl9BeCMjBmalJVb`
- English Deployment table for BYOC exception: `tblLMqwkNDtAEK5p`
- Chinese base: `I6YUb1M0JajHrqsJGcLcZNh7neP`
- Chinese Get Started table: `tblsw6S3J0ekcgNB`
- English wiki root: `https://zilliverse.feishu.cn/wiki/OUWXw5c4gia34ZkQUcEcMFbWn6s`
- Chinese wiki root: `https://zilliverse.feishu.cn/wiki/XyeFwdx6kiK9A6kq3yIcLNdEnDd`

## Current State

- Source Get Started snapshot: `11` records.
- Target 从这里开始 snapshot: `12` records.
- All target docs already exist. Current sync work is metadata-only.
- The extra target row `BYOC 简介` is intentional because Chinese docs do not have a separate Deployment section.
- Target `Chapter` options are not aligned for Get Started. They currently look like Deployment/BYOC options:
  - `Deploy BYOC on AWS`
  - `Deploy BYOC-I on AWS`
  - `Deploy BYOC on GCP`
  - `Deploy BYOC-I on Microsoft Azure`
- Do not populate `Chapter` for Get Started records until the target field options are corrected or the user explicitly approves blank/unaligned Chapter handling.

## BYOC Placement Exception

Chinese docs do not have a separate Deployment section. Therefore the English Deployment doc `BYOC Overview` is intentionally placed under Chinese `从这里开始`.

Use this source row for the target `BYOC 简介` metadata:

| Source table | Source slug/title | Chinese title | Chinese wiki token |
|---|---|---|---|
| Deployment (`tblLMqwkNDtAEK5p`) | `byoc-intro` / BYOC Overview | BYOC 简介 | `DOUbw9IGNidZoZk541EcxkH1nY7` |

Preserve the Chinese target doc URL while copying source-controlled metadata from the English Deployment row:

- `Slug`: `byoc-intro`
- `Targets`: `Zilliz.PaaS`
- `Placement Type`: `canonical`
- `Keywords`: `zilliz, byoc, milvus, vector database`
- `Progress`: `Draft`
- `Notebook`: `FALSE`
- `Beta`: `CONTACT SALES`

Treat `BYOC 简介` as a valid localized Get Started row, not as an orphan.

## Record Mapping

| Target Seq | Target title | Source table | Source slug/title |
|---:|---|---|---|
| 1 | BYOC 简介 | Deployment | `byoc-intro` / BYOC Overview |
| 2 | 注册账号 | Get Started | `register-with-zilliz-cloud` / Register with Zilliz Cloud |
| 3 | 免费试用 Zilliz Cloud | Get Started | `free-trials` / Try Zilliz Cloud For Free |
| 4 | 快速开始 | Get Started | section row / Quickstarts |
| 5 | 快速开始：安装 CLI 与 Agent 集成 | Get Started | `cli-and-agent-integration-guide` / Quickstart to CLI & Agent Integration |
| 6 | 快速开始：使用 Serving 集群 | Get Started | `quick-start` / Quickstart to Serving Cluster |
| 7 | 快速开始：按需搜索 | Get Started | `quick-start-to-on-demand-search` / Quickstart to On-Demand Search |
| 8 | 快速开始：External Data Lake Search | Get Started | `quick-start-to-external-data-lake-search` / Quickstart to External Data Lake Search |
| 9 | Zilliz Cloud 版本对比 | Get Started | `select-zilliz-cloud-service-plans` / Plan Comparison |
| 10 | 选择合适的集群类型 | Get Started | `cu-types-explained` / Cluster Types |
| 11 | 云服务提供商和地域 | Get Started | `cloud-providers-and-regions` / Cloud Providers & Regions |
| 12 | 常见问题 | Get Started | `faqs` / FAQs |

## Metadata Sync Rules

- Do not write `Seq. ID` because it is an auto-number field.
- Preserve target `Docs` URLs and Chinese document titles.
- Use Chinese target document titles for `Labels`.
- Copy source-controlled metadata into target records:
  - `Slug`
  - `Targets`
  - `Placement Type`
  - `Keywords`
  - `Progress`
  - `Notebook`
  - `Beta`
  - `Parent`
- For the `快速开始` section row, keep `Slug` blank because the English source section has no slug.
- For quickstart child rows, set `Parent` to the target `快速开始` section record.
- Leave `Chapter` blank until the target options are corrected.

## 2026-06-18 Dry Run

| Class | Count | Notes |
|---|---:|---|
| `META_ONLY` | 12 | Fill metadata for existing target records only. |
| `NEW` | 0 | No docs or records need to be created. |
| `UPDATE_DOC` | 0 | No Feishu document content changes are needed. |
| `ORPHAN` | 0 | `BYOC 简介` is covered by the BYOC placement exception. |
| `MISSING_PARENT` | 0 | Quickstart child rows can link to the existing target `快速开始` section record. |

Before live writes, ask for explicit approval to apply the `META_ONLY` updates to target table `tblsw6S3J0ekcgNB`.
