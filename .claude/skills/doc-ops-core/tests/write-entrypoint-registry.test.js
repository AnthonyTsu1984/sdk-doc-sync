'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  detectWriteCapability,
  discoverEntrypoints,
  loadWriteEntrypointRegistry,
  validateRegistryEntries,
} = require('../src/write-entrypoint-registry');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

test('tracked entrypoint registry covers the complete frozen inventory with honest governance metadata', () => {
  const registry = loadWriteEntrypointRegistry({ repoRoot: REPO_ROOT });
  const discovered = discoverEntrypoints(REPO_ROOT);
  // The three Golden Rule 4 post-action scripts that survived the phase-6
  // wave-1 disposition are exception-admitted, so the inventory validation
  // runs against the real reviewed exceptions at the current time.
  const expectedChanges = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, '.claude', 'skills', 'doc-ops-core', 'expected-changes.json'),
    'utf8',
  ));
  const result = validateRegistryEntries({
    repoRoot: REPO_ROOT,
    registry,
    discoveredPaths: discovered,
    expectedChanges,
    now: new Date().toISOString(),
  });

  // Entry-point pin: re-derive with `node -e "const {discoverEntrypoints}=require('.claude/skills/doc-ops-core/src/write-entrypoint-registry');console.log(discoverEntrypoints(process.cwd()).length)"` — 4 additions arrived with the pr-intake toolchain (0cf7505); +1 read-only admission gate scripts/check-invariant-coverage.js (invariant registry phase 1); +1 read-only reconciliation scripts/reconcile-tree-delta.js (invariant policy kernel phase 2); +1 read-only content reconciliation scripts/reconcile-content.js (content-fidelity phase 4); +1 read-only local polish applier scripts/apply-polish-context.js (content-fidelity phase 4 step 5); +1 read-only identity reconciliation bin/identity-reconcile.js (identity-coverage reconciliation); +1 read-only coverage report scripts/invariant-coverage-report.js (phase 5 shared substrate); −79 legacy-live one-off campaign scripts removed (phase-6 wave-1 disposition, 165→86); +2 read-only admission gates scripts/check-js-syntax.js and scripts/run-focused-tests.js (6.5 review hardening, 86→88); +1 read-only artifact publisher scripts/publish-admission-artifact.js (6.11 admission artifact publication, 88→89); −4 dormant legacy-live tools removed with the wave-3 close-out (feishu-doc.js, feishu-doc-translator.js, node-v30-update.js, java-v26-update.js — doc-agent-live-write reclassified canonical-governed; baseline legacyLiveCount 5→0), 89→85; +1 read-only post-verbatim polish gate bin/pr-polish.js (api.pr-polish-governed), 85→86; +1 canonical-governed post-verbatim polish application bin/pr-polish-apply.js (api.pr-polish-governed application step, executed-batch-digest approval), 86→87. +1 canonical-governed repair tool scripts/repair-same-name-placement.js (api.same-name-sibling-placement remediation: drive move + category-node repoint under plan-digest approval), 87→88; +2 read-only corpus collectors scripts/collect-page-blocks.js and scripts/intake-preflight.js (campaign-control hardening batch 1: corpus sweep + intake preflight, 88→90; +1 read-only topology audit scripts/audit-track-topology.js (campaign-control hardening batch 2, 90→91; +1 canonical-governed topology repair scripts/repair-java-topology.js (batch 2 disposition execution, 91→92; +1 read-only gate presentation scripts/gate-presentation.js (campaign-control hardening batch 3: gate-card link three-piece — local index + auto-open + clipboard, 92→93); +2 read-only grouping-gate CLIs scripts/build-grouping-proposal.js and scripts/record-grouping-approval.js (api.grouping-proposal-governance: canonical proposal builder + durable APPROVE_GROUPING receipt, 93→95; +1 read-only derive compiler bin/sdk-derive.js (rust overlay pilot: pinned base + overlay compile, deterministic local artifacts, never writes Feishu, 95→96); +3 java v3.0.x revision-campaign intake surfaces (read-only scope builder scripts/build-revision-scope.js, read-only session intake bin/revision-intake.js, canonical-governed per-unit revision executor bin/revision-apply.js with executed-batch-digest approval), 96→99; +1 read-only pre-presentation check scripts/gate-presentation-check.js (fixed gate-presentation structure + binding check with --ensure regeneration, 2026-10-14 ruling), 99→100; +2 read-only input-side intake CLIs .claude/skills/api-reference-sync/scripts/dump-bitable-snapshot.js and .claude/skills/api-reference-sync/scripts/dump-pr-pages.js (campaign-control batch 15 §5.1/§5.2: canonical Bitable snapshot producer + PR page dumper, GET-only/git-show only, 100→102).
  // Batch-15 campaign split, two sources by merge order (review P0-1):
  //   - this branch alone: +1 read-only canonical composer
  //     scripts/compose-pr-reconcile-candidate-spec.js (batch 15 §4), 100→101;
  //   - feat/batch15-input-side alone: +2 read-only input-side intake CLIs
  //     scripts/dump-bitable-snapshot.js and scripts/dump-pr-pages.js (batch 15
  //     §5.1/§5.2, GET-only/git-show only), 100→102;
  //   - merged (100 + 1 + 2): 103 — advance this pin to 103 when the branches
  //     merge, and the merged registry carries all three entries.
  //   - +1 read-only budget metering CLI scripts/agent-budget.js (slice 3-1
  //     agent budget metering: reads host-side agent metadata/rollout and
  //     repo tmp bookkeeping, appends only run-local
  //     tmp/token-budget-{live,ledger}.jsonl records), 103→104.
  //   - +1 read-only SKILL.md meta-lint scripts/skill-md-lint.js (slice 3-2
  //     thin-skill refactor, audit tmp/skill-thin-refactor-audit.md §6.5 B-5:
  //     size budget + marker/registry digest consistency + pointer integrity
  //     + refusal-code citations; no external mutation signature), 104→105.
  //   - +6 read-only intake/batch-18 CLIs (python PR #1173/#1181 intake draft:
  //     scripts/copy-and-repoint-plan.js, scripts/resolve-content-targets.js;
  //     batch 18 wiring: scripts/intake-assemble.js, scripts/inject-includes.js,
  //     scripts/propose-audience.js, scripts/record-campaign-approval.js — all
  //     local-artifact producers with no external mutation signature), 105→111.
  //   - +1 read-only batch-18 §5 headless shell bin/campaign-run.js (W-H/W-I
  //     runner call-site: spawns the canonical governed CLI phases as
  //     subprocesses, the write boundary staying with each child entrypoint;
  //     writes only the local findings-ledger/freeze artifacts under tmp/), 111→112.
  //   - +2 read-only batch-16 CLIs: scripts/campaign-settle.js (design §6:
  //     settleCampaign CLI-ization — findings-ledger mark-disposed or freeze
  //     + doorbell, only local tmp/ artifacts, same basis as campaign-run) and
  //     scripts/build-campaign-plan.js (design §8: campaign plan v2 generator
  //     — reads config/release-tracks.json + intake artifact paths, writes
  //     only the requested plan file), 112→114.
  //   - +1 read-only revision unit-digest collector
  //     .claude/skills/api-reference-sync/scripts/revision-unit-digests.js
  //     (batch 16 slice 7: per-unit {reviewUnitId, batchDigest} set for the
  //     approval's derived units binding; reads session/scope/contexts,
  //     writes only the requested unit-digests file under tmp/), 114→115.
  //   - +1 read-only placement-audit proposals builder
  //     .claude/skills/api-reference-sync/scripts/build-audit-proposals.js
  //     (shadow campaign #1: derives the audit's proposals view from intake
  //     decisions — local file write only), 115→116.
  //   - +1 read-only UPDATE fidelity assertion CLI
  //     .claude/skills/api-reference-sync/scripts/compare-update-spec-context.js
  //     (P0-1 2026-10-21: reads candidate-spec + reviewed-context, prints a
  //     byte-fidelity report — UPDATE 条目确定性拼装的机械断言, no external
  //     mutation signature), 116→117.
  assert.equal(discovered.length, 117);
  assert.deepEqual(result, { valid: true, errors: [] });
  const canonical = registry.entries.find((entry) => entry.path.endsWith('/sdk-doc-sync.js'));
  assert.equal(canonical.classification, 'canonical-governed');
  assert.equal(canonical.approval, 'exact-batch-digest');
  assert.equal(canonical.journal, 'required');
  const procedure = registry.entries.find((entry) => entry.path.endsWith('/procedure-code-sync.js'));
  assert.equal(procedure.classification, 'canonical-governed');
  assert.equal(procedure.approval, 'exact-batch-digest');
  assert.equal(procedure.journal, 'required');
  const authoring = registry.entries.find((entry) => entry.path.endsWith('/verified-doc-authoring.js'));
  assert.equal(authoring.classification, 'canonical-governed');
  assert.equal(authoring.approval, 'exact-batch-digest');
  assert.equal(authoring.reconciliation, 'required');
  const verifier = registry.entries.find((entry) => entry.path.endsWith('/verify-feishu-doc-code.js'));
  assert.equal(verifier.approval, 'exact-runtime-manifest-digest');
  assert.equal(verifier.journal, 'required-for-mutating-live-runtime');
  // Wave 3: the legacy-live population is zero — doc-agent-live-write is
  // canonical-governed and the four dormant tools are removed.
  const legacy = registry.entries.filter((entry) => entry.classification === 'legacy-live');
  assert.equal(legacy.length, 0);
  assert.equal(registry.baseline.legacyLiveCount, 0);
  const agent = registry.entries.find((entry) => entry.path.endsWith('doc-agent-live-write.js'));
  assert.equal(agent.classification, 'canonical-governed');
  assert.equal(agent.approval, 'exact-batch-digest');
  assert.equal(agent.journal, 'required');
});

test('write capability detection distinguishes explicit tenant mutations from read-only scans', () => {
  assert.deepEqual(detectWriteCapability('await writer.updateRecord(recordId, fields);'), {
    writeCapable: true,
    evidence: ['writer.updateRecord'],
  });
  assert.deepEqual(detectWriteCapability('await reader.listRecords();\nawait fetch(url, { method: "POST", body: query });'), {
    writeCapable: false,
    evidence: [],
  });
});

test('new legacy-live registry entries require a reviewed unexpired exception', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'entrypoint-registry-'));
  const filePath = path.join(root, 'scripts', 'new-live.js');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    "require('../doc-ops-core/src/legacy-quarantine').enforceLegacyQuarantine({ entrypointPath: __filename });\nawait writer.updateRecord(recordId, fields);\n",
  );
  const entry = {
    path: 'scripts/new-live.js',
    skill: 'localized-doc-sync',
    classification: 'legacy-live',
    operation: 'repair',
    approval: 'none',
    journal: 'none',
    reconciliation: 'none',
    quarantineFlag: 'DOC_OPS_ALLOW_LEGACY_LIVE',
    canonicalReplacement: 'Task 9',
    admittedAtBaseline: false,
    tests: [],
  };
  const rejected = validateRegistryEntries({
    repoRoot: root,
    registry: { schemaVersion: 1, entries: [entry] },
    discoveredPaths: ['scripts/new-live.js'],
    expectedChanges: [],
    now: '2026-08-06T00:00:00.000Z',
  });
  assert.ok(rejected.errors.some((error) => error.code === 'LEGACY_LIVE_EXCEPTION_REQUIRED'));

  const accepted = validateRegistryEntries({
    repoRoot: root,
    registry: { schemaVersion: 1, entries: [entry] },
    discoveredPaths: ['scripts/new-live.js'],
    expectedChanges: [{ entrypointPath: 'scripts/new-live.js', expiresAt: '2026-09-01T00:00:00.000Z' }],
    now: '2026-08-06T00:00:00.000Z',
  });
  assert.deepEqual(accepted, { valid: true, errors: [] });
});
