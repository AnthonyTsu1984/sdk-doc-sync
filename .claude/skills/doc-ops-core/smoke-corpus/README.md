# Shared Doc Ops Smoke Corpus

This corpus is synthetic and tenant-safe. It represents production document shapes without copying production documents, record identifiers, folder tokens, tenant URLs, or customer content.

The corpus covers the five canonical skills:

- `procedure-code-sync`
- `doc-code-verify`
- `verified-doc-authoring`
- `localized-doc-sync`
- `api-reference-sync`

Every document omits a body H1, carries `DOC_OPS_SYNTHETIC_FIXTURE_V1`, and declares stable required and forbidden fragments in `manifest.json`. The validator rejects missing files, unsafe paths, duplicate IDs, uncovered skills, body H1 headings, non-synthetic documents, and strings that resemble live Feishu tokens.

Run the hermetic checks:

```bash
npm run smoke:corpus
npm run smoke:simulate -- --run-id 20260802T120000Z-a1b2c3d4
```

`smoke:simulate` runs create, patch, refetch-style verification, and cleanup against an in-memory stateful fake tenant. It performs no network calls and no live writes.
