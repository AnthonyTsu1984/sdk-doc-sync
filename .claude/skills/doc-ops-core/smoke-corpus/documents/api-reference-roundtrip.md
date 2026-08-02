<!-- DOC_OPS_SYNTHETIC_FIXTURE_V1 -->

## createCollection()

Creates a synthetic collection used only by the isolated documentation smoke tenant.

```cpp
#include <vector>
#include "milvus/MilvusClient.h"

int main() {
    std::vector<int> ids{1, 2, 3};
    return static_cast<int>(ids.size());
}
```

- parent item
  - child item
    1. grandchild item

<include target="milvus">
The Milvus server endpoint is `http://localhost:19530`.
</include>

<include target="zilliz">
The Zilliz Cloud endpoint is `https://api.cloud.zilliz.com`.
</include>

See [Milvus API reference](https://milvus.io/docs) for the published reference surface.
