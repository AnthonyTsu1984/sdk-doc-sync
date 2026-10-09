# SDK 参考文档行文与格式 Rubric（v1）

日期：2026-10-08
来源：操作员口述约定 + 五个样页实测提炼。
地位：polish 引擎（rust-overlay-pilot §2.6）与研发生成器契约的**共同标准**——同一份 rubric 两个消费端。修改走 PR，不随写随扩。
样页（golden fixtures，token 记录在案）：python `describe_collection()` LXASdPs6KoRfCJx11A1cl2Ssngg；java `describeCollection()` WEE6ddFntowCIixVMCmc3pESnug；go `DescribeCollection` Gqw1dx2TLodFGCx2prYcTgminRe；c++ `DescribeCollection()` LwzwdSZkSoV2Nrxsv49cyb4SnZf；go `CreateAlias`（仅 error 返回）YJuQdfyRfonHrTxLh6ucA3EDnQf。快照存 `tmp/rubric-exemplars/`，进 fixture 时固化进 `overlay/schema/fixtures/`。

## 1. RETURNS 形状（当前最大缺口：rust 全缺，其它语言部分缺）

统一骨架，各语言按变体落地：

```
**RETURN TYPE:**
*<type>*

**RETURNS:**
<一句话：返回什么，成功/失败语义>

```<lang>
<形状：结构体定义或示例字典>
```

**PARAMETERS:**
- **<field>** (*<dtype>*) -<描述>
  <嵌套字段按层级缩进递进>

**METHODS / ERROR HANDLING / EXCEPTIONS:**
<访问器列表 / 错误惯例>
```

语言变体（五个样页实测）：

| 语言 | RETURN TYPE | RETURNS | 响应字段 | 错误段 |
|---|---|---|---|---|
| python | `*dict*` | 一句话 + **Python fence 示例字典**（真实示例值，如 `'test_01'`、`field_id: 100`） | **PARAMETERS** bullets，嵌套 4 空格；`params` 内按字段类型列可选属性（max_length/dim/max_capacity…） | **EXCEPTIONS** |
| java | `*XxxResp*` | 一句话（无 fence） | **PARAMETERS** 平铺 bullets | **EXCEPTIONS**（MilvusClientException） |
| go | `*entity.X, error*` | 一句话 + **Go fence 完整 struct 定义** | **PARAMETERS** bullets（类型词可挂文档链接） | **ERROR HANDLING**（`error` 条目） |
| go（仅 error） | `*error*` | "Returns nil on success, or an error describing what went wrong." | —（无响应字段段） | **ERROR HANDLING** |
| c++ | —（无独立段） | `*Status*` + 一句话 | 响应字段以**多层嵌套 bullets 直接挂在 RETURNS 下**（层级 2 空格递进） | Status 行文内 |
| rust（目标；当前为零） | `*Result<T>*` | 一句话 + **Rust fence struct 定义** | **PARAMETERS** bullets | **METHODS**（accessor 紧凑行，沿用 §2.1 struct 页句式）+ RETURNS 行文内 `Error` 语义 |

规则：

- fence 展示**形状**（struct 定义 / 示例字典），不是调用示例——调用示例仍在 `## Example` 段；
- 响应字段描述与请求字段同一句式（§2 首句/冠词规则）；
- 嵌套 bullets 每层缩进 4 空格（与请求 PARAMETERS 一致）；
- 类型词可挂到对应类型页链接（go/cpp 样页示证），链接走 identity 解析。

## 2. 行文约定

首句规则（五样页全部吻合 "This operation …"；与 GLOBAL_LAYOUT_RULES `contentQuality.firstSentencePattern(s)` 现行裁定一致——2026-10-04 双式裁定，机器判定以 `src/renderers/sdk-layout-profiles.js` 数据为准，本文件是人读镜像与研发契约附件）：

- 方法页：`This operation <动词> …`
- 类/结构/容器页：`An <X> instance <做什么>`

描述句规则：

- 方法（builder/option）：第三人称单数动词起头，如 `Sets xxxx.`、`Gets xxxx.`
- 参数/字段描述：定冠词/不定冠词打头，如 `The name of the database.`、`A list of data types in strings.`

清理规则：

- 清除内部 notes、内部术语、面向维护者的描述；
- **行文不出现版本号**——与文档界面的版本信息冲突，误导读者；**仅有的两处合法版本号**：Deprecation 双行 callout 的 `Deprecated in v…`（GLOBAL `deprecation.prosePattern` 规定的固定形态）与 addedSince 类页脚元数据。版本差异用元数据承载，不进正文。

## 3. 治理接线

- **单一事实源**：机器可判定的规则以 `src/renderers/sdk-layout-profiles.js`（GLOBAL_LAYOUT_RULES v4 及各语言 profile）与 `contracts/invariants.json` 为准；本文件是它们的人读镜像 + 与研发契约的验收标准附件。两者不一致时以数据文件为准，并在同一 PR 内同步本文件。
- 本文件 = rust-overlay-pilot §2.6 polish 引擎的 rubric 数据源 + 与研发契约谈判的验收标准附件；
- 五样页为 layout/polish 的 golden fixtures；
- 语义门不变式照旧：参数项+描述语义保持、URL 集合有序不变、既有 fence 逐字节不动（RETURNS 形状**生成阶段**除外——那是受治理的新增内容，不是 polish）；
- python 样页示证：云措辞差异可内嵌在响应字段描述里（`auto_id` 条目的 Milvus/Zilliz Cloud include 对）——这类差异正是 targets 登记表要吃的数据，迁移语言时机械提取；
- 已知数据质量小项：py 样页示例字典里 `'num_partitions': 1，` 有全角逗号——fixtures 固化前先清。
