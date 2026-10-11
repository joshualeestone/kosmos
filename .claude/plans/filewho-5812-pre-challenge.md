---
pre_challenge: true
method: challenge-loop
branch: filewho-5812
diff_hash: ce19abf8404f52f0e8a598562c87bae27b8ab5370426f653a938afca3caba7ac
validation: passed (Mortals full suite at aeec0be58, 18777 tests, 18534 pass, 0 fail, 0 cancelled, 2026-10-10 23:29 CDT; local helper skipped on that clean entry, hash ce19abf8404f)
subdir_audit: passed
timestamp: 2026-10-11T04:30:24Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 found no new issues)
**Reviewer models:** alternating opus (odd) and sonnet (even).

Note: the loop read as converged at iteration 4 and was reopened by a defect found outside a review (the #5434
owner-only writer guard's lists, found by a sibling branch's review), then by iteration 5's findings. Each review's
findings and dispositions are recorded in .claude/plans/filewho-5812.md ("Review N" sections), copied here.

Note on 6.0: no local full suite (the shared Agent1s queue); the full suite ran once at convergence on Mortals.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- FIXED: the "never a guess" claim was false inside the window (a failed edit's record); the window is 2 minutes and
  the plan states both ways it can be wrong.
- FIXED: the token-only narrowing on the keep route is tested through the server (an agent cannot note a write in
  another agent's name; its own is noted).
- FIXED: the agent lookup is paid only for a file inside a project (noteWrite takes a lazy lookup).
- DEFERRED: a lock on the per-project file. noteWrite is synchronous in the one board process, so two hook calls cannot
  interleave its read and write.
- NITs taken: the display name read once per request; the deepest project folder wins; realpathSync.native for the
  letter case on macOS.

#### Iteration 2
**Reviewer model:** sonnet
- FIXED: every edit read all projects and resolved their folders; the resolved roots are kept for 10 s (a project made
  less than 10 s before an edit names nobody for that edit), and the same agent again within 5 s does not rewrite the
  record.
- FIXED: a Write that creates new folders fell back to the unresolved path, so a project reached through a link missed
  it; the deepest folder that exists is resolved and the rest joined back (tested through a link).
- Duplicate of review 1: "changed by" is approximate; the weakest premise above states how.
- Not taken: removing a deleted project's record (bounded by 30 days and 2000 entries); the route's extra try/catch.

#### Iteration 3
**Reviewer model:** opus
- DECIDED, not built: the writer is not checked against the project's members. A token-only agent can name only
  itself, and an agent writing in a project it is not on did make that change; a board-token caller can name anyone,
  the trust the keep route already has. What would change it: a report of agents named for projects they never worked
  in.
- FIXED (in the premise above): a person's save within the window is named for the agent.
- Duplicate of review 2: the cost on the hook path (now bounded by the roots cache and the rewrite skip).
- NITs taken: records have no prototype (a file named __proto__ is kept; tested); one loop resolves the roots; the
  constants sit together; ownedBy's comment describes the function.

#### Iteration 4
**Reviewer model:** sonnet
- NO NEW ISSUES (the loop read as converged here).

**Found after iteration 4 (not by a reviewer):**
- FIXED: engine/filewriters.js is an owner-only store writer (writeSecret at 0o600) and was not in the #5434 writer
  guard's lists; it is now in both, so a later switch to a loose save is caught.

#### Iteration 5
**Reviewer model:** opus
- FIXED: the writer note ran before undo.keep on the hook's path (the hook waits at most 3 s before the edit), so a slow
  write could make the undo copy miss it; the note now runs after the answer is sent.
- NIT taken: a top-level file named '..notes.md' is inside the project (tested). Not taken: the Files row's width for a
  long name (the row is the existing one; design shots are for a layout change); the preview header showing the same
  line; repeating the plan's premise in the module comment.

#### Iteration 6
**Reviewer model:** sonnet
- NO NEW ISSUES (the loop read as converged here).
