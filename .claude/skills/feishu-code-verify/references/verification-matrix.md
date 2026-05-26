# Verification Matrix

Prefer the lowest-risk check that catches real documentation drift.

| Language | Default Check | Stronger Check | Skip/Manual When |
| --- | --- | --- | --- |
| JSON | `JSON.parse` | schema validation if schema is known | JSON contains comments or placeholders |
| YAML | parse with `yaml` package if installed | schema validation if schema is known | parser is unavailable |
| Bash/Shell | `bash -n`; scenario `bash -n` for ordered snippets | run annotated blocks or generated scenarios only with `--allow-run`; add `--live` for service calls | mutates state or calls live services |
| Python | `py_compile`; doctest for `>>>` examples; scenario `py_compile` for ordered snippets | pytest/doctest with fixtures | imports require live services or packages unavailable |
| JavaScript | `node --check`; scenario `node --check` for ordered snippets | run annotated blocks or generated scenarios only with `--allow-run`; add `--live` for service calls | ESM/package context is ambiguous |
| TypeScript | `tsc --noEmit` if `tsc` exists | project-aware `tsc -p` | no TypeScript compiler |
| Go | `gofmt` fragment harness for partial snippets; `go test` for complete package snippets; scenario `gofmt` for ordered snippets | repo-aware scenario `go test` with `DOC_VERIFY_GO_MODULE_DIR` or `--go-module-dir` | setup symbols/types are required |
| Java | fragment harness with `javac`; dependency-only errors become manual classpath/setup hints | `javac`/Maven with `DOC_VERIFY_JAVA_CLASSPATH`, `--java-classpath`, `DOC_VERIFY_JAVA_SDK_REPO`, or `--java-sdk-repo` | classpath cannot be derived |
| C/C++ | compiler `-fsyntax-only` for complete snippets | project-aware compile database | includes are unavailable |
| SQL/HTTP | parse/display only | live smoke test with `--live` | no safe test database/service |

Use `manual` instead of `failed` when a snippet is valid documentation but requires environment-specific setup.
When scenario mode is enabled, treat `manualCoveredByScenario` as verified in the document workflow and investigate `manualUncovered` first.
