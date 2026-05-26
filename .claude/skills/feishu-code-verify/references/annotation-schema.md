# Annotation Schema

Place annotations in the first five non-empty lines of a code block. The parser accepts `doc-verify:` and `verify:` prefixes in `#`, `//`, `/* */`, or shell comment form.

## Modes

- `doc-verify: parse` validates structured data only.
- `doc-verify: compile` runs syntax or compile checks without executing business logic.
- `doc-verify: run` permits runtime execution only when the verifier is called with `--allow-run`.
- `doc-verify: live` marks a service-backed example. It is not executed unless `--live`, `--allow-run`, and the required live profile env vars are present.
- `doc-verify: manual` records the snippet as manually verifiable.
- `doc-verify: skip reason="..."` skips the snippet and records the reason.

## Optional Fields

- `doc-verify-timeout: 10000` sets timeout in milliseconds for that block.
- `doc-verify-name: human readable name` overrides the report display name.
- `doc-verify-expected: text` records a simple expected-output hint. The current script reports this value but does not enforce it unless `--allow-run` is used.

## Examples

```python
# doc-verify: compile
from pymilvus import MilvusClient

client = MilvusClient(uri="http://localhost:19530")
```

```bash
# doc-verify: skip reason="creates a cloud cluster"
zilliz cluster create --cluster-name docs-test
```

```bash
# doc-verify: live
curl --request POST \
  --url "${SERVING_CLUSTER_ENDPOINT}/v2/vectordb/collections/load" \
  --header "Authorization: Bearer ${TOKEN}"
```
