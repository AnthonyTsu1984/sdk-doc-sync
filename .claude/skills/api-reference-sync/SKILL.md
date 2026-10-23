---
name: api-reference-sync
description: Use when a Milvus or Zilliz SDK, CLI, REST API, or OpenAPI release must be scanned and diffed against existing Feishu or zdoc documentation to create, update, deprecate, backfill, or reparent API reference records. Do not use for drafting a standalone narrative page, localization, or filling language tabs in one procedure document.
---

# API Reference Sync

把一个 SDK 版本发布同步到飞书 API Reference 库。**直线流程，一个 runner，三个命令。**

## 流程（全流程就这四步）

1. **备料（确定性，无模型）**：`intake-assemble` 扫 SDK 源码 + dump PR 页 → 组装每单元最终内容（candidate-spec → reviewed-context，字节保真由 `compare-update-spec-context` 断言）。
2. **手写一份小配置** `sync-config.json`（语言/轨/飞书 token/工件路径；旧战役用 `init --from-plan` 一键迁移）。
3. **`bin/sdk-release-sync.js sync --config <cfg>`**：展示单元清单 → 操作员确认 → 逐单元 写→验→Draft。
4. **失败后**：重跑 `sync`（自动跳过已完成）；**WIP 滞留用 `recover` 清扫**（文档已写对则直接终化，没写对则重写）。`status` 随时看全表状态。

```bash
# 从旧 campaign plan 迁移配置（一次性）
node bin/sdk-release-sync.js init --from-plan tmp/api-reference-sync/campaign-plans/python-v30-sync/campaign-plan.json

# 看状态（只读）
node bin/sdk-release-sync.js status --config tmp/api-reference-sync/campaign-plans/python-v30-sync/sync-config.json

# 收敛（先弹清单确认）
node bin/sdk-release-sync.js sync --config <cfg>

# WIP 兜底清扫（可定时；发布是定时的，WIP 不许滞留超过一个清扫周期）
node bin/sdk-release-sync.js recover --config <cfg>
```

## 容错语义（runner 内建，操作员不需要操心）

- **传输类失败**（网络超时/限流/5xx）自动指数退避重试，写路径幂等（同内容重写字节相同）。
- **单单元失败不冻结全局**：记录原因，继续下一个单元；报告列全部失败项，重跑只碰失败项。
- **digest 漂移内部自愈**：执行前重取该单元当前 digest 再执行（旧编排里三轮才追出的缝，现在是内部重试）。
- **会话是内部实现细节**：runner 自建自管，形状不对自动归档重建，不存在"会话残留"这类冻结。
- **WIP 兜底**：任何原因停在 WIP 的记录，`recover` 一律收敛到终态（对→终化，错→重写）。

## 边界（保持不变的部分）

- 写入前需要操作员对单元清单的显式确认（`--yes` 仅限无人值守定时场景）。
- 旧版本文档作为历史快照保留——发布同步中绝不 patch 或删除旧版文档。
- `Slug` 字段永不写入；`Targets` 由 targets 工件决定，执行器不擅自写。
- 回滚走 `bin/sdk-document-rollback.js`，runner 不做删除式回滚。
- REST/OpenAPI review is one unit per `(versionTrack, endpoint, method)`; adapters must never guess an internal-to-public control-plane mapping — ambiguous ones are agent work ([references/sdk-rest.md](references/sdk-rest.md)).
- 运维细节参考（按需读）：[references/document-rollback.md](references/document-rollback.md)、[references/schema-first-generation.md](references/schema-first-generation.md)、[references/release-smoke-test.md](references/release-smoke-test.md)、[references/post-write-verification.md](references/post-write-verification.md)。
- PR 只读发现（`sdk-pr-scan`）等专项流程见 [references/cli.md](references/cli.md)。

## Domain Invariants

引擎层的内容保证（重设计只换了编排层，这些引擎不变量原样有效；生产代码逐条强制）：

- Single-request methods never get their own H3; Example is a bare code block (LAYOUT_SINGLE_REQUEST_H3). [api.global-layout-rules]
- Classify ownership as `standalone`, `method_owned`, or `ambiguous`, embedding method-owned request, response, result, task, info, iterator, descriptor, transport, and wrapper types in their owner pages. [api.ownership-classification]
- A public class is not standalone evidence; ambiguous ownership blocks planning; standalone creation requires an explicit reviewed standalone exception. [api.standalone-evidence-gate]
- One document per public interface record; parameter-only changes never justify an umbrella page. [api.one-document-per-interface]
- Release folders are sparse deltas; version Bitables are complete indexes; unchanged entries keep inherited links. [api.sparse-version-delta-model]
- Delta model: older tree = full inventory, newer = changed pages; copy-patch-repoint via the fixed DAG; shared-doc patches need `no_successor_action`. [api.versioned-tree-delta]
- Navigation type, `Docs` type, and Drive placement are separate facts; a `Class` record may point at a Docx page and still parent methods. [api.placement-facts-separate]
- Stateful-class identity: organization profile + reviewed `organizations[]` contract + explicit `target.releasePlacement` (RELEASE_PLACEMENT_*). [api.stateful-class-identity]
- Stateful-class contracts bind to the scanner-derived `organizationInventory`, never caller `complete: true` (SOURCE_ORGANIZATION_INVENTORY_REQUIRED). [api.organization-inventory-binding]
- Changed inherited interface → COPY_PATCH_AND_REPOINT (LEGACY_PLAN_ACTION on ungoverned forms). [api.changed-inherited-copy-patch]
- Unchanged inherited interface with stale parent/Type → UPDATE_RECORD_METADATA: token preserved, no Docx copy/patch (DELTA_MODEL_MIRROR_BLOCKED). [api.unchanged-inherited-metadata-update]
- Resolve canonical target from current hierarchy evidence; unknown state blocks planning. [api.current-hierarchy-resolution]
- Every organization rule keeps a tracked evidence manifest, never an untracked dump. [api.organization-evidence-manifest]
- SDK artifacts: reviewed evidence, versioned layout profile, block-safety validation, immutable plan; full-body repair needs exact token approval. [api.reviewed-artifact-evidence]
- After writes verify tenant host, ancestry, record metadata, older-source preservation, human-visible access. [api.post-write-verification]
- A grouping approval binds the campaign to the exact release scope it covers (one-shot, GROUPING_APPROVAL_ALREADY_BOUND); later dry-runs/resumes/writes must match the approved lineage scopeDigest (GROUPING_STALE, GROUPING_APPROVAL_CHAIN_INVALID) — any newer candidate spec, reviewed context, scoped dry-run, or execution artifact requires a fresh grouping gate. [api.grouping-proposal-staleness]
- Grouping proposals come only from scripts/build-grouping-proposal.js; credentials only via scripts/record-grouping-approval.js. [api.grouping-proposal-governance]
- Governed markdown converts losslessly: unrepresentable tokens refuse; native table blocks. [api.markdown-block-fidelity]
- Repo-relative URLs never reach documents: intake preflight and the writer refuse non-absolute links. [api.absolute-link-urls]
- Pages carrying user-authored `<include target="...">` markers never take a body rebuild (INCLUDE_REBUILD_FORBIDDEN). [api.literal-include-preserved]
- Bitable Description is VirtualNode-only (DESCRIPTION_SCOPE_VIOLATION). [api.record-description-scope]
- Verbatim pages attest their content digest; divergence demands rebuild (REBUILD_REQUIRED_SHAPE_MISMATCH). [api.pr-verbatim-content]
- Polish is a governed per-unit phase, never a bypass: substring-anchored prose, structure-preserving restructure (2026-10-01). [api.pr-polish-governed]
- The governed document inventory stays closed; leftovers are detect-only (CONTENT_ORPHAN_DOCUMENT). [api.governed-document-inventory]
- Layout: pages conform to the declared profile data, checked by one language-neutral checker + five global rules (2026-10-03); undeclared rules never apply. [api.sdk-page-layout]
- Same-title siblings: protected cross-track copy-patch structure, never duplicates (SAME_NAME_*). [api.same-name-sibling-placement]
- Writes ride reconcile discipline: same-named siblings refuse (FOLDER_NAME_COLLISION); read-back postchecks; lost responses reconcile, never blind-retry. [api.write-boundary-reconcile]
- Placement binds to its live walk (`--placement-walk-digest`; PLACEMENT_WALK_*); CREATE targets live-resolvable. [api.placement-live-binding]
- REBUILD is first-class, never a second CREATE (J6): own-record auto-routes; foreign fails closed (REBUILD_SCOPE_FOREIGN); reuses ids, binds metadata.rebuildOf. [api.rebuild-first-class]
- Track topology = fallback-chain model (2026-10-04); pasted-URL Slugs refuse (TOPOLOGY_RECORD_SLUG_URL); preflight via scripts/audit-track-topology.js. [api.track-topology-audit]
- Style mirrors only operator-designated exemplars, declared in `styleMirrors` and allowlisted in config/style-mirror-allowlist.json (fail closed). [api.style-mirror-allowlist]
- Sessions close only with learnings on the record (打回即铸): rule-candidate drafts or suppression with rationale (PROCESS_LEARNING_CAPTURE_REQUIRED). [api.process-learning-capture]
- Operator-authored pages land via surgical apiPatchPlan (desired = live + reviewed delta; ascending insertAt; simulation pre-gate — audit B-1). [api.operator-authored-surgical-patch]

## 已退役的机制（不要再引入）

2026-10-23 重设计裁定：以下机制**整体移除**——digest 门禁仪式（APPROVE_* sha256）、
战役收据与三链复验、会话状态机的操作员可见面、执行 journal 对账、failure-class
预算重试环、dwf 编排模板（release-sync-campaign.dwf.ts 十阶段）、campaign
freeze/settle。引擎内部的批次 digest 保留为**纯内部身份**（幂等去重用），
操作员不接触、不比对、不批准任何摘要。

## 深入参考（按需读）

- [references/cli.md](references/cli.md) — 全部 CLI 的完整 flag 语义
- [references/sdk-pr-sync.md](references/sdk-pr-sync.md) — PR 只读发现与 scope 约定
- [references/sdk-rest.md](references/sdk-rest.md) — REST/OpenAPI 轨
- [references/stable-core-boundary.md](references/stable-core-boundary.md) — 运行时代码与 tmp 运行工件的边界
- intake 链细节：`scripts/intake-assemble.js` 头注释与 `scripts/compare-update-spec-context.js`
