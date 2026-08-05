# Tools -> 工具 Alignment

Use this maintained alignment file when syncing English source table `Tools` (`tblm1SbEPZaZrGZQ`) to Chinese target table `工具` (`tblRaa3JnIhllHb9`).

Last inspected: 2026-06-18.

## Sources

- English base: `Ac7xbs2k1ad7bjsCXr0ccHe9nMh`
- English table: `tblm1SbEPZaZrGZQ`
- Chinese base: `I6YUb1M0JajHrqsJGcLcZNh7neP`
- Chinese table: `tblRaa3JnIhllHb9`
- English wiki source container: `Agent Docs`, `https://zilliverse.feishu.cn/wiki/R8ZwwvHrJivIAyk8JkQchM0Anng`
- Chinese wiki root: `Cloud Docs`, `https://zilliverse.feishu.cn/wiki/XyeFwdx6kiK9A6kq3yIcLNdEnDd`
- Chinese wiki space ID: `7167193056431783939`

## Current State

- Source table snapshot: `24` records.
- Target table snapshot: `0` records.
- Source records contain `23` canonical wiki docs and `1` link row (`Zilliz CLI`).
- Chinese docs currently have no Tools equivalents.
- Target `Chapter` options are not aligned for Tools. They currently look like Deployment/BYOC options:
  - `Deploy BYOC on AWS`
  - `Deploy BYOC-I on AWS`
  - `Deploy BYOC on GCP`
  - `Deploy BYOC-I on Microsoft Azure`
- Do not populate `Chapter` for Tools records until the target field options are corrected or the user explicitly approves blank/unaligned Chapter handling.

## Target Wiki Structure

Create a non-bitable Chinese wiki container if it does not already exist:

- `Cloud Docs / 工具`

Then create the translated canonical docs under this container, preserving source hierarchy:

- `工具 / 智能体与提示词`
  - `Zilliz Skill`
  - `Claude Code 插件`
    - `安装与配置`
    - `核心能力`
    - `更多示例`
  - `Gemini CLI 扩展`
  - `AI 提示词`
    - `基础提示词`
    - `资源规划`
    - `定价`
    - `集群连接`
    - `Schema 设计`
    - `搜索`
    - `导入`
    - `迁移`
    - `访问控制`
    - `集成`
    - `按需搜索`
    - `回填与 Schema 迭代`
    - `索引`
    - `智能体插件与扩展`
- `工具 / Terraform Provider`

The `Zilliz CLI` source row is a `link` row only and should not create a wiki doc.

## Record Mapping

| Source Seq | Source slug/title | Chinese title | Placement |
|---:|---|---|---|
| 1 | `agents-and-prompts` / Agents & Prompts | 智能体与提示词 | canonical |
| 2 | `zilliz-skill` / Zilliz Skill | Zilliz Skill | canonical |
| 3 | `zilliz-plugin` / Claude Code Plugin | Claude Code 插件 | canonical |
| 4 | `zilliz-gemini-extension` / Gemini CLI Extension | Gemini CLI 扩展 | canonical |
| 6 | `zilliz-ai-prompts` / AI Prompts | AI 提示词 | canonical |
| 7 | `zilliz-plugin-setup` / Setup | 安装与配置 | canonical |
| 8 | `zilliz-plugin-capabilities` / Core Capabilities | 核心能力 | canonical |
| 9 | `zilliz-plugin-examples` / More Examples | 更多示例 | canonical |
| 13 | `zilliz-base-prompts` / Base Prompt | 基础提示词 | canonical |
| 14 | `zilliz-resource-planning-prompts` / Resource Planning | 资源规划 | canonical |
| 15 | `zilliz-pricing-prompts` / Pricing | 定价 | canonical |
| 16 | `zilliz-cluster-connection-prompts` / Cluster Connection | 集群连接 | canonical |
| 17 | `zilliz-schema-design-prompts` / Schema Design | Schema 设计 | canonical |
| 18 | `zilliz-search-prompts` / Search | 搜索 | canonical |
| 19 | `zilliz-import-prompts` / Import | 导入 | canonical |
| 20 | `zilliz-migration-prompts` / Migration | 迁移 | canonical |
| 21 | `zilliz-access-control-prompts` / Access Control | 访问控制 | canonical |
| 22 | `zilliz-integrations-prompts` / Integrations | 集成 | canonical |
| 23 | `on-demand-search` / On-Demand Search | 按需搜索 | canonical |
| 24 | `backfill-and-schema-iteration` / Backfill and Schema Iteration | 回填与 Schema 迭代 | canonical |
| 25 | `indexes` / Indexes | 索引 | canonical |
| 26 | `agent-plugins-and-extensions` / Agent Plugins and Extensions | 智能体插件与扩展 | canonical |
| 27 | `terraform-provider` / Terraform Provider | Terraform Provider | canonical |
| 28 | link / Zilliz CLI | Zilliz CLI | link |

## Parent Mapping

- `agents-and-prompts`: no bitable parent.
- `zilliz-skill`, `zilliz-plugin`, `zilliz-gemini-extension`, and `zilliz-ai-prompts` parent: `agents-and-prompts`.
- `zilliz-plugin-setup`, `zilliz-plugin-capabilities`, and `zilliz-plugin-examples` parent: `zilliz-plugin`.
- Prompt module pages (`zilliz-base-prompts` through `agent-plugins-and-extensions`) parent: `zilliz-ai-prompts`.
- `terraform-provider`: no bitable parent.
- `Zilliz CLI` link row: no bitable parent.

## Metadata Sync Rules

- Do not write `Seq. ID` because it is an auto-number field.
- Use Chinese titles for `Labels` and target `Docs` link titles.
- Preserve source-controlled metadata:
  - `Slug`
  - `Targets`
  - `Placement Type`
  - `Keywords`
  - `Progress`
  - `Notebook`
  - `Beta`
  - `Ref Target Doc`
  - `Parent`
- Preserve source `Docs` hierarchy by linking target rows to the newly created Chinese wiki docs.
- For the `Zilliz CLI` link row, preserve `Ref Target Doc` `/reference/cli/overview`, `Placement Type` `link`, and pseudo `Docs` `[Zilliz CLI](http://Zilliz CLI)`.
- Leave `Chapter` blank until the target options are corrected.

## Translation Rules

- Translate prose, headings, table content, and callouts to Chinese.
- Preserve code blocks, commands, URLs, package names, tool names, slugs, and environment/API identifiers.
- Preserve `<include ...>`, `<Procedures>`, `<callout>`, `<synced-source>`, and other Feishu/XML-like blocks where present.
- Preserve source document structure and parent/child hierarchy.

## 2026-06-18 Dry Run

| Class | Count | Notes |
|---|---:|---|
| `NEW_WIKI_CONTAINER` | 1 | Create `Cloud Docs / 工具` as a non-bitable wiki container if absent. |
| `NEW_TRANSLATED_DOC` | 23 | Translate and create canonical Chinese wiki docs. |
| `NEW_LINK_META` | 1 | Create `Zilliz CLI` link row only. |
| `NEW_RECORD` | 24 | Create target bitable rows after docs are created. |
| `UPDATE_DOC` | 0 | Target has no existing Tools docs. |
| `META_ONLY` | 0 | Target table is empty. |
| `ORPHAN` | 0 | Target table is empty. |
| `MISSING_PARENT` | 0 | Parent rows can be created before children. |

Before live writes, ask for explicit approval to create the wiki container, 23 translated wiki docs, and 24 target table records.
