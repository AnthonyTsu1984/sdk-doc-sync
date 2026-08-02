# Isolated Feishu Tenant Smoke Environment

Use this procedure to establish the persistent test substrate for the shared documentation skills. The persistent substrate contains only a root folder and an index Base. Individual smoke runs create disposable child folders, documents, and records beneath those approved roots.

## Safety boundary

- Prefer a separate Feishu tenant. A separate test workspace inside the production tenant is a weaker fallback and must use a dedicated app plus explicit folder/Base allowlists.
- Use a named CLI profile such as `doc-ops-smoke`; never use the active default profile implicitly.
- Use the `__DOC_OPS_SMOKE__` canary prefix for every disposable resource.
- Do not copy production documents into the test tenant. Use the synthetic corpus under `smoke-corpus/`.
- Never paste an app secret, access token, refresh token, folder token, Base token, or table ID into chat.
- Creation, patch, and cleanup are three independent approval gates. Cleanup is never automatic.
- Smoke artifacts and state belong under `tmp/doc-ops-smoke/<run-id>/`; never update a production `scan-state.json`.
- All test-tenant login and profile operations run inside the Docker sandbox under `../sandbox/`. Never initialize or authorize the test app with the host `lark-cli`.

## 1. Create or select a test tenant

In Feishu, switch the browser and desktop client to the tenant that will be used only for testing. Confirm its tenant name is visibly different from production. Record a non-secret marker such as `DOC_OPS_TEST` for `SMOKE_TENANT_MARKER`.

If no test tenant exists, create a separate Feishu organization with a dedicated administrator account, invite only the smoke operators, and disable external sharing unless a specific smoke case needs it. Tenant creation and administrator UI labels can differ by Feishu edition; stop if the browser is still showing the production tenant.

## 2. Create a dedicated custom app

Create the app in the browser, then build the isolated CLI image:

```bash
npm run smoke:sandbox:build
```

Configure the app only inside the container volume:

```bash
npm run smoke:sandbox:init
```

The interactive prompt accepts the App ID and hides the App Secret. The secret is passed to container-local `lark-cli` through stdin. Profile metadata is stored in `doc-ops-smoke-lark-config`; the encrypted credential and its container-local master key are stored in `doc-ops-smoke-lark-keychain`. The host `~/.lark-cli` and Keychain are never mounted.

Enable only the app permissions needed for the smoke lifecycle:

- Docx: create, read content/blocks, and update content/blocks.
- Drive: read metadata, create folders, copy/move files, and delete disposable files.
- Base: create/read app, table, field, and record resources; create/update/delete disposable records.

Publish and install the app in the test tenant. Add missing scopes incrementally from structured permission errors; do not grant unrelated messaging, calendar, contact, or production-data scopes.

## 3. Authorize a test user

Use a test-tenant user who can create Drive folders, documents, and Bases:

```bash
npm run smoke:sandbox:auth-login
```

Generate a QR code from the returned verification URL:

```bash
npm run smoke:sandbox:qrcode -- "<verification-url>"
```

Complete authorization in a later turn with the returned device code. Do not poll in the same turn that presents the URL:

```bash
npm run smoke:sandbox:auth-complete -- "<device-code>"
```

Verify the profile before any write:

```bash
npm run smoke:sandbox:status
```

The verified user name and bot app name must both belong to the test tenant.

The live harness binds every approved action to a SHA-256 identity fingerprint derived from the sandbox profile, app, active identity type, and verified user. Generate it without exposing the source identifiers:

```bash
npm run smoke:identity
```

Store only the returned `sha256:...` value as `SMOKE_IDENTITY_FINGERPRINT`; never store or paste the source identifiers in logs, plans, or chat. Recompute the fingerprint after reinitializing the profile, changing the app, or authorizing a different user. A mismatch stops the run before mutation.

## 4. Bootstrap the persistent smoke roots

After explicit creation approval, create one root folder as the test user:

```bash
npm run smoke:sandbox:lark -- drive +create-folder \
  --name "__DOC_OPS_SMOKE_ROOT_V1__" \
  --as user
```

Create one Base inside that folder. The schema deliberately resembles the fields exercised by API-reference and localization workflows while remaining synthetic:

```bash
npm run smoke:sandbox:lark -- base +base-create \
  --name "__DOC_OPS_SMOKE_INDEX_V1__" \
  --table-name "Cases" \
  --folder-token "<smoke-root-folder-token>" \
  --time-zone "Asia/Shanghai" \
  --fields '[{"type":"text","name":"Docs","style":{"type":"url"}},{"type":"text","name":"Case ID"},{"type":"text","name":"Run ID"},{"type":"select","name":"Progress","multiple":false,"options":[{"name":"WIP"},{"name":"Draft"}]},{"type":"select","name":"Type","multiple":false,"options":[{"name":"Smoke"}]},{"type":"select","name":"Skill","multiple":true,"options":[{"name":"procedure-code-sync"},{"name":"doc-code-verify"},{"name":"verified-doc-authoring"},{"name":"localized-doc-sync"},{"name":"api-reference-sync"}]},{"type":"text","name":"Corpus Version"},{"type":"text","name":"Expected Digest"},{"type":"checkbox","name":"Disposable"},{"type":"datetime","name":"Last Modified At","style":{"format":"yyyy-MM-dd HH:mm"}}]' \
  --as user
```

Capture the returned root folder token, Base token, and table ID locally. Do not send them through chat. Grant the test app access only to this folder and Base if bot-based adapters will perform the smoke writes.

## 5. Configure the local harness

Copy `.env.smoke.example` to `.env.smoke.local` and fill only non-secret identifiers. Load them into the current shell:

```bash
set -a
source .env.smoke.local
set +a
```

When bot credentials are required by the internal Feishu adapter, enter the app secret with hidden input for the current shell only:

```bash
read -s "SMOKE_APP_SECRET?Test app secret: "
export SMOKE_APP_SECRET
```

Remove it after the run:

```bash
unset SMOKE_APP_SECRET
```

Run the non-mutating gates:

```bash
npm run smoke:corpus
npm run smoke:doctor
npm run smoke:plan -- --run-id 20260802T120000Z-a1b2c3d4
npm run smoke:simulate -- --run-id 20260802T120000Z-a1b2c3d4
```

`smoke:doctor` fails if required `SMOKE_*` values are missing, if the identity fingerprint is malformed, if a smoke identifier equals the corresponding production environment variable, if the host is unsafe, or if the corpus is invalid. It redacts credentials and resource identifiers in its output.

## 6. Live execution gates

The generated plan contains independent creation and patch digests. The executable cleanup batch does not exist before creation:

1. `creationBatch.batchDigest` authorizes only the disposable child folder, documents, and Base records.
2. `patchBatch.batchDigest` authorizes only the reviewed smoke patches.
3. After successful creation, `smoke:cleanup:plan` materializes a cleanup batch from the exact folder, document, and record identifiers persisted in that run's state. Its digest authorizes only those recorded resources.

Before each phase, report only sanitized target labels, action counts, and the exact digest. Do not report folder, document, Base, table, app, or user identifiers. Creation, patch, and cleanup require separate explicit approvals. Refetch and verify every mutation. Cleanup remains optional and requires a final parent-folder/Base refetch.

Run an approved creation batch:

```bash
npm run smoke:live:create -- \
  --run-id 20260802T120000Z-a1b2c3d4 \
  --approve-batch-digest sha256:<approved-creation-digest>
```

Run the separately approved patch batch:

```bash
npm run smoke:live:patch -- \
  --run-id 20260802T120000Z-a1b2c3d4 \
  --approve-batch-digest sha256:<approved-patch-digest>
```

Run the post-patch acceptance gate before cleanup:

```bash
npm run smoke:acceptance -- --run-id 20260802T120000Z-a1b2c3d4
```

`smoke:acceptance` is read-only and requires no write approval. It refetches only the synthetic canary resources through the sandbox, verifies journal lineage, current document digests, parent placement, exact Base links, skill-specific invariants, and the verifier report, then writes one shared result-contract artifact for each of the five canonical skills under `tmp/doc-ops-smoke/runs/<run-id>/artifacts/skill-acceptance/`. Repeating it against unchanged tenant state must produce the same five semantic digests.

Materialize the creation-bound cleanup batch without deleting anything:

```bash
npm run smoke:cleanup:plan -- --run-id 20260802T120000Z-a1b2c3d4
```

Only after separately reviewing and approving that newly materialized digest, run cleanup:

```bash
npm run smoke:live:cleanup -- \
  --run-id 20260802T120000Z-a1b2c3d4 \
  --approve-batch-digest sha256:<approved-cleanup-digest>
```

If a journal already exists for a phase, do not blindly rerun it. Reconcile the recorded receipts and current tenant state first; the live runner intentionally returns `EXECUTION_RECONCILIATION_REQUIRED`.

If creation stops after one or more resources were observed but before the completion sentinel, generate a recovery-only cleanup batch from the exact partial state and journal:

```bash
npm run smoke:recovery:plan -- --run-id 20260802T120000Z-a1b2c3d4
```

This plan includes only creation-bound resources with both persisted state and prepared/observed journal evidence. It cannot reuse the symbolic cleanup digest. After separately approving its exact digest, execute it with:

```bash
npm run smoke:live:recovery-cleanup -- \
  --run-id 20260802T120000Z-a1b2c3d4 \
  --approve-batch-digest sha256:<approved-recovery-cleanup-digest>
```
