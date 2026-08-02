<!-- DOC_OPS_SYNTHETIC_FIXTURE_V1 -->

## Procedure

The Python example defines the workflow. Other languages must preserve the same call order and meaning.

### Python

```python
# include-start milvus
client = MilvusClient(uri="http://localhost:19530")
client.create_collection(collection_name="doc_ops_smoke", dimension=8)
# include-end
```

### Java

```java
MilvusClientV2 client = new MilvusClientV2(ConnectConfig.builder()
    .uri("http://localhost:19530")
    .build());
client.createCollection(CreateCollectionReq.builder()
    .collectionName("doc_ops_smoke")
    .dimension(8)
    .build());
```

- parent item
  - child item
    1. grandchild item

Unrelated prose must remain byte-for-byte equivalent after a scoped language patch.
