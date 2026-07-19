# Active-Track Inheritance

Use this reference when a maintained SDK/API documentation track has active successor tracks that normally inherit user-facing changes.

## Goal

Prevent a source-track update from becoming approval-ready while the successor track silently misses, renames, or diverges from the same public feature.

This is a review gate, not an automatic copy rule. Verify successor behavior from source, scanner output, and existing documentation state before proposing successor actions.

## Successor Detection

The reviewed-context builder detects successor tracks from the relevant per-SDK reference version table by default. For example, if the current track appears in the table and later `v<major>.<minor>.x` rows also appear, those later rows become required successor checks.

Use `--sdk-reference <file>` only when testing or when the run must use a reviewed reference file outside the default `.claude/skills/sdk-doc-sync/sdk-<language>.md` location.

## Candidate Spec Shape

For normal maintained-track inheritance, do not hard-code successor pairs in the candidate spec. The reference version table is the source of truth.

When a run has an extra successor not represented in that table, add it at the candidate-spec root:

```json
{
  "inheritance": {
    "requiredSuccessorTracks": ["<successor-track>"]
  }
}
```

Use the root `inheritance.requiredSuccessorTracks` field for additional run-specific successor tracks, not as the only enforcement source.

Each selected candidate or group must include:

```json
{
  "inheritanceReview": {
    "reviewed": true,
    "successors": [
      {
        "track": "<successor-track>",
        "status": "inherited|missing|renamed|changed|not_applicable|deferred|successor_action_planned",
        "decision": "no_successor_action|include_successor_action|defer|exclude",
        "docIdentity": {
          "stableId": "<successor-stable-id>",
          "canonicalSlug": "<successor-canonical-slug>"
        },
        "evidence": [
          { "kind": "source", "locator": "<file>:<line>" }
        ],
        "notes": "<short reason>"
      }
    ]
  }
}
```

`scripts/build-reviewed-release-context.js` rejects reviewed context generation when required successor tracks are missing or unreviewed.

## Status Meanings

| Status | Meaning | Typical decision |
|--------|---------|------------------|
| `inherited` | Successor track already exposes the same user-facing behavior and docs do not need a separate action. | `no_successor_action` |
| `successor_action_planned` | Successor track should receive a corresponding create, update, repoint, or metadata action. | `include_successor_action` |
| `missing` | Successor source/docs do not expose the source-track feature. | `include_successor_action`, `defer`, or `exclude` |
| `renamed` | Successor track exposes the feature under a different public identity. | `include_successor_action` or `defer` |
| `changed` | Successor track exposes related behavior but signatures, semantics, placement, or examples differ. | `include_successor_action` or `defer` |
| `not_applicable` | Successor track intentionally removed or replaced the feature. | `no_successor_action` or `exclude` |
| `deferred` | Successor decision is acknowledged but intentionally left for a later run. | `defer` |

Do not use `no_successor_action` for `missing`, `renamed`, or `changed`; that hides inheritance work.

The reviewed-context builder enforces the status/decision pairs shown in the table. Use `deferred` only with `defer`, and use `successor_action_planned` only with `include_successor_action`.

## Proposal Requirements

For every source-track candidate, include:

- source documentation identity and target category;
- successor track and successor documentation identity if known;
- source variants and successor variants;
- inheritance status and proposed decision;
- evidence from source files, scanner output, existing docs, or bitable records;
- risk if successor work is deferred.

## Approval Boundary

Grouping approval may approve inheritance decisions. Write approval applies only to the exact source-track and successor-track actions shown in the reviewed planning artifacts.

If any successor evidence or decision changes after approval, return to grouping/inheritance review before requesting write approval again.
