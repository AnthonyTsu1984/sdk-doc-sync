# Runbook: production admitted-fingerprint binding (checklist 6.9)

Purpose: a production run must bind the EXACT source tree the admission gates
executed against. "Tested similar code" is not proof.

## Mechanism

- Every `ADMITTED` admission run records the widened whole-tree fingerprint
  (`productionInputFingerprint`: tracked ∪ untracked file contents — the same
  O1/O2 definition run manifests bind) into the append-only ledger
  `tmp/skill-feedback-rollout/admitted-fingerprints.jsonl`, naming the phase,
  whether it was `--deterministic-only`, and the results artifact path. The
  same fingerprint is written into `results.json` (`productionInputFingerprint`) —
  distinct from the admission-scoped `sourceFingerprint` the drift guard compares.
- A governed writer whose shell sets `DOC_OPS_REQUIRE_ADMITTED_FINGERPRINT=1`
  refuses every mutation with typed `RUN_NOT_ADMITTED` unless the bound run
  manifest's source fingerprint has an exact ADMITTED record. Dev/test shells
  leave the flag unset — the writer gate is a no-op there.
- The check runs at the innermost writer layer (`assertMutationAllowed`), so
  every canonical write path (api sync/acceptance/rollback, procedure,
  authoring, localized, agent-team live-write) is covered without per-CLI
  wiring.

## Operator procedure (production shell)

```bash
# 1. Run the admission gates on the exact tree you will run production with.
npm run admit:skills -- --phase <label>            # full (model evals included)
# or, for the deterministic subset:
npm run admit:skills -- --phase <label> --deterministic-only

# 2. Production shell: require the admitted binding.
export DOC_OPS_REQUIRE_ADMITTED_FINGERPRINT=1
# then run the production CLI as usual; any tree drift since admission
# (including untracked file edits) refuses with RUN_NOT_ADMITTED.
```

For production runs on a machine that did NOT run admission (e.g. evidence
produced by CI), place the CI's admission evidence so the ledger can see it:
either copy the ledger, or construct
`tmp/skill-feedback-rollout/admitted-fingerprints.jsonl` with the record from
the CI artifact's `results.json` (`productionInputFingerprint` field — distinct from the admission-scoped `sourceFingerprint` the drift guard compares).

## Semantics and limits (honest)

- Re-admission after any tree edit is REQUIRED: the fingerprint covers
  untracked file content (O1) and the whole working tree — a strict superset
  of the admission input set (O2). A tree edit invalidates the binding; the
  writer refuses until the gates run again on the new tree.
- Release-grade evidence is a FULL admission (`deterministicOnly: false` in
  the record); deterministic-subset records are marked as such.
- The flag is operator discipline, not hardware enforcement — same trust
  model as every env gate in this repo. The known sampling limit (a
  make-and-revert inside one gate's execution window is undetectable)
  remains, recorded at PR #39 review as O4.
