# 评审检查单(本仓 PR 清偿条件)

日期:2026-10-04
来源:docs/campaign-control-hardening.md §3.5(打回即铸 fixture)成文为仓库级评审规则。本检查单是"人工评审每拦下一类新缺陷,PR 必须如何清偿"的唯一权威版本;技能内条款见 api-reference-sync SKILL.md 的 `api.process-learning-capture` invariant。

## 1. 打回即铸(铁律)

**人工评审每拦下一类新缺陷,当 PR 必须新增反例 fixture(+ 规则或 runbook),否则不算清偿。人类眼睛不该对同类型缺陷看第二眼。**

- **操作员拒绝了一条机器可查的规则,就是流程事故**:当轮强制铸造 fixture 进写前/成稿离线校验,PR 不带不算清偿(campaign-control-hardening §3.7 铁律一的强化形态)。
- **运行时已自动记账**:writer-governance 边界的 typed 拒绝(code)进入 `tmp/invariant-violations.jsonl`(`kind: runtime_refusal`,注册过的 code 绑 invariantId,新 code 首次出现即学习原料;`npm run invariants:violations` 查看)。
- **会话侧已自动捕获**:two-gate `close-session` 把每条 change-request 与 changes_requested/rejected 决策机械转为 rule-candidate 草稿(`tmp/skill-feedback/api-reference-sync/candidates/`),或显式抑制(带 rationale);close 对未捕获事件 fail-closed。评审打回的材料因此**永远有痕**——分诊时从草稿出发,不要再从记忆出发。
- **固化路径**:按四分诊规则(确定性可检→invariant / 诊断→runbook / 措辞→eval / 语言差异→layoutRules 数据)走五步管道(bullet→registry→enforcer→fixture→绕过收口);rule-candidate 晋升走 `doc-ops-core/bin/skill-feedback.js`(3 独立支持 + 3 held-out + 高危禁自动,`activationAuthorized` 恒 false,激活需独立评审过的仓库变更)。
- **为什么不铸必须显式**:`sdk-review-session.js record-learning-suppression --event-key <key> --rationale <text>`;rationale 为空的抑制无效。

## 2. 常规 PR 检查(既有门禁的索引)

- admission 全绿(js-syntax / focused-tests / invariant-coverage --strict / 各测试套件),CI `skill-admission` ADMITTED。
- 改 `## Domain Invariants` bullet 必须同 diff 更新 `contracts/invariants.json`(statementDigest 重算)+ 可执行 fixture,否则 `INVARIANT_STATEMENT_DIGEST_MISMATCH` / `INVARIANT_COVERAGE_REQUIRED` 拒收。
- 弱化既有 invariant 需先落一份独立评审过的未过期 waiver(`contracts/invariant-waivers.json`)。
- 每批验收必含:反例 fixture 引用本轮真实失误(campaign-control-hardening §10 矩阵即验收清单一一对应)。
