# Skill Feedback Governance

Review decisions are evidence, not executable rules. An exact approval authorizes only the artifact digest named by that decision.

## Storage boundaries

- Append raw normalized decisions to ignored JSONL under `tmp/skill-feedback/<skill>/decisions.jsonl`.
- Keep reviewer and message identities in the runtime envelope. They do not affect semantic decision digests or independent support counts.
- Keep candidates, shadow evaluations, and promotion proposals outside active skill instructions until a reviewed Git change promotes them.
- Redact credential fields and token-like values before persistence.

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
