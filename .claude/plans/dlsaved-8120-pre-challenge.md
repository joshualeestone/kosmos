---
pre_challenge: true
method: challenge-loop
branch: dlsaved-8120
diff_hash: 221073a2761dcfdb882a64dba0faa292b013ca2b9fa4e5004b26fd6da77277dd
validation: passed
timestamp: 2026-11-06T22:46:33Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the 8-round cap (standing instruction to all Kosmos builders, Splinter 2026-10-22: past 8, continue only while a BLOCKER is open). The final round (8, whole branch) raised no BLOCKER; its two WARNINGs were fixed.
**Total findings:** 5 BLOCKERs, 39 WARNINGs, 5 CONVENTIONs, 46 NITs (summed from the per-iteration headers below)
**Fixed:** every BLOCKER and every WARNING except as marked; **Deferred:** named below and in the plan's Not in this branch / Known limits; **Asked (awaiting user):** 0

**ITER_COMMITS:** the eight round commits are on branch dlsaved-8120-presquash (pushed; head 4a6850202b): bfeb8f2566, db190c96ef, 8f56839a1f, c5b61a2075, 01f9978285, edf3d33d52, 5a7891817c, c20fd36eab. This branch was then squashed to one commit (ee766921fd) and rebased once onto main, to resolve a conflict with #8121 (Always Allow) and #8118 (reopen) in native-app/main.swift in one place; then rebased again (b307e48ac9) after main reverted #8121 before the 0.7.95 cut: the selftest counts main's 39 rows plus this branch's 10 (49), and mayDownload has this branch's willAsk with no Always Allow. After the second rebase: download selftest 49 of 49, related suites 256, render-file-preview-4930 97 on Chromium and WebKit.

**Measured outside the suite:** the download selftest in a real WKWebView, 48 of 48 rows (keyed answers, asking only when the person is really asked, a refusal before any download, a frame's keyed download never told, every answer running in the page, Show in Finder by origin and only for a whole-number id). render-file-preview-4930 97 pass on Chromium and on WebKit (Playwright's WebKit makes no download for a script click, so its address rows are judged on Chromium). Each round's new rows were run against the previous round's page as a control and failed on the cases they name.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 2 BLOCKERs, 8 WARNINGs, 2 CONVENTIONs, 6 NITs
- [BLOCKER] a refused download stuck on Saving and blocked the retry --> FIXED: answers matched by the page's own key (kdl)
- [BLOCKER] oldest-click matching credited saves to the wrong click (a folder zip, out-of-order answers) --> FIXED: same
- [WARNING] x8 (the name to another page, reveal by any page, pre-download refusals silent, a second copy by row clicks or a redraw, the note erased, an older saved over a newer refusal, no page test, no reveal test) --> FIXED
- [CONVENTION] x2, [NIT] x6 --> FIXED, except the pv-dup recheck (fixed in iteration 2)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 6 WARNINGs, 2 CONVENTIONs, 5 NITs
- [BLOCKER] a click on Saved started a second copy and could leave the button stuck on Saved --> FIXED: busy until the button is back; its label captured once
- [WARNING] x6 (backstop, ignored click silent, guessable key, dead Finder button, delivery untested, tunnel unverified) --> FIXED; the tunnel read from kosmos-relay proxy.rs (strips only token and boot), named as a limit
- [CONVENTION] x2, [NIT] x5 --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 6 WARNINGs, 0 CONVENTIONs, 9 NITs
- [BLOCKER] the Finder button could not be reached with Tab --> FIXED: the trap covers the action row
- [WARNING] x6 (reopen after saved said Saving, adopted button stuck, Already saving lingering, a long save saved twice, refusal in the good-news colour, layout measured only on a picture) --> FIXED, with layout rows for a PDF page, a 200-line text and a file card
- [NIT] x9 --> FIXED, except: asking sent on every click (fixed in iteration 5); response paths reading the key from any frame (fixed in iteration 5)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 6 NITs
- [WARNING] x5 (timers: a dropped answer busy for ever, Saving while asking, a slow server allowing a second copy; tests that could not fail; Already saving on a second line) --> FIXED: 2 min with no answer, 30 min ceiling with an honest line, no Saving while asking, revealId with rows
- [CONVENTION] the revealfailed listener separate --> KEPT (each listener does one thing)
- [NIT] x6 --> FIXED, except the Finder button outliving the restore (kept by design: until the viewer closes)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 6 NITs
- [WARNING] asking on every click --> FIXED: willAsk, only when the question is really up
- [WARNING] a busy button without an accessible name --> FIXED: Saving <name>, Waiting for your answer to save
- [WARNING] a frame's download could carry a key --> FIXED: the key is taken at the start, main frame only
- [WARNING] layout untested on a tall picture --> FIXED: an 800 x 3000 picture on desktop and phone, both engines (it fits with no CSS change; an apparent WebKit overflow was the check measuring mid zoom-in)
- [NIT] x6 --> FIXED, except the selftest's unread listener (removed in iteration 3)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 5 NITs
- [WARNING] two rows in one list hid the first one's saved --> FIXED
- [WARNING] a redirected response loses the key --> DEFERRED: named as a known limit (the board does not redirect downloads; the 2-minute timer covers it)
- [WARNING] the refused-download branch read the key from any frame --> FIXED
- [WARNING] asked, then silence, spun for ever --> FIXED: the 30-minute ceiling
- [WARNING] pins accepted the old form --> FIXED: they require the new wiring (control reds)
- [NIT] x5 --> FIXED, except .pv-msg:empty (kept: hiding a live region can stop its announcements)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
- [BLOCKER] a viewer opened again mid-save had no line, so its saved news never came --> FIXED: it takes its own line
- [WARNING] x3 (a list line left on Saving, saved over an error, a silent second click) --> FIXED
- [NIT] x6 --> FIXED (port 443 origin, a frame's keyed download measured live) or named in the plan's limits (modifier clicks, a save outliving the ceiling, the rail's note)

#### Iteration 8
**Reviewer model:** sonnet, whole branch, final
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] a reopened viewer's line stayed empty --> FIXED: Saving or saved in its own line
- [WARNING] a board silent for 2 minutes then saving --> DEFERRED: named as a known limit
- [NIT] x3 (the saved event before the quarantine mark; the delivered count being asynchronous; a redrawn list button not marked busy) --> KEPT: ordering only; the verdict runs well after the waits; a documented limit

**Final validation:** passed at b307e48ac9 after the second rebase (validation-log: PASSED, hash 221073a2761d): 27,657 tests, 27,227 pass, 0 fail, 430 skipped. (After the first rebase it had passed too, at ee766921fd: 27,655, 0 fail.) Before the rebases (at c20fd36eab) the one red was tools.shell-shard-4317, the browser-check surface gate, which found two checks covering surfaces this branch changed and not touched by it; answered by the Browser-check-surface trailers on the squashed commit, each check run first on Chromium and WebKit: render-dialog-gutter-4506 52 passed on each, render-files-preview-4997 106 pass on each.
