A Collection instance represents collection metadata in Milvus, including the collection schema and consistency settings. Returned by `DescribeCollection()`.

<include target="milvus">
Available to Milvus users.
</include>

```go
type Collection struct {
    ID               int64
    Name             string
    Schema           *entity.Schema
    ConsistencyLevel ConsistencyLevel
}
```

**FIELDS:**

- **ID** (*int64*) -
  The unique identifier of the collection.
- **Name** (*string*) -
  The name of the collection.
- **Schema** (*\*entity.Schema*) -
  The collection schema, with field definitions and the primary key.
- **ConsistencyLevel** ([ConsistencyLevel](/reference/go/consistency-level)) -
  The consistency level of the collection.

## Example{#example}

Reads collection metadata after a describe call.

```go
collection, err := cli.DescribeCollection(ctx, milvusclient.NewDescribeCollectionOption("books"))
if err != nil {
    // handle error
}
fmt.Println(collection.Name, collection.ConsistencyLevel)
```

## Notes

- Use a client connected to the target Milvus deployment.

## Related

- [Collection guide](/docs/collections)
