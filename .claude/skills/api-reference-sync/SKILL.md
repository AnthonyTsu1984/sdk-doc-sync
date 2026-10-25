---
name: api-reference-sync
description: Use when a Milvus or Zilliz SDK, CLI, REST API, or OpenAPI release must be scanned and diffed against existing Feishu or zdoc documentation to create, update, deprecate, backfill, or reparent API reference records. Do not use for drafting a standalone narrative page, localization, or filling language tabs in one procedure document.
---

# API Reference Sync

把一个 SDK 版本发布同步到飞书 API Reference 库。**直线流程，一个 runner，三个命令。**

## Trigger Boundary

Use for release-range discovery, inventory, versioned planning, backfill, deprecation, reparenting, or source-backed SDK/CLI/REST updates.

Do not use for a narrative guide, localization, code-only checks, or missing language tabs in one document. Use `verified-doc-authoring`, `localized-doc-sync`, `doc-code-verify`, or `procedure-code-sync` respectively.

## Permission Boundary

- Write requires explicit approval of the unit list by the operator (`sync` shows the list and waits; `--yes` is for unattended scheduled runs only). No digest ceremony: the operator approves WHAT will be written, never a sha256 line.
- Keep the older-version doc as a historical snapshot — never patch or delete it during a newer release sync.
- Every unit is verified after write: the executor refetches live state (dry-run first, then write, then refetch verification) before a record finalizes `WIP→Draft`.
- `Slug` never written (TOPOLOGY_RECORD_SLUG_URL); `Targets` come from the targets artifact, never the executor's guess; rollback only via `bin/sdk-document-rollback.js`.
- REST/OpenAPI review is one unit per `(versionTrack, endpoint, method)`; adapters must never guess an internal-to-public control-plane mapping — ambiguous ones are agent work ([sdk-rest.md](sdk-rest.md)).

## Shared Contract

- Capability baseline: [capabilities.json](capabilities.json); runtime primitives (digests, session store, journals) come from `../doc-ops-core/`.
- The engine's internal batch digest is a pure internal identity (idempotence), never an approval surface — the operator never reads, compares, or approves digests.
- The deterministic intake chain (scan → dump PR pages → candidate-spec → reviewed-context, byte-fidelity asserted by `scripts/compare-update-spec-context.js`) is the authority for unit content; models never touch UPDATE entries.

## Domain Workflow

1. **备料（确定性，无模型）**：`intake-assemble` 扫 SDK 源码 + dump PR 页 → 组装每单元最终内容（candidate-spec → reviewed-context，字节保真断言）。
2. **一份小配置** `sync-config.json`（旧战役用 `init --from-plan` 一键迁移）。
3. **`bin/sdk-release-sync.js sync --config <cfg>`**：展示单元清单 → 操作员确认 → 逐单元 写→验→Draft。
4. **失败后**：重跑 `sync`（自动跳过已完成）；**WIP 滞留用 `recover` 清扫**（文档已写对则直接终化，没写对则重写）。`status` 随时看全表状态。

Quick start:

```bash
node bin/sdk-release-sync.js init --from-plan tmp/api-reference-sync/campaign-plans/<dir>/campaign-plan.json
node bin/sdk-release-sync.js status --config tmp/api-reference-sync/campaign-plans/<dir>/sync-config.json
node bin/sdk-release-sync.js sync --config <cfg>
```

引擎直调（扫描与 dry-run，只读）：

```bash
npm run api-reference-sync -- --sdk-dir repos/pymilvus --language python \
  --sdk-name pymilvus --sdk-version v2.6.x \
  --release-scope tmp/sdk-release-scout/python-v26.json --dry-run --json
```

## 容错语义（runner 内建，操作员不需要操心）

- **传输类失败**（网络超时/限流/5xx）自动指数退避重试，写路径幂等（同内容重写字节相同）。
- **单单元失败不冻结全局**：记录原因，继续下一个单元；报告列全部失败项，重跑只碰失败项。
- **digest 漂移内部自愈**：执行前重取该单元当前 digest 再执行（旧编排里三轮才追出的缝，现在是内部重试）。
- **会话是内部实现细节**：runner 自建自管，形状不对自动归档重建，不存在"会话残留"这类冻结。
- **WIP 兜底**：任何原因停在 WIP 的记录，`recover` 一律收敛到终态（对→终化，错→重写）。发布是定时的，WIP 不许滞留超过一个清扫周期。

## Required References

- [references/versioning.md](references/versioning.md) — 版本轨与稀疏增量模型
- [references/post-write-verification.md](references/post-write-verification.md) — 写后验证（refetch 语义）
- [references/cli.md](references/cli.md) — 全部 CLI 的完整 flag 语义
- [references/troubleshooting.md](references/troubleshooting.md) — 故障排查
- [references/tree-delta-policy.md](references/tree-delta-policy.md) — 版本树增量决策内核
- [references/inheritance-evidence.md](references/inheritance-evidence.md) — 跨轨共享与继承证据
- [references/surgical-patch.md](references/surgical-patch.md) — 操作员页面的外科补丁
- [references/active-track-inheritance.md](references/active-track-inheritance.md) — 活动轨继承
- [references/bitable-document-organization.md](references/bitable-document-organization.md) — 记录组织
- [references/document-rollback.md](references/document-rollback.md) — 回滚
- [references/schema-first-generation.md](references/schema-first-generation.md) — schema-first 生成
- [references/release-smoke-test.md](references/release-smoke-test.md) — 发布冒烟
- [references/stable-core-boundary.md](references/stable-core-boundary.md) — 运行时与 tmp 边界
- [references/workspace-contract.md](references/workspace-contract.md) — 工作空间契约
- [sdk-pr-sync.md](sdk-pr-sync.md) — PR 只读发现与 scope 约定
- [sdk-rest.md](sdk-rest.md) — REST/OpenAPI 轨
- 语言细则：[sdk-python.md](sdk-python.md)、[sdk-java.md](sdk-java.md)、[sdk-go.md](sdk-go.md)、[sdk-node.md](sdk-node.md)、[sdk-cpp.md](sdk-cpp.md)、[sdk-alignment.md](sdk-alignment.md)
- intake 链细节：`scripts/intake-assemble.js` 头注释与 `scripts/compare-update-spec-context.js`

## 已退役的机制（不要再引入）

2026-10-23 重设计裁定：以下机制**整体移除**——digest 门禁仪式（APPROVE_* sha256）、战役收据与三链复验、会话状态机的操作员可见面、执行 journal 对账（EXECUTION_RECONCILIATION）、failure-class 预算重试环、dwf 编排模板（十阶段）、campaign freeze/settle、campaign plan/settle/approval/presentation CLI。引擎内部的批次 digest 保留为**纯内部身份**（幂等去重用），操作员不接触、不比对、不批准任何摘要。

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
- Grouping proposals come only from scripts/build-grouping-proposal.js (receipt recording retired with the operator ceremony, 2026-10-23). [api.grouping-proposal-governance]
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
