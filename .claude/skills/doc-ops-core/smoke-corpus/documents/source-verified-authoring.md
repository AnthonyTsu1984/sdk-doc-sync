<!-- DOC_OPS_SYNTHETIC_FIXTURE_V1 -->

## Claim inventory

| Claim | Evidence | Status |
|---|---|---|
| The request accepts `dimension` | [Synthetic source](https://example.invalid/source) | Verified |
| The default metric is stable | No canonical evidence in this fixture | Unresolved |

## Draft

The verified request shape includes a `dimension` field. The default metric remains explicitly unresolved.

```python
client.create_collection(collection_name="doc_ops_smoke", dimension=8)
```
