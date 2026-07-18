# Manta Runtime Verification

Use Manta when the requested Milvus endpoint is reachable only inside a Manta workspace or Kubernetes namespace. Keep local static evidence and Manta runtime evidence separate.

## Safety Gate

- Run a local static/scenario baseline first.
- Do not create or delete a Milvus instance unless the user explicitly requests lifecycle work or requests version-specific verification without providing a ready resource.
- Require `--run-scenarios --live --allow-run` before starting an integrated runtime job.
- Prefer `manta-client resource` and `manta-client job` over direct `kubectl` operations.
- Use isolated database and collection names and report cleanup status.

## Reuse A Ready Resource

Inspect readiness and endpoint metadata:

```bash
manta-client resource list --json
manta-client resource info <resource-id> --json
```

Run the verifier with the selected resource:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js \
  --doc <doc-url-or-token> \
  --scenario \
  --run-scenarios \
  --live \
  --allow-run \
  --manta \
  --manta-workspace <workspace> \
  --manta-resource <resource-id-or-name> \
  --report /tmp/feishu-code-verify-manta.json
```

Use `--manta-endpoint` when the internal endpoint is already known.

## Create A Requested Temporary Instance

Only when explicitly requested and no ready resource exists:

```bash
manta-client job create \
  -w <workspace> \
  -s milvus-deploy \
  -p "Create a temporary Milvus <version-or-build> instance for documentation verification. Return the resource, namespace, endpoint, image, and readiness evidence." \
  -f -T 1800 -j
```

After completion, confirm `ready: true` with `manta-client resource info` before executing documentation scenarios.

## Execute Inside The Namespace

If the endpoint remains internal-only, run a test job in the same workspace:

```bash
manta-client job create \
  -w <workspace> \
  -s milvus-test \
  -p "Run the generated documentation scenario against <endpoint>. Use isolated resources, print server and SDK versions, record pass/fail per documented step, clean up fixtures, and return artifacts." \
  -f -T 1800 -j
```

Collect evidence with:

```bash
manta-client job info <job-id> --json
manta-client job logs <job-id> -f -T 300
manta-client job artifacts <job-id>
manta-client job download <job-id> output.json -o /tmp/feishu-code-verify-manta-output.json
```

## Reporting

Include:

- job ID, resource ID/name, workspace, namespace, and endpoint;
- Milvus server version or image;
- SDK and runtime versions;
- exact isolated resource names and cleanup result;
- per-step pass/fail;
- compatibility differences between server and SDK support;
- `mantaRuntimePassed`, `mantaRuntimeFailed`, or `mantaRuntimeManual` separately from local results.
