---
pre_challenge: true
method: challenge-loop
branch: tasks-stroke-3949
diff_hash: cbed14bae13caab420fdfa4ed01d3a8eb78b37f9c7e9c3bce44adbf3dcf70671
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T04:03:24Z
iterations: 19
converged: true
---

# Challenge loop proof: tasks-stroke-3949 (#3949, the Tasks page from Josh's 09-26 passes)

Nineteen blind reviews, alternating Opus and Sonnet. The ledger is in the plan `.claude/plans/tasks-stroke-3949-*.md`.
Validation rc=0 and subdir audit rc=0 at c134dab51 (run 7). Runs 1-6 were each red on only one or two load-sensitive
tests the branch does not touch (#4066 x3, updating-988 x2, #4028, post-stdin-2909). Each passed alone, and none was
counted. Both browser-check gates (surface and coarse) rc=0.

## Scope
- 16:18: the outer frame was removed.
- 18:03: two bands (the ground, then white from Group by down, full width) with shaded cards.
- 18:16: empty status groups are hidden, with one line when a filter empties the list.
- 19:30: the count title ("X Tasks on N Projects"), a compact search after Sort (with "/" and Esc), and taller
  padding under the tiles.
- Josh OK'd Mona's full-page mock (Splinter, 19:44).

## Per-iteration findings
- Iteration 1 (Sonnet): 2 NEW.
  - [WARNING] The frame guard missed per-side, outline and shadow frames. FIXED.
  - [NIT] overflow: hidden. Deferred.
- Iteration 2 (Opus): 2 NEW.
  - [WARNING] The regex walker missed some spellings and false-flagged zeros. FIXED (a CSS rule walker).
  - [NIT] x3.
- Iteration 3 (Sonnet): 3 NEW.
  - [WARNING] :hover, compound classes and a brace inside a string. FIXED.
  - [WARNING] The surface token. FIXED.
  - [NIT] "0 solid". FIXED.
- Iteration 4 (Opus): 0 NEW. CONVERGED on the frame.
- Iteration 5 (Sonnet, rebased): 0 NEW.
- Iteration 6 (Opus, bands): 4 NEW.
  - [WARNING] The sticky bar is now sticky. DECIDED, and asserted.
  - [WARNING] The bottom-edge read could not fail. FIXED.
  - [WARNING] Containment in the consolidated layout. FIXED.
  - [CONVENTION] Lost commit subjects. FIXED.
- Iteration 7 (Sonnet): 2 NEW.
  - [CONVENTION] A dead "Nothing here." branch. FIXED.
  - [WARNING] The sticky check ran only for some fixture sizes. FIXED.
- Iteration 8 (Opus): 1 NEW.
  - [WARNING] Classic scrollbars in the edge reads. FIXED (clientWidth; not reproduced locally).
- Iteration 9 (Sonnet): 2 NEW.
  - [WARNING] "No tasks yet." had no test. FIXED.
  - [WARNING] No consolidated pixel reads. FIXED.
- Iteration 10 (Opus): 0 NEW. CONVERGED (5 NITs).
- Iteration 11 (Sonnet, 19:30 changes): 4 NEW.
  - [BLOCKER] "/" from inside a modal. FIXED.
  - [BLOCKER] "1 Task on 2 Projects". FIXED.
  - [WARNING] Surface tokens. FIXED.
  - [WARNING] Stale prose. FIXED.
- Iteration 12 (Opus): 4 NEW.
  - [WARNING] x4: IME Esc, a modal with body focus, zero-count wording, the tile total. FIXED or DECIDED.
- Iteration 13 (Sonnet): 2 NEW.
  - [WARNING] A door left the search open. FIXED.
  - [WARNING] The IME guard had no test. FIXED.
- Iteration 14 (Opus): 1 NEW.
  - [WARNING] "/" right after clicking the Tasks tab. FIXED.
- Iteration 15 (Sonnet): 1 NEW.
  - [WARNING] Header popovers. FIXED.
- Iteration 16 (Opus): 1 NEW.
  - [WARNING] Any aria-expanded disclosure blocked "/". FIXED.
- Iteration 17 (Sonnet): 1 NEW.
  - [BLOCKER] The burger nav focus sits on a tab. FIXED (a global check).
- Iteration 18 (Opus): 2 NEW.
  - [WARNING] A hidden expanded trigger. FIXED.
  - [WARNING] A row checkbox. FIXED.
  - [NIT] x2. FIXED.
- Validation caught one more: a test step invented an element id (the #758 meta-test). FIXED.
- Iteration 19 (Sonnet): 0 NEW BLOCKER, WARNING or CONVENTION. CONVERGED.
  - [NIT] The two empty-line conditions are asymmetric (equivalent today). Left.

## Evidence
- render-tasks-view-3559: 260 PASS. Every fix has an arm that fails without it (mutation-checked).
- render-alltasks: 31/31. render-subtasks-3861: 49/49. render-user-menu-3051: 72/72. Tasks unit tests: 42/42.
