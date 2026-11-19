---
pre_challenge: true
method: challenge-loop
branch: reclaim-8719
diff_hash: 542bd0c88edfc00ab488447421a6ff81c2998927283b02d57e67fb727e0b4f14
validation: GitHub CI is the full gate (the local suite queue was long). Focused tests from the repo root pass, including server.test.js; the #1304 failure first reported here came from running it outside the repo root (it reads files by relative path), not from main
subdir_audit: passed
timestamp: 2026-11-19T15:09:48Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at the 8-round review cap, Splinter's standing rule of 2026-10-31: cap 8 rounds unless a BLOCKER is open; none was open)
**Fixed:** every finding of rounds 1 to 7, in the commits named below | **Deferred:** the round-8 leftovers, carried on kosmos#8724 | **Asked:** 0

⚠️ **Reconstructed record.** The loop ran on 2026-11-18. Its in-session ledger did not survive the Mac's restart at
08:14 CST on 2026-11-19, before this proof could be written (GitHub credentials were down from 19:36 the night before,
so nothing could be pushed or opened). This summary is rebuilt from the per-round fix commits, whose messages name
what each round fixed, and from the round-8 leftovers posted on kosmos#8724 the same morning. Per-finding categories
and the reviewer model of each round were in that ledger and are not recoverable; they are marked unknown rather than
guessed. Rebased this morning onto main after #8719 part 1 (#8725, 0232a837d6) merged; the rebase was clean.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** unknown (ledger lost)
**Fixed (c7db5941a9):**
- [FIXED] engine/linkwindow.js: match the window by the board's name and mark the raw session (named Kosmos)
- [FIXED] engine/linkwindow.js: re-read the mark and the program after marking; take the mark off on a mismatch
- [FIXED] engine/linkwindow.js: fail closed on an unreadable tmux answer
- [FIXED] web/index.html: the dialog says Kosmos will look after the window like its own (restart, close if stopped)
- [FIXED] web/index.html: Tab trap and focus return in the dialog; a stale message clears; success said in the composer line

#### Iteration 2
**Reviewer model:** unknown (ledger lost)
**Fixed (72a72794b5, with 80d55a9997 and 40a01cd418):**
- [FIXED] engine/linkwindow.js: every tmux call targets `=session:` (measured: `=session` does not resolve for options or messages on tmux 3.6a)
- [FIXED] engine/linkwindow.js: the session's id and program pinned before the mark, compared after; the unmark's result checked
- [FIXED] engine/linkwindow.js: Windows refused before tmux is read
- [FIXED] engine/linkwindow-8719.test.js: a test drives link() through a real tmux on a private socket

#### Iteration 3
**Reviewer model:** unknown (ledger lost)
**Fixed (d09f63a022, with 22c0ef0e27):**
- [FIXED] server.js: the link route needs a fresh sign-in from a remote session (beside connect-agent)
- [FIXED] engine/linkwindow.js: the look reads the checked pane and the current mark; a mark already there refuses; a swapped session is never unmarked
- [FIXED] engine/linkwindow.js: every pane carrying the name is checked
- [FIXED] server.link-8719.test.js: fail-closed and 500 arms tested
- [FIXED] engine/linkwindow-8719.test.js: the real-tmux test isolated from ~/.tmux.conf and now catches a non-exact target (measured)

#### Iteration 4
**Reviewer model:** unknown (ledger lost)
**Fixed (b08d42602f):**
- [FIXED] engine/linkwindow.js: after the look, mark, read back and unmark by the session id the look read (measured: a replaced session's old id marks nothing)
- [FIXED] engine/linkwindow.js: the look must report the very program the board vetted
- [FIXED] engine/linkwindow.js: the mark field reads whole (a value holding a tab)

#### Iteration 5
**Reviewer model:** unknown (ledger lost)
**Fixed (754a62de05, with 4dd1d82f57):**
- [FIXED] engine/linkwindow.js: one tmux binary, the board's own
- [FIXED] engine/linkwindow.js: refuse a session with any window besides the agent (the mark covers the session, and a supervisor may later close it whole)
- [FIXED] engine/linkwindow.js: a foreign mark is its own refusal
- [FIXED] web/index.html: the page's submit is one tested function that never writes on another agent's page and keeps the button off while a request is out
- [FIXED] engine/linkwindow-8719.test.js: the real-tmux test has timeouts

#### Iteration 6
**Reviewer model:** unknown (ledger lost)
**Fixed (e9905718cf, with b13e26c82a):**
- [FIXED] engine/linkwindow.js: one window with one pane before and after the mark (session_windows x window_panes; measured: there is no session_panes on tmux 3.6a)
- [FIXED] .claude/plans/reclaim-8719.md: records the end-to-end measurement on a sandboxed board with a private tmux (refused before, linked, then no longer refused for identity)

#### Iteration 7
**Reviewer model:** unknown (ledger lost)
**Fixed (bc7bf83f79):**
- [FIXED] web/index.html: the dialog says what linking leaves undone (no board restart, the agent's own kosmos commands not yet its); the rest carried on kosmos#8724
- [FIXED] engine/linkwindow.js: a window that went away is said plainly, not as a stuck mark
- [FIXED] web/index.html: a refresh failure after a link never reports that the link failed
- [FIXED] engine/status.js: boardTmux sits apart from readerTmux's comment

#### Iteration 8
**Reviewer model:** unknown (ledger lost)
**Stopped at the cap.** Two low-risk findings, recorded on kosmos#8724 (comment of 2026-11-19 08:2x CST) rather than worked:
- [DEFERRED] engine/linkwindow.js: a comment should say the 1x1 check is what makes the active-pane fallback safe, so a later change to the check cannot weaken it quietly
- [DEFERRED] web/index.html: the link dialog's Escape handler neither stops propagation nor checks it is the topmost dialog; it does nothing unless that dialog is visible

### After the loop
Two commits after this proof's first version, both to docs/browser-checks/mobile-shots.js only (the design-shot
tool, no product code): screens `link-button-8719` and `link-dialog-8719`, so the reviewer has light and dark,
desktop and phone shots of the button and its dialog (~/work/design-shots/kosmos-8719). The diff hash above covers
them. The tool's own tests (mobile-shots-desktop, -serviceworker-6206, browser-checks reason-grep, bounded-close,
teardown-guard) pass with them.

### After the first CI run (2026-11-19 09:3x CST)
This branch's first full suite on GitHub went red on six checks main added or tightened since the review loop, none of
which the loop's local runs had covered (the full suite never ran locally). Fixed in 547dd2539d, test and layout only:
- engine/linkwindow-8719.test.js: the private tmux server is ended with an `-L` array literal (#6857's accepted shape).
- web.linksubmit-8719.test.js: the open agent is a real fleet card, not a hand-built one (fixture-discipline).
- web.modal-way-out-1316.test.js: the link confirm is in the modal table (Escape closes it), and the count is 29.
- web/index.html: the link confirm sits inside the agent panel, as #8631's Block confirm sits in the room column, so the
  body keeps its 42 auto-placed children (web.consolidated-980). It is position:fixed, so it still covers the page.
- The #2518 surface gate names 11 browser checks whose tokens (d-say, d-say-msg, msg, rm-back) sit on changed lines.
  The PR's browser-checks job runs the checks this page diff selects (#4119); the per-check record follows that run.

### Outstanding questions (ASKED)
None.

### Note on the later slice
kosmos#8724 item 1 (branch linkjob-8724, stacked on this one) changes this branch's dialog sentence "the board cannot
restart it": the board can now, after a set-up. That change rides that branch and its own review loop.
