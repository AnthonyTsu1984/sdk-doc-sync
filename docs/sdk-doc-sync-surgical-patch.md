# 外科补丁（手工 apiPatchPlan）——使用方法与教训固化

> 2026-10-07 py-v30 batch-4 战役沉淀。背景：search_iterator / search 两页为操作员手改高密度页（15/36 处 `<include target=...>` 标记、bullet 内 callout、include 包裹的兄弟参数组），schema-first 再生无法保真复刻。经操作员裁定与五轮迭代，固化为手工外科 apiPatchPlan 路线，并连带修复两个 harness 缺陷（type-50 preserve 缺失、pageFacts 扁平格式 callout 归属失效）与一条规则数据（L2/IP/COSINE denylist）。

## 何时走外科路线（判定标准）

schema-first 再生（默认 UPDATE 渲染）把 context 参数渲染成整页 desired content,与 live 页做 section 级 diff——任何差异都会以 `replace-section` **删除整段再重建**。因此只要页面存在"再生无法逐字节复刻"的内容,重建就是破坏:

- 操作员手改的 `<include target="...">` 标记（内联、或包裹兄弟参数组——后者超出 context params 模式表达力,即使 pageFacts 层级遍历修复后也一样）;
- bullet 内嵌 callout（如 limit 里的聚合注意事项）;
- 任何操作员手工排版结构。

`api.literal-include-preserved` 已禁止含标记页整页重建;本路线是它的推广:**计划中的 desired 块 = live 块原文 + 评审过的 delta——未改动内容永不再生,保真由构造保证**。

注意:REBUILD（整页替换）对含标记页被 `INCLUDE_REBUILD_FORBIDDEN` 显式禁止（"surgical child-block insertion is the only sanctioned edit path"）;verified-doc 技能的 `VERIFIED_DOC_SURGICAL` 锚点模式是技能外语境的同类机制。

## 接线方式

计划挂到 **scope action 的 `planningContext.apiPatchPlan`**（上下文解析优先级最高）。规划器把它签进批次摘要（工件字节 + 计划),executor 经 `applyApiPatch` → `m2f.apply_api_patch` 执行。工件仍带 `layout`（gating + 落地后验证用）。**门预览显示的是 provider 的 schema-first 渲染（context 驱动的期望形态）,落地是外科 delta——门材料必须明示两者关系。**

## 计划构建程序（每步都有对应的翻车实录）

1. **拉 live 块**（`m2f.get_document_blocks`）。载荷是扁平的:**块的 `children` 是 ID 字符串数组**,载荷锚定一个 page 块（block_type 1）。
2. **替换子树必须经 id→块对象映射重建**（`buildSubtree`）。ID 串留在 children 里 = 执行器 level-2 populate 把字符串当块 POST → `field_violations: children[*].block_type` → 创建失败。重建后自校验:每个节点是对象、数字 block_type、无 block_id/parent_id 残留、全树无 ID 串 children。（search_iterator 三轮失败的第一根因。）
3. **新增内容块:克隆 live 页已验证形状改字段,不走 m2f markdown 解析**。两个坑:①fresh 实例与 post-fetch 实例对同一 markdown 的解析块数可能不同（确定性分歧,实测复现）;②强调写在链接文本内会输出字面星号（正确形态:强调包在链接外 `[*X*](url)`）。链接存在 `text_element_style.link.url`（百分号编码）。
4. **`desiredRoleSequence` = `buildApiSectionModel` 对 live 页的实际角色**。`RETURN TYPE:` 是独立的 `result-type` 角色——写成 `returns` 就是 SECTION_SEQUENCE_MISMATCH。
5. **`insertAt` = 删除后位置**。执行器先删（按位置从后往前）再插（按 insertAt 升序）。多插入按升序声明。
6. **`deleteBlockIds` 只放页面直接子级**。删父级联整个子树（已在一次性草稿页实证:86→82 整子树移除）;嵌套子块的直接删除被 API 拒绝（"not a direct child"）。
7. **呈门前本地模拟**:在 live 块列表副本上复刻执行器语义（删从后往前、插按 insertAt 升序、每块连同嵌套子块展开）,再对预测页跑 `buildApiSectionModel` + `checkLayoutConformance`。零违例才呈门。

## 执行器安全链（页面被什么保护）

- **创建侧字段校验先于任何删除**——拒绝即零副作用（实测两次:62991dbf/98261480 页面 33 块原样）。
- **verifyDocument 先于 Bitable 变更**——失败触发 `rollbackRevert` 自动复原（实测 16b8241f/a0c3713b 两次自愈）。
- 记录变更只在两者都通过后发生。
- **失败 journal 占据批次 digest 槽位**——同 digest 重执行被拒。恢复程序 = 操作员裁定 `RECONCILE_ARCHIVE_FAILED_JOURNAL <unit> sha256:<journal-semantic-digest>`（语义摘要用 `digestSemantic` 对解析条目复算核验）→ 字节拷贝归档 → 从槽位移除 → 同已批准 digest 重执行。

## 整页版式检查会咬人的既有页面特质（计划要主动消解）

`verifyDocument` 对**打补丁后的页**跑 section model + 版式一致性——页面既有特质与计划缺陷同责:

- `PARAM_DESC_REQUIRED`:无描述的参数 bullet（search 页的 kwargs;search_iterator 页同款）→ 加描述 op（源码 docstring 为忠实来源）。
- `SECTION_SEQUENCE_MISMATCH`:期望角色序列必须用实际角色（`result-type` 是独立角色,不是 `returns`）。
- `INTERNAL_NOTE_LEAK`:裸 "Notes" 行。**曾经误报**:pageFactsFromBlocks 把扁平拉取数组当顶层遍历,治理 callout 的内层 "Notes" 标题以顶层身份再次入流——已修（538a285:载荷锚定 page 块且 children 可解析时走真实层级遍历,三处递归 walk 接入 id 解析,回归测试覆盖平铺格式）。修复后 callout 内 Notes 正确判定为受治理。
- `RETURNS_MIN_DEPTH`:散文式 RETURNS（无响应字段列表）不满足强式规则 → 需要补响应字段 op（字段名可从页面自身示例输出取证,如 search 的 id/distance/entity）。

## m2f 解析器事实清单

- 强调在链接文本内 → 字面星号;强调包链接外 → 斜体+链接 ✓。
- children-create API 拒绝内嵌 children 的块 → populate 逐层递归,载荷必须逐层剥。
- fresh/post-fetch 实例解析分歧存在 → 新增内容一律克隆 live 形状手改。
- callout 块类型 = 19;`reference_synced` = 50（已入 preserve 集,`source_synced` = 49）。
- zsh heredoc/node -e 转义会静默改坏脚本——**一律用 Write 工具写脚本文件**,拒绝 `node -e` 补丁。

## 与其他路径的关系

- schema-first 再生:campaign 生成页（context 完整描述内容）的默认 UPDATE 渲染。
- REBUILD:整页替换,含标记页禁止。
- verified-doc 的 `VERIFIED_DOC_SURGICAL` 锚点模式:本技能外语境的同构机制（锚点对替换,不支持插入——插入需走本路线或其推广）。

## 战役案例索引（py-v30 batch-4,2026-10-07）

- search_iterator:v6 三 op 成功落地（语法 +2 行、尾插 external_filter_func bullet、kwargs 补描述）。三轮失败链:ID 串 children（根因）→ 嵌套子块删除拒绝 → pageFacts 扁平格式误报（促成 harness 修复）。
- search:v2 四 op（语法 +1 行、fc bullet、kwargs 描述、RETURNS 强式）一次通过（验证器修复后）。
- 台账关键字:`py-v30-b4-write-searchiterator-v3`、`py-v30-b4-write-search-v2`、`py-v30-search-journal-reconcile`、`py-v30-pagefacts-flat-format-fix`、`py-v30-denylist-metric-literals`、`py-v30-preserve-reference-synced`。
