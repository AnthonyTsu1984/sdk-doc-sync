# Safety Policy

Verification is read-only by default.

## Never Execute By Default

Do not execute snippets that:

- contain delete, drop, remove, destroy, truncate, revoke, or uninstall commands;
- create or mutate cloud resources;
- include API keys, tokens, passwords, credentials, or private endpoints;
- require a running Milvus/Zilliz/Feishu service;
- depend on unknown local state;
- start servers, background daemons, Docker containers, or long-running jobs.

These blocks may still receive non-executing parse, syntax, or compile checks. Runtime execution should be reported as `manual` unless the user explicitly enables `--live` or `--allow-run`.

## Runtime Execution

Runtime execution requires both:

- an in-block annotation such as `doc-verify: run`;
- the command-line flag `--allow-run`.

Live service checks require `--live`, `--allow-run`, an in-block runtime annotation, and the live profile's required env vars. Runtime checks should use a timeout and a temp working directory.

For a runtime manifest with `create`, `update`, or `delete` side effects:

1. Supply a unique `--resource-suffix` so every resource name is isolated.
2. Run once with `--runtime-manifest <path>` to materialize the exact manifest. The verifier stops before runtime when approval is absent.
3. Review snippets/scenarios, env groups, network targets, resource names, expected mutations, cleanup actions, timeouts, side-effect classes, and recovery commands.
4. Rerun with `--approve-runtime-digest sha256:<manifest-digest>` and `--runtime-journal <path>`.
5. Treat `--live --allow-run` without the exact digest as unauthorized for mutating scenarios.

Every prepared resource mutation and cleanup must receive an observed journal result. Completion is `VERIFIED` only when mutations succeeded and cleanup is verified. Missing cleanup returns `BLOCKED` with residual resource names and recovery commands; failed mutations return `FAILED`.

Runtime approval never authorizes documentation write-back. A `--remediation-handoff <path>` artifact is read-only and must be converted into a new exact action batch by `procedure-code-sync` or `verified-doc-authoring`.

## Output Handling

Reports must redact likely secrets from stdout/stderr. Keep only short stderr/stdout excerpts in the JSON report.
