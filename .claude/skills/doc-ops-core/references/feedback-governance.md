# Skill Feedback Governance

Review decisions are evidence, not executable rules. An exact approval authorizes only the artifact digest named by that decision.

## Storage boundaries

- Append raw normalized decisions to ignored JSONL under `tmp/skill-feedback/<skill>/decisions.jsonl`.
- Keep reviewer and message identities in the runtime envelope. They do not affect semantic decision digests or independent support counts.
- Keep candidates, shadow evaluations, and promotion proposals outside active skill instructions until a reviewed Git change promotes them.
- Redact credential fields and token-like values before persistence.

## Automatic capture (打回即铸, 2026-10-04)

The first mile of the loop is mechanical, not discretionary:

- Session close captures: a two-gate `close-session` (api-reference-sync first) mechanically converts every session change request and every `changes_requested`/`rejected` decision bound to the session into a rule-candidate draft under `tmp/skill-feedback/<skill>/candidates/` (`auto-<digest16>.json`, deterministic and idempotent), or skips it when an explicit suppression with a recorded rationale exists (`record-learning-suppression --event-key <key> --rationale <text>`; the close refuses a suppression matching no derived event). A close with uncaptured events fails closed (`PROCESS_LEARNING_CAPTURE_REQUIRED`); a capture that cannot persist a candidate blocks the close (`PROCESS_LEARNING_CAPTURE_FAILED`). No-text events still become `one-off-exception` candidates ("triage required") — an unrecorded rejection is exactly the silent evaporation this prevents.
- Runtime refusals are evidence: every typed pre-write refusal at the writer-governance boundary lands in `tmp/invariant-violations.jsonl` as `kind: runtime_refusal` (registered codes keyed by invariant ID, first-seen codes keyed by code — `npm run invariants:violations`). A brand-new refusal code is learning material by definition.
- Triage stays human: drafts carry provenance (`applicableWhen.derivedFrom`/`eventKey`) and enter the normal lifecycle below; nothing auto-activates.

## Rule lifecycle

Rules move only through:

```text
candidate -> shadow -> proposed -> active -> superseded | deprecated
```

There is no CLI command that activates a rule. `build-promotion` creates a digest-bound proposal with `activationAuthorized: false`; activation requires a separately reviewed repository change.

## Support and scope

- Count support by unique task or review unit, not repeated messages.
- Inferred rules require three independent supporting decisions and three passing held-out cases.
- An explicit durable instruction may reduce support collection to one decision, but it still requires three held-out cases and a reviewed promotion digest.
- Preserve `applicableWhen`, `notApplicableWhen`, contradictions, supersession, provenance, and expiry.
- A one-off exception remains session evidence and is never promoted.

## Notification policy

- Ordinary promotion-ready candidates accumulate and notify in complete batches of five.
- Conflicts, high-risk candidates, authority expansion, and rules nearing expiry notify immediately.
- Frequency never expands write, delete, credential, network, runtime, acceptance, rollback, or publication authority.

## Promotion targets

| Rule class | Allowed target |
| --- | --- |
| `hard-policy` | capability manifest or executable contract |
| `deterministic-procedure` | reviewed script |
| `domain-fact` | direct reference or evidence |
| `soft-preference` | skill-local `references/learned-rules.json` |
| `one-off-exception` | none |
