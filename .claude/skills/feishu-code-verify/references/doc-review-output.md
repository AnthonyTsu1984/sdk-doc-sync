# Doc Review Output

Every verification run should end with a human-readable review, not only a JSON report path.

The review should separate what the verifier proved from what the documentation still needs to communicate.

## Required Summary

Report these items:

- input source: Feishu URL/token, bitable slice, or Markdown file;
- languages checked;
- verification modes used: raw snippet checks, scenario compile checks, scenario runtime checks, live checks;
- report path;
- pass/fail/manual counts from `summary`;
- scenario counts, including `scenarioRuntimePassed`, `scenarioRuntimeFailed`, and `scenarioRuntimeManual` when present;
- important generated scenario paths when they are relevant to diagnosis.

## Explain Status Meaning

Always explain the distinction between these result types:

- raw block `passed`: the extracted block itself passed its configured parse/compile/run check;
- raw block `manual`: the block is plausible documentation but needs context, dependencies, credentials, service state, or human review;
- `scenarioCoverage.status=passed`: the block was included in a passing generated workflow, but this does not mean the raw block is copy-paste runnable by itself;
- scenario runtime `passed`: the generated workflow ran successfully with the verifier's wrappers, env mapping, and fixtures.

Do not collapse `manualCoveredByScenario` into raw `passed`. Say that the workflow is verified while the standalone block remains context-dependent.

## Suggestions To The Doc

Include suggestions even when all code checks pass. Cover at least these categories:

- Script correctness: syntax errors, compile errors, runtime errors, missing imports, wrong class/function names, wrong SDK calls, incompatible package/module assumptions.
- Copy-paste readiness: whether each block is self-contained, intentionally partial, or dependent on previous sections.
- Workflow structure: whether setup, schema creation, data preparation, search/query, cleanup, and expected output appear in a clear order.
- Procedure gaps: missing prerequisites, required env vars, SDK installation, authentication, local repo/classpath/module setup, service availability, object storage setup.
- Data/fixture gaps: missing sample data, missing Parquet/JSON objects, vector dimensions, schema-field mismatches, search examples that require inserted data.
- Safety and isolation: destructive commands, resource cleanup, live service mutations, and whether examples use isolated/generated resource names.
- Reader expectations: where the doc should say "run this after the previous block", "replace these placeholders", "this block is illustrative", or "this requires a live cluster".

## When To Recommend Doc Changes

Recommend changing the doc when verification needed to invent semantic information that a reader would also need.

Examples:

- generated rows were inserted before a search but the doc does not say data must exist;
- a generated Parquet file was needed because the documented object URL is only a placeholder;
- vector dimensions had to be expanded or corrected;
- imports, SDK classes, module setup, or classpath dependencies are not discoverable from nearby text;
- required env vars or credentials are not listed;
- cleanup/destructive behavior is unclear.

Do not recommend doc changes for verifier-only mechanics that are not user-facing, such as temp directory names, report paths, or generated wrapper class names.

## Suggested Response Shape

Use this structure unless the user asks for another format:

```text
Verification summary
- Source:
- Languages:
- Modes:
- Report:
- Result:

What passed
- ...

Manual or failed items
- ...

Doc suggestions
- ...

Confidence / limits
- ...
```

Keep the review grounded in report fields and scenario artifacts. If a suggestion is an inference from generated-program preparation, say so explicitly.

## High-Information Template

Use this fuller template for SDK procedure docs, shim/fixture development, or any live runtime run. Keep the sections even when a value is zero or not applicable.

```text
Verification report

Scope
- Sources:
- Languages:
- Modes:
- Live target:
- SDK/tooling inputs:
- Reports:
- Scenario artifacts:

Headline result
- Raw snippets:
- Scenario compile:
- Scenario runtime:
- Manual coverage:
- Exit status meaning:

Evidence matrix
| Source | Language | Raw result | Scenario compile | Scenario runtime | Shims/fixtures | Evidence |
| ... |

What the verifier proved
- Raw block passed:
- Scenario-covered:
- Runtime-proved:
- Dependency/tooling-proved:

Failures and gaps
| Source | Language | Stage | Symptom | Root cause class | Next action |
| ... |

Root cause classes
- Doc code defect: syntax/API issue in the extracted block itself.
- Missing setup shim: client/env/import/variable boilerplate omitted by the doc.
- Missing fixture: schema, collection, index, rows, object storage, or test data absent.
- Environment dependency: SDK package, classpath, Go module, CLI, cloud endpoint, or network unavailable.
- Product/runtime behavior: service rejected a request after valid setup.

Shim/fixture decisions
- Safe shim candidates:
- Fixture candidates:
- Do not shim:
- Requires doc change:

Doc recommendations
- Copy-paste readiness:
- Workflow order:
- Prerequisites/env:
- Data/schema:
- Safety/isolation:
- Expected output:

Confidence and limits
- High confidence:
- Medium confidence:
- Not proven:
- Follow-up verification command:
```

### Evidence Matrix Guidance

Use terse but concrete evidence in the table:

- Raw result: `65 passed / 3 failed / 23 manual`.
- Scenario compile: `python passed`, `java manual: missing Gson`, `go manual: module path mismatch`.
- Scenario runtime: include the first failing operation, not the entire stack trace.
- Shims/fixtures: list report `scenario.shims[].name`; if a fixture was generated, name the fixture and resource suffix.
- Evidence: report path plus generated scenario path and the block index or line number when useful.

### Shim And Fixture Backlog Format

When the run is being used to improve verifier coverage, include a ranked backlog:

```text
Next shim/fixture backlog
P0
- Rule:
  Trigger:
  Transformation/fixture:
  Safety guard:
  Expected report change:

P1
- Rule:
  Trigger:
  Transformation/fixture:
  Safety guard:
  Expected report change:

Do not implement as shim
- Reason:
```

Prefer fixture rules for semantic prerequisites such as collection schema and rows. Prefer shim rules for mechanical omissions such as endpoint env mapping, client construction, import hoisting, repeated local declarations, and syntactic wrapping of documented DSL expressions.
