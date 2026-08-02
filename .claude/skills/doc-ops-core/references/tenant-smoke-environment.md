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

## 1. Create or select a test tenant

In Feishu, switch the browser and desktop client to the tenant that will be used only for testing. Confirm its tenant name is visibly different from production. Record a non-secret marker such as `DOC_OPS_TEST` for `SMOKE_TENANT_MARKER`.

If no test tenant exists, create a separate Feishu organization with a dedicated administrator account, invite only the smoke operators, and disable external sharing unless a specific smoke case needs it. Tenant creation and administrator UI labels can differ by Feishu edition; stop if the browser is still showing the production tenant.

## 2. Create a dedicated custom app

Preferred agent-assisted flow, after explicit approval:

```bash
lark-cli config init --new --name doc-ops-smoke
```

The operator must complete the browser flow while signed into the test tenant. The agent must relay the exact verification URL and a QR code, then stop until the operator confirms completion.

If the app already exists, configure it locally without putting the secret in shell history:

```bash
read -s "SMOKE_APP_SECRET?Test app secret: "
printf %s "$SMOKE_APP_SECRET" | lark-cli config init \
  --app-id "<test-app-id>" \
  --app-secret-stdin \
  --brand feishu \
  --name doc-ops-smoke
unset SMOKE_APP_SECRET
```

Enable only the app permissions needed for the smoke lifecycle:

- Docx: create, read content/blocks, and update content/blocks.
- Drive: read metadata, create folders, copy/move files, and delete disposable files.
- Base: create/read app, table, field, and record resources; create/update/delete disposable records.

Publish and install the app in the test tenant. Add missing scopes incrementally from structured permission errors; do not grant unrelated messaging, calendar, contact, or production-data scopes.

## 3. Authorize a test user

Use a test-tenant user who can create Drive folders, documents, and Bases:

```bash
lark-cli auth login \
  --domain docs \
  --domain drive \
  --domain base \
  --no-wait \
  --json \
  --profile doc-ops-smoke
```

Generate a QR code from the returned verification URL and complete authorization in a later turn with `lark-cli auth login --device-code ...`. Do not poll in the same turn that presents the URL.

Verify the profile before any write:

```bash
LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1 \
LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1 \
lark-cli auth status --json --verify --profile doc-ops-smoke
```

The verified user name and bot app name must both belong to the test tenant.

## 4. Bootstrap the persistent smoke roots

After explicit creation approval, create one root folder as the test user:

```bash
lark-cli drive +create-folder \
  --name "__DOC_OPS_SMOKE_ROOT_V1__" \
  --as user \
  --profile doc-ops-smoke
```

Create one Base inside that folder. The schema deliberately resembles the fields exercised by API-reference and localization workflows while remaining synthetic:

```bash
lark-cli base +base-create \
  --name "__DOC_OPS_SMOKE_INDEX_V1__" \
  --table-name "Cases" \
  --folder-token "<smoke-root-folder-token>" \
  --time-zone "Asia/Shanghai" \
  --fields '[{"type":"text","name":"Docs","style":{"type":"url"}},{"type":"text","name":"Case ID"},{"type":"text","name":"Run ID"},{"type":"select","name":"Progress","multiple":false,"options":[{"name":"WIP"},{"name":"Draft"}]},{"type":"select","name":"Type","multiple":false,"options":[{"name":"Smoke"}]},{"type":"select","name":"Skill","multiple":true,"options":[{"name":"procedure-code-sync"},{"name":"doc-code-verify"},{"name":"verified-doc-authoring"},{"name":"localized-doc-sync"},{"name":"api-reference-sync"}]},{"type":"text","name":"Corpus Version"},{"type":"text","name":"Expected Digest"},{"type":"checkbox","name":"Disposable"},{"type":"datetime","name":"Last Modified At","style":{"format":"yyyy-MM-dd HH:mm"}}]' \
  --as user \
  --profile doc-ops-smoke
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

`smoke:doctor` fails if required `SMOKE_*` values are missing, if a smoke identifier equals the corresponding production environment variable, if the host is unsafe, or if the corpus is invalid. It redacts credentials in its output.

## 6. Live execution gates

The generated plan contains three independent digests:

1. `creationBatch.batchDigest` authorizes only the disposable child folder, documents, and Base records.
2. `patchBatch.batchDigest` authorizes only the reviewed smoke patches.
3. `cleanupBatch.batchDigest` authorizes only deletion of the resources recorded by that run.

Before each phase, report the target tenant marker, named profile, approved root/Base/table, action list, and exact digest. Refetch after create and patch. Cleanup requires a separate explicit approval and a final parent-folder/Base refetch.
