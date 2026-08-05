# Feishu-Markdown Bridge

A deterministic documentation-operations toolkit for Milvus and Zilliz content in Feishu/Lark and local Markdown.

The repository exposes five focused documentation skills backed by a shared `doc-ops-core`. The shared core standardizes immutable action batches, exact approval digests, append-only journals, reconciliation, result contracts, and round-trip verification so that read, write, recovery, and cleanup behavior stays consistent across workflows.

## Canonical Skills

| Skill | Use it for |
| --- | --- |
| `api-reference-sync` | Scan Milvus or Zilliz SDK, CLI, REST, and OpenAPI releases; diff them against existing documentation; and plan versioned create, update, deprecate, backfill, or reparent operations. |
| `doc-code-verify` | Parse, lint, compile, scenario-test, or explicitly run existing documentation code examples without modifying the source document. |
| `verified-doc-authoring` | Draft or substantially revise source-grounded technical documentation from local files, Feishu pages, URLs, product notes, issues, and implementation evidence. |
| `localized-doc-sync` | Align paired source and localized Feishu wiki roots and Bitables while preserving record identity, hierarchy, metadata, and rich media. |
| `procedure-code-sync` | Add verified Java, Go, Node.js, REST, Zilliz CLI, or C++ variants to an existing Python-led procedure page. |

Deprecated names remain as compatibility entries and delegate to the canonical skills:

| Compatibility name | Canonical skill |
| --- | --- |
| `sdk-doc-sync` | `api-reference-sync` |
| `feishu-code-verify` | `doc-code-verify` |
| `draft-verified-docs` | `verified-doc-authoring` |
| `localization-docs` | `localized-doc-sync` |
| `patch-feishu-code` | `procedure-code-sync` |

## Safety Model

- Discovery, source inspection, indexing, diffing, drafting, verification, and dry-runs are read-only by default.
- A live mutation requires explicit approval of the exact generated batch digest. Changing the action set produces a new digest and requires new approval.
- Every approved action is journaled before and after mutation and ends with a durable completion sentinel.
- An interrupted run is reconciled against recorded receipts and current tenant state instead of being blindly replayed.
- Written documents and records are refetched and checked for content, metadata, hierarchy, links, and protected-block preservation.
- API-reference acceptance is separate from write approval. Updating records from `WIP` to `Draft` and advancing `scan-state.json` requires verified execution lineage and a separate acceptance step.

## Supported API Surfaces

- **Python** — PyMilvus
- **Java** — Milvus Java SDK
- **Node.js** — Milvus Node.js SDK
- **C++** — Milvus C++ SDK
- **Go** — Milvus Go SDK
- **REST/OpenAPI** — Milvus and Zilliz Cloud API specifications
- **Zilliz CLI** — Rust `zilliz` / `zz` commands

## Project Structure

```text
.
├── .claude/
│   ├── skills/
│   │   ├── api-reference-sync/      # Release discovery, SDK/API planning, execution, and converters
│   │   ├── doc-code-verify/         # Deterministic code-example verification
│   │   ├── verified-doc-authoring/  # Source-grounded documentation authoring
│   │   ├── localized-doc-sync/      # Source/localized document alignment
│   │   ├── procedure-code-sync/     # Multi-language procedure code patches
│   │   ├── doc-ops-core/            # Shared contracts, guards, journals, reconciliation, and smoke harness
│   │   └── <compatibility entries>/ # Deprecated names that delegate to canonical skills
│   └── agent-team/                   # Feishu event, approval, worker, and task orchestration
├── evals/                            # Skill routing evaluation cases
├── repos/                            # Local SDK/source repositories; contents are ignored by Git
├── scripts/                          # Repository validation and test entry points
├── tests/skills/                     # Cross-skill contract and invocation tests
├── package.json
└── README.md
```

## Setup

Install dependencies from the repository root:

```bash
npm ci
```

For Feishu/Lark reads or live operations, create a local `.env` file:

```env
FEISHU_HOST=https://open.feishu.cn
APP_ID=your_app_id
APP_SECRET=your_app_secret
```

Clone the source repositories needed by the workflow under `repos/`:

```bash
git clone https://github.com/milvus-io/pymilvus.git repos/pymilvus
```

Live write workflows may require additional target tokens such as `ROOT_TOKEN` and `BASE_TOKEN`. Keep credentials out of committed files.

## Common Workflows

### Discover and Plan an API-Reference Release

Generate a bounded release-scope artifact:

```bash
npm run api-reference-sync:release-scout -- \
  --language python \
  --sdk-name pymilvus \
  --track v2.6.x \
  --output tmp/sdk-release-scout/python-v26.json \
  --json
```

Use the reviewed artifact for a read-only sync plan:

```bash
npm run api-reference-sync -- \
  --sdk-dir repos/pymilvus \
  --language python \
  --sdk-name pymilvus \
  --sdk-version v2.6.x \
  --release-scope tmp/sdk-release-scout/python-v26.json \
  --dry-run \
  --json
```

Live execution additionally requires the exact `proposedExecutionBatch.batchDigest` through `--approve-batch-digest <hash>` and any target-specific approval evidence required by the generated plans.

The legacy npm entry remains available:

```bash
npm run sdk-doc-sync -- --help
```

### Verify Documentation Code

Verify snippets in a local Markdown file:

```bash
npm run doc-code-verify -- --markdown path/to/document.md
```

Verification is read-only by default. Runtime or live scenario execution requires explicit CLI gates and an approved environment.

### Convert Feishu Documents and Markdown

Export a Feishu document to Markdown:

```bash
node .claude/skills/api-reference-sync/bin/export-doc.js \
  <doc-token-or-url> \
  tmp/exported.md
```

Use the Feishu document utility for folder, Bitable, push, and patch operations:

```bash
node .claude/skills/api-reference-sync/scripts/feishu-doc.js list-folder <folder-token>
node .claude/skills/api-reference-sync/scripts/feishu-doc.js bitable-list <base-token>
node .claude/skills/api-reference-sync/scripts/feishu-doc.js push <file> --folder <token> --title <title> --dry-run
node .claude/skills/api-reference-sync/scripts/feishu-doc.js patch <doc-token> <file> --strategy smart --dry-run
```

Run a dry-run before every live push or patch and refetch the target after a write.

### Run the Hermetic Doc-Ops Smoke Test

Validate the synthetic corpus without making network calls:

```bash
npm run smoke:corpus
```

The in-memory lifecycle simulator also performs no network calls or live writes. It requires a valid smoke configuration because plans are bound to an isolated test namespace:

```bash
cp .env.smoke.example .env.smoke.local
# Fill only isolated test identifiers in .env.smoke.local.

set -a
source .env.smoke.local
set +a

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)"

npm run smoke:doctor
npm run smoke:plan -- --run-id "$RUN_ID"
npm run smoke:simulate -- --run-id "$RUN_ID"
```

Live smoke tests use an isolated Lark CLI sandbox and separate approval gates for create, patch, acceptance, and cleanup. Follow [the tenant smoke environment runbook](.claude/skills/doc-ops-core/references/tenant-smoke-environment.md); never point smoke configuration at production resources.

## Testing

Run the complete repository suite:

```bash
npm test
```

Useful focused checks:

```bash
npm run validate:skills
npm run test:skills
npm run test:doc-ops-core
npm run test:verifier
npm run test:agent-team
npm run test:patch-code-blocks
```

API-reference test aliases are also available:

```bash
npm run test:unit
npm run test:offline
npm run test:integration
npm run test:list
```

## Key Files

| File | Purpose |
| --- | --- |
| `.claude/skills/api-reference-sync/SKILL.md` | Canonical SDK, CLI, REST, and OpenAPI release-sync workflow |
| `.claude/skills/doc-code-verify/SKILL.md` | Verification boundaries and execution gates for code examples |
| `.claude/skills/verified-doc-authoring/SKILL.md` | Source-verification and authoring workflow |
| `.claude/skills/localized-doc-sync/SKILL.md` | Paired source/localized document synchronization workflow |
| `.claude/skills/procedure-code-sync/SKILL.md` | Existing-procedure multi-language patch workflow |
| `.claude/skills/doc-ops-core/contracts/` | Shared approval, journal, run-artifact, capability, and verification schemas |
| `.claude/skills/doc-ops-core/src/` | Deterministic action batches, guards, state transitions, reconciliation, and result contracts |
| `.claude/skills/doc-ops-core/references/tenant-smoke-environment.md` | Isolated live smoke setup, execution, recovery, and cleanup runbook |
| `scripts/run-tests.js` | Complete repository test orchestrator |

## License

ISC
