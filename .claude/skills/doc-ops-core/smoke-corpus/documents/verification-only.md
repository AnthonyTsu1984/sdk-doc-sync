<!-- DOC_OPS_SYNTHETIC_FIXTURE_V1 -->

## Raw block

```cpp
#include <vector>

int size() {
    std::vector<int> values{1, 2, 3};
    return static_cast<int>(values.size());
}
```

Expected check: compiler `-fsyntax-only`; no network and no write-back.

## Scenario

The scenario wrapper supplies a `main()` function separately and reports raw-block evidence independently from scenario evidence.
