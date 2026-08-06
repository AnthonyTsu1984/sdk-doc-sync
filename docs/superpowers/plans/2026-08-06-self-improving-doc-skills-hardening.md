# Self-Improving Documentation Skills Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn approval and review feedback into governed, test-backed skill improvements while bringing every canonical documentation skill up to an appropriate level of deterministic approval, recovery, acceptance, and rollback safety.

**Architecture:** Keep raw decisions, candidate rules, and promoted behavior separate. Extend `doc-ops-core` with an append-only decision ledger and rule-promotion contracts; retain PR #7's `api-reference-sync` review session as the reference implementation; then migrate each other skill according to its side-effect risk instead of forcing one identical workflow on all skills. For localization, add a discovery layer that re-enumerates Base tables, schemas, views, records, and mappings on every run before any review unit is formed. A decision never edits a skill directly: it can only produce a candidate, a shadow evaluation, and a digest-bound promotion proposal.

**Tech Stack:** Node.js CommonJS, `node:test`, JSON Schema 2020-12, canonical JSON and SHA-256 from `doc-ops-core`, JSONL decision journals, the existing model-eval harness, Feishu/Lark APIs, and Git-reviewed skill changes.

---

## Current-state diagnosis

| Surface | Current strength | Material gap | Target maturity |
| --- | --- | --- | --- |
| `doc-ops-core` | Stable digests, approval envelopes, journals, reconciliation, state machine, round-trip guard, 150 passing tests | Approval schema only records `approved`; no feedback/rule lifecycle; conformance can pass without a production adapter | Shared decision and promotion governance with adapter-adoption tests |
| `api-reference-sync` | PR #7 adds one-document review units, persisted sessions, journal-derived receipts, acceptance manifests, resume validation, and rollback | No rationale/scope capture; no rule candidates; domain session logic is not yet reusable; many legacy scripts can reach writers outside the canonical CLI | Reference implementation plus governed learning and entrypoint containment |
| `localized-doc-sync` | Strong written contract, table-pair rules, media invariants, shared smoke fixtures | Production `agent-team` approves by task ID rather than batch digest; `live-actions.json` is mutable; translator lacks canonical journal/resume/acceptance; table inventory, schema, and identity assumptions can drift | Dynamic full-Base discovery, immutable scan manifest, governed mapping/identity resolution, per-document content units, bounded metadata units, exact approvals, journaled execution and rollback |
| `procedure-code-sync` | Clear block-scoped workflow and behavior evals | No canonical planner/executor/session CLI; shared write guard is prose-only; no crash recovery or rollback receipt | One-document coherent patch unit with block snapshots, journal, acceptance, and rollback |
| `verified-doc-authoring` | Strong claim-grounding and unresolved-claim discipline | Claim inventory is not a schema-bound artifact; Feishu write helpers can be called without a canonical batch/session; learning from edits is manual | Claim-review artifact, exact patch batch, acceptance receipt, corrective rollback, structured editorial feedback |
| `doc-code-verify` | Real executable verifier and shared result contract | Live scenarios can mutate isolated resources without a shared runtime manifest/journal; remediation handoff is unstructured | Read-only default retained; live runtime manifest, cleanup journal, and typed remediation handoff |
| Compatibility skills | Thin wrappers with routing tests | Canonical references still contain stale old-name guidance; no deprecation telemetry or removal gate | Canonical wording everywhere except compatibility surfaces, with measurable alias usage |

## Live Bitable evidence from the 2026-08-06 read-only scan

The hardening plan must preserve these observations as test cases, not as permanent inventory constants. The English Base `DocsList (Global)` was revision `9`; the Chinese Base `DocsList (中文)` was revision `19`. Every table, field, view, and record below was read with user identity and complete pagination.

| Source table | Source rows | Target table | Target rows | Exact non-empty slug overlap | Immediate observation |
| --- | ---: | --- | ---: | ---: | --- |
| Deployment | 20 | none | — | — | A discovered source-only table; current policy places only `byoc-intro` in 从这里开始 |
| Get Started | 51 | 从这里开始 | 43 | 42 | 9 current source-only slugs; `byoc-intro` is an intentional target-side cross-table mapping |
| Development | 188 | 开发指南 | 182 | 175 | 12 source-only and 6 target-only slugs before locale exceptions; `database` occurs twice on both sides |
| Management | 152 | 运维指南 | 128 | 108 | 34 source-only and 11 target-only slugs before locale exceptions; 10 source and 9 target rows have no slug |
| Client Libraries | 7 | 客户端参考 | 7 | 7 | Structurally aligned in the current snapshot |
| Tools | 24 | 工具 | 24 | 23 | The remaining row is the slugless `Zilliz CLI` link row on both sides |
| AI Models | 11 | AI 模型 | 7 | 3 | 7 source and 4 target `ref` rows have no slug; provider substitution requires explicit locale policy |
| Architecture | 6 | 产品架构 | 0 | 0 | Target table exists but is empty |
| Solution | 0 | 解决方案 | 0 | 0 | Both tables are currently empty |

Material findings:

1. Table count is already asymmetric (`9` source, `8` target) and must be treated as runtime data. Future table additions, removals, renames, splits, and merges must become scan issues rather than silent omissions.
2. All 17 current tables expose 16 schema fields and one unfiltered grid view, while the active views expose only the business fields used by the workflow. Hidden legacy fields such as `Chapter` are explicitly out of scope and must not produce drift issues, comparisons, or writes. Active fields can still drift: Chinese `AI 模型.Notebook` is `select` while the source field is `text`, and several visible select fields contain values that appear to belong to another field. This is especially important for `Targets`, because publication routing depends on it.
3. Identity and required metadata depend on `Placement Type`. `canonical` rows require `Slug` and are the only rows that carry publication-routing `Targets`; `section` rows require `Slug` but do not carry `Targets`; `link` and `ref` rows carry neither `Slug` nor `Targets` and follow their respective source meta. The Development `section:database` and `canonical:database` pair is therefore valid, while a global `Map<slug, record>` still silently loses records.
4. The maintained alignment references contain stale state snapshots: Get Started changed from `11/12` to `51/43`, Development from a `178`-row target snapshot to `182`, and Management, Client Libraries, and Tools are no longer empty. References may hold policy and reviewed overrides, but live counts and completeness must come from a new scan.
5. The existing translator paginates records and accepts explicit table IDs, but its diff still indexes only by slug, omits slugless target rows from orphan detection, overwrites duplicate slugs, depends on date fields absent from the current 16-field schema, does not model `META_ONLY`, and retains an `--auto-approve` live path. It cannot be the discovery or authorization boundary as written.

## Governing decisions

1. Treat an exact approval as authorization for one artifact, not as a reusable rule.
2. Treat `changes_requested -> revised artifact -> accepted` as the strongest learning signal because it contains a contrastive pair.
3. Store raw feedback outside Git by default. Commit only reviewed rules, tests, capability changes, scripts, or reference updates.
4. Never auto-promote a rule that broadens write, delete, credential, network, runtime, acceptance, or rollback authority.
5. Require every promoted rule to declare scope, exclusions, provenance, support, contradictions, supersession, and expiry behavior.
6. Use PR #7's one-document unit only where document content changes. Permit bounded `META_ONLY` batches when all records share one table pair, field set, risk class, and exact digest.
7. Keep `doc-code-verify` read-only by default. Runtime approval and remediation approval remain separate decisions.
8. Do not refactor PR #7's working review-session implementation into shared code until characterization tests prove the generic boundary.
9. Discover the complete source and target Base inventories on every localization run. A configured table map is a reviewed policy overlay, not proof that the inventory is complete.
10. Bind localization work to an immutable scan manifest containing Base revisions, table inventory, schema fingerprints, view scope, record-set digests, mapping decisions, identity decisions, locale exceptions, and the complete issue queue.
11. Resolve records with a placement-typed identity strategy: `canonical:<slug>`, `section:<slug>`, and source-meta-derived identities for `link` and `ref`. Do not require or synthesize Slug for `link/ref`; do not collapse a section and canonical row that intentionally share a Slug. Ambiguity in source-meta identity blocks planning.
12. Treat new, missing, renamed, split, merged, and unmapped tables plus field type/option/relationship drift as first-class issues. Schema drift that affects writes blocks execution until reviewed.
13. Process issues one review unit at a time, re-scan the affected table pair after each accepted unit, and require a final full-Base scan before overall finalization.
14. Keep live state out of prose references. Store durable locale policy and identity overrides separately from dated evidence snapshots, and require every override to carry provenance, scope, and expiry or revalidation behavior.
15. Ignore hidden, unconfigured legacy fields such as the current Chinese `Chapter` fields. Inventory may record them for completeness, but only configured business roles or explicitly requested fields participate in schema drift, diffing, approval, and writes.
16. Treat `Targets` as publication-critical configuration on `canonical` rows only, not ordinary descriptive metadata. Missing, invalid, or changed canonical target values alter publication scope and require locale-policy evaluation, exact approval, live precondition checks, and post-write verification. `section`, `link`, and `ref` rows must not be flagged for absent `Targets`. Never copy source `Targets` blindly when Chinese publication applicability differs.
17. Enforce the placement metadata matrix: `canonical` requires `Slug` and `Targets`; `section` requires `Slug` and omits `Targets`; `link/ref` omit both and inherit identity/metadata from their respective source meta. Violations are typed contract issues, not generic missing-field warnings.
18. Use precise source terminology. The `translation source` in an English-Chinese translation pair is always the English document/record. A `reference source` is the locale-specific member of an existing translation pair referenced by a `ref` row: an English ref points to the English member and a Chinese ref points to the Chinese member. The ref row does not create another pair or review unit.
19. Classify `link` targets deterministically from `Ref Target Doc`: values beginning with `/` are internal-site links; values beginning with `http` are external links. Preserve their semantic path or URL and emit an issue for unsupported forms instead of treating them as ref documents.
20. Do not require English and Chinese `Parent` to be identical. Validate each hierarchy against its locale-specific source and reviewed hierarchy policy; cross-locale parent equality is evidence only, not an invariant.
21. Treat `Labels`, `Keywords`, `Progress`, `Notebook`, `Beta`, `Book`, `Alias1`, and `Alias2` as locale-source-owned metadata. English values follow the English locale source and Chinese values follow the Chinese locale source. Cross-language inequality is not itself a sync issue.

## Target repository shape

```text
.claude/skills/doc-ops-core/
├── contracts/
│   ├── decision-event.schema.json
│   ├── rule-candidate.schema.json
│   └── rule-promotion.schema.json
├── src/
│   ├── decision-ledger.js
│   ├── rule-candidate.js
│   ├── rule-promotion.js
│   └── write-entrypoint-registry.js
├── harness/
│   ├── rule-eval-generator.js
│   └── adapter-adoption.js
├── bin/
│   └── skill-feedback.js
├── references/
│   └── feedback-governance.md
└── write-entrypoints.json

tmp/skill-feedback/<skill>/
├── decisions.jsonl
├── candidates/
├── shadow-evals/
└── promotion-proposals/

evals/skills/
└── learning-cases.jsonl

.claude/skills/localized-doc-sync/
├── contracts/
│   ├── scan-manifest.schema.json
│   └── scan-issue.schema.json
├── src/
│   ├── inventory-scanner.js
│   ├── schema-profiler.js
│   ├── table-mapper.js
│   ├── identity-resolver.js
│   ├── issue-classifier.js
│   ├── planner.js
│   ├── executor.js
│   └── review-session-store.js
└── references/
    ├── table-map.json
    ├── identity-overrides.json
    └── locale-policy.json
```

Raw decision storage under `tmp/skill-feedback/` remains ignored. Promoted behavior lands in an existing capability manifest, executable contract, script, direct reference, or a small skill-local `references/learned-rules.json`; it does not remain permanently in the candidate registry.

### Task 1: Freeze the pre-change runtime and approval baseline

**Files:**

- Create ignored artifact: `tmp/skill-feedback-baseline/summary.json`
- Read: `.claude/skills/*/SKILL.md`
- Read: `.claude/skills/*/capabilities.json`
- Read: `.claude/agent-team/src/approval-commands.js`
- Read: `.claude/agent-team/src/event-consumer.js`
- Read: `.claude/agent-team/bin/doc-agent-live-write.js`
- Read: `.claude/skills/api-reference-sync/src/sdk-doc-sync/review-session-store.js`

- [ ] **Step 1: Record the current test baseline**

Run:

```bash
npm run validate:skills
npm run test:skills
npm run test:doc-ops-core
npm run test:offline
```

Expected: the first three commands retain the currently observed `10 skills`, `70/70`, and `150/150` passing baselines; record any pre-existing offline failure without modifying source.

- [ ] **Step 2: Inventory all write-capable entrypoints**

Classify each tracked CLI or script as `read-only`, `canonical-governed`, `legacy-live`, `test-only`, or `deprecated`. Record whether it checks an exact batch digest, writes a prepared journal entry, refetches, verifies, and supports reconciliation.

- [ ] **Step 3: Record production-adapter coverage**

Create one matrix row per canonical skill with `planner`, `approval`, `journal`, `resume`, `acceptance`, `rollback`, `result-contract`, and `live-smoke` booleans. The matrix must distinguish a simulated smoke adapter from a production entrypoint.

- [ ] **Step 4: Commit no baseline artifacts**

Expected: `git status --short` shows only the implementation-plan file until Task 2 starts.

### Task 2: Add append-only decision-event contracts

**Files:**

- Create: `.claude/skills/doc-ops-core/contracts/decision-event.schema.json`
- Create: `.claude/skills/doc-ops-core/src/decision-ledger.js`
- Create: `.claude/skills/doc-ops-core/tests/decision-ledger.test.js`
- Modify: `.claude/skills/doc-ops-core/tests/run-all.js`

- [ ] **Step 1: Write failing schema and ledger tests**

Use this minimum semantic shape:

```js
const event = {
  schemaVersion: 1,
  decisionId: 'decision:review:node-bulkwriter:1',
  skill: 'api-reference-sync',
  gate: 'DOCUMENT_REVIEW',
  outcome: 'changes_requested',
  taskId: 'node-v3.0.4',
  sessionId: 'session:node-v3.0.x',
  reviewUnitId: 'review:bulk-writer',
  proposalDigest: 'sha256:' + 'a'.repeat(64),
  resultDigest: null,
  instruction: 'Keep BulkWriter as one Class page with child Function records.',
  rationale: 'The established navigation topology must remain stable.',
  scopeHint: {
    level: 'skill',
    language: 'node',
    taskType: 'stateful-class-organization'
  },
  evidence: [{ type: 'execution-journal', digest: 'sha256:' + 'b'.repeat(64) }]
};
```

Test duplicate `decisionId`, invalid digest, missing scope for a durable-rule request, secret-like fields, unsupported outcome, and non-canonical line ordering.

Use this exact outcome vocabulary so gates remain distinguishable without inventing skill-local synonyms:

```js
const DECISION_OUTCOMES = Object.freeze([
  'approved',
  'rejected',
  'changes_requested',
  'accepted',
  'rollback_requested',
  'rolled_back',
  'finalized',
]);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
node --test .claude/skills/doc-ops-core/tests/decision-ledger.test.js
```

Expected: FAIL because the contract and module do not exist.

- [ ] **Step 3: Implement the ledger**

Export exactly:

```js
module.exports = {
  DecisionLedger,
  DecisionLedgerError,
  normalizeDecisionEvent,
  semanticDecisionDigest,
};
```

`DecisionLedger.append()` must use canonical JSONL, `fsync`, duplicate rejection, and a configurable path. Raw reviewer IDs and message IDs belong under a runtime envelope and must not affect `semanticDecisionDigest`.

- [ ] **Step 4: Add redaction rules**

Reject or redact values matching credential field names and token-like strings before persistence. Preserve the human instruction after redaction because it is the learning signal.

- [ ] **Step 5: Run shared tests**

Run:

```bash
npm run test:doc-ops-core
```

Expected: PASS with the new ledger tests included.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/doc-ops-core
git commit -m "feat: add governed skill decision ledger"
```

### Task 3: Add candidate-rule and promotion contracts

**Files:**

- Create: `.claude/skills/doc-ops-core/contracts/rule-candidate.schema.json`
- Create: `.claude/skills/doc-ops-core/contracts/rule-promotion.schema.json`
- Create: `.claude/skills/doc-ops-core/src/rule-candidate.js`
- Create: `.claude/skills/doc-ops-core/src/rule-promotion.js`
- Create: `.claude/skills/doc-ops-core/tests/rule-candidate.test.js`
- Create: `.claude/skills/doc-ops-core/tests/rule-promotion.test.js`
- Create: `.claude/skills/doc-ops-core/bin/skill-feedback.js`
- Create: `.claude/skills/doc-ops-core/references/feedback-governance.md`

- [ ] **Step 1: Write failing rule lifecycle tests**

Require this lifecycle:

```text
candidate -> shadow -> proposed -> active -> superseded | deprecated
```

Reject direct `candidate -> active`, unresolved contradictions, missing held-out eval results, unsupported promotion targets, or any high-risk rule that sets `automaticPromotion: true`.

- [ ] **Step 2: Define rule classes and promotion targets**

Use these exact classes:

```js
const RULE_CLASSES = Object.freeze([
  'hard-policy',
  'deterministic-procedure',
  'domain-fact',
  'soft-preference',
  'one-off-exception',
]);
```

Map them respectively to executable contract/capability, script, direct reference/evidence, `references/learned-rules.json`, and non-promotable session evidence.

- [ ] **Step 3: Implement deterministic support accounting**

Count independent support by unique task or review-unit identity, not by repeated messages in one review. Preserve `supportingDecisionDigests`, `contradictingDecisionDigests`, `supersedes`, `expiresAt`, `applicableWhen`, and `notApplicableWhen`.

- [ ] **Step 4: Enforce promotion thresholds**

Use these defaults:

```js
const DEFAULT_THRESHOLDS = Object.freeze({
  inferredIndependentSupport: 3,
  explicitDurableInstructionSupport: 1,
  heldOutCasesRequired: 3,
  unresolvedContradictionsAllowed: 0,
  highRiskAutomaticPromotion: false,
});
```

An explicit durable instruction may shorten evidence collection, but it still requires held-out evaluation and a reviewed promotion digest.

- [ ] **Step 5: Implement read-only CLI commands**

Support:

```text
skill-feedback append-decision
skill-feedback propose-rule
skill-feedback score-rule
skill-feedback build-promotion
skill-feedback status
```

Do not implement an unreviewed `activate` command. `build-promotion` writes a proposal and digest only.

- [ ] **Step 6: Run focused and shared tests, then commit**

```bash
node --test .claude/skills/doc-ops-core/tests/rule-candidate.test.js
node --test .claude/skills/doc-ops-core/tests/rule-promotion.test.js
npm run test:doc-ops-core
git add .claude/skills/doc-ops-core
git commit -m "feat: govern skill rule promotion"
```

### Task 4: Make governance executable in every capability manifest

**Files:**

- Modify: `.claude/skills/doc-ops-core/contracts/capability-manifest.schema.json`
- Modify: `.claude/skills/doc-ops-core/harness/conformance-runner.js`
- Modify: `.claude/skills/doc-ops-core/tests/capability-manifest.test.js`
- Modify: `.claude/skills/api-reference-sync/capabilities.json`
- Modify: `.claude/skills/doc-code-verify/capabilities.json`
- Modify: `.claude/skills/localized-doc-sync/capabilities.json`
- Modify: `.claude/skills/procedure-code-sync/capabilities.json`
- Modify: `.claude/skills/verified-doc-authoring/capabilities.json`

- [ ] **Step 1: Add RED tests for governance policy**

Require every canonical manifest to declare:

```json
{
  "reviewPolicy": {
    "unit": "document",
    "gates": ["write", "document-acceptance"],
    "rollback": "pre-finalization"
  },
  "learningPolicy": {
    "captureOutcomes": ["rejected", "changes_requested", "approved", "accepted"],
    "approvalStrength": "weak-positive",
    "highRiskAutomaticPromotion": false
  },
  "adapterPolicy": {
    "operations": [
      {
        "operation": "sync",
        "status": "adopted",
        "productionEntrypoint": ".claude/skills/api-reference-sync/bin/sdk-doc-sync.js",
        "focusedTest": ".claude/skills/api-reference-sync/tests/sdk-doc-sync-cli.test.js",
        "journalRequiredForWrites": true
      }
    ]
  }
}
```

Use skill-specific values: `doc-code-verify.reviewPolicy.unit` is `run`, its default gate is `none`, and journal requirements activate only for approved live runtime. At this task boundary, mark the API-reference operation `adopted`, static code verification `adopted`, live code verification `planned`, and the three prose-only write adapters `planned` with their implementation task number. Later migration tasks must change their own operation to `adopted` before completion.

- [ ] **Step 2: Upgrade the schema version coherently**

Change all five manifests and the schema together from version 1 to version 2. Reject mixed versions in the all-skill conformance test.

- [ ] **Step 3: Add adapter-adoption assertions**

For every operation marked `adopted` or `partial`, the conformance runner must verify that the manifest names a real module and focused test file. A `planned` operation must name its migration task and cannot satisfy final completion. A prose-only `SKILL.md` reference must never satisfy adapter adoption.

- [ ] **Step 4: Run conformance and skill tests**

```bash
npm run test:doc-ops-core
npm run test:skills
```

Expected: PASS after all five manifests declare coherent policies and honestly distinguish `adopted` from `planned`; the final rollout gate later rejects any remaining `planned` write operation.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/*/capabilities.json .claude/skills/doc-ops-core
git commit -m "feat: declare skill review and learning governance"
```

### Task 5: Extend the model harness with learning and scope evaluations

**Files:**

- Create: `evals/skills/learning-cases.jsonl`
- Create: `.claude/skills/doc-ops-core/harness/rule-eval-generator.js`
- Create: `.claude/skills/doc-ops-core/tests/rule-eval-generator.test.js`
- Modify: `scripts/run-skill-model-evals.js`
- Modify: `tests/skills/model-eval-harness.test.js`
- Modify: `tests/skills/behavior-cases.test.js`
- Modify: `package.json`

- [ ] **Step 1: Add failing harness tests for a `learning` mode**

Require isolated RED/GREEN runs, at least three held-out cases, exact scope matching, counterexample coverage, and pass^k safety semantics.

- [ ] **Step 2: Seed cross-skill learning cases**

Include at least these cases:

```text
approval-does-not-globalize
edit-then-accept-is-strong-evidence
node-only-rule-does-not-apply-to-python
newer-rule-supersedes-older-preference
contradiction-quarantines-candidate
high-risk-frequency-does-not-loosen-approval
one-off-exception-is-not-promoted
stale-rule-expiry-stops-application
```

- [ ] **Step 3: Generate shadow cases from candidate rules**

`rule-eval-generator.js` must produce deterministic positive, negative, and boundary case skeletons from `applicableWhen` and `notApplicableWhen`. Generated cases stay under `tmp/skill-feedback/<skill>/shadow-evals/` until reviewed.

- [ ] **Step 4: Add npm commands**

```json
{
  "eval:skills:learning": "node scripts/run-skill-model-evals.js --mode learning --phase both --repeats 3",
  "eval:skills:learning:safety": "node scripts/run-skill-model-evals.js --mode learning --phase both --case-class safety --repeats 10"
}
```

- [ ] **Step 5: Run harness tests and a focused model-free corpus validation**

```bash
npm run test:skills
node --test .claude/skills/doc-ops-core/tests/rule-eval-generator.test.js
```

- [ ] **Step 6: Commit**

```bash
git add evals/skills scripts/run-skill-model-evals.js tests/skills package.json .claude/skills/doc-ops-core
git commit -m "test: add governed skill learning evaluations"
```

### Task 6: Bind agent-team decisions to immutable artifacts

**Files:**

- Modify: `.claude/agent-team/src/approval-commands.js`
- Modify: `.claude/agent-team/src/event-consumer.js`
- Modify: `.claude/agent-team/src/cards.js`
- Modify: `.claude/agent-team/src/task-store.js`
- Modify: `.claude/agent-team/bin/doc-agent-dry-run.js`
- Modify: `.claude/agent-team/bin/doc-agent-live-write.js`
- Modify: `.claude/agent-team/tests/approval-commands.test.js`
- Modify: `.claude/agent-team/tests/event-consumer.test.js`
- Create: `.claude/agent-team/tests/digest-bound-live-write.test.js`

- [ ] **Step 1: Write RED tests rejecting task-only approval**

Reject `approve loc-scan-1`. Accept only commands that bind the task and current digest:

```text
APPROVE_WRITES loc-scan-1 sha256:<batch-digest>
REJECT_WRITES loc-scan-1 sha256:<batch-digest>: <reason>
REQUEST_CHANGES loc-scan-1 sha256:<batch-digest>: <instruction>
```

- [ ] **Step 2: Build the action batch during dry-run**

Replace mutable `live-actions.json` authority with a canonical `action-batch.json`. The approval card must show skill, operation, action count, targets, side-effect classes, and full digest.

- [ ] **Step 3: Use the shared decision ledger**

`event-consumer` must append a normalized decision event before dispatch. Its semantic evidence must include the exact batch digest; duplicate detection must include message identity without treating repeated messages as independent rule support.

- [ ] **Step 4: Fail closed during live write**

Immediately before mutation, reload `action-batch.json`, recompute its digest, construct the approval envelope from the accepted decision, and run `assertApproval`. Do not trust `live-actions.json` or a GitHub dispatch payload as the action source.

- [ ] **Step 5: Preserve compatibility as a non-executable response**

Old commands such as `approve <task-id>` may return a card containing the exact current command, but must not dispatch live work.

- [ ] **Step 6: Run agent-team tests and commit**

```bash
npm run test:agent-team
git add .claude/agent-team
git commit -m "fix: bind bot approvals to exact action batches"
```

### Task 7: Inventory and contain every write-capable script

**Files:**

- Create: `.claude/skills/doc-ops-core/write-entrypoints.json`
- Create: `.claude/skills/doc-ops-core/src/write-entrypoint-registry.js`
- Create: `.claude/skills/doc-ops-core/tests/write-entrypoint-registry.test.js`
- Create: `tests/skills/write-entrypoint-admission.test.js`
- Modify: `scripts/validate-skills.js`
- Modify: selected legacy scripts only after classification

- [ ] **Step 1: Add a RED static-admission test**

Scan tracked JavaScript entrypoints for imports or calls associated with Bitable, Docx, Drive, Wiki, translator, and `lark-cli` mutations. Fail when a live-capable entrypoint is absent from the registry.

- [ ] **Step 2: Define the registry record**

```json
{
  "path": ".claude/skills/api-reference-sync/bin/sdk-doc-sync.js",
  "skill": "api-reference-sync",
  "classification": "canonical-governed",
  "operation": "sync",
  "approval": "exact-batch-digest",
  "journal": "required",
  "reconciliation": "required",
  "tests": [".claude/skills/api-reference-sync/tests/sdk-doc-sync-cli.test.js"]
}
```

- [ ] **Step 3: Classify legacy scripts without assuming every writer import mutates**

Mark read-only scanners accurately. Mark one-off live repair scripts `legacy-live` and require an explicit quarantine flag plus a pointer to the canonical replacement path.

- [ ] **Step 4: Block new bypasses**

CI must reject new `legacy-live` entries unless `expected-changes.json` names the exception and an expiry date. Test-only fake adapters remain allowed under test directories.

- [ ] **Step 5: Run validation and commit**

```bash
npm run validate:skills
npm run test:skills
git add .claude/skills/doc-ops-core tests/skills scripts/validate-skills.js
git commit -m "test: inventory documentation write entrypoints"
```

### Task 8: Add governed learning to api-reference-sync without weakening PR #7

**Files:**

- Modify: `.claude/skills/api-reference-sync/src/sdk-doc-sync/review-session-store.js`
- Modify: `.claude/skills/api-reference-sync/bin/sdk-review-session.js`
- Modify: `.claude/skills/api-reference-sync/references/bot-integration.md`
- Modify: `.claude/skills/api-reference-sync/references/bot-prompts.md`
- Modify: `.claude/skills/api-reference-sync/capabilities.json`
- Modify: `.claude/skills/api-reference-sync/tests/review-session-store.test.js`
- Modify: `.claude/skills/api-reference-sync/tests/sdk-review-session-cli.test.js`
- Create: `.claude/skills/api-reference-sync/tests/decision-capture.test.js`

- [ ] **Step 1: Characterize PR #7 before adding feedback hooks**

Add tests proving that decision capture cannot change `acceptedReviewUnits`, `activeExecution`, `acceptanceManifestDigest`, rollback capability, or `scanStateUpdated`.

- [ ] **Step 2: Capture all review outcomes in a separate ledger**

Add CLI inputs for `--decision-ledger`, `--rationale`, and a structured `--scope-hint`. Capture `changes_requested`, `rejected`, `accepted`, `rollback_requested`, `rolled_back`, and final acceptance.

- [ ] **Step 3: Bind contrastive evidence**

When a unit is revised, record both the rejected execution or proposal digest and the later accepted execution journal digest. Do not infer a reusable rule when no rationale or observable change exists.

- [ ] **Step 4: Keep approval commands exact**

The bot prompt must continue to emit exactly one copy-ready gate command. Rule proposal commands appear only after the gate decision and use a separate promotion workflow.

- [ ] **Step 5: Add API-reference-specific learning cases**

Cover helper ownership, stateful class organization, inherited document copy/repoint, sparse release folders, and older-document preservation. Every learned rule must be constrained by language, track, organization identity, or explicit cross-SDK scope.

- [ ] **Step 6: Run focused suites and commit**

```bash
node --test .claude/skills/api-reference-sync/tests/review-session-store.test.js
node --test .claude/skills/api-reference-sync/tests/sdk-review-session-cli.test.js
node --test .claude/skills/api-reference-sync/tests/decision-capture.test.js
npm run test:unit
git add .claude/skills/api-reference-sync
git commit -m "feat: capture governed api reference review feedback"
```

### Task 9: Migrate localized-doc-sync to recoverable review units

Detailed operating model: [Localized Doc Sync Full-Scan and Review Design](../specs/2026-08-06-localized-doc-sync-full-scan-design.md).

**Files:**

- Create: `.claude/skills/localized-doc-sync/contracts/scan-manifest.schema.json`
- Create: `.claude/skills/localized-doc-sync/contracts/scan-issue.schema.json`
- Create: `.claude/skills/localized-doc-sync/contracts/translation-receipt.schema.json`
- Create: `.claude/skills/localized-doc-sync/bin/localized-doc-sync.js`
- Create: `.claude/skills/localized-doc-sync/src/inventory-scanner.js`
- Create: `.claude/skills/localized-doc-sync/src/schema-profiler.js`
- Create: `.claude/skills/localized-doc-sync/src/table-mapper.js`
- Create: `.claude/skills/localized-doc-sync/src/identity-resolver.js`
- Create: `.claude/skills/localized-doc-sync/src/issue-classifier.js`
- Create: `.claude/skills/localized-doc-sync/src/translation-state.js`
- Create: `.claude/skills/localized-doc-sync/src/planner.js`
- Create: `.claude/skills/localized-doc-sync/src/executor.js`
- Create: `.claude/skills/localized-doc-sync/src/review-session-store.js`
- Create: `.claude/skills/localized-doc-sync/src/rollback-planner.js`
- Create: `.claude/skills/localized-doc-sync/references/table-map.json`
- Create: `.claude/skills/localized-doc-sync/references/identity-overrides.json`
- Create: `.claude/skills/localized-doc-sync/references/locale-policy.json`
- Create: `.claude/skills/localized-doc-sync/tests/inventory-scanner.test.js`
- Create: `.claude/skills/localized-doc-sync/tests/schema-profiler.test.js`
- Create: `.claude/skills/localized-doc-sync/tests/table-mapper.test.js`
- Create: `.claude/skills/localized-doc-sync/tests/identity-resolver.test.js`
- Create: `.claude/skills/localized-doc-sync/tests/issue-classifier.test.js`
- Create: `.claude/skills/localized-doc-sync/tests/translation-state.test.js`
- Create: `.claude/skills/localized-doc-sync/tests/planner.test.js`
- Create: `.claude/skills/localized-doc-sync/tests/executor.test.js`
- Create: `.claude/skills/localized-doc-sync/tests/review-session-store.test.js`
- Modify: `.claude/skills/localized-doc-sync/SKILL.md`
- Modify: `.claude/skills/localized-doc-sync/capabilities.json`
- Modify: `.claude/agent-team/bin/doc-agent-live-write.js`
- Modify: `package.json`

- [ ] **Step 1: Write RED tests for dynamic full-Base discovery**

The scanner must enumerate current Base identity/revision, every table, primary field, field schema, view scope, and complete record count before it reads the configured mapping. Tests must add, remove, and rename tables between runs and prove that no table can disappear behind a stale `table_pairs` list or a default first-table selection.

- [ ] **Step 2: Build schema profiles and role resolution**

Resolve configured semantic roles such as `slug`, `docs`, `parent`, `placement`, `refTarget`, `targets`, `labels`, `progress`, and `book` from live field names and types. Mark `targets` as publication-critical for canonical rows only. Emit canonical schema fingerprints and typed issues for missing active fields, active-field type or option drift, primary-field changes, self-link changes, and filtered views. Record hidden unconfigured fields without treating them as drift; specifically ignore the current hidden Chinese `Chapter` fields unless a future policy explicitly activates them. Missing or invalid `Targets` schema/options must block canonical publication planning but must not create row-level missing-value issues for `section/link/ref`. Compare locale-source-owned metadata against the source for that locale, not directly across English and Chinese. Other unknown or write-relevant active-field drift must block execution; field IDs and the current 16-field shape must not be hardcoded.

- [ ] **Step 3: Replace slug-only matching with typed identity resolution**

Apply the placement metadata matrix before matching. Use `canonical:<slug>` and `section:<slug>` even when both types share the same Slug. For `link`, create `link:internal:<path>` when `Ref Target Doc` begins with `/` and `link:external:<url>` when it begins with `http`; reject unsupported target forms. For `ref`, resolve its locale-specific reference source through the existing underlying translation pair: English ref to the English member, Chinese ref to the Chinese member. Do not invent Slug, equate locale-specific document tokens, or create a separate ref translation pair. Add fixtures for the valid `section:database` / `canonical:database` pair, both link kinds, Management ref rows, and AI provider substitutions. Emit `PLACEMENT_METADATA_INVALID`, `LINK_TARGET_INVALID`, or `IDENTITY_AMBIGUOUS` instead of overwriting or guessing.

- [ ] **Step 4: Separate dynamic mapping from durable locale policy**

Model table relations as `mapped`, `source-only`, `target-only`, `split`, `merged`, `ignored-by-policy`, or `unresolved`. Treat Deployment as one current source-only case, not a hardcoded special branch. Store reviewed cross-table mappings, China-specific provider substitutions, locale-specific hierarchy decisions, and intentional exclusions in small structured references with provenance and revalidation metadata. Reuse ordinary translation-pair identity for documents referenced by `ref` rows.

- [ ] **Step 5: Produce an immutable scan manifest and complete issue queue**

The manifest must bind source and target Base revisions, complete inventories, schema/view fingerprints, record-set digests, table mappings, placement-typed record identities, underlying translation-pair identities for ref targets, accepted translation-receipt lineage, locale-specific hierarchy policy, locale-policy digest, and every issue. At minimum classify `UNMAPPED_TABLE`, `TABLE_MISSING`, `SCHEMA_DRIFT`, `PLACEMENT_METADATA_INVALID`, `LINK_TARGET_INVALID`, `IDENTITY_AMBIGUOUS`, `NEW`, `UPDATE_CONTENT`, `TARGET_LOCAL_EDIT`, `TRANSLATION_DIVERGED`, `TRANSLATION_BASELINE_REQUIRED`, `LOCAL_META_DRIFT`, `META_ONLY`, `PUBLICATION_SCOPE_MISMATCH`, `TARGET_ONLY`, `POLICY_EXCLUDED`, `LOCALE_EQUIVALENT`, `HIERARCHY_UNRESOLVED`, and `NOOP`. Ref rows that correctly follow an existing translation pair are `NOOP`; a missing referenced member is handled as an issue on the underlying translation pair, not as ref work. A partial table-pair scan may diagnose one issue but cannot authorize or finalize a run.

- [ ] **Step 6: Add durable translation receipts and four-way drift classification**

Persist the accepted English source digest, Chinese target digest, locale-owned metadata digests, execution-journal digest, and acceptance-decision digest for every managed canonical pair. Classify unchanged pairs, English-only changes, Chinese-only local edits, concurrent divergence, and missing historical baseline without using absent Bitable date fields. Never overwrite a Chinese local edit automatically. A receipt may be created only after live verification and acceptance.

- [ ] **Step 7: Write RED tests for review-unit formation**

Create one review unit for each `NEW`, `UPDATE_CONTENT`, locale-specific hierarchy change, canonical publication-scope change, or unresolved policy decision, including its Docx, folder/parent, media, and Bitable operations. Canonical `Targets` changes must show the before/after publication destinations and the applicable Chinese-source evidence. `section/link/ref` must not acquire `Targets`; link units must preserve their typed path/URL identity. A correctly resolved ref is a no-op and must not create a review unit; work belongs to the underlying translation pair if one of its members is missing or outdated. Permit a `META_ONLY` unit to contain multiple records only when table pair, placement type, locale-source ownership, changed field set, risk class, precondition schema, publication effect, and locale-policy decision are identical. Every unit must cite its parent scan manifest digest and issue IDs.

- [ ] **Step 8: Wrap the existing translator behind the canonical planner**

Reuse translation and Markdown conversion as domain adapters only. The planner must emit canonical actions without allowing the translator's first-table fallback, slug-only diff, interactive approval, or `--auto-approve` path to become discovery or executable authority.

- [ ] **Step 9: Add write-ahead journal, resume, acceptance, and rollback**

Use `ExecutionJournal` for prepared and observed entries. Persist a session outside model context. A later process must derive completed units from verified journals and live readback, not task state or caller-supplied IDs. After each content document executes, stop for human document review. Rollback must restore the prior Docs pointer/metadata and remove only resources proven to have been created by that unit.

- [ ] **Step 10: Re-scan locally after each unit and globally before finalization**

After an accepted unit, re-read the affected table pair and its dependency edges to close or supersede issue IDs. Verify touched canonical records' `Targets` values against the approved Chinese publication scope; verify that touched `section/link/ref` records still omit `Targets`; verify link path/URL identity; and verify each ref points to the locale-appropriate member of its existing underlying translation pair. Validate Parent against each locale's hierarchy policy rather than requiring cross-language equality. Before final confirmation, re-enumerate both Bases and build a fresh full scan. Finalization is allowed only when all original and newly discovered issues are accepted, explicitly policy-skipped, or carried forward in a reviewed unresolved manifest. Preserve boards, Figma, sheets, Supademo, images, opaque blocks, and source-side read-only behavior.

- [ ] **Step 11: Run tests and commit**

Add `test:localized-doc-sync` as the stable package-script entrypoint for the complete localized skill suite, then run:

```bash
npm run test:localized-doc-sync
npm run test:agent-team
npm run test:doc-ops-core
git add .claude/skills/localized-doc-sync .claude/agent-team package.json
git commit -m "feat: make localization writes reviewable and recoverable"
```

### Task 10: Give procedure-code-sync a canonical block-patch runtime

**Files:**

- Create: `.claude/skills/procedure-code-sync/bin/procedure-code-sync.js`
- Create: `.claude/skills/procedure-code-sync/src/block-inventory.js`
- Create: `.claude/skills/procedure-code-sync/src/patch-planner.js`
- Create: `.claude/skills/procedure-code-sync/src/patch-executor.js`
- Create: `.claude/skills/procedure-code-sync/src/review-session-store.js`
- Create: `.claude/skills/procedure-code-sync/tests/block-inventory.test.js`
- Create: `.claude/skills/procedure-code-sync/tests/patch-planner.test.js`
- Create: `.claude/skills/procedure-code-sync/tests/patch-executor.test.js`
- Modify: `.claude/skills/procedure-code-sync/SKILL.md`
- Modify: `.claude/skills/procedure-code-sync/capabilities.json`

- [ ] **Step 1: Write RED tests for coherent document units**

A review unit is one procedure document and all block operations needed to keep its cross-language workflow coherent. Reject partial approval of individual language blocks after the document batch digest is built.

- [ ] **Step 2: Persist exact before-state block evidence**

Record document revision, block IDs, child indexes, language labels, protected surrounding-block digest, and the exact blocks being inserted or replaced.

- [ ] **Step 3: Execute through the shared guard and journal**

Recheck the live block inventory immediately before mutation, write prepared entries, patch from highest child index to lowest, refetch after structural changes, and append observed verification.

- [ ] **Step 4: Add acceptance and rollback**

Document acceptance binds the execution journal digest. Rollback uses the before-state block snapshot and must stop if replacement-generated block identities or surrounding structure have drifted.

- [ ] **Step 5: Produce a typed verifier handoff**

After patching, call `doc-code-verify` and bind its result semantic digest into the acceptance receipt. Unsupported language gaps remain explicit and are not treated as failed writes.

- [ ] **Step 6: Run tests and commit**

```bash
node --test .claude/skills/procedure-code-sync/tests/*.test.js
npm run test:verifier
npm run test:skills
git add .claude/skills/procedure-code-sync
git commit -m "feat: add recoverable procedure code patching"
```

### Task 11: Make verified-doc-authoring claim- and acceptance-driven

**Files:**

- Create: `.claude/skills/verified-doc-authoring/contracts/claim-inventory.schema.json`
- Create: `.claude/skills/verified-doc-authoring/bin/verified-doc-authoring.js`
- Create: `.claude/skills/verified-doc-authoring/src/claim-inventory.js`
- Create: `.claude/skills/verified-doc-authoring/src/patch-planner.js`
- Create: `.claude/skills/verified-doc-authoring/src/patch-executor.js`
- Create: `.claude/skills/verified-doc-authoring/src/review-session-store.js`
- Create: `.claude/skills/verified-doc-authoring/tests/claim-inventory.test.js`
- Create: `.claude/skills/verified-doc-authoring/tests/patch-executor.test.js`
- Modify: `.claude/skills/verified-doc-authoring/SKILL.md`
- Modify: `.claude/skills/verified-doc-authoring/references/workflow.md`
- Modify: `.claude/skills/verified-doc-authoring/capabilities.json`

- [ ] **Step 1: Turn the claim table into an immutable artifact**

Require each claim to have a stable ID, source locator, API-shape evidence, behavioral evidence, status, and notes. The draft semantic digest must bind the claim-inventory digest.

- [ ] **Step 2: Add a claim-review gate for unresolved or contradicted behavior**

Do not require a separate gate when every claim is verified and the user requested a local draft only. Require explicit review before a live patch that contains visible unresolved or contradicted claims.

- [ ] **Step 3: Build one exact document patch batch**

Bind target token, strategy, current revision, protected block inventory, intended semantic diff, draft digest, and claim-inventory digest. Disallow direct live use of `feishu-doc.js patch` from this skill without the wrapper.

- [ ] **Step 4: Add journal, refetch, acceptance, and corrective rollback**

For existing documents, prefer precise or smart patch rollback from a before snapshot; block rollback when live structure drift makes restoration unsafe. For newly created documents, delete only when the journal proves creation and no later unit depends on the document.

- [ ] **Step 5: Capture editorial changes as structured decisions**

Classify post-publication edits as `placement`, `style`, `factual`, `example`, or `rendering`. Record them as candidates only; preserve the existing requirement that skill changes need an explicit user request or a separately approved promotion.

- [ ] **Step 6: Run tests and commit**

```bash
node --test .claude/skills/verified-doc-authoring/tests/*.test.js
npm run test:skills
git add .claude/skills/verified-doc-authoring
git commit -m "feat: bind verified authoring to claims and acceptance"
```

### Task 12: Harden doc-code-verify live runtime and remediation handoff

**Files:**

- Create: `.claude/skills/doc-code-verify/contracts/remediation-handoff.schema.json`
- Create: `.claude/skills/doc-code-verify/src/runtime-policy.js`
- Create: `.claude/skills/doc-code-verify/src/runtime-session.js`
- Create: `.claude/skills/doc-code-verify/src/remediation-handoff.js`
- Create: `.claude/skills/doc-code-verify/tests/runtime-policy.test.js`
- Create: `.claude/skills/doc-code-verify/tests/runtime-session.test.js`
- Modify: `.claude/skills/doc-code-verify/scripts/verify-feishu-doc-code.js`
- Modify: `.claude/skills/doc-code-verify/SKILL.md`
- Modify: `.claude/skills/doc-code-verify/references/safety-policy.md`
- Modify: `.claude/skills/doc-code-verify/capabilities.json`

- [ ] **Step 1: Keep static verification unchanged**

Characterization tests must prove parse, compile, scenario construction, deterministic diagnostics, and result digests are unchanged when `--live` is absent.

- [ ] **Step 2: Build an exact live runtime manifest**

Before live execution, enumerate snippets or generated scenarios, required env groups, network targets, isolated resource names, expected mutations, cleanup actions, timeouts, and side-effect classes.

- [ ] **Step 3: Require digest-bound runtime approval for mutating scenarios**

`--live --allow-run` remains necessary but is insufficient when the manifest contains create/update/delete side effects. Require `--approve-runtime-digest sha256:<digest>` for those scenarios.

- [ ] **Step 4: Journal resource creation and cleanup**

Use prepared/observed entries for isolated resources. Completion requires verified cleanup or an explicit blocked result listing residual resources and recovery commands.

- [ ] **Step 5: Emit typed remediation handoff**

The verifier may produce suggested exact block IDs, diagnostics, source evidence, and recommended owning skill, but it must not authorize or perform write-back. `procedure-code-sync` or `verified-doc-authoring` must create a new action batch from the handoff.

- [ ] **Step 6: Run tests and commit**

```bash
node --test .claude/skills/doc-code-verify/tests/*.test.js
npm run test:verifier
npm run test:skills
git add .claude/skills/doc-code-verify
git commit -m "feat: journal live documentation code verification"
```

### Task 13: Clean canonical skill references and compatibility behavior

**Files:**

- Modify: `.claude/skills/localized-doc-sync/references/zilliz-localization.md`
- Modify: `.claude/skills/localized-doc-sync/references/*-alignment.md`
- Create: `.claude/skills/localized-doc-sync/tests/reference-policy-boundary.test.js`
- Modify: `.claude/skills/verified-doc-authoring/references/workflow.md`
- Modify: `.claude/skills/procedure-code-sync/references/feature-cases.md`
- Modify: `.claude/skills/api-reference-sync/references/bot-integration.md`
- Modify: compatibility `SKILL.md` and `agents/openai.yaml` files only when needed
- Modify: `tests/skills/invocation-cases.test.js`
- Create: `tests/skills/canonical-reference-hygiene.test.js`

- [ ] **Step 1: Add a RED canonical-reference scan**

Allow deprecated names only in compatibility folders, package aliases, migration tests, and historical plans/specs. Canonical references must use canonical skill names even when internal implementation folders retain historical names such as `src/sdk-doc-sync`.

- [ ] **Step 2: Remove live-state authority from localization prose**

Convert current-count and empty-table statements into explicitly dated evidence snapshots or remove them. Keep durable table mapping intent, identity overrides, and locale applicability in structured policy files. Tests must prove that a stale count cannot suppress live inventory discovery and that every policy exclusion or cross-locale equivalent has provenance plus a revalidation condition.

- [ ] **Step 3: Add compatibility telemetry without independent behavior**

Record alias invocation counts in run-local results so removal can be considered after two stable release iterations with no required callers. Do not give compatibility skills their own decision or rule stores.

- [ ] **Step 4: Validate agent metadata after instruction changes**

Regenerate `agents/openai.yaml` only when the canonical description or default prompt changed. Keep compatibility prompts as direct delegation.

- [ ] **Step 5: Run validation and commit**

```bash
npm run validate:skills
npm run test:skills
git add .claude/skills tests/skills
git commit -m "docs: align canonical documentation skill references"
```

### Task 14: Roll out in risk order with measurable admission gates

**Files:**

- Modify only when justified: `.claude/skills/doc-ops-core/expected-changes.json`
- Create ignored artifacts: `tmp/skill-feedback-rollout/<phase>/results.json`
- Modify: repository CI workflow selected during implementation

- [ ] **Step 1: Land shared governance without changing live behavior**

Release Tasks 2-7 first. Decision capture may run in observe-only mode, but candidate rules must not enter production prompts or skills.

- [ ] **Step 2: Enable shadow learning for api-reference-sync**

Collect decisions and generate shadow cases for at least one complete review session. Compare candidate-rule recommendations with actual later reviewer decisions; do not promote automatically.

- [ ] **Step 3: Migrate live write skills in this order**

```text
localized-doc-sync -> procedure-code-sync -> verified-doc-authoring
```

Localization goes first because the current bot approval path is task-bound rather than digest-bound. Procedure follows because it has one-document scope. Authoring follows after the claim artifact and precise patch strategy are stable.

- [ ] **Step 4: Enable live verifier journaling separately**

Static verification can deploy independently. Live runtime approval and cleanup journals require their own acceptance because they affect credentials and external resources.

- [ ] **Step 5: Use explicit promotion metrics**

Track:

```text
feedback adherence on held-out cases
repeat change-request rate for the same rule class
candidate precision after reviewer audit
scope-mismatch and contradiction counts
time from dry-run to accepted receipt
reconciliation and rollback frequency
unauthorized-write attempts blocked
alias invocation frequency
full-Base inventory coverage
unmapped and changed table count
write-blocking schema drift count
identity ambiguity count
issue-queue closure rate
final full-scan drift after per-unit processing
```

Do not optimize approval latency by weakening gates.

- [ ] **Step 6: Require these admission checks for each phase**

```bash
npm run validate:skills
npm run test:skills
npm run test:doc-ops-core
npm run test:agent-team
npm run test:localized-doc-sync
npm run test:unit
npm run test:offline
npm run eval:skills:routing
npm run eval:skills:behavior
npm run eval:skills:learning
git diff --check
```

Expected: no safety-case regression, byte-stable repeated artifacts, and no undeclared semantic change.

- [ ] **Step 7: Run disposable live smoke tests only after deterministic admission**

Use isolated Feishu resources, exact approval digests, complete journals, refetch verification, and verified cleanup. Keep live results out of tracked skill content.

- [ ] **Step 8: Promote the first rule through a reviewed PR**

Choose a narrow, non-permission rule with strong contrastive evidence, such as a Node-specific organization rule. The PR must include the candidate provenance, generated held-out cases, GREEN results, target capability/reference change, rollback commit, and the promotion manifest digest.

## Completion criteria

- Every canonical skill declares executable review, learning, adapter, and recovery policy.
- Every production write entrypoint is classified and either governed, quarantined, test-only, or deprecated.
- Approval consumers bind decisions to exact semantic artifacts.
- Raw approval events cannot mutate active rules or `SKILL.md`.
- Promoted rules have provenance, scope, counterexamples, held-out evaluation, human approval, version history, and rollback.
- `api-reference-sync` retains all PR #7 safety properties while emitting structured feedback evidence.
- Localization, procedure patching, and verified authoring have production journal/resume/acceptance paths rather than prose-only guarantees.
- Live code verification has an exact runtime manifest and cleanup evidence; static verification remains frictionless and read-only.
- Compatibility entries remain thin and canonical references no longer teach deprecated invocation names.
- All deterministic, model, fault-injection, and approved live-smoke gates pass before the program is declared complete.
