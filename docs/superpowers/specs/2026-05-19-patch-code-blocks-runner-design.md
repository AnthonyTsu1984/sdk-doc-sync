# patch-code-blocks Runner Design

## Objective
Implement a standalone executable runner for `patch-code-blocks` that supports both dry-run analysis and `--apply=true` patching for Feishu wiki/doc code blocks.

## Scope
- Implement one CLI entrypoint:
  - `.claude/skills/patch-code-blocks/bin/patch-code-blocks.js`
- Support inputs from skill contract:
  - `--target`, `--product`, `--release`, `--reference`, `--languages`, `--language-order`, `--apply`
- Enforce hard-stop validations and patch guardrails.
- Produce dry-run capability matrix and candidate summary.
- Execute idempotent in-place patching in apply mode.

## Non-Goals
- Runtime execution or correctness verification of snippets.
- Daily build retention or sandbox orchestration.
- Any patching outside code-block sections.

## CLI Contract
- Defaults:
  - `--product=milvus`
  - `--reference=/Volumes/CaseSensitive/projects/feishu-markdown-bridge/repos`
  - `--languages=python,java,go,node,rest,cli`
  - `--apply=false`
- Required:
  - `--target`
  - `--release` when `--product=milvus`
- Normalization:
  - `restful` and `restful-api` -> `rest`
  - zilliz aliases normalized to `zilliz-saas` / `zilliz-paas`

## Module Layout
- `.claude/skills/patch-code-blocks/src/args.js`
  - Parse args, apply defaults, normalize aliases, enforce hard stops.
- `.claude/skills/patch-code-blocks/src/target.js`
  - Resolve wiki/doc URL and derive `doc_token`.
- `.claude/skills/patch-code-blocks/src/blocks.js`
  - Fetch document blocks and extract code-block groups per operation section.
- `.claude/skills/patch-code-blocks/src/product-filter.js`
  - Apply `<include target="...">` and `<exclude target="...">` directives.
- `.claude/skills/patch-code-blocks/src/reference-scan.js`
  - Load reference material and compute operation × language status.
- `.claude/skills/patch-code-blocks/src/diff-plan.js`
  - Build patch candidates for `supported` status and run idempotency pre-check.
- `.claude/skills/patch-code-blocks/src/apply.js`
  - Replace/insert code blocks, enforce labels and final language order.
- `.claude/skills/patch-code-blocks/src/report.js`
  - Emit dry-run and apply-mode summaries.

## Runtime Flow
1. Input gate validation and normalization.
2. Resolve target and fetch blocks.
3. Extract operation sections and existing language blocks.
4. Filter sections by product include/exclude directives.
5. Reference-driven capability scan (`supported`/`missing`/`unclear`).
6. Build candidate plan for `supported` only.
7. If `--apply=true`, run idempotency pre-check and apply patch changes.
8. Re-read/confirm updated sections and print final summary.

## Patching Rules
- Never patch outside selected languages.
- Never duplicate language blocks.
- Patch code-block sections only; preserve narrative text.
- Replace existing language block when present; insert only when absent.
- Enforce Feishu labels:
  - `python` -> `Python`
  - `java` -> `Java`
  - `go` -> `Go`
  - `node` -> `JavaScript`
  - `rest` -> `Bash`
  - `cli` -> `Shell`
- Enforce final language order:
  - `python -> java -> go -> node -> rest -> cli`

## Reporting
- Dry-run:
  - capability matrix by operation/language
  - candidate diff summary by operation
- Apply mode:
  - patched / skipped / failed counts
  - per-operation outcomes and re-read confirmation

## Test Plan
Create tests under `.claude/skills/patch-code-blocks/tests/`:
1. Input gate tests (required args, milvus release requirement, alias normalization).
2. Product-filter tests (include/exclude handling and zilliz alias mapping).
3. Idempotency tests (no duplicate insertions; stable repeated runs).
4. Apply tests (replace vs insert correctness; code-block-only mutation).
5. End-to-end dry-run fixture test (matrix and candidate summary output).

## Acceptance Criteria
- Running from project root works:
  - `node .claude/skills/patch-code-blocks/bin/patch-code-blocks.js --target <url> --product zilliz-saas`
- Dry-run prints matrix + candidate summary.
- `--apply=true` performs idempotent patching and outputs patched/skipped/failed report.
- Implementation keeps verification boundary intact by directing runtime validation to `/test-code-blocks`.
