# Harnesses

Harnesses validate intentionally partial snippets without forcing Feishu docs to include noisy boilerplate.

## Go

When a Go snippet has no `package` declaration, the verifier:

1. extracts leading `import` declarations;
2. wraps the remaining body in:

```go
package main

func main() {
    // snippet body
}
```

3. runs `gofmt`.

This is a syntax check only. It does not type-check SDK symbols or setup variables such as `ctx` or `cli`.

## Python Scenario Mode

Use scenario mode when Python snippets form a workflow and later snippets depend on earlier setup:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --doc <doc> --scenario --languages python
```

The verifier generates:

```text
/tmp/feishu-code-scenarios/python/<source-id>/docs_scenario.py
```

It combines snippets in document order, injects common Zilliz/Milvus env variables, converts simple doctest prompts (`>>>` and `...`) to Python statements, preserves injected env vars when snippets assign endpoint/token placeholders, and runs `python3 -m py_compile`. This is compile-only unless `--run-scenarios --live --allow-run` is set. In runtime mode it executes `python3 docs_scenario.py`.

Use `DOC_VERIFY_PYTHONPATH` or `--python-path` when runtime needs a local SDK checkout:

```bash
export DOC_VERIFY_PYTHONPATH=repos/pymilvus
```

Use `DOC_VERIFY_PYTHON` or `--python-command` when dependencies are installed in a venv:

```bash
export DOC_VERIFY_PYTHON=repos/pymilvus/.venv/bin/python
```

For Python bulk-import docs, scenario runtime replaces placeholder API key, cluster id, object URL, and object storage credentials with live env values. See [live-env.md](live-env.md) for the supported AWS and object URL aliases.

## Node/JavaScript Scenario Mode

Use scenario mode when JavaScript snippets form a workflow and later snippets depend on earlier setup:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --doc <doc> --scenario --languages node
```

The verifier generates:

```text
/tmp/feishu-code-scenarios/javascript/<source-id>/docs_scenario.js
```

If snippets use ESM import/export syntax or top-level `await`, it generates `docs_scenario.mjs` instead. It combines snippets in document order, strips snippet shebangs, exposes common Zilliz/Milvus env variables on `globalThis`, rewrites common `my_database` and `prod_collection` literals to isolated runtime names, and runs `node --check`.

Runtime mode requires `--run-scenarios --live --allow-run`. The verifier executes `node docs_scenario.js` or `node docs_scenario.mjs`.

## Bash Scenario Mode

Use scenario mode when shell snippets form a workflow and later snippets depend on earlier setup:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --doc <doc> --scenario --languages bash
```

The verifier generates:

```text
/tmp/feishu-code-scenarios/bash/<source-id>/docs_scenario.sh
```

It combines snippets in document order, strips snippet shebangs, exports common Zilliz/Milvus env variables, rewrites common `my_database` and `prod_collection` literals to isolated runtime names, and runs `bash -n`.

Runtime mode requires `--run-scenarios --live --allow-run`. The verifier executes `bash docs_scenario.sh`.

## Go Scenario Mode

Use scenario mode when Go snippets form a workflow and later snippets depend on earlier setup:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --doc <doc> --scenario --languages go
```

The verifier generates:

```text
/tmp/feishu-code-scenarios/go/<source-id>/DocsScenario.go
```

It merges snippet imports, injects common Zilliz/Milvus env variables as package-level vars, wraps ordered snippet bodies in `func main()`, and runs `gofmt`. Without a module directory, this is syntax-only.

For module-aware checks, point to a local Go SDK/module checkout:

```bash
export DOC_VERIFY_GO_MODULE_DIR=repos/milvus-sdk-go
```

or pass `--go-module-dir`. The verifier writes a generated `go.mod` in the scenario directory with `require <module> v0.0.0` and `replace <module> => <local checkout>`, then runs `go test .`. Missing modules or shared setup symbols are reported as `manual`, not `failed`.

If the local SDK requires a newer Go toolchain than the current environment can use, the module-aware scenario is also `manual`. The syntax-only `gofmt` scenario can still pass and cover document ordering.

Runtime mode requires `--run-scenarios --live --allow-run` and a module-aware scenario. The verifier runs `go mod tidy`, then `go test .`, then `go run .`. It injects a small three-row fixture with `product_id`, `product_name`, and 768-d `embedding` values before the search step.

## Java

When a Java snippet has no class declaration, the verifier:

1. extracts `import ...;` lines;
2. adds common `java.util.*` imports for collection-heavy docs;
3. wraps the remaining body in:

```java
public class DocsSnippet {
    public static void example() throws Exception {
        // snippet body
    }
}
```

4. runs `javac`.

If `javac` only reports missing packages, classes, variables, or methods, the result is `manual` instead of `failed`, because the fragment can be syntactically plausible while requiring SDK dependencies or setup from another section.

Use `DOC_VERIFY_JAVA_CLASSPATH` or `--java-classpath` for dependency-aware checks.

If the Milvus Java SDK repo is checked out locally, the verifier can derive the classpath:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js \
  --doc <doc> \
  --scenario \
  --languages java \
  --java-sdk-repo repos/milvus-sdk-java
```

Equivalent env vars:

```bash
export DOC_VERIFY_JAVA_SDK_REPO=repos/milvus-sdk-java
export DOC_VERIFY_MAVEN_REPO=/tmp/feishu-code-verify-m2
```

Explicit `DOC_VERIFY_JAVA_CLASSPATH` or `--java-classpath` takes precedence.

When `--java-sdk-repo` or `DOC_VERIFY_JAVA_SDK_REPO` is set, Java harnesses also scan `sdk-core/src/main/java` and infer missing imports for referenced Milvus SDK classes. This covers docs that import request classes but omit response classes such as `SearchResp`.

The local SDK checkout must include its proto sources under `sdk-core/src/main/milvus-proto/proto`. If that directory is missing, initialize SDK submodules before deriving a classpath:

```bash
git -C repos/milvus-sdk-java submodule update --init --recursive
```

## Java Scenario Mode

Use scenario mode when snippets form a workflow and later snippets depend on earlier setup:

```bash
node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --doc <doc> --scenario --languages java
```

The verifier generates:

```text
/tmp/feishu-code-scenarios/java/<source-id>/DocsScenario.java
```

It combines Java snippets in document order into:

```java
import java.util.*;

public class DocsScenario {
    public static void main(String[] args) throws Exception {
        String SERVING_CLUSTER_ENDPOINT = System.getenv().getOrDefault("SERVING_CLUSTER_ENDPOINT", System.getenv().getOrDefault("ZILLIZ_CLUSTER_ENDPOINT", System.getenv("DOC_VERIFY_SERVING_CLUSTER_ENDPOINT")));
        String TOKEN = System.getenv().getOrDefault("TOKEN", System.getenv().getOrDefault("ZILLIZ_CLUSTER_CREDENTIAL", System.getenv().getOrDefault("ZILLIZ_API_KEY", System.getenv().getOrDefault("DOC_VERIFY_TOKEN", System.getenv("DOC_VERIFY_ZILLIZ_API_KEY")))));
        String CLOUD_PLATFORM_ENDPOINT = System.getenv().getOrDefault("CLOUD_PLATFORM_ENDPOINT", System.getenv("DOC_VERIFY_CLOUD_PLATFORM_ENDPOINT"));
        // ordered snippet bodies
    }
}
```

Set SDK dependencies with:

```bash
export DOC_VERIFY_JAVA_CLASSPATH="<path-to-sdk-jar>:<dependency-jars>"
```

or pass `--java-classpath`. To derive it from a local Java SDK checkout, use `--java-sdk-repo` or `DOC_VERIFY_JAVA_SDK_REPO`.

Without classpath, dependency-only `javac` errors are reported as `manual`.

Scenario mode records the snippets included in each generated scenario. If a scenario compiles, each included snippet gets `scenarioCoverage.status=passed` in the report. This is intentionally separate from the snippet's own `verification.status`: a block can remain `manual` as a standalone fragment because it depends on earlier setup, while the scenario proves the ordered workflow compiles.

Runtime mode requires `--run-scenarios --live --allow-run`. After `javac` passes, the verifier executes `java -cp <scenario-dir>:<sdk-classpath> DocsScenario`. It injects a small three-row fixture with `product_id`, `product_name`, and 768-d `embedding` values before the search step.

## Disabling

Use `--no-harness` when you want only complete-file checks.
