# fix-github-issue Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a personal Claude Code skill that takes a GitHub issue number, runs parallel codebase research, triages relevance (early exit if irrelevant), dispatches a fix agent team, runs a code review cycle, and closes the issue via PR or comment.

**Architecture:** A single SKILL.md in `~/.claude/skills/fix-github-issue/` containing a 7-phase prescriptive workflow. Technique skill (how-to guide) — follows the writing-skills TDD cycle: baseline test first, then skill authoring, then loophole refinement.

**Tech Stack:** `gh` CLI, agent-teams skills (team-debug, team-feature, team-review), Grep/Glob/Bash for research, `npm run test:run` for test coverage phase.

---

## File Map

| Action | Path |
|--------|------|
| Create | `~/.claude/skills/fix-github-issue/SKILL.md` |

---

### Task 1: Write the Baseline Test Scenario (RED)

Before writing the skill, document what Claude does *without* it. This is the RED phase.

**Files:**
- Create: `~/.claude/skills/fix-github-issue/baseline-test.md` (temporary, deleted after refactor)

- [ ] **Step 1: Create the baseline test scenario document**

Create `~/.claude/skills/fix-github-issue/baseline-test.md` with this content:

```markdown
# Baseline Test Scenario — fix-github-issue

## Scenario
Dispatch a subagent with this prompt and observe behavior WITHOUT the fix-github-issue skill loaded:

"Please investigate and fix GitHub issue #74 in the zbaker94/sounds-bored repo
(DEFAULT_LAYER constant duplicated in PadConfigDrawer.tsx and LayerAccordion.tsx).
Create a branch, fix it, and close the issue appropriately."

## What to observe
- Does it run parallel research agents or investigate linearly?
- Does it check whether the issue is still relevant before branching?
- Does it explicitly exit early if already resolved?
- Does it auto-detect team type?
- Does it run a code review pass after changes?
- Does it close the issue with PR or comment?

## Expected baseline failures (technique skill gaps)
- Linear investigation (no parallelism)
- No explicit early exit gate
- No team type auto-detection
- No structured code review cycle
- Ad-hoc PR/close behavior
```

- [ ] **Step 2: Dispatch a baseline subagent (general-purpose) with the scenario prompt**

Prompt the subagent:
> "Please investigate and fix GitHub issue #74 in the zbaker94/sounds-bored repo (DEFAULT_LAYER constant duplicated in PadConfigDrawer.tsx and LayerAccordion.tsx). Create a branch, fix it, and close the issue appropriately. Do NOT use any skills — work from first principles."

- [ ] **Step 3: Record actual baseline behavior in the doc**

Note verbatim what the subagent did. Pay attention to:
- Did it use parallel agents or go linear?
- Did it check relevance before branching?
- Did it run a review pass?
- How did it close the issue?

Update `baseline-test.md` with the actual observed behavior.

---

### Task 2: Write the Skill — SKILL.md (GREEN)

**Files:**
- Create: `~/.claude/skills/fix-github-issue/SKILL.md`

- [ ] **Step 1: Create `~/.claude/skills/fix-github-issue/SKILL.md`** with the following exact content:

```markdown
---
name: fix-github-issue
description: Use when given a GitHub issue number to investigate, triage, and fix in the sounds-bored repo. Covers parallel research, early exit for irrelevant issues, fix team dispatch with auto-detected type, code review cycle, and issue closure via PR or comment.
---

# Fix GitHub Issue (sounds-bored)

Sounds-bored repo only (`zbaker94/sounds-bored`). Requires `gh` CLI authenticated. Run from `C:/Repos/sounds-bored` on branch `master`.

## Phase 1 — Fetch Issue

```bash
gh issue view <number> --json title,body,labels,state,comments
```

If `state` is already `CLOSED` → report to user and **exit immediately**.

## Phase 2 — Parallel Research

Dispatch all 3 agents simultaneously in a single message (parallel, not sequential):

**Agent A — Code Search** (subagent_type: `Explore`)

Prompt:
> "Search the sounds-bored codebase at C:/Repos/sounds-bored for patterns related to this issue: [paste full issue title and body]. Use Grep, Glob, and Read to find relevant files and functions. Confirm whether the described behavior or problem exists in the current code, or whether it appears already resolved. Report: relevant files with line numbers, your assessment of whether the issue is still present."

**Agent B — Test Coverage** (subagent_type: `Explore`)

Prompt:
> "In C:/Repos/sounds-bored, run `npm run test:run` and capture the full output. Then search test files matching `src/**/*.test.ts` and `src/**/*.test.tsx` for coverage of [affected area from issue title/body]. Report: any currently failing tests, coverage gaps in the affected area, whether the issue area has test coverage."

**Agent C — Issue History** (subagent_type: general-purpose)

Prompt:
> "Run the following command and report the results: `gh issue list --state all --search \"<keywords from issue title>\" --repo zbaker94/sounds-bored --limit 20`. Identify any duplicate issues, prior fixes for the same problem, or related closed issues that may already address this."

## Phase 3 — Triage (EARLY EXIT GATE)

Read all 3 agent reports. Make a relevance determination.

**If the issue is NO LONGER RELEVANT** (code already handles it, duplicate of a closed issue, fixed in a recent commit, not reproducible):

```bash
gh issue comment <number> --body "Closing: investigated this issue and found it is no longer relevant. [Explain what was found — e.g., 'The DEFAULT_LAYER constant was already consolidated in commit abc123' or 'This is a duplicate of #65 which was resolved.']"
gh issue close <number>
```

**STOP HERE. Do not create a branch. Do not dispatch a fix team. Report findings to user and exit.**

**If the issue IS still relevant:** continue to Phase 4.

## Phase 4 — Branch + Team Dispatch

Create the branch:
```bash
git checkout -b fix/issue-<number>
```

Detect team type from issue labels:

| Labels contain | Team to dispatch |
|----------------|-----------------|
| `bug`, `fix`, `regression` | `team-debug` |
| `enhancement`, `feature`, `improvement` | `team-feature` |
| Unclear or no labels | `team-feature` (default) |

Invoke the appropriate skill (`agent-teams:team-debug` or `agent-teams:team-feature`) with this full context brief:

```
Issue: #<number> — <title>
Body: <full issue body>
Labels: <labels>
Branch: fix/issue-<number>
Repo root: C:/Repos/sounds-bored

Code search findings (Agent A):
<paste Agent A report>

Test findings (Agent B):
<paste Agent B report>

Related issues (Agent C):
<paste Agent C report>

Instructions:
- Implement the fix described in the issue
- Write or update tests to cover the fix
- Do NOT commit — leave changes staged or unstaged for review
```

## Phase 5 — Code Review Cycle

Once the fix team reports completion:

1. Invoke `agent-teams:team-review` on all changed files (use `git diff master` to get the diff)
2. Surface all reviewer findings back to the fix team in a single message
3. Fix team addresses all findings in one pass
4. **One review cycle only** — do not dispatch another review after the fix pass

If the fix team made **no file changes** → skip to Phase 6 (no-changes path).

## Phase 6 — Close

### If changes were made:

```bash
gh pr create \
  --title "fix: <issue title> (#<number>)" \
  --body "$(cat <<'EOF'
## Summary
- <bullet 1: what was changed>
- <bullet 2: what was changed>
- <bullet 3: tests added/updated>

Closes #<number>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" \
  --base master
```

### If no changes were made (issue not reproducible / already fixed):

```bash
gh issue comment <number> --body "Investigated this issue but found no changes were needed: [explain — e.g., 'The behavior described is not reproducible in the current codebase' or 'This was already resolved as part of a broader refactor.']"
gh issue close <number>
```

## Phase 7 — Summary to User

Report:
- What each research agent found
- Triage decision (still relevant or not)
- If relevant: what the fix team changed, what the reviewer flagged, how findings were addressed
- Final action: PR link (with number), or issue closure reason
```

- [ ] **Step 2: Verify the file was created correctly**

```bash
cat "C:/Users/$(whoami)/.claude/skills/fix-github-issue/SKILL.md"
```

Confirm frontmatter is valid YAML, all 7 phases are present, early exit gate is explicit.

---

### Task 3: Test the Skill (GREEN verification)

**Files:**
- No changes — verification only

- [ ] **Step 1: Invoke the skill on issue #74**

Type `/fix-github-issue 74` in a new conversation and observe behavior.

- [ ] **Step 2: Verify Phase 2 fires 3 parallel agents**

Confirm all 3 research agents are dispatched in a single message (not sequentially).

- [ ] **Step 3: Verify Phase 3 early exit**

For a test of the early-exit path, invoke the skill on an already-closed issue (e.g., find one with `gh issue list --state closed --limit 5 --repo zbaker94/sounds-bored`). Confirm the skill exits after posting a comment and does NOT create a branch.

- [ ] **Step 4: Verify PR is created with `Closes #<number>`**

If changes are made on issue #74, confirm the PR body contains `Closes #74` and the PR is ready for review (not draft).

- [ ] **Step 5: Record any deviations from expected behavior**

Note any phases skipped, wrong team type selected, or incorrect close behavior. These become refactor targets in Task 4.

---

### Task 4: Refactor — Close Loopholes (REFACTOR)

**Files:**
- Modify: `~/.claude/skills/fix-github-issue/SKILL.md`

- [ ] **Step 1: Review observed deviations from Task 3**

For each deviation, add an explicit counter to SKILL.md. Common gaps to check:

| Observed failure | Fix to add |
|-----------------|-----------|
| Agents dispatched sequentially | Add: "IMPORTANT: All 3 agents MUST be dispatched in a single message. Do not wait for Agent A before dispatching B and C." |
| Early exit skipped (went straight to branch) | Add red flag: "Do NOT create the branch before completing Phase 3." |
| Review cycle ran more than once | Add: "Run exactly one review pass. After the fix team addresses findings, proceed to Phase 6 immediately." |
| PR created as draft | Add: "Do NOT use `--draft`. The PR must be ready for review." |
| Team type defaulted to debug for enhancement | Review the label detection table and clarify |

- [ ] **Step 2: Update SKILL.md with any new explicit constraints found**

Edit the file at `~/.claude/skills/fix-github-issue/SKILL.md` to add the counters identified above.

- [ ] **Step 3: Re-test one more time with a different issue**

Pick issue #73 (`console.warn in production library code`). Invoke `/fix-github-issue 73` and verify the full flow runs correctly end-to-end with the updated skill.

- [ ] **Step 4: Delete the baseline test document**

```bash
rm "C:/Users/$(whoami)/.claude/skills/fix-github-issue/baseline-test.md"
```

- [ ] **Step 5: Verify final skill file is clean**

```bash
cat "C:/Users/$(whoami)/.claude/skills/fix-github-issue/SKILL.md"
```

Confirm no `baseline-test.md` reference remains, no TODOs, all phases present.

---

### Task 5: Register Skill in MEMORY.md

**Files:**
- Modify: `C:/Users/Zack/.claude/projects/C--Repos-sounds-bored/memory/MEMORY.md`

- [ ] **Step 1: Add skill entry to project MEMORY.md**

Add to `C:/Users/Zack/.claude/projects/C--Repos-sounds-bored/memory/MEMORY.md` under a "Skills" section (or append if none exists):

```markdown
## Custom Skills

- `fix-github-issue` — invoke with `/fix-github-issue <number>` to research, fix, and close a GitHub issue using parallel agents + code review cycle
```

- [ ] **Step 2: Verify MEMORY.md is under 200 lines**

```bash
wc -l "C:/Users/Zack/.claude/projects/C--Repos-sounds-bored/memory/MEMORY.md"
```

If over 200 lines, consolidate entries to keep the index concise.
