# createCollection()

Creates a collection through the Java v2 client.

<include target="milvus">
Available to Milvus users.
</include>

```java
public void createCollection(CreateCollectionReq request)
```

## Request Syntax{#request-syntax}

```java
CreateCollectionReq.builder()
    .collectionName(collectionName)
    .dimension(dimension)
    .metricType(metricType)
    .build();
```

**BUILDER METHODS:**

- `collectionName(String collectionName)`
  The name of the collection to create.
- `dimension(Integer dimension)`
  The vector field dimension.
- `metricType(MetricType metricType)`
  The metric used to compare vectors.

**RETURNS:**

*void*

Completes after the collection is created.

**EXCEPTIONS:**

- **MilvusClientException**
  The request cannot be completed. Reports client or server failures.

## Example{#example}

### Create a collection

Builds and submits a collection request.

```java
client.createCollection(CreateCollectionReq.builder()
    .collectionName("docs")
    .dimension(128)
    .build());
```

## Notes

- Use a client connected to the target Milvus deployment.

## Related

- [Collection guide](/docs/collections)
