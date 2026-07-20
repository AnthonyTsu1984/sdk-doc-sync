# SDK Doc Sync Quality Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the uncovered placement-audit CLI defect and make `sdk-doc-sync` easier to discover, operate, and verify without weakening its Feishu write, inherited-document, or approval safety rules.

**Architecture:** Keep executable behavior in the existing Node.js modules and tests. Reduce `SKILL.md` to a decision-oriented entry point, move detailed phase/reporting procedures into focused references, and document which scripts are supported workflow entry points versus retained historical utilities. Add repository-level pressure scenarios that encode the failure modes behind the current safety rules.

**Tech Stack:** CommonJS Node.js, `node:test`, Markdown skills and references, repository skill validator.

---

### Task 1: Cover And Fix The Placement-Audit CLI Path

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/tests/script-paths.test.js`
- Modify: `.claude/skills/sdk-doc-sync/scripts/build-current-placement-audit.js`

- [ ] **Step 1: Write the failing CLI regression test**

Add a `node:test` case that runs the script as a child process with a minimal proposal file and an injected local test mode or exported `main` dependency seam. Assert that the command exits successfully and prints JSON containing `status`, `entries`, and `blocked`, with `entries` equal to the generated artifact entry count.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/script-paths.test.js
```

Expected: FAIL on the placement-audit CLI case with `ReferenceError: entries is not defined` or the equivalent missing summary result.

- [ ] **Step 3: Apply the minimal fix**

Change the CLI summary from the undefined local `entries.length` to `artifact.entries.length`. Keep library behavior and output fields unchanged.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/script-paths.test.js
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js
```

Expected: both commands PASS with no failures.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/sdk-doc-sync/tests/script-paths.test.js .claude/skills/sdk-doc-sync/scripts/build-current-placement-audit.js
git commit -m "fix: cover placement audit cli path"
```

### Task 2: Classify Supported And Historical Scripts

**Files:**
- Create: `.claude/skills/sdk-doc-sync/scripts/README.md`
- Modify: `.claude/skills/sdk-doc-sync/references/cli.md`
- Modify: `.claude/skills/sdk-doc-sync/tests/script-paths.test.js`

- [ ] **Step 1: Write the failing documentation contract test**

Add assertions that `scripts/README.md` exists, distinguishes supported workflow helpers from historical one-off migration scripts, labels `src/sdk-doc-sync/doc-generator.js` as legacy scaffold infrastructure, and warns that TODO-generating scripts are not approval-grade write inputs.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/script-paths.test.js
```

Expected: FAIL because the script classification document does not exist.

- [ ] **Step 3: Add the script classification guide**

Document these supported workflow helpers explicitly: `build-current-placement-audit.js`, `build-reviewed-release-context.js`, `render-grouping-inheritance-table.js`, and `feishu-doc.js`. Classify release-specific `*-create.js`, `*-update.js`, `*-fix*.js`, and version folders as retained historical or migration utilities that require source review before reuse. State that `DocGenerator` and any TODO scaffold output are prohibited as publishable artifacts and are rejected by the executor.

- [ ] **Step 4: Route CLI readers to the classification guide**

Add one concise link from `references/cli.md` to `scripts/README.md`; do not duplicate the inventory in both files.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/script-paths.test.js
```

Expected: PASS.

```bash
git add .claude/skills/sdk-doc-sync/scripts/README.md .claude/skills/sdk-doc-sync/references/cli.md .claude/skills/sdk-doc-sync/tests/script-paths.test.js
git commit -m "docs: classify sdk doc sync scripts"
```

### Task 3: Streamline The Core Skill Without Losing Safety Rules

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/SKILL.md`
- Create: `.claude/skills/sdk-doc-sync/references/phase-gates.md`
- Create: `.claude/skills/sdk-doc-sync/references/review-and-approval.md`
- Modify: `.claude/skills/sdk-doc-sync/tests/release-scope.test.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/script-paths.test.js`

- [ ] **Step 1: Record RED pressure-scenario results before editing the skill**

Run at least three fresh subagent scenarios using only the current skill: an inherited changed document, ambiguous grouping plus successor inheritance, and a request to write after a Markdown-only preview. Save concise observed decisions and any hesitation or rule lookup failures in the Task 4 scenario artifact before changing `SKILL.md`.

- [ ] **Step 2: Write failing structural and invariant tests**

Add tests requiring the two new references, links from `SKILL.md`, a core word count below 1,800 words, and retained text contracts for: exact approval tokens, stale-artifact rejection, placement audit before approval, `COPY_PATCH_AND_REPOINT`, sparse release folders, lark-cli operational role, no Markdown-only approval, no internal notes/placeholders/escaped identifiers, and no `scan-state.json` update before verified completion.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js .claude/skills/sdk-doc-sync/tests/script-paths.test.js
```

Expected: FAIL on missing references and the word-count ceiling.

- [ ] **Step 4: Refactor the skill core**

Keep `SKILL.md` focused on triggers, reference routing, non-negotiable invariants, the four-phase state machine, and the minimal run sequence. Move detailed status tables, chat report column requirements, accepted reply syntax, blocked-run recovery commands, and approval-artifact construction to the two new references. Preserve exact tokens `APPROVE_GROUPING` and `APPROVE_WRITES` in the core.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
wc -w .claude/skills/sdk-doc-sync/SKILL.md
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js .claude/skills/sdk-doc-sync/tests/script-paths.test.js
npm run validate:skills
```

Expected: `SKILL.md` is below 1,800 words and all commands PASS.

```bash
git add .claude/skills/sdk-doc-sync/SKILL.md .claude/skills/sdk-doc-sync/references/phase-gates.md .claude/skills/sdk-doc-sync/references/review-and-approval.md .claude/skills/sdk-doc-sync/tests/release-scope.test.js .claude/skills/sdk-doc-sync/tests/script-paths.test.js
git commit -m "docs: streamline sdk doc sync skill core"
```

### Task 4: Add Skill Pressure Scenarios And Re-Run Them

**Files:**
- Create: `.claude/skills/sdk-doc-sync/tests/skill-pressure-scenarios.md`
- Modify: `.claude/skills/sdk-doc-sync/tests/script-paths.test.js`

- [ ] **Step 1: Write the scenario artifact**

For each scenario, record the prompt, expected safe decisions, RED baseline observation from Task 3, and GREEN result after the refactor. Include these scenarios: changed inherited doc in an older release folder; four current-release misses that resolve to inherited v2.5.x/v2.4.x documents; free-form `ok` after grouping; write request based on Markdown-only preview; and rollback after garbled Docx formatting.

- [ ] **Step 2: Add the artifact contract test**

Require all five scenario names and the explicit expected decisions: `COPY_PATCH_AND_REPOINT`, placement-audit resolution across source version roots, rejection of free-form approval, block-level approval evidence, and lark-cli history revert/cleanup as operational recovery.

- [ ] **Step 3: Run GREEN pressure tests**

Dispatch fresh subagents with the streamlined skill and the same scenario prompts. Record whether each scenario passes and any remaining rationalization. If a scenario fails, minimally tighten the relevant core invariant or reference and rerun it.

- [ ] **Step 4: Verify and commit**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/script-paths.test.js
```

Expected: PASS.

```bash
git add .claude/skills/sdk-doc-sync/tests/skill-pressure-scenarios.md .claude/skills/sdk-doc-sync/tests/script-paths.test.js .claude/skills/sdk-doc-sync/SKILL.md .claude/skills/sdk-doc-sync/references
git commit -m "test: document sdk doc sync pressure scenarios"
```

### Task 5: Final Package Verification

**Files:**
- Modify only if verification exposes a defect in the files changed by Tasks 1-4.

- [ ] **Step 1: Run complete verification**

Run:

```bash
npm run validate:skills
node .claude/skills/sdk-doc-sync/tests/run-all.js
git diff --check
git status --short
```

Expected: skill validation passes, all SDK tests pass, no whitespace errors, and only intentional committed changes remain.

- [ ] **Step 2: Review the complete branch**

Review `git diff sdk-doc-sync-correctness...HEAD` for preserved safety invariants, no accidental script deletion, no live Feishu writes, no secret or generated artifact additions, and clear commit boundaries.

- [ ] **Step 3: Commit verification-only fixes if needed**

If verification required a scoped correction, commit it with a precise message. Otherwise create no empty commit.
