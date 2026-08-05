<!-- DOC_OPS_SYNTHETIC_FIXTURE_V1 -->

## 创建集合

使用固定维度和仅用于测试的名称创建集合。

```javascript
await client.createCollection({
  collection_name: "doc_ops_smoke",
  dimension: 8,
});
```

本地化过程中必须保留代码、标识符、链接目标和调用顺序。
