# 切片 3-2 执行计划：invariants 注册表补账 + SKILL.md 判例法瘦身重写

依据：`tmp/skill-thin-refactor-audit.md`（只读审计定稿 2026-10-15）。分支 `feat/thin-skill-refactor`（worktree `../fmb-thin-skill`）。

## 步骤与提交点

1. **A\* 注册表补账**：6 条 declared→runtime-enforced（global-layout-rules / stateful-class-identity / organization-inventory-binding / changed-inherited-copy-patch / unchanged-inherited-metadata-update / post-write-verification），enforcers 证据先 grep 核实审计行号再写入（文件+拒绝码）；notes 记录残留欠账（审计 B-3 前提已部分失效：LAYOUT_EXAMPLE_HEADING 已存在于 layout-conformance.js:226-231，随条目注明）。→ commit `invariants: backfill A* enforcers (audit §2)`
2. **判例归档**：脚本 cp SKILL.md 现全文 → `references/skill-history/2026-10-15-pre-thin.md`（不读入上下文）。
3. **SKILL.md 重写**（50,656 B → 靶心 ≤16KB）：frontmatter/Trigger/Output/Required References 保留；Permission 判断核保留、机械子句指针化；Shared Contract 判例压缩+裁定日期；Gates 保留门表+批解析语义+诚实边界；Workflow 8 步压缩，步 2/步 8 中批 15 切片 3-3 要改的段落只留占位指针；Invariants 24 条 A 类压指针行、6 条 C 类留原则句、B 类留一行原则；新增「新判例入法口径」节（审计 §6）。→ 与 2 同 commit 或紧随 commit
4. **元 lint**：`scripts/skill-md-lint.js`（大小 ≤16KB、指针完整性、references 引用一致、invariant marker 齐全）+ offline 测试 + write-entrypoints 只读注册。→ commit
5. 入口编排 `.zcode/commands/api-reference-sync.md` 改指针加载（gitignored，直接改不入库）。
6. 全套测试 + runtime-enforced 计数 ≥23 验证 + 报告。

## 完成标准

SKILL.md ≤16KB 且 lint 绿；runtime-enforced ≥23；全仓测试绿；Required References/Trigger 面保留；主树干净。
