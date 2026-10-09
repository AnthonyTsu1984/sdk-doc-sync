A Reranker instance combines and ranks the results of multiple ANN sub-requests for `HybridSearch()`. Use `NewRRFReranker()` or `NewWeightedReranker()` to create instances.

<include target="milvus">
Available to Milvus users.
</include>

```go
type Reranker interface {
    GetParams() []*commonpb.KeyValuePair
}
```

**BUILDER METHODS:**

- `NewRRFReranker()`
  Creates a Reciprocal Rank Fusion (RRF) reranker. The default `k` is 60.
- `NewWeightedReranker(weights []float64)`
  Creates a weighted reranker with one weight per ANN sub-request.

**METHODS:**

- `GetParams() []*commonpb.KeyValuePair`
  Returns the rerank strategy and parameters as key-value pairs.
- `WithK(k float64)`
  Sets the RRF `k` smoothing factor.
- `WithWeights(weights []float64)`
  Sets optional reciprocal-rank coefficients in ANN request order. The server requires a non-empty slice, one value in \[0, 1\] per ANN request; nil and empty slices are serialized so the server can reject them.

## Example{#example}

Merges two ANN requests with RRF.

```go
resultSets, err := cli.HybridSearch(ctx, milvusclient.NewHybridSearchOption(
	"quick_setup", 10, denseReq, sparseReq,
).WithReranker(milvusclient.NewRRFReranker()))
```

## Notes

- Use a client connected to the target Milvus deployment.

## Related

- [Collection guide](/docs/collections)
