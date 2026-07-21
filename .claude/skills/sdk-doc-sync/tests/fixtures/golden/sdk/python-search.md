Searches vectors in a collection and returns the nearest matches.

<include target="milvus">
Available to Milvus users.
</include>

## Request Syntax{#request-syntax}

```python
def search(self, collection_name: str, data: list[list[float]], *, limit: int = 10, **kwargs: Any) -> list[SearchResult]:
```

**PARAMETERS:**

- **collection\_name** ([str](/reference/python/str)) - **\[REQUIRED\]**
  The name of the target collection.
- **data** (*list\[list\[float\]\]*) - **\[REQUIRED\]**
  The query vectors.
- **limit** (*int*) - Default: `10`
  The maximum number of matches to return.
  Constraints: Must be positive; choices: 10, 20.
- **kwargs** (*Any*) -
  Additional search options.

**RETURN TYPE:**

[list\[SearchResult\]](/reference/python/search-result)

**RETURNS:**

Returns the matching entities ordered by similarity.

- **items** ([SearchResult\[\]](/reference/python/search-result)) - **\[REQUIRED\]**
  The matching entities.
  - **score** (*float*) - **\[REQUIRED\]**
    The similarity score.

**EXCEPTIONS:**

- **MilvusException**
  The server rejects the search request. Reports the server error code and message.

## Examples

Runs a vector search.

```python
results = client.search(collection_name="docs", data=[[0.1, 0.2]], limit=10)
print(results)
```

## Notes

- Use a client connected to the target Milvus deployment.

## Related

- [Collection guide](/docs/collections)
