---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: install-launch-fixes-0639
diff_hash: f3574ca88ebd7eddbeabde08c8bf02a5626c65f9d8da4f07f3e1a884cbb6a772
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T15:45:00Z
converged: true
---

## [PRE-CHALLENGE] Single-pass self-review

One pair of eyes, mine, `explicit_override: true`. Proportionate because this is a
REMOVAL of a link I added in #2267, driven by Josh's own 0.6.39 install-test ruling
(routed by Splinter with the corrected behaviour), verified by a repurposed
browser-check and the full wiring-guard set.

### What ships

The #1652/#2267 find-agents link is removed from screen-9's create arm: its render,
its delegated #fr-fleet handler, and its CSS. The create ending is silent again
("Create your first agent. / Let's get started." + the single Giddy Up). Josh's
verbatim ruling is preserved in the comment with the reversal recorded.

### Self-review

[STRENGTH] The removal is complete: no live `.fr-lookimport` remains (the one grep
hit is a removal comment), the delegated handler is gone, the CSS is gone. The
openCreate initialMode threading is kept (other callers use the import panel), so
nothing else regresses.

[STRENGTH] The browser-check now asserts the ABSENCE it should: no link, no
"Documents and Downloads" copy, on the exact empty-create state Josh saw. It keeps
its adopt control (a real fleet has no link) and its openCreate->pm control (proven
by fixing the async loadRoles wait the removed section used to cache).

[NIT] The min-checks guard dropped from 10 to 7 (four link-click assertions removed).
7 real assertions still gate a vacuous run; lowered honestly, not to dodge a failure.

No issues found that block.

### Evidence
- render-firstrun-import-1652.js: 7/7 checks pass (link absent, copy absent, both
  controls hold, no page errors).
- Wiring guards: browser-checks-indexed 1/1, reason-grep 5/5, selectors 4/4.
- server.test.js: 266/266. diff em-dash swept clean.
- The web/index.html diff carries a browser-check (render-firstrun-import) + a
  Browser-check trailer, so the #1720 gate is satisfied.

### Weakest premise

This reverts a #2267 addition that Splinter/Mona approved at the time. Josh's own
install test is the higher authority and Splinter routed the corrected behaviour, so
the reversal is authorized, not unilateral. The Documents/Downloads agents now depend
on #1 (permissions) firing a full scan - a separate launch item I am coordinating
with Kitty, flagged in the code comment.
