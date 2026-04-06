# Design: `fix-github-issue` Skill

**Date:** 2026-04-05  
**Repo:** sounds-bored (zbaker94/sounds-bored)  
**Skill location:** `~/.claude/skills/fix-github-issue/SKILL.md`  
**Trigger:** `/fix-github-issue <issue-number>`

---

## Overview

A personal Claude Code skill that takes a GitHub issue number, investigates whether it is still relevant via parallel research agents, amends the issue with findings, and — if still relevant — dispatches an agent team to fix it on a new branch, runs a code review cycle, then closes the issue via PR or comment.

Scope: sounds-bored repository only.

---

## Workflow (7 Phases)

### Phase 1 — Fetch Issue

```bash
gh issue view <number> --json title,body,labels,state,comments
```

Extract: title, body, labels (for team type detection), current state, existing comments.

If the issue is already closed, report to user and exit immediately.

---

### Phase 2 — Parallel Research

Dispatch 3 agents simultaneously, each with the issue title + body as context:

**Agent A — Code Search (`Explore` subagent)**
- Grep/glob codebase for patterns, function names, and file paths mentioned in the issue
- Confirm whether described behavior exists in current code or appears already resolved
- Report: relevant files with line numbers, assessment of whether issue is present

**Agent B — Test Coverage (`Explore` subagent)**
- Run `npm run test:run`, capture output
- Grep test files for coverage of the affected area
- Report: failing tests, coverage gaps, whether the issue area has test coverage

**Agent C — Issue History (general-purpose subagent)**
- Run `gh issue list --state all --search "<keywords-from-title>"` to find related issues
- Report: duplicates, prior fixes, related closed issues that may already address this

---

### Phase 3 — Synthesize + Triage (EARLY EXIT GATE)

Main agent reads all 3 reports and makes a relevance determination.

**If the issue is NO LONGER RELEVANT** (already fixed in code, duplicate of a closed issue, etc.):
1. Post a comment on the GitHub issue explaining the findings (what was found, why it's not relevant)
2. Close the issue: `gh issue close <number> --comment "<explanation>"`
3. **EXIT the skill immediately** — no branch, no team dispatch, nothing further

**If the issue IS still relevant:** continue to Phase 4.

---

### Phase 4 — Branch + Team Dispatch

Create the branch:
```bash
git checkout -b fix/issue-<number>
```

Auto-detect team type from issue labels:
| Labels | Team |
|--------|------|
| `bug`, `fix`, `regression` | `team-debug` |
| `enhancement`, `feature`, `improvement` | `team-feature` |
| Unclear / no labels | `team-feature` (default) |

Dispatch the fix team with a full context brief containing:
- Issue number, title, body, labels
- Agent A findings (relevant files + line numbers)
- Agent B findings (failing tests, coverage gaps)
- Agent C findings (related issues / prior attempts)
- Branch name: `fix/issue-<number>`
- Instruction: implement the fix, write/update tests, do NOT commit

---

### Phase 5 — Code Review Cycle

Once the fix team completes:

1. Dispatch `team-review` with a diff of all changed files
2. Reviewer surfaces findings back to the fix team
3. Fix team addresses all findings in a single pass
4. No further review passes — one review cycle only

If the fix team made **no changes** (determined the issue was already addressed or not reproducible), skip to Phase 6 with the "no changes" path.

---

### Phase 6 — Close

**If changes were made:**
- Create a ready-for-review PR:
  ```bash
  gh pr create --title "fix: <issue title> (#<number>)" --body "Closes #<number>\n\n<summary of changes>"
  ```
- The `Closes #<number>` in the PR body will auto-close the issue when merged

**If no changes were needed** (issue already resolved / not reproducible):
- Post a comment explaining the findings
- Close the issue: `gh issue close <number>`

---

### Phase 7 — Summary

Report to user:
- What the research found
- What action was taken (PR link, or closure reason)
- Any notable findings from the code review cycle

---

## Key Constraints

- **No Tauri MCP** — the Tauri dev server is not available locally; all investigation is code search + test runner only
- **No auto-commit** — fix team implements changes but does not commit; committing is the user's responsibility
- **Single review pass** — code review runs once; no infinite review loops
- **Branch naming:** `fix/issue-<number>` (no slug, no title appended)
- **PR type:** ready for review (not draft)

---

## Files Involved

| File | Role |
|------|------|
| `~/.claude/skills/fix-github-issue/SKILL.md` | Skill definition |
| `gh` CLI | GitHub issue fetch, comment, close, PR creation |
| `npm run test:run` | Test runner for Agent B |
| `agent-teams` skills | team-debug, team-feature, team-review dispatch |

---

## Out of Scope

- Generic multi-repo support (sounds-bored only)
- Multiple review passes
- Auto-push to remote (user pushes manually)
- Tauri MCP / live app interaction
