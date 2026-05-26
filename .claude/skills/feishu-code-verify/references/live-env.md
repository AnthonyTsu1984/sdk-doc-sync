# Live Env

Live runtime verification is opt-in. Use it only after a read-only report looks clean.

## Zilliz Profile

Default profile: `zilliz`.

Required env groups:

- one of `SERVING_CLUSTER_ENDPOINT`, `ZILLIZ_CLUSTER_ENDPOINT`, `DOC_VERIFY_SERVING_CLUSTER_ENDPOINT`
- one of `TOKEN`, `ZILLIZ_CLUSTER_CREDENTIAL`, `ZILLIZ_API_KEY`, `DOC_VERIFY_TOKEN`, `DOC_VERIFY_ZILLIZ_API_KEY`

Optional env groups:

- one of `CLOUD_PLATFORM_ENDPOINT`, `DOC_VERIFY_CLOUD_PLATFORM_ENDPOINT`

Python bulk-import scenario env:

- `AWS_ACCESS_KEY` or `DOC_VERIFY_AWS_ACCESS_KEY`
- `AWS_ACCESS_SECRET_KEY`, `AWS_SECRET_ACCESS_KEY`, or `DOC_VERIFY_AWS_SECRET_KEY`
- `AWS_S3_BUCKET` or `DOC_VERIFY_AWS_S3_BUCKET`
- optional `DOC_VERIFY_S3_OBJECT_KEY`, default `path/in/external/storage.json`
- optional `DOC_VERIFY_OBJECT_URLS`, comma-separated object URLs; overrides bucket/key URL generation
- optional `DOC_VERIFY_GENERATE_PARQUET`, default `1`; generates a schema-matching Parquet fixture in S3
- optional `DOC_VERIFY_GENERATED_PARQUET_KEY`, default `doc-verify/<collection>/products.parquet`
- optional `DOC_VERIFY_CLUSTER_ID`; otherwise derived from `ZILLIZ_CLUSTER_ENDPOINT`
- optional `DOC_VERIFY_CLOUD_API_KEY`; otherwise `ZILLIZ_API_KEY` or `TOKEN`
- optional `DOC_VERIFY_IMPORT_TIMEOUT`, default `600` seconds
- optional `DOC_VERIFY_IMPORT_POLL_SECONDS`, default `5` seconds

## Requesting Env Vars

Run:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --doc <doc> --request-live
```

The report includes a `liveVerification` object with:

- detected live/runtime candidate count;
- required env groups;
- which env var satisfied each group;
- missing env groups;
- rerun flags.

## Running Live Checks

Live checks still require block annotations:

```bash
# doc-verify: live
curl --request GET "${SERVING_CLUSTER_ENDPOINT}/v2/vectordb/collections/list"
```

Then run with:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --doc <doc> --live --allow-run
```

For generated scenario runtime, use:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --doc <doc> --run-scenarios --live --allow-run --languages python,go,java,node,bash
```

Scenario runtime does not require per-block annotations because `--run-scenarios` is an explicit whole-document runtime opt-in.

Runtime scenarios replace common `my_database` and `prod_collection` literals with generated isolated names. Set `DOC_VERIFY_RESOURCE_SUFFIX` or `--resource-suffix` to choose the suffix.

For Java scenario compile checks, runtime env vars are independent from dependency resolution. Use `DOC_VERIFY_JAVA_CLASSPATH` or `--java-classpath` to compile against the Java SDK, then add the live env vars before enabling runtime checks.
