---
pre_challenge: true
method: challenge-loop
branch: boardblock-8631
diff_hash: 4137dbe53a82ebe25a0c6b32fb54e5a7c37fd3229c3824ffaee28ecfbcf79cdb
validation: passed
subdir_audit: passed
timestamp: 2026-11-17T19:38:39Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at the operator's standing cap of 8 review rounds, one reviewer at a time; iteration 8 still
raised one WARNING, fixed after it, so no round came back clean)
**Total findings acted on:** 34 (0 BLOCKERs, 29 WARNINGs, 0 CONVENTIONs, 5+ NITs fixed; NITs not fixed are listed below)
**Fixed:** 29 | **Deferred:** 4 | **Asked (awaiting user):** 0

Diff base for rounds 1 to 8 was origin/reportblock-8625 (#8625, unmerged then); the branch was rebased onto main after
#8625 merged (7fe2533c72). Full validation ran three times: run 1 (stacked) and run 2 (rebased) each found 3 reds the
reviews had not, all fixed (see "Full-suite findings"); run 3 PASSED for this diff_hash.

Note on provenance: the rebase rewrote every commit, so the Origin column is the classification made at the time of
each round, against the then-current fix commits.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 6 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html xRowById - Report and Block on archive and search rows found no row --> FIXED
- [WARNING] web/index.html xReport - a 2000-unit cut could split an emoji and throw in encodeURIComponent --> FIXED (cut by character)
- [WARNING] web/index.html note link - focus went nowhere on a first visit to the Blocked list --> FIXED
- [WARNING] web/index.html - the Blocked list was painted only through settingsGo --> FIXED
- [WARNING] web/index.html - a comment claimed the time line grows the bubble by nothing --> FIXED (deleted; plan says 24px)
- [WARNING] browser check - xReport and the click delegation were never exercised --> FIXED (real-button arm)
- [NIT] double Report press --> FIXED; [NIT] the room note on a room switch --> FIXED; [NIT] the report line lingers; [NIT] ".." after a reason

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (pjWinReset clearing the note, from iteration 1's fix)
- [WARNING] web/index.html pjWinReset - the note was cleared on a same-room reset mid-read --> FIXED (only on a room change)
- [WARNING] web/index.html blockedPaint - a failed Unblock plus a failed re-read hid the list with no line --> FIXED
- [WARNING] web/index.html - focus lost after Block and after Unblock --> FIXED
- [NIT] closing the dialog during the request --> FIXED (pending); [NIT] plan count --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1 of the above (archive repaint, from iteration 1's archive lookup)
- [WARNING] web/index.html - Block inside the archive view left the rows on screen --> FIXED (paintArch, anchor kept)
- [WARNING] web/index.html xReport - the clipboard write lost the user activation after an await (WebKit) --> FIXED (ClipboardItem started inside the press)
- [WARNING] web/index.html - focus after Block in the archive --> FIXED (Back to the room)
- [NIT] Unblock that worked while the re-read failed --> FIXED; others recorded

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] server.js - hiddenBlocked counted archived rows for the live room --> FIXED (+ server test with control)
- [WARNING] web/index.html - a failed read leaves the note --> DEFERRED: the room already says what is shown may be behind
- [WARNING] web/index.html xBlockedOpen - 2 to 3 list reads per press --> FIXED (shared in-flight read, asserted once)
- [WARNING] web/index.html xReport - a clipboard write that never settles held the mail --> FIXED (1.5 s race)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above (held-row filter, from iteration 1's design)
- [WARNING] web/index.html - filtering held rows by hand left paging cursors naming rows the room no longer serves --> FIXED (window starts again; archive re-reads)
- [WARNING] web/index.html - a failed Unblock left its button disabled --> FIXED (+ check with control)
- [WARNING] web/index.html - Unblock's "back in your rooms" held only for the newest page --> FIXED (window reset)
- [WARNING] web/index.html - a scripted mailto may be refused by the Mac app --> DEFERRED after MEASURING: WKWebView reports a script-made link click as .linkActivated (harness), which connectLinkDecision opens
- [NIT] report line in another room --> FIXED; [NIT] 44px width --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (Unblock path from iteration 5)
- [WARNING] web/index.html - Unblock did not re-read an open archive (plan said it did) --> FIXED
- [WARNING] web/index.html - Unblock waited for the poll --> FIXED (loadRoom)
- [NIT] text arm computed the count --> FIXED; [NIT] aria-labels --> FIXED; [NIT] stray timer --> FIXED

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 7 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html - a 2xx without blocked:true read as a failure; the base had changed the phone's words --> FIXED (rebased; "could not confirm")
- [WARNING] server.js - the archive's own hidden rows vanished unexplained --> FIXED (per-view counts; the note follows the archive)
- [WARNING] browser check - the loadRoom wiring was untested --> FIXED (+ control)
- [WARNING] web/index.html - the note was not in the phone-width ResizeObserver --> FIXED
- [WARNING] web/index.html - a comment claimed behaviour the code does not have --> FIXED (reworded)
- [NIT] grapheme cut --> FIXED (Intl.Segmenter); [NIT] mailto href untested --> FIXED; [NIT] focus trap --> DEFERRED (no dialog on the board has one); [NIT] two quick Unblocks lose a line --> DEFERRED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (hiddenLive from iteration 7)
- [WARNING] web/index.html pjWinReset - another room's hiddenLive survived a room switch --> FIXED (+ check)
- [NIT] cancel focus fallback --> FIXED; [NIT] stalled sender read holds Report; [NIT] mailto after awaits (measured, see 5)

### Full-suite findings (validation runs 1 and 2, after the loop)
- web.room-window-7365 and kin lift loadRoom alone: pjBlockedNoteSet unguarded --> FIXED (typeof-guarded)
- web.survival pins the Settings line --> FIXED (own line)
- web.consolidated-980 caps the body at 42 children --> FIXED (dialog inside the room column, as pjarch-modal)
- the surface gate's 13 checks --> each run and passing; per-check trailers in the commit
- web.modal-way-out-1316's dialog table --> FIXED (row added, count 28)
- web.layout-picker and web.consolidated-980 read windows of showTab --> FIXED (the arrival read moved after paintSettings, measured to read once)

### Final Ledger (deferrals)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 4 | WARNING | web/index.html loadRoom | BRANCH | a failed read leaves the hidden line | DEFERRED | the room says what is shown may be behind |
| 2 | 5 | WARNING | web/index.html xReportSend | BRANCH | scripted mailto in the Mac app | DEFERRED | measured: linkActivated |
| 3 | 7 | NIT | web/index.html xblock-modal | BRANCH | no focus trap | DEFERRED | no board dialog has one |
| 4 | 7 | NIT | web/index.html Unblock | SELF | two quick Unblocks lose a line | DEFERRED | the list itself stays right |

### NITs (not fixed)
- the report line under the composer stays until replaced (iteration 1)
- a stalled sender read holds Report with no line (iteration 8; the board is local)

### Strengths (across all iterations)
- every outside value escaped or set as text; ids gated by the phone's x- rule before any attribute (every round)
- the phone's words and refusal rules followed line for line (rounds 2, 7, 8)
- server tests with controls for each arm; browser check presses the real buttons (rounds 4 to 8)
