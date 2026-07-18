# CreateCollection()

Creates a collection through the Go client.

<include target="milvus">
Available to Milvus users.
</include>

```go
func (c *Client) CreateCollection(ctx context.Context, option CreateCollectionOption) error
```

## Request Syntax{#request-syntax}

```go
option := milvusclient.SimpleCreateCollectionOptions("docs", 128)
```

**PARAMETERS:**

- **collectionName** (*string*) - **\[REQUIRED\]**
  The name of the collection to create.
  Constraints: kind: required.
- **dimension** (*int64*) - **\[REQUIRED\]**
  The vector field dimension.
  Constraints: kind: required.

**OPTION METHODS:**

- `WithMetricType(metricType entity.MetricType)`
  This sets the metric type.
- `WithConsistencyLevel(level entity.ConsistencyLevel)`
  This sets the consistency level.

**RETURN TYPE:**

*error*

**RETURNS:**

Returns nil on success or an error on failure.

**EXCEPTIONS:**

- **error**
  The operation fails. Check the returned error for failure details.

## Example{#example}

Creates a collection and checks the returned error.

```go
option := milvusclient.SimpleCreateCollectionOptions("docs", 128)
err := client.CreateCollection(ctx, option)
if err != nil {
    log.Fatal(err)
}
```

## Notes

- Use a client connected to the target Milvus deployment.

## Related

- [Collection guide](/docs/collections)
