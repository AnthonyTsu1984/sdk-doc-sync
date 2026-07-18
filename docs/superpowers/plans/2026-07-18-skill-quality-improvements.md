# Repository Skill Quality Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repository's Feishu/Lark workflow skills safer, easier to trigger, less prone to documentation drift, and continuously validated by the default test suite.

**Architecture:** Add a dependency-free repository validator and skill contract tests first, then use those tests to drive corrections to frontmatter, commands, approval gates, and resource structure. Keep each `SKILL.md` as a concise router and move detailed operational guidance into one-level `references/` files. Preserve `patch-code-blocks` as an internal tool package until its apply path is implemented.

**Tech Stack:** Node.js built-in test runner, CommonJS validation scripts, Markdown/YAML skill bundles, npm scripts.

---

### Task 1: Add repository skill validation

**Files:**
- Create: `scripts/validate-skills.js`
- Create: `tests/skills/validate-skills.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing validator tests**

Test that the validator discovers the five directories containing `SKILL.md`, accepts optional Agent Skills fields but rejects `argument-hint`, checks directory/name equality, verifies relative Markdown links, reports missing `agents/openai.yaml`, and treats `patch-code-blocks` as an internal tool directory rather than a malformed skill.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/skills/validate-skills.test.js`

Expected: FAIL because `scripts/validate-skills.js` does not exist.

- [ ] **Step 3: Implement the dependency-free validator**

Export `parseFrontmatter`, `validateSkill`, and `validateRepository`. The CLI must print one diagnostic per line and exit nonzero on errors. Validate required fields, official name/description constraints, known frontmatter keys, relative links, `SKILL.md` line count, and optional agent metadata.

- [ ] **Step 4: Add npm scripts**

Add:

```json
"test:skills": "node --test tests/skills/*.test.js",
"validate:skills": "node scripts/validate-skills.js",
"test:verifier": "node .claude/skills/feishu-code-verify/scripts/verify-feishu-doc-code.js --self-test"
```

Make `npm test` run skill validation tests, SDK tests, patch-code-blocks tests, and verifier self-test.

- [ ] **Step 5: Run focused tests and validator**

Run: `npm run test:skills && npm run validate:skills`

Expected: tests pass; validator initially reports the real repository violations addressed in Tasks 2-5.

### Task 2: Fix correctness, safety, and CLI drift

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/SKILL.md`
- Modify: `.claude/skills/localization-docs/SKILL.md`
- Modify: `.claude/skills/draft-verified-docs/SKILL.md`
- Modify: `.claude/skills/patch-feishu-code/SKILL.md`
- Create: `tests/skills/skill-contracts.test.js`

- [ ] **Step 1: Write failing contract tests**

Assert that:

- the SDK quick-start uses `--language python`, includes `--sdk-name`, and contains no contradictory instruction to delete historical version documents;
- localization examples include `--source-table` and `--target-table` and no longer claim those options are missing;
- every write-capable skill requires an exact action preview, explicit approval, live write, and refetch verification;
- no skill authorizes editing its own skill files without an explicit user request.

- [ ] **Step 2: Run contract tests and verify RED**

Run: `node --test tests/skills/skill-contracts.test.js`

Expected: FAIL on the existing drift and safety contradictions.

- [ ] **Step 3: Apply minimal documentation corrections**

Choose one SDK invariant: older-version documents remain historical snapshots unless the user separately requests cleanup. Correct the CLI examples and localization table-aware workflow. Add the shared write gate to draft and patch skills.

- [ ] **Step 4: Run contract tests and relevant CLI help checks**

Run:

```bash
node --test tests/skills/skill-contracts.test.js
node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js --help
node .claude/skills/sdk-doc-sync/bin/feishu-doc-translator.js --help
```

Expected: tests pass and documented flags appear in help.

### Task 3: Normalize metadata and discovery

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/SKILL.md`
- Modify: `.claude/skills/patch-feishu-code/SKILL.md`
- Modify: descriptions in all five `SKILL.md` files
- Create: `.claude/skills/feishu-code-verify/agents/openai.yaml`
- Create: `.claude/skills/patch-feishu-code/agents/openai.yaml`
- Create: `.claude/skills/sdk-doc-sync/agents/openai.yaml`
- Create: `evals/skills/invocation-cases.jsonl`
- Create: `tests/skills/invocation-cases.test.js`

- [ ] **Step 1: Write failing metadata and eval-corpus tests**

Require supported frontmatter only, agent metadata for every skill, and explicit/implicit/contextual/negative routing cases for each skill.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/skills/invocation-cases.test.js`

Expected: FAIL because metadata and the corpus are incomplete.

- [ ] **Step 3: Remove nonstandard frontmatter and clarify boundaries**

Move argument examples into agent default prompts. Ensure descriptions say what the skill does, when it applies, and distinguish drafting, code verification, language-port patching, localization, and release-driven SDK synchronization.

- [ ] **Step 4: Add the routing corpus**

Use JSON Lines objects with `id`, `class`, `prompt`, `expectedSkill`, and `mustNotSelect`. Include at least four cases per skill and confusion cases between neighboring skills.

- [ ] **Step 5: Run metadata tests and validator**

Run: `npm run test:skills && npm run validate:skills`

Expected: pass with no metadata errors or missing agent files.

### Task 4: Apply progressive disclosure to large skills

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/SKILL.md`
- Create: `.claude/skills/sdk-doc-sync/references/versioning.md`
- Create: `.claude/skills/sdk-doc-sync/references/post-write-verification.md`
- Create: `.claude/skills/sdk-doc-sync/references/cli.md`
- Create: `.claude/skills/sdk-doc-sync/references/troubleshooting.md`
- Modify: `.claude/skills/feishu-code-verify/SKILL.md`
- Create: `.claude/skills/feishu-code-verify/references/manta-runtime.md`
- Modify: `.claude/skills/patch-feishu-code/SKILL.md`
- Create: `.claude/skills/patch-feishu-code/references/feature-cases.md`
- Modify: `.claude/skills/localization-docs/references/development-alignment.md`
- Create: `.claude/skills/localization-docs/references/development-snapshot-2026-07-03.md`

- [ ] **Step 1: Add failing size and content-placement assertions**

Require `sdk-doc-sync/SKILL.md` to be under 300 lines, require detailed CLI/Manta/prior-run sections to live in references, and ensure every new reference is directly linked from its parent skill.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/skills/skill-contracts.test.js`

Expected: FAIL on current size and section placement.

- [ ] **Step 3: Move content without changing operational meaning**

Keep only routing, phase summaries, approval rules, and mandatory invariants in each main skill. Move detailed commands, platform-specific execution, and dated observations to the new references. Add a compact contents list to references longer than 100 lines.

- [ ] **Step 4: Run all skill tests and link validation**

Run: `npm run test:skills && npm run validate:skills`

Expected: pass; no broken links; main skill sizes meet the enforced limits.

### Task 5: Strengthen the default verification suite

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/tests/run-all.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/script-paths.test.js`
- Modify: `package.json`
- Modify: `tests/skills/skill-contracts.test.js`

- [ ] **Step 1: Write a failing test for complete default coverage**

Require `npm test` to cover SDK tests, skill tests, patch-code-blocks tests, and verifier self-test without recursively invoking itself.

- [ ] **Step 2: Run and verify RED**

Run: `node --test .claude/skills/sdk-doc-sync/tests/script-paths.test.js`

Expected: FAIL until the scripts and runner contract are updated.

- [ ] **Step 3: Implement the aggregate test command**

Keep focused scripts for local development and make the default command an explicit ordered aggregate with nonzero propagation.

- [ ] **Step 4: Run the full suite**

Run: `npm test`

Expected: all suites pass with zero failures.

### Task 6: Final verification and handoff

**Files:**
- Review all modified files.

- [ ] **Step 1: Run repository validation**

Run:

```bash
npm run validate:skills
npm test
git diff --check
git status --short
```

- [ ] **Step 2: Inspect the final diff**

Confirm no hardcoded secret values were added, no historical document deletion instruction remains, every skill has agent metadata, and `patch-code-blocks` remains explicitly internal and dry-run-only.

- [ ] **Step 3: Commit in logical units**

Use focused commits for validator/tests, safety and metadata corrections, progressive-disclosure refactors, and aggregate verification.
