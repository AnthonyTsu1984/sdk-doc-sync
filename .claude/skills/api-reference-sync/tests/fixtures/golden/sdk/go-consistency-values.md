A ConsistencyLevel instance specifies the consistency guarantee level for read operations on a collection.

<include target="milvus">
Available to Milvus users.
</include>

```go
type ConsistencyLevel commonpb
```

**VALUES:**

- **ClStrong** = ConsistencyLevel(commonpb.ConsistencyLevel\_Strong)
  Strong consistency. All operations are immediately visible.
- **ClBounded** = ConsistencyLevel(commonpb.ConsistencyLevel\_Bounded)
  Bounded staleness with a default 5-second tolerance window.
- **ClSession** = ConsistencyLevel(commonpb.ConsistencyLevel\_Session)
  Session consistency. Reads see writes from the same session.

## Example{#example}

Passes a consistency level to a search request.

```go
results, err := cli.Search(ctx, milvusclient.NewSearchOption("my_collection", 10, []entity.Vector{entity.FloatVector(queryVector)}).WithConsistencyLevel(entity.ClStrong))
```

## Notes

- Use a client connected to the target Milvus deployment.

## Related

- [Collection guide](/docs/collections)
