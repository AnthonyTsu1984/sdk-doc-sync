# Runbook: harness release live-smoke gate (checklist 6.8)

Purpose: before releasing a new harness version, one operator runs the full
disposable-tenant smoke — **create → patch → verify (acceptance readback) →
cleanup** — against a disposable Feishu tenant, under the run's own exact
digest approvals, and records PASS evidence bound to the exact source
fingerprint. This gate is **never PR-automated**; it runs at release time on
the operator's machine (workflow stance unchanged).

## Prerequisites

- A **disposable** Feishu tenant (never a production tenant). The config guard
  refuses values that collide with production `APP_ID` / `APP_SECRET` /
  `BASE_TOKEN` / `ROOT_TOKEN` / `TABLE_ID` (`SMOKE_CONFIG_COLLISION`).
- The `doc-ops-smoke` CLI profile configured for that tenant
  (`lark auth login --profile doc-ops-smoke`, `lark config set --profile doc-ops-smoke …`).
- Environment (all required, prefix `SMOKE_`): `PROFILE`, `TENANT_MARKER`
  (explicit uppercase test-tenant marker), `FEISHU_HOST`
  (`https://open.feishu.cn` or `https://open.larksuite.com`), a valid
  `IDENTITY_FINGERPRINT` (`sha256:…`), plus disposable `ROOT_TOKEN`,
  `BASE_TOKEN`, `TABLE_ID`.

## Steps

```bash
# 0. Deterministic preflight (zero writes)
node .claude/skills/doc-ops-core/bin/doc-ops-smoke.js validate-corpus
node .claude/skills/doc-ops-core/bin/doc-ops-smoke.js doctor
node .claude/skills/doc-ops-core/bin/doc-ops-smoke.js plan --run-id <YYYYMMDDTHHMMSSZ-8hex>
node .claude/skills/doc-ops-core/bin/doc-ops-smoke.js simulate --run-id <run-id>

# 1. One-shot release gate (LIVE, disposable tenant only).
#    Take the three digests from the plan output above.
node .claude/skills/doc-ops-core/bin/doc-ops-smoke.js release-gate \
  --run-id <run-id> \
  --approve-create-digest <plan.creationBatch.batchDigest> \
  --approve-patch-digest  <plan.patchBatch.batchDigest> \
  --approve-cleanup-digest <plan.cleanupBatch.batchDigest>
```

The gate, in order: verifies every approval digest against the plan **before
anything runs** (`SMOKE_RELEASE_GATE_DIGEST_MISMATCH` otherwise), replays the
offline rehearsal (`SMOKE_RELEASE_GATE_REHEARSAL_FAILED` otherwise), refuses
if this tree already holds PASS evidence — the conflict surfaces at preflight,
before identity or any live write
(`SMOKE_RELEASE_GATE_EVIDENCE_CONFLICT`; deliberate re-gating means moving
the old artifact aside first) — verifies the sandbox identity, then chains
live-create → live-patch → acceptance readback → live-cleanup. Each phase is
journal-gated exactly like the per-phase commands; any failure stops the
chain typed before the next phase. The cleanup phase runs under the
**materialized** batch digest (targets rebound to exact live tokens after
creation); the gate validates the materialized batch's composition against
the pre-approved plan (`SMOKE_RELEASE_GATE_CLEANUP_DERIVATION_INVALID` on any
divergence beyond the target/dependsOn rebinding) and records BOTH digests in
the evidence.

## Evidence

On PASS the gate writes
`tmp/doc-ops-smoke/release-gate/release-<sourceFingerprint>.json` — exclusive
create, deterministic content (no timestamps), binding: source fingerprint
(whole-tree, tracked ∪ untracked contents), sandbox identity fingerprint,
run id, corpus id, the four phase outcomes, the three approved digests, and
the materialized cleanup digest. That file is the release evidence: a harness
version is releasable when its tree fingerprint has a PASS gate artifact.
No artifact ⇒ not gated ⇒ do not release. **Preserve the artifact out of
tree** (release-notes attachment or the release tag annotation) — `tmp/` is
gitignored and machine-local, and committing the artifact would change the
very fingerprint it binds.

## Recovery (only on failure)

- Partial create/patch: inspect `tmp/doc-ops-smoke/runs/<run-id>/` journals,
  then `live-cleanup-resume` / `live-recovery-cleanup` with their planned
  digests. Never replay `live-create`/`live-patch` over an existing journal
  (the journal guard refuses).
- Acceptance diverged: the gate stops before cleanup with
  `SMOKE_RELEASE_GATE_ACCEPTANCE_FAILED`; inspect the readback, then clean up
  with `cleanup-plan --run-id <run-id>` → take the **materialized**
  `cleanupBatch.batchDigest` from its output → `live-cleanup --run-id <run-id>
  --approve-batch-digest <that digest>`. The planned cleanup digest cannot
  govern cleanup after creation: targets are rebound to exact live tokens.
