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

## Output Handling

Reports must redact likely secrets from stdout/stderr. Keep only short stderr/stdout excerpts in the JSON report.
