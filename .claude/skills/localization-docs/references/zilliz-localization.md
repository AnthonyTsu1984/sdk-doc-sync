# Zilliz Localization Reference

Load this reference when using `localization-docs` for the Zilliz Feishu docs bitables and wiki roots.

## Canonical Bases

English source:

- Bitable URL: `https://zilliverse.feishu.cn/base/Ac7xbs2k1ad7bjsCXr0ccHe9nMh?table=tblWv7PjNDsexddH&view=vewggN2Xfc`
- Base token: `Ac7xbs2k1ad7bjsCXr0ccHe9nMh`
- Table ID: `tblWv7PjNDsexddH`
- View ID: `vewggN2Xfc`
- Wiki root URL: `https://zilliverse.feishu.cn/wiki/OUWXw5c4gia34ZkQUcEcMFbWn6s`
- Wiki root token: `OUWXw5c4gia34ZkQUcEcMFbWn6s`
- Language: `en`
- Table count: `9`

Localized target:

- Bitable URL: `https://zilliverse.feishu.cn/base/I6YUb1M0JajHrqsJGcLcZNh7neP?table=tblYpqCgevikMomb&view=vewggN2Xfc`
- Base token: `I6YUb1M0JajHrqsJGcLcZNh7neP`
- Table ID: `tblYpqCgevikMomb`
- View ID: `vewggN2Xfc`
- Wiki root URL: `https://zilliverse.feishu.cn/wiki/XyeFwdx6kiK9A6kq3yIcLNdEnDd`
- Wiki root token: `XyeFwdx6kiK9A6kq3yIcLNdEnDd`
- Default target language assumption: `zh`; confirm if the user needs another locale.
- Table count: `8`

## Table Inventory

English source tables:

| Source table name | Source table ID |
|---|---|
| Deployment | `tblLMqwkNDtAEK5p` |
| Get Started | `tbl9BeCMjBmalJVb` |
| Development | `tblWv7PjNDsexddH` |
| Management | `tblZMzoITXNsyKmQ` |
| Client Libraries | `tblgHPdSvZP8gUz6` |
| Tools | `tblm1SbEPZaZrGZQ` |
| AI Models | `tblb929onfgAPW90` |
| Architecture | `tblh7utKxg0dgdTo` |
| Solution | `tblbIuN0ns3QWcQR` |

Localized target tables:

| Target table name | Target table ID |
|---|---|
| 从这里开始 | `tblsw6S3J0ekcgNB` |
| 开发指南 | `tblYpqCgevikMomb` |
| 运维指南 | `tblMuHkoG4qMugeX` |
| 客户端参考 | `tbloC4PVprwYo0P0` |
| 工具 | `tblRaa3JnIhllHb9` |
| AI 模型 | `tblr7Zec2ReTfRmw` |
| 产品架构 | `tblzcM4ERJ00Wjjx` |
| 解决方案 | `tblkdIEI58OHEJn0` |

## Table Pair Mapping

Use this mapping for per-table diffing and synchronization:

| Source | Source table ID | Target | Target table ID | Status |
|---|---|---|---|---|
| Get Started | `tbl9BeCMjBmalJVb` | 从这里开始 | `tblsw6S3J0ekcgNB` | mapped |
| Development | `tblWv7PjNDsexddH` | 开发指南 | `tblYpqCgevikMomb` | mapped |
| Management | `tblZMzoITXNsyKmQ` | 运维指南 | `tblMuHkoG4qMugeX` | mapped |
| Client Libraries | `tblgHPdSvZP8gUz6` | 客户端参考 | `tbloC4PVprwYo0P0` | mapped |
| Tools | `tblm1SbEPZaZrGZQ` | 工具 | `tblRaa3JnIhllHb9` | mapped |
| AI Models | `tblb929onfgAPW90` | AI 模型 | `tblr7Zec2ReTfRmw` | mapped |
| Architecture | `tblh7utKxg0dgdTo` | 产品架构 | `tblzcM4ERJ00Wjjx` | mapped |
| Solution | `tblbIuN0ns3QWcQR` | 解决方案 | `tblkdIEI58OHEJn0` | mapped |
| Deployment | `tblLMqwkNDtAEK5p` | TBD | TBD | source-only; ask before creating or merging into another target table |

Do not ignore source-only tables. For `Deployment`, stop and ask whether to create a localized target table, merge it into an existing target table, or leave it as source-only.

## Environment

Required for Feishu API access:

```env
APP_ID=...
APP_SECRET=...
FEISHU_HOST=https://open.feishu.cn
WIKI_SPACE_ID=...
```

Optional by workflow:

```env
ANTHROPIC_API_KEY=...
DEEPL_API_KEY=...
FIGMA_API_KEY=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=...
AWS_BUCKET=...
IMAGE_BED_URL=...
```

Use `FIGMA_API_KEY` when exporting Figma iframe previews from source docs. Use the AWS settings only when the workflow uploads exported media to S3 rather than local/Feishu storage.

## Library Map

- Translator CLI: `npm run translate -- ...`
- Translator entrypoint: `.claude/skills/sdk-doc-sync/bin/feishu-doc-translator.js`
- Orchestrator: `.claude/skills/sdk-doc-sync/src/feishu-doc-translator/index.js`
- Bitable reader: `.claude/skills/sdk-doc-sync/src/feishu-doc-translator/bitable-reader.js`
- Diff engine: `.claude/skills/sdk-doc-sync/src/feishu-doc-translator/translation-diff.js`
- Markdown translator: `.claude/skills/sdk-doc-sync/src/feishu-doc-translator/doc-translator.js`
- Feishu to Markdown: `.claude/skills/sdk-doc-sync/src/feishu-to-markdown.js`
- Markdown to Feishu: `.claude/skills/sdk-doc-sync/src/markdown-to-feishu.js`
- Bitable writer: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/bitable-writer.js`
- Low-level docs library: `.claude/skills/sdk-doc-sync/lib/lark-docs/`

## Useful Commands

Inspect field schemas:

```bash
lark-cli base +field-list --base-token Ac7xbs2k1ad7bjsCXr0ccHe9nMh --table-id tblWv7PjNDsexddH --offset 0 --limit 200
lark-cli base +field-list --base-token I6YUb1M0JajHrqsJGcLcZNh7neP --table-id tblYpqCgevikMomb --offset 0 --limit 200
```

List all tables:

```bash
lark-cli base +table-list --base-token Ac7xbs2k1ad7bjsCXr0ccHe9nMh --as user
lark-cli base +table-list --base-token I6YUb1M0JajHrqsJGcLcZNh7neP --as user
```

Inspect records:

```bash
lark-cli base +record-list --base-token Ac7xbs2k1ad7bjsCXr0ccHe9nMh --table-id tblWv7PjNDsexddH --view-id vewggN2Xfc --page-size 100
lark-cli base +record-list --base-token I6YUb1M0JajHrqsJGcLcZNh7neP --table-id tblYpqCgevikMomb --view-id vewggN2Xfc --page-size 100
```

Fetch a doc as Markdown:

```bash
lark-cli docs +fetch --api-version v2 --as user --doc "https://zilliverse.feishu.cn/wiki/OUWXw5c4gia34ZkQUcEcMFbWn6s" --doc-format markdown
```

Smoke-test the current default-table localization diff:

```bash
npm run translate -- \
  --source-bitable Ac7xbs2k1ad7bjsCXr0ccHe9nMh \
  --target-bitable I6YUb1M0JajHrqsJGcLcZNh7neP \
  --source-root OUWXw5c4gia34ZkQUcEcMFbWn6s \
  --target-root XyeFwdx6kiK9A6kq3yIcLNdEnDd \
  --source-lang en \
  --target-lang zh \
  --drive-type wiki \
  --dry-run
```

The command above uses the existing CLI and therefore only exercises the default table selected by the reader. For actual localization, run the dry-run once for every mapped table pair. Use the library programmatically with `BitableReader({ baseToken, tableId })` for each pair, or patch `.claude/skills/sdk-doc-sync/bin/feishu-doc-translator.js` and `.claude/skills/sdk-doc-sync/src/feishu-doc-translator/index.js` to pass `sourceTable` and `targetTable` into the readers.

## Action Semantics

The existing `TranslationDiff` class:

- matches records by exact slug by default;
- skips records where `Type` is `VirtualNode` or `Module`;
- marks missing target documents as `NEW`;
- marks records as `UPDATE` when source `Last Modified At` is newer than target, when target has no modification date, or when source deprecation metadata is missing in target;
- marks target-only records as `ORPHAN`.

If the target table has localized field names or different option values, normalize those fields before trusting the diff.

## Table Metadata Alignment

Compare and align these field categories before document work:

- document link field, usually `Docs`;
- slug field, usually `Slug`, often computed;
- type/category field, usually `Type`;
- parent-record link field, usually `Parent` or the Chinese parent field;
- status/progress fields, usually `Progress`;
- source and target date fields, usually `Added Since`, `Last Modified At`, and `Deprecate Since`;
- tag fields, usually `Labels`, `Keywords`, `Targets`, and any locale-specific publication fields.

Do not add or rename fields without approval. If field alignment requires schema changes, present a before/after field map first.

For all table pairs, first collect:

- `+field-list` for source and target tables;
- `+view-list` if view-specific filters control publication scope;
- a small `+record-list` sample to confirm field value shapes;
- the source/target parent-record field names and link behavior.

## Table-Specific Exceptions

### Get Started -> 从这里开始

Use [get-started-alignment.md](get-started-alignment.md) as the maintained alignment file for this table pair. It records the metadata-only sync plan, target title mapping, parent handling, and the BYOC placement exception.

Apply these exceptions when aligning source table `tbl9BeCMjBmalJVb` to target table `tblsw6S3J0ekcgNB`:

- Chinese docs do not have a separate Deployment section. Therefore `BYOC Overview` / slug `byoc-intro` from the English `Deployment` table is intentionally placed in the Chinese `从这里开始` table as `BYOC 简介`.
- Treat `BYOC 简介` as a valid localized Get Started entry, not as a target-only orphan.
- Populate `BYOC 简介` metadata from the English `Deployment` source row `byoc-intro`, while preserving the Chinese target doc URL.
- Do not populate the target `Chapter` field for Get Started until its options are corrected. The current target `Chapter` options are Deployment/BYOC-specific and do not match English Get Started.

### Development -> 开发指南

Use [development-alignment.md](development-alignment.md) as the maintained alignment file for this table pair. It records the matching strategy, Chinese title overrides, Chinese SaaS exceptions, created localized docs, and the latest full-table metadata verification status.

Apply these exceptions when aligning source table `tblWv7PjNDsexddH` to target table `tblYpqCgevikMomb`:

- `Text Embedding Function Overview` / slug `text-embedding-overview` is deprecated. The source record was intentionally removed from the English docs; do not add it to the localized target and do not report it as missing.
- `OpenAI`, `Voyage AI`, and `Cohere` under Text Embedding Functions are global-SaaS-only provider docs. Chinese SaaS uses `硅基流动` only. Do not add the global provider records to the Chinese target.
- `Cohere Ranker` and `Voyage AI Ranker` are global-SaaS-only model ranker docs. Chinese SaaS uses `硅基流动 Ranker` only. Do not add these global provider ranker records to the Chinese target.
- Treat existing target records `硅基流动` and `硅基流动 Ranker` as valid localized/provider-specific equivalents, not as orphan records.
- Global SaaS storage integration docs `Integrate with AWS S3`, `Integrate with Google Cloud Storage`, and `Integrate with Azure Blob Storage` do not apply to Chinese SaaS. Do not add those global provider records to the Chinese target.
- Chinese SaaS storage integration uses `阿里云对象存储` and `Amazon S3` instead:
  - `阿里云对象存储`: `https://zilliverse.feishu.cn/wiki/IwAbwxWzQiGVc0khATdcOoCbnCg`
  - `Amazon S3`: `https://zilliverse.feishu.cn/wiki/Bt3swdJKaigDQgkrzSwcoEEgnV4`
- Treat these two Chinese SaaS storage docs as valid localized/provider-specific equivalents for storage integration, not as unrelated target-only records.
- When producing an add list for this table pair, report excluded global-SaaS-only/deprecated records separately from true missing records.

### Management -> 运维指南

Use [management-alignment.md](management-alignment.md) as the maintained alignment file for this table pair. It records the Chinese wiki pool, current empty-target status, schema issue, high-confidence Chinese counterparts, China-specific provider/payment exceptions, and docs that are intentionally not applicable to Chinese SaaS.

Apply these exceptions when aligning source table `tblZMzoITXNsyKmQ` to target table `tblMuHkoG4qMugeX`:

- The target table is currently empty. Create section records with pseudo links and canonical/ref records with existing Chinese wiki doc URLs when a counterpart is listed in `management-alignment.md`.
- Do not populate the target `Chapter` field until its options are corrected for Management or the user explicitly approves blank/unaligned Chapter handling.
- For storage integrations, Chinese SaaS uses `阿里云对象存储` and `Amazon S3`. Do not add Global-only Google Cloud Storage or Azure Blob Storage storage-integration records to the Chinese target.
- For private endpoint docs, Chinese SaaS uses Aliyun, Tencent Cloud, AWS China, and Huawei private-link docs. Do not add Global-only GCP Private Service Connect or Azure Private Link records to the Chinese target.
- For billing/payment, Chinese SaaS has China-specific enterprise verification, cash recharge, Aliyun marketplace, Amazon marketplace, order, invoice, and renewal docs. Do not blindly mirror Global credit-card and AWS/GCP/Azure marketplace records.
- Treat Management records marked `Chinese: N/A` or `NOT_APPLICABLE_TO_CHINESE_SAAS` in `management-alignment.md` as intentionally absent from Chinese SaaS. Do not create target records for them and do not report them as unresolved missing docs.

### Client Libraries -> 客户端参考

Use [client-libraries-alignment.md](client-libraries-alignment.md) as the maintained alignment file for this table pair. It records the empty-target state, link-row handling, existing Chinese `安装 SDK` doc, and metadata-only record creation plan.

Apply these rules when aligning source table `tblgHPdSvZP8gUz6` to target table `tbloC4PVprwYo0P0`:

- Create target records for the six external reference link rows (`RESTful API`, `Python`, `Java`, `Go`, `Node.js`, and `C++`) using the source `Ref Target Doc` paths and pseudo `Docs` links.
- Create the canonical `install-sdks` row using the existing Chinese doc `安装 SDK`: `https://zilliverse.feishu.cn/wiki/Jo4bwNi6zi4zlHkN2bWcewFYnDc`.
- Do not create or update wiki docs for this table unless the user explicitly asks for content refresh. The Chinese `安装 SDK` doc already exists.
- Do not populate the target `Chapter` field for Client Libraries until its options are corrected. The current target `Chapter` options are Deployment/BYOC-specific and do not match Client Libraries.

### Tools -> 工具

Use [tools-alignment.md](tools-alignment.md) as the maintained alignment file for this table pair. It records the empty-target state, no-existing-Chinese-equivalent assumption, target wiki container plan, translation plan, hierarchy, and bitable record creation plan.

Apply these rules when aligning source table `tblm1SbEPZaZrGZQ` to target table `tblRaa3JnIhllHb9`:

- Chinese docs currently have no existing Tools equivalents. Translate source docs and create new Chinese wiki docs.
- Create a non-bitable wiki container `工具` under Chinese `Cloud Docs` if it does not already exist, then place translated Tools docs under it.
- Create target bitable records for the 23 canonical docs and one `Zilliz CLI` link row.
- Preserve source `Slug`, `Targets`, `Placement Type`, `Keywords`, `Progress`, `Notebook`, `Beta`, `Ref Target Doc`, and parent hierarchy.
- Use Chinese titles in target `Labels` and target `Docs` link titles.
- Do not populate the target `Chapter` field for Tools until its options are corrected. The current target `Chapter` options are Deployment/BYOC-specific and do not match Tools.

## Media And Embeds

Round-trip support exists in `markdown-to-feishu.js` and `larkDocWriter.js`:

- Images become Markdown images and are uploaded by `MarkdownToFeishu.__process_image_blocks()` during `push_markdown()`.
- Boards are exported with comments like `<!-- feishu-block: board, token: ... -->` and can be recreated as board blocks if the token remains valid.
- Figma embeds are iframe blocks. The exporter can capture Figma previews with `FIGMA_API_KEY`; the importer recreates iframe blocks from `<!-- feishu-block: iframe, url: ..., type: ... -->`.
- Supademo insertions export as `<Supademo id="..." title="" ... />` and import as Feishu add-on blocks with component type `blk_682093ba9580c002363b9dc3`.
- Sheets use `<!-- feishu-block: sheet, ... -->` metadata where supported.

For docs with boards, iframes, sheets, or Supademo blocks, verify the live Feishu block structure after update. Do not rely only on Markdown diff output.

## Approval Checklist

Before live writes, show:

- base/table/root tokens;
- translator type and language pair;
- number of `NEW`, `UPDATE`, `SKIP`, `ORPHAN`, and `META_ONLY` records;
- the first batch of affected slugs and titles;
- whether any parent records are missing in target;
- whether any docs contain image-like or add-on blocks;
- metadata fields that will be created or changed.

After live writes, refetch target records and a sample of changed docs. Confirm the bitable links resolve and the docs sit under the localized wiki root.
