# Zilliz CLI — SDK Doc Sync Reference

> **⚠️ Tool transition:** The Python `zilliz-cli` (v0.1.5) was replaced by the Rust `zilliz` / `zz` binary. As of 2026-06-17, the public release stream is `zilliz-v1.4.4` with v1.4.5 implementation changes traced in `zilliz-cloud/vdc/zilliz-tui`. The legacy `zilliz-cli` reference below is kept for historical context.

## zilliz-tui / zilliz CLI (current Rust stream)

- **Code repo in this workspace:** `repos/zilliz-cloud/vdc/zilliz-tui/`
- **Public release repo:** `repos/zilliz-cli/` (`github.com/zilliztech/zilliz-cli`)
- **Language:** Rust (Cargo.toml + clap derive macros)
- **Binary names:** `zilliz` and `zz`
- **Latest scanned public release:** `zilliz-v1.4.4` (scanned 2026-06-17)
- **Latest scanned implementation commit:** `14b5dc47a029a0c8908a47daa035b269e3247ce1` in `repos/zilliz-cloud/vdc/zilliz-tui`
- **Source:** `repos/zilliz-cloud/vdc/zilliz-tui/src/`
- **CLI dispatch:** `src/cli/args.rs` (clap definitions) + `src/lib.rs` (op dispatch table)
- **Resource models:** `src/model/builtin_models/control-plane.json` and `data-plane.json`
- **Hand-written command modules:** `src/cli/{alert,auth,auth_cmd,backup,billing,cluster,completion,configure,context,metrics,version}.rs`
- **Changelog:** `repos/zilliz-cloud/vdc/zilliz-tui/CHANGELOG.md`

### Bitable & Drive Tokens (v1.3.x / v1.4.x)

| Field | v1.3.x | v1.4.x |
|-------|--------|--------|
| Bitable | `Rr4lbWr8baQj5psICV9cEFa2nYe` | `Lx1bbCdpMaSmJXs8wz5cjsDengf` |
| Table | `tblpQmRZvCES9KCF` | `tblpQmRZvCES9KCF` |
| Drive folder | `QBLKf6CCPloK0cddw6gcXUZqnob` | `LF1Kf54jFllUBydVk7hcha30nUh` |
| Shared drive root | `EsDFfU9OQlcdBldL1jVcCwpfnPd` | `EsDFfU9OQlcdBldL1jVcCwpfnPd` |

Folder map v1.3.x: `/tmp/v13x-folders.json` (3 categories × 8 subfolders = 24 leaf folders).
Doc copy mapping (v0.1.x → v1.3.x docx tokens): `/tmp/v13x-doc-copy-mapping.json`.
Folder map v1.4.x: Cloud Management (`QMg2fBP94l5N7VdSwbucwMffnje`) → Project (`ECvTfFzKElW00pdSugdcqakXnep`), OnDemandCluster (`LuO3fJ20yldkHcdLRzbc3ZYenEb`), PrivateLink (`Oiv0fRpvQlQ07RdjQObcYtaunVh`), Stage (`LR32fkHcElbx5QdurL9cMlvunLh`), Volume (`WabafQZw0l0BDUdRbsZcK8SOnqc`), StorageIntegration; Data Operations (`Ag0Rf5tHcl6Wp7d37lBcUE8LnMg`) → Collection (`ZiRWf2bJDlO6A3dWLW1cRKHLnAb`), ExternalCollectionRefresh (`UsGBf6CcilUmMFdhvqScr3Krnah`); Configuration (`DGm8fFP8plvHz5d6sErcKcoLnRh`) → Context (`UwkgfNHjflzvCXdn9CkcXWrInHd`), Auth (`NORefWujnlbXKSdmo1tclDHdn6g`), Global (`NYgzfcJMylBEqqd8UBMcuEWKnga`).

### Category Structure (v1.3.x)

```
Configuration/
  Alert/      Auth/      Completion/   Configure/
  Context/    Global/    History/*new  Quickstart/*new
Cloud Management/
  Backup/     Billing/   Cluster/      Import/
  Job/        Project/   Volume/       Milvus Standalone/*new
Data Operations/
  Alias/      Collection/  Database/   Index/
  Partition/  Role/        User/       Vector/
```

### Net-new commands in v1.x (vs v0.1.x)

| Command | Category / Subfolder | Notes |
|---|---|---|
| `whoami` (alias `info`) | Configuration / Auth | replaces `auth status` |
| top-level `switch` | Configuration / Auth | replaces `auth switch` (auth alias still works) |
| `quickstart` | Configuration / Quickstart | guided onboarding flow, supports `--non-interactive`, `--skip-login` |
| `history list` / `search` / `clear` | Configuration / History | reads from local rotating log |
| `context clear` | Configuration / Context | new sub-command |
| `milvus standalone install/start/stop/restart/delete/upgrade` | Cloud Management / Milvus Standalone | local Milvus deployment via Docker |
| `billing download-invoice` | Cloud Management / Billing | new in v1.x |
| `collection metrics` | Data Operations / Collection | per-collection metrics |
| `storage-integration list` | Cloud Management / StorageIntegration | list external storage integrations |
| `storage-integration create` | Cloud Management / StorageIntegration | create AWS/Azure/GCP external storage integration |
| `storage-integration describe` | Cloud Management / StorageIntegration | inspect one integration by ID |
| `storage-integration delete` | Cloud Management / StorageIntegration | delete one integration by ID |
| `storage-integration validate` | Cloud Management / StorageIntegration | validate integration configuration |
| `storage-integration generate-auth-materials` | Cloud Management / StorageIntegration | generate cloud-side authorization materials |

### Behavior changes since v0.1.x (existing docs need patching)

- **`login`** — adds `--cn` flag for China cloud login (API key only).
- **`logout`** — clears stored credentials in addition to ending the session.
- **`auth status` / `auth switch`** — DEPRECATED aliases; recommend `whoami` and top-level `switch`.
- **`cluster metrics` / `collection metrics`** — Braille chart became the default rendering in v1.3.1 (BREAKING).

### Scanner status

`src/sdk-doc-sync/scanners/zilliz-cli-scanner.js` supports both the legacy Python/Click layout and the current Rust `zilliz-tui` layout. Rust mode parses JSON model resources, clap-derived top-level commands, and the hand-written operation registry in `src/cli/help.rs`. Hand-written commands still use curated option metadata; update `RUST_HANDWRITTEN_OP_PARAMS` when Rust modules parse raw args or print help manually.

Release scout support for v1.4.x uses a cross-repo boundary:

```bash
node .claude/skills/sdk-doc-sync/bin/zilliz-cli-release-impact.js \
  --baseline-tag zilliz-v1.4.4 \
  --target-tag zilliz-v1.4.5 \
  --json \
  --output tmp/sdk-release-scout/zilliz-cli-v14-impact.json

node .claude/skills/sdk-doc-sync/bin/sdk-release-scout.js \
  --language zilliz-cli \
  --sdk-name zilliz-cli \
  --track v1.4.x \
  --release-impact tmp/sdk-release-scout/zilliz-cli-v14-impact.json \
  --json \
  --output tmp/sdk-release-scout/zilliz-cli-v14.json
```

- Public release discovery comes from `repos/zilliz-cli`.
- Implementation drift comes from `repos/zilliz-cloud/vdc/zilliz-tui`.
- Release-note command impacts come from `zilliz-cli-release-impact.js`; treat `SOURCE_VALIDATION_REQUIRED` as blocked until matching `zilliz-tui` source is validated.
- Run `zilliz-cli-handwritten-audit.js` when `src/cli/help.rs` or hand-written Rust modules change; `HANDWRITTEN_FLAG_MISSING` and `HANDWRITTEN_METADATA_MISSING` are scanner blockers.
- If the latest public release still equals `scan-state.json.lastScannedTag`, report `NO_RELEASE_CHANGES`; implementation-only changes are `UNRELEASED_IMPLEMENTATION_CHANGES` and are not approval-ready.
- For a new public release, pass `--implementation-baseline-ref` and `--implementation-target-ref` pinned to the matching `zilliz-tui` implementation commits. Do not use `origin/master` as an approval-grade release target.
- Only ask for sync approval after a public release exists and the release-scout artifact has no unmapped identity diagnostics.

### Cross-repo mapping workflow (zilliz-cli ↔ zilliz-cloud/vdc/zilliz-tui)

Use this when public release tags are in `zilliztech/zilliz-cli` but implementation/source history lives in `zilliz-cloud/vdc/zilliz-tui`.

1. Resolve release window from public repo:
   - `gh release view -R zilliztech/zilliz-cli --json tagName,publishedAt,targetCommitish,url`
   - `git -C repos/zilliz-cli tag --sort=-v:refname | head -20`
2. Diff public repo tags to detect packaging/docs-only churn:
   - `git -C repos/zilliz-cli diff --name-status <old-tag>..<new-tag>`
   - If changes are only `README.md`, `install.*`, `docs/*`, treat as **packaging/docs delta**.
3. Extract release-note command deltas:
   - Run `zilliz-cli-release-impact.js` and inspect `candidateDocImpacts`, `packagingChanges`, `nonPackagingChanges`, and diagnostics.
   - Use manual release-note reading only to explain low-confidence or ambiguous artifact entries.
4. Validate each release-note command in source repo:
   - `grep -R "<command-or-flag>" -n repos/zilliz-cloud/vdc/zilliz-tui/src`
   - `grep -R "<resource-or-path>" -n repos/zilliz-cloud/vdc/zilliz-tui/src/model/builtin_models/*.json`
   - For hand-written Rust commands, verify `RUST_HANDWRITTEN_OP_PARAMS` in `zilliz-cli-scanner.js` matches the module's raw arg parser and `--help` output.
5. Build a doc-impact matrix from the release-impact artifact and source validation with three outcomes:
   - **Docs Required (CREATE):** new command/resource/action appears.
   - **Docs Required (UPDATE):** existing command changed flags/constraints/examples/path/behavior.
   - **No SDK doc action:** installer UX/readme/roadmap/plugin-list-only changes.
6. Only after matrix approval, run sdk-doc-sync creation/patching for changed commands.

### Example matrix: `zilliz-v1.3.4` → `zilliz-v1.4.2` (2026-05-14 audit)

| Evidence source | Observed change | Doc impact |
|---|---|---|
| `git diff zilliz-v1.3.4..zilliz-v1.4.2` in `repos/zilliz-cli` | `README.md`, `install.sh`, `install.ps1`, `docs/roadmap.md`, `docs/best-practices*.md` | No SDK command doc action by itself |
| Release notes `zilliz-v1.4.0` | Added `external-collection refresh` actions; renamed `query-cluster` → `on-demand-cluster`; `--cu` → `--cu-size`; new constraints and path renames | UPDATE existing command docs + CREATE new command docs where missing |
| Release notes `zilliz-v1.4.1` | Added top-level `zilliz upgrade`/`update` and background update-check behavior | CREATE `upgrade` doc + UPDATE global behavior notes |
| Release notes `zilliz-v1.4.2` | Added top-level `zilliz uninstall` (`--purge`, `--yes`) | CREATE `uninstall` doc |
| Release notes / implementation trace through `zilliz-v1.4.4` and commit `14b5dc47a029a0c8908a47daa035b269e3247ce1` | Added `storage-integration` command family; removed manual `completion` command because shell completion is now automatic | CREATE storage-integration docs; DEPRECATE `completion`; UPDATE affected v1.4.x records |

Storage-integration docs are handled by `.claude/skills/sdk-doc-sync/scripts/zilliz-cli-v14x/update-v144-v145.js`. Run dry-run first; the script also updates related records' `Last Modified At` and deprecates removed `completion` behavior.

Important: the public `zilliz-cli` repo can be release-oriented and may not contain full Rust source at each tag. Do not infer “no command changes” from file diffs alone; always parse release notes and then validate against `zilliz-cloud/vdc/zilliz-tui` source/model files.

### Current unreleased candidates after `zilliz-v1.4.4`

Do not sync these until a public release after `zilliz-v1.4.4` exists:

- `cluster create`: dedicated clusters support `--replica`, `--autoscaling-cu-min`, and `--autoscaling-cu-max`. Dynamic CU min/max must be supplied together and cannot be combined with `--cu-size`.
- `stage`: resource is deprecated in favor of `volume`; hidden from grouped help, shell completion, and available-resource hints, but `stage list/create/delete/apply` remain executable for compatibility.

---

## zilliz-cli (legacy — Python/Click, v0.1.5)

## Overview

Zilliz CLI (`zilliz-cli`) is a Python/Click CLI tool for managing Zilliz Cloud clusters and Milvus operations. It uses a model-driven architecture — ~80 commands are auto-generated from JSON model files, with ~12 hand-written commands for interactive flows.

## Source Repository

- Repo: `repos/zilliz-cloud/vdc/zilliz-cli/`
- JSON models: `src/zilliz_cli/builtin_models/control-plane.json` (cloud management) and `data-plane.json` (Milvus data operations)
- Hand-written commands: `src/zilliz_cli/commands/*.py` (auth, configure, context, cluster create, billing, completion)
- Scanner: `src/sdk-doc-sync/scanners/zilliz-cli-scanner.js`

## Bitable & Drive Tokens

| Field | Token |
|-------|-------|
| Bitable | `OAK4bJaNuac501sX6Y1cS3OGnzf` |
| Table | `tblcjFhmGDgPkYmK` |
| Drive root | `EsDFfU9OQlcdBldL1jVcCwpfnPd` |
| v0.1.x folder | `PPuBfnEIWltim9dw8hxcC3EDnwb` |

## Category Structure

```
Cloud Management/
  Cluster/     — list, describe, modify, suspend, resume, delete, providers, regions, create
  Project/     — create, list, describe, upgrade
  Backup/      — create, list, describe, delete, export, restore-cluster, restore-collection, describe-policy, update-policy
  Import/      — start, list, status
  Volume/      — create, list, delete
  Job/         — describe
  Billing/     — bind-card, usage, invoices
Data Operations/
  Collection/  — create, list, describe, drop, rename, load, release, get-load-state, get-stats, has, flush, compact
  Vector/      — insert, upsert, search, hybrid-search, query, get, delete
  Database/    — create, list, describe, drop
  Index/       — create, list, describe, drop
  Partition/   — create, list, drop, has, get-stats, load, release
  User/        — create, list, describe, drop, update-password, grant-role, revoke-role
  Role/        — create, list, describe, drop, grant-privilege, revoke-privilege
  Alias/       — create, list, describe, alter, drop
Configuration/
  Alert/       — list, delete, enable, disable
  Auth/        — status, switch (+ login/logout as top-level)
  Configure/   — set, get, clear, list
  Context/     — set, current
  Completion/  — install, uninstall, status, show
```

## Control Plane vs Data Plane

- **Control plane** (`control-plane.json`): Cloud management APIs — clusters, projects, backups, billing. Uses global endpoint `api.cloud.zilliz.com`.
- **Data plane** (`data-plane.json`): Milvus operations — collections, vectors, indexes, partitions, users, roles, aliases, databases. Uses per-cluster endpoint from `zilliz context set`.

## Doc Format — CLI Commands

```markdown
This operation creates a new collection.

> 📖 **Notes**
>
> This command is available for Dedicated clusters only.

## Usage{#usage}

```bash
zilliz collection create [OPTIONS]
```

**OPTIONS:**

- **--name, -n** (*string*) -
  **[REQUIRED]**
  Specifies the collection name.
- **--dimension, -d** (*integer*) -
  Specifies the vector dimension. Required unless `--body` is provided.
- **--metric-type** (*string*) -
  Specifies the distance metric. Default: `COSINE`. Choices: `COSINE`, `L2`, `IP`.

## Example{#example}

```bash
# Quick create with defaults
zilliz collection create --name my_collection --dimension 768
```
```

Key differences from SDK docs:
- Description uses "This operation ..." form (imperative verb conjugated to 3rd person)
- Parameter descriptions use "Specifies the ..." form (not bare fragments)
- "Usage" section (not "Request Syntax") with `bash` code block
- "OPTIONS" (not "PARAMETERS") using CLI flag names (`--cluster-id`)
- No RETURNS/EXCEPTIONS sections
- No API endpoint blockquote (removed — renders as dark callout box in Feishu)
- Notes use `📖 **Notes**` format inside a quote block, with title and body on separate lines
- `dedicatedOnly` rendered as a note
- `requiredUnless`/`requiredWhen` rendered as prose in description

### Feishu API constraints for CLI docs

- `POST /open-apis/docx/v1/documents/{doc_id}/blocks/{parent_id}/children` accepts `block_type: 15` (Quote) but **rejects `block_type: 34`** (Quote Container) with error 1770001.
- `batch_update` does not support `update_block_type` (error 1770001). For format changes that require block type changes, use delete + insert.
- `patch_document()` with `strategy: 'replace'` fails when the markdown source would change block types (e.g., converting a Quote container to Text paragraphs). Use targeted block delete/insert instead.

## Scanner Details

### Three-Phase Scan

1. **Phase 1 — JSON models**: Parses `control-plane.json` + `data-plane.json` resources and operations
2. **Phase 2 — Hand-written commands**: Regex-parses Click decorators from `commands/*.py`
3. **Phase 3 — Merge**: Combines symbols; hand-written wins on slug collision

### Symbol Mapping

| CLI Concept | Symbol Field |
|---|---|
| Resource group (`cluster`) | `parentClass` = `Cluster` |
| Operation (`list`) | `name` = `list` |
| Slug | `Cluster-list` |
| CLI flags | `params[]` with `name`, `shorthand`, `type`, `required` |
| Kind | `command` (maps to bitable `Function`) |
| CLI usage line | `signature` = `zilliz cluster list [OPTIONS]` |

### CLI-specific metadata on symbols

- `httpMethod` / `httpPath` — API endpoint the command calls
- `plane` — `control` or `data`
- `pagination` — pagination config from JSON model
- `bodyParam` — the `--body` flag name if the command accepts a JSON body
- `examples[]` — example usage strings from JSON model
- `dedicatedOnly` — whether the command requires a Dedicated cluster
- `handwritten` — true for Phase 2 symbols

## Running (zilliz-cli legacy)

```bash
# Dry run — scan and show what would be created
node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js --language zilliz-cli --sdk-dir repos/zilliz-cloud/vdc/zilliz-cli --sdk-version v0.1.x --dry-run

# Scanner only — verify symbol extraction
node -e "
const S = require('./src/sdk-doc-sync/scanners/zilliz-cli-scanner');
const s = new S({ rootDir: 'repos/zilliz-cloud/vdc/zilliz-cli' });
s.scan().then(syms => {
  console.log('Total:', syms.length);
  const cats = {};
  for (const s of syms) { cats[s.category] = (cats[s.category]||0)+1; }
  console.log('By category:', cats);
  const parents = {};
  for (const s of syms) { parents[s.parentClass] = (parents[s.parentClass]||0)+1; }
  console.log('By resource:', parents);
});
"
```
