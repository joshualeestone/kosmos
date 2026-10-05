---
pre_challenge: true
method: challenge-loop
branch: fedscreens-4649
diff_hash: 91af26ab01dd9b4d502f2c83ae86779eccba951e70a99736fc45ab605f04dbc5
validation: passed (mortals-validate at c6899692e9, 2026-10-05 01:49 CDT: status clean, 14831 pass, 0 fail; browser check render-federation-invite-4649.js passed at 9f783a53ff, 45 PASS, control on main rc 1). FULL browser checks run on this head before merge.
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-05T06:51:06Z
iterations: 13
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 13 blind reviewers, alternating Opus and Sonnet.
**Converged:** Yes. Iteration 13 raised no BLOCKER, WARNING or CONVENTION (6 NIT; one comment NIT taken).
**Note on this ledger:** the per-round severity counts were not kept; each round below lists what it found and
what was done, from that round's commit message. Every round before 13 raised at least one actionable finding.
Validation history: run 1 (9f783a53ff) failed one test, web.room-phone-718's media-block reader, because a
comment of mine said '@media' inside the script (fixed in c6899692e9); run 2 never started (it hit the default
2700 s queue bound); run 3 passed clean.

#### Iteration 1 (f8161f90a)
- FIXED: Enter in 'Who is it for?' obeys Make's guard (a request in flight sends no second invite; auto-repeat no
- FIXED: A scroll re-places the + menu under its + (the emoji picker's pattern) instead of closing it: the room scrolls
- FIXED: Tab inside the menu closes it back to its + (the browser's own Tab jumped far from the +).
- FIXED: A code already on screen survives a passing 'signup' gate reading (one poll that reads the entitlement as
- FIXED: Arm A7: Enter x3 while asked sends one invite, composing sends none; scroll keeps the menu, Tab returns to the

#### Iteration 2 (970d084d9)
- FIXED: The sheet, which declares aria-modal, now traps Tab among its visible, enabled controls (plus-lost-modal's
- FIXED: Escape stays a way out of both steps (#1316; deliberate, unlike a stray backdrop click) and does nothing
- FIXED: Arms: A2 consolidated asserts the menu sits inside the rail with its right edge on the rail +; A6 asserts

#### Iteration 3 (55374c1fd)
- FIXED: Enter and Escape skip an IME composition the file's own way (isComposing OR keyCode 229: WebKit commits a
- FIXED: While Make is being answered the sheet does not close (Cancel, Escape, backdrop): the board may already have
- FIXED: After a refused Make, focus returns to the label (pjFieldBad's way), not <body>.
- FIXED: Comments: the menu's sub-line names the whole team (not the picker's list); gap G1 (non-owners are offered the

#### Iteration 4 (a54fba786)
- FIXED: A forced close mid-Make (federation off) clears the in-flight flag, and opening the sheet clears it too: the
- FIXED: The + menu remembers its project; the next gate stamp closes it after a project switch or when its + is no
- FIXED: The + claims a menu (aria-haspopup) only while a project is open (with none it opens the add-agent dialog).
- FIXED: FEDINV_INFLIGHT is declared early beside the menu's state (the gate can call the close).
- FIXED: The check header lists A7 to A10; arm A10 covers the forced close and the project switch.

#### Iteration 5 (fceb45ffe)
- FIXED: The sheet lives inside #panel-projects, where .panel h2 / .panel p out-rank .rm-title, .fhint, .fmsg and
- FIXED: A gate stamp that closes the menu while focus is in it refocuses the + (its items go hidden).
- FIXED: Cancel and Done call fedInviteClose() with no argument, so a click event can never arrive as force.
- FIXED: web.modal-way-out-1316: the invite-sheet entry sits above #4930's comment, so each comment is over its row.

#### Iteration 6 (63713113d)
- FIXED: Make gives up after 30 s (AbortController) and falls into 'could not reach' with Make live again: the sheet
- FIXED: Both menu items act only for the project the menu was opened on; a switch since then (a notification, a route)
- FIXED: pjAddMenuPlace closes the menu when its + is no longer on screen (no zero-rect jump to the top-left).
- FIXED: The backdrop closes the asking step only when the press also started on it (a drag-select out of the label no
- FIXED: Dropped .fedinv-box's dead max-width (.rm-box.rm-box-form out-ranks it; the sheet Mona reviewed is 34rem).
- FIXED: pjAddMenuSync notes why its PJ_CURRENT read is safe.

#### Iteration 7 (2f1f30824)
- FIXED: Make's limit is 60 s (FEDINV_MAKE_LIMIT_MS), above the board's worst case (its coordinator call gives up at
- FIXED: Make does nothing unless the gate is 'show' (a passing signup reading keeps the asking step open).
- FIXED: The phone placement uses the app's one phone width, (max-width: 40rem), not a second 600 px definition.
- FIXED: The menu's numbers are named constants (PJ_ADDMENU_WIDTH/GUTTER/GAP) with their reasons.
- FIXED: Every menu close path that hides focused items returns focus to the + (pjAddMenuCloseKeepFocus).
- FIXED: A resize re-places the menu (a phone's address bar collapsing on scroll fires resize).
- FIXED: The Tab trap engages only while the sheet is on screen. The label's maxlength names its source (LABEL_MAX).
- FIXED: Dropped the dead .fedinv-josh rule.

#### Iteration 8 (f60978fd0)
- FIXED: A timeout is decided by the abort signal, not by which await saw it: an abort during the body read (swallowed by
- FIXED: After a network failure or timeout, focus returns to the label (Make is disabled until the request settles).
- FIXED: Make under a passing signup reading says inviting is not available just now (it looked dead).
- FIXED: FEDINV_MAKE_LIMIT_MS is a let so a check can shorten it; arm A11 times a Make out and asserts the message,

#### Iteration 9 (ad702389c)
- FIXED: The timeout line no longer sends the person to check Members (slice A lists no pending codes): 'A code may
- FIXED: While Make is answered Cancel is disabled, and Escape is refused out loud ('One moment: Kosmos is making the
- FIXED: Arm A12: headers in, body stalled, abort: the signal still yields the timeout line (the stub's stream errors on
- FIXED: Shot 03's withdraw sentence is noted as slice B's; the rail's ungroup closes the menu keeping focus; menuy is

#### Iteration 10 (d3abe3629)
- FIXED: The menu closes (keeping focus) when its + scrolls out of the window, instead of staying pinned over whatever
- FIXED: The sheet's Escape stops propagation (it is aria-modal; the menu's already did).
- FIXED: Closing the sheet falls back to the rail + as well when its opener is gone.
- FIXED: The timeout line's comment states the fact rather than naming a slice.

#### Iteration 11 (c0165931a)
- FIXED: A passing 'signup' gate reading closes nothing: closing the asking step threw away a label being typed, for no
- FIXED: The Tab trap leaves out unchecked radios (the browser tabs only to a group's checked one).
- FIXED: The menu's arrow keys act only while focus is in the menu.
- FIXED: The sheet's Escape comment says what stopPropagation actually stops.

#### Iteration 12 (e54a298d0)
- FIXED: The sheet's asking step belongs to the project it was opened on: the per-stamp sync closes it after a project

#### Iteration 13 (9f783a53ff): converged
- [NIT] A7c's comment said the asking step closes on a signup reading; the arm asserts the opposite --> FIXED
- [NIT] no A3 pass for a "signup" reading opening the add-agent dialog directly --> DEFERRED (covered by the gate's CSS and fedShow; A7c covers signup with the sheet open)
- [NIT] the sheet's Escape handler checks hidden but not getClientRects --> DEFERRED (needs an unusual route; noted)
- [NIT] the menu is never flipped above a + near the window's bottom --> DEFERRED (not reachable with today's placements)
- [NIT] a short phone viewport can clip the sheet with the keyboard up --> DEFERRED (shared by every .rm-box dialog)
- [NIT] a stray blank line before FIRST RUN --> DEFERRED
- [STRENGTH] request body, in-flight and abort handling, TDZ safety, the gate in CSS and code, XSS, unit tests (17 pass)
