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
