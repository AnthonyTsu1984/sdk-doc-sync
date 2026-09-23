# Invariant Registry Governance

A domain rule is only as strong as the code that executes it on every relevant run. The invariant registry makes each machine-enforced rule traceable: stable ID, exact SKILL.md statement, enforcement stages, enforcer modules and blocker codes, and executable fixtures that invoke production policy code.

## Artifacts

- `<skill>/contracts/invariants.json` — the registry. One entry per invariant: `id`, `version`, `risk`, `scope`, `status` (`runtime-enforced` | `declared`), `enforcement` stages (`evidence`, `plan`, `pre-write`, `post-write`, `reconcile`, `admission`), `statementDigest`, and for runtime-enforced entries non-empty `fixtureIds` and `enforcers` (`{stage, module, codes[]}`; modules must exist in the repository).
- `<skill>/SKILL.md` Domain Invariants bullet — carries the trailing `[invariant.id]` marker. The registry `statementDigest` binds the whitespace-normalized bullet text (marker excluded), so a prose edit of a marked rule breaks `validate:skills` with `INVARIANT_STATEMENT_DIGEST_MISMATCH` until the registry is consciously updated.
- `<skill>/tests/conformance-fixtures/cases.json` — fixtures. A fixture referenced by a runtime-enforced invariant must declare `executable: { runner: "invariant-conformance", scenario: <name> }`; the skill's conformance test executes the scenario against production policy modules and fails when a listed fixture never runs (`INVARIANT_FIXTURE_NOT_EXECUTED`).
- `<skill>/contracts/invariant-waivers.json` — the only sanctioned exception artifact (see Transition policy).

## Gates

1. `validate:skills` — static: registry schema, marker ↔ entry bijection, statement digest binding, fixture existence, enforcer module existence, waiver schema (expiry not enforced statically; a stale waiver is ignored at consumption instead of failing unrelated builds).
2. `check:invariants` (`scripts/check-invariant-coverage.js`, admission stage) — diff-based:
   - Domain Invariants statement changes (added/removed/reworded bullets) require a `contracts/invariants.json` update in the same diff, else `INVARIANT_COVERAGE_REQUIRED`. A replay of PR #19's one-line-only diff is a committed regression test.
   - New bullets of a registry-adopted skill must carry a registered marker (`INVARIANT_MARKER_REQUIRED`); legacy unmarked bullets are grandfathered until a later phase promotes them.
   - Registry-only diffs are scanned for enforcement transitions (below), so a one-file registry edit cannot bypass the gate.
3. Skill conformance test — runtime: every runtime-enforced fixture executes production code and its typed decision equals the fixture assertions.

## Transition policy

A `runtime-enforced` invariant may not be weakened by editing the registry alone. The admission check compares base and head registries and reports:

- `removal` — the entry disappears;
- `downgrade` — status leaves `runtime-enforced`;
- `weakened-coverage` — status stays but fixture IDs, enforcement stages, or enforcer codes are lost. Enforcers are compared per stage+module with codes merged, so adding codes to an existing enforcer (or adding a new enforcer) is strengthening and never reported.

Each weakening transition requires a matching waiver in `contracts/invariant-waivers.json` that **already exists at the merge-base** — the waiver must have landed through its own separately reviewed change before the weakening diff:

```json
{
  "schemaVersion": 1,
  "waivers": [
    {
      "invariantId": "api.versioned-tree-delta",
      "transition": "downgrade",
      "reason": "Superseded by the Phase 2 post-write verifier; migration tracked in the enforcement plan.",
      "approvedBy": "<PR/review artifact that separately approved this exception>",
      "expiresAt": "2026-12-31T00:00:00.000Z"
    }
  ]
}
```

- A waiver introduced **in the same diff** as the transition it authorizes is self-approval and fails with `INVARIANT_WAIVER_SAME_DIFF`. The two-step flow is mandatory: land the waiver (its own review), then land the registry change that consumes it.
- An unmatched or expired waiver fails with `INVARIANT_DOWNGRADE_UNWAIVED`.
- Strengthening transitions (declared → runtime-enforced, added fixtures/enforcers/stages) never require a waiver.

Waivers are expiring exceptions, not permanent exits: when one expires, restore enforcement or land a new separately reviewed waiver. Binding waivers to externally verified approval/receipt digests (instead of pre-existence alone) is tracked as Phase 5 governance work in `.claude/plans/2026-09-23-skill-harness-rule-enforcement.md`.

## Reference enforcement (api-reference-sync, version 2)

The first runtime-enforced invariant, `api.versioned-tree-delta`, now spans
the full stage ladder: evidence → plan (policy kernel + attestation-bearing
plans) → pre-write → post-write (executor reference check, batch-level
`VERIFY_TREE_DELTA` journaled per attested action, acceptance finalization
requiring verified invariant evidence) → reconcile (read-only
`scripts/reconcile-tree-delta.js`). See the skill's
`references/tree-delta-policy.md` for the enforcement contract and decision
table. Later phases generalize this shape to the other canonical skills.
