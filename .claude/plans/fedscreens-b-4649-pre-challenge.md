---
pre_challenge: true
method: challenge-loop
branch: fedscreens-b-4649
diff_hash: a3000224db90c7f3afd7e6de68b6edd2732f8182b6cdc4e233855020bf3dc784
validation: passed (mortals-validate at bc3fd8215a 2026-10-05 07:36 CDT: clean, 15035 pass, 0 fail; browser check render-federation-invite-4649.js at bc3fd8215a 116 PASS, control on main rc 1). Since then only main merged in (slice A squash, #5150, #5209, #5112, #5073, #5064) plus plan files; 2393/2393 page tests on the merged head.
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-05T13:09:20Z
iterations: 28
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 blind rounds before slice A's latest head was merged in (converged at round 10), then 18 blind
rounds on the merged branch (converged at round 18; nits only, two taken). Opus and Sonnet alternated.
**Note on this ledger:** per-round severity counts were not kept; each round lists what it found and what was done,
from that round's commit message.

#### Pre-merge iteration 1 (92f3e21d2)
- FIXED: A 404 from the members route (before #5266 merges: no such endpoint; or a project not on this computer)
- FIXED: checked_at null: the board then reports a joined person as pending or expired, so the page offers no
- FIXED: Remove's answer is dropped when another project was opened meanwhile (fedWithdraw already did this).
- FIXED: A sentence said under the list is cleared by the next action, instead of staying for the whole visit.
- FIXED: A failed members load is asked again on a later gate stamp, at most every 30 s.
- FIXED: Withdraw's 404 asks the list again.

#### Pre-merge iteration 2 (77538350d)
- FIXED: A members load that throws now records its time, so the 30 s retry holds (it re-asked on every poll).
- FIXED: The could-not-check line needs visible rows: withdrawn/removed-only answers draw nothing.
- FIXED: Remove's dialog is reset when another project was opened while it was asked.

#### Pre-merge iteration 3 (8f160f41b)
- FIXED: Another project opened mid-Remove now CLOSES the dialog (it was left open on the old project).
- FIXED: Remove repaints its row as busy and refuses a second open while one is asked (no double POST).
- FIXED: An unchecked answer (checked_at null, with rows) is asked again after 30 s, like a failed one.
- FIXED: The confirm body names the person by first name only when the label reads as a name; 'my sister',
- FIXED: New arms B10a (names), B10b (project switch mid-Remove, via a stub delay) and B10c (the 30 s retry),

#### Pre-merge iteration 4 (3edc831e4)
- FIXED: A code made while the invite sheet was closed or reopened still refreshes the From outside list.
- FIXED: Row actions carry an accessible name ("Withdraw Lee Park"); after Withdraw, focus returns to the
- FIXED: The confirm body's possessive uses a curly apostrophe like the rest of the app's copy.
- FIXED: FED_NOT_CHECKED / FED_UNREACHABLE move up beside the section's other state (the comment says early).
- FIXED: Arms: B10b counts only project-k asks; B11a Withdraw pressed in the consolidated rail; B11b the gate

#### Pre-merge iteration 5 (48c99f3dc)
- FIXED: Remove's failure path repaints, so the row's Remove is live again; the shared dialog's close falls back to
- FIXED: A successful Withdraw refocuses after the refetch.
- FIXED: Refusals are also said in one persistent visually-hidden live region (fedSay): regions rebuilt with their
- FIXED: A checked answer is asked again every 60 s (unchecked or failed: 30 s), so someone who joins while the
- FIXED: fedInviteMake's success refetch has the same open-project guard as its stale path; fedInviteClose falls
- FIXED: Arm B12 goes through fedGateStamp itself: gate off asks nothing, the stamp to show asks once and draws,

#### Pre-merge iteration 6 (44bb41465)
- FIXED: A failed refresh keeps the last good answer for the project, marked unchecked (rows kept, spec), which also
- FIXED: shared (Ice Cream Kitty, 18:18, coming in a follow-up to #5266): an unchecked answer with no rows but
- FIXED: Refusals are spoken once, by fedSay; the painted sentences no longer carry aria-live.
- FIXED: fedRefocus only takes focus back when the repaint dropped it (body) or it is still in the section.
- FIXED: The 60 s refetch is skipped while the tab is hidden.
- FIXED: Arms: B5 (shared on/off, a failed refresh keeps rows, a failed first load), B13 (a local minus after a

#### Pre-merge iteration 7 (275084cc5)
- FIXED: A gate stamp to show that needs no ask repaints the section (off then show again left the tab blank).
- FIXED: fedRefocus also takes focus back from the Remove dialog that is closing (focus leaves it later, not at once).
- FIXED: Withdraw's 409 joined and 404 refocus AFTER the refetch, since the row's key changes or the row goes.
- FIXED: The members GET gives up after 20 s (AbortController), so one hung request cannot stop every later ask.
- FIXED: Withdraw's 409 joined shows the board's sentence as given; the page's copy is only the no-sentence fallback
- FIXED: The announcer region is made at load. The gate comment describes the refetch cadence it drives.
- FIXED: Arms: B11b closes the dialog through fedGateStamp(OFF); B12 adds off-then-show-again redrawing without a

#### Pre-merge iteration 8 (ce3fd3d83)
- FIXED: The 20 s abort covers the body read too (the timer is cleared only after json()), so a stalled body cannot
- FIXED: A successful Remove marks that edge removed in the kept answer, so a failed refetch cannot bring the person back.
- FIXED: The lapse date is added only to a sentence ending 'lapses.'; other wording is shown as given (unit assert).
- FIXED: The consolidated rail repaints only when the section's markup changed, not on every 60 s refetch.
- FIXED: pjFedMessage's two slice B comments sit beside their own lines.

#### Pre-merge iteration 9 (46cd0de36)
- FIXED: The consolidated rail is rebuilt on every status poll; a focused outside action is found again by its row key
- FIXED: A board with no agents of its own still lists the project's people from outside in the consolidated rail
- FIXED: A successful Remove or Withdraw repaints at once (the row goes now, not when the refetch answers), and
- FIXED: The rail repaint comment no longer claims the poll does not rebuild the rail.

#### Pre-merge iteration  (462eb8be0)
- FIXED: The control could not fail: no launch file was written for the Claude agent, so it had no account and the
- FIXED: The comment says OpenAI is left out of /api/status on purpose, so an OpenAI key account is named by its key
- FIXED: Arm 12 leaves the page on a real agent even when there was no previous one; a stray EOF blank line removed.
- FIXED: On one panel the 'Right now' line said '(b)' while the Move dropdown just below said 'API key ending 9999' for
- FIXED: Correction to the previous commit's message: the server test's Claude control pins the Claude row being chosen,
- FIXED: Comments that said a.account is resolved against the Claude list only now say Claude plus Gemini and Grok;
- FIXED: acctParenthetical's header and the runs-on paint comment name the order: name, email, API key, then slug.
- FIXED: The server test adds a dir-less codex agent beside Claude, Gemini and Grok defaults: it must get no row (OpenAI's
- FIXED: Plan: review 7's Move-dropdown WARNING is recorded as not an issue, with the reason (acctMoveWorld already

#### Pre-merge iteration  (6ebbeca4d)

#### Pre-merge iteration 1 (00c7105fc)

#### Pre-merge iteration 2 (e9c480599)

#### Pre-merge iteration  (5213adc89)

#### Pre-merge iteration  (3614cc830)

#### Pre-merge iteration  (999d9ed96)
- FIXED: Enter in 'Who is it for?' obeys Make's guard (a request in flight sends no second invite; auto-repeat no
- FIXED: A scroll re-places the + menu under its + (the emoji picker's pattern) instead of closing it: the room scrolls
- FIXED: Tab inside the menu closes it back to its + (the browser's own Tab jumped far from the +).
- FIXED: A code already on screen survives a passing 'signup' gate reading (one poll that reads the entitlement as
- FIXED: Arm A7: Enter x3 while asked sends one invite, composing sends none; scroll keeps the menu, Tab returns to the
- FIXED: The sheet, which declares aria-modal, now traps Tab among its visible, enabled controls (plus-lost-modal's
- FIXED: Escape stays a way out of both steps (#1316; deliberate, unlike a stray backdrop click) and does nothing
- FIXED: Arms: A2 consolidated asserts the menu sits inside the rail with its right edge on the rail +; A6 asserts
- FIXED: Enter and Escape skip an IME composition the file's own way (isComposing OR keyCode 229: WebKit commits a
- FIXED: While Make is being answered the sheet does not close (Cancel, Escape, backdrop): the board may already have
- FIXED: After a refused Make, focus returns to the label (pjFieldBad's way), not <body>.
- FIXED: Comments: the menu's sub-line names the whole team (not the picker's list); gap G1 (non-owners are offered the
- FIXED: A forced close mid-Make (federation off) clears the in-flight flag, and opening the sheet clears it too: the
- FIXED: The + menu remembers its project; the next gate stamp closes it after a project switch or when its + is no
- FIXED: The + claims a menu (aria-haspopup) only while a project is open (with none it opens the add-agent dialog).
- FIXED: FEDINV_INFLIGHT is declared early beside the menu's state (the gate can call the close).
- FIXED: The check header lists A7 to A10; arm A10 covers the forced close and the project switch.
- FIXED: The sheet lives inside #panel-projects, where .panel h2 / .panel p out-rank .rm-title, .fhint, .fmsg and
- FIXED: A gate stamp that closes the menu while focus is in it refocuses the + (its items go hidden).
- FIXED: Cancel and Done call fedInviteClose() with no argument, so a click event can never arrive as force.
- FIXED: web.modal-way-out-1316: the invite-sheet entry sits above #4930's comment, so each comment is over its row.
- FIXED: Make gives up after 30 s (AbortController) and falls into 'could not reach' with Make live again: the sheet
- FIXED: Both menu items act only for the project the menu was opened on; a switch since then (a notification, a route)
- FIXED: pjAddMenuPlace closes the menu when its + is no longer on screen (no zero-rect jump to the top-left).
- FIXED: The backdrop closes the asking step only when the press also started on it (a drag-select out of the label no
- FIXED: Dropped .fedinv-box's dead max-width (.rm-box.rm-box-form out-ranks it; the sheet Mona reviewed is 34rem).
- FIXED: pjAddMenuSync notes why its PJ_CURRENT read is safe.
- FIXED: Make's limit is 60 s (FEDINV_MAKE_LIMIT_MS), above the board's worst case (its coordinator call gives up at
- FIXED: Make does nothing unless the gate is 'show' (a passing signup reading keeps the asking step open).
- FIXED: The phone placement uses the app's one phone width, (max-width: 40rem), not a second 600 px definition.
- FIXED: The menu's numbers are named constants (PJ_ADDMENU_WIDTH/GUTTER/GAP) with their reasons.
- FIXED: Every menu close path that hides focused items returns focus to the + (pjAddMenuCloseKeepFocus).
- FIXED: A resize re-places the menu (a phone's address bar collapsing on scroll fires resize).
- FIXED: The Tab trap engages only while the sheet is on screen. The label's maxlength names its source (LABEL_MAX).
- FIXED: Dropped the dead .fedinv-josh rule.
- FIXED: A timeout is decided by the abort signal, not by which await saw it: an abort during the body read (swallowed by
- FIXED: After a network failure or timeout, focus returns to the label (Make is disabled until the request settles).
- FIXED: Make under a passing signup reading says inviting is not available just now (it looked dead).
- FIXED: FEDINV_MAKE_LIMIT_MS is a let so a check can shorten it; arm A11 times a Make out and asserts the message,
- FIXED: The timeout line no longer sends the person to check Members (slice A lists no pending codes): 'A code may
- FIXED: While Make is answered Cancel is disabled, and Escape is refused out loud ('One moment: Kosmos is making the
- FIXED: Arm A12: headers in, body stalled, abort: the signal still yields the timeout line (the stub's stream errors on
- FIXED: Shot 03's withdraw sentence is noted as slice B's; the rail's ungroup closes the menu keeping focus; menuy is
- FIXED: The menu closes (keeping focus) when its + scrolls out of the window, instead of staying pinned over whatever
- FIXED: The sheet's Escape stops propagation (it is aria-modal; the menu's already did).
- FIXED: Closing the sheet falls back to the rail + as well when its opener is gone.
- FIXED: The timeout line's comment states the fact rather than naming a slice.
- FIXED: A passing 'signup' gate reading closes nothing: closing the asking step threw away a label being typed, for no
- FIXED: The Tab trap leaves out unchecked radios (the browser tabs only to a group's checked one).
- FIXED: The menu's arrow keys act only while focus is in the menu.
- FIXED: The sheet's Escape comment says what stopPropagation actually stops.
- FIXED: The sheet's asking step belongs to the project it was opened on: the per-stamp sync closes it after a project

#### Merged-B round 1 (b48b03ba9)
- FIXED: A Make given up on (A's time limit) says a code may still have been made, so the From outside list now asks
- FIXED: B7b: a reply landing after a forced close (the gate leaving show and returning) still has the list asked again

#### Merged-B round 2 (f8cf0263e)
- FIXED: Remove and Withdraw are given up on after FED_ACT_LIMIT_MS (60 s, as Make): a request that never settled kept
- FIXED: A Remove that Cancel did not stop (Cancel closes the dialog; the request goes on) says it went through beside
- FIXED: The tab view keeps focus across a rebuild (a background refetch, another row's answer), as the rail does; a
- FIXED: The remove/withdraw stub honours the abort signal like a real fetch. Arms B15a-g: tab and rail focus across a

#### Merged-B round 3 (947deff11)
- FIXED: fedRefocus skips a disabled button (its row still being asked) for the +; Remove's answer after a Cancel
- FIXED: A Remove given up on closes the dialog and says so beside the list, which is asked again, instead of offering
- FIXED: The row buttons' names read 'Remove Dana Ruiz', 'Withdraw the code for Lee Park', 'Make a new code for Old Friend'.
- FIXED: Unit tests for the rows from the page's own functions: which show (the expired-row dedupe, withdrawn and
- FIXED: Deferred, with the reason in a comment: a failed refresh that kept an answer with no rows says nothing.

#### Merged-B round 4 (a42921c7a)
- FIXED: A late answer never pulls focus out of an open dialog (another Remove, a local minus): fedRefocus stands down
- FIXED: A busy row's button is aria-disabled, not disabled, so the rebuilt button keeps focus while it is asked (a
- FIXED: Remove's timed-out and 404 paths focus after the list is asked again, as Withdraw does, so focus is not left on
- FIXED: Withdraw's 409 joined sentence moves under the row it now is (keyed by its connection) and focus follows.
- FIXED: fedSay's hidden region uses the page's .vh rule; the timeout sentence no longer says 'below'; unlabelled rows'
- FIXED: B1 and B15f's one-line test also fails on a name or date cut short by an ellipsis.

#### Merged-B round 5 (f65ab898b)
- FIXED: Remove and Withdraw get owner-list sentences (pjFedMessage opts.change): 'Only the owner of this project can
- FIXED: A refused Remove with the dialog open puts focus back on its Remove button, which was disabled while asked.
- FIXED: B15i: a Remove nobody answers closes the dialog, says so beside the list, asks the list again, places focus.

#### Merged-B round 6 (574a653c5)
- FIXED: The dialog's Remove: focus moves to Cancel before Remove is disabled, so it is not dropped to <body> behind the
- FIXED: Dropped the opts.change 'expired' sentence and the expired entries in the reload lists: neither board route
- FIXED: fedRefocus no longer skips disabled row buttons (they are aria-disabled now); its comment says so.
- FIXED: B16: owner:false and self_shared draw nothing even with invites in the answer (control: the same as owner).
- FIXED: Stated on the card, not changed here: the could-not-check line for create-screen joiners depends on the board's

#### Merged-B round 7 (0d666d6c5)
- FIXED: A rail 'Make a new code' whose button a poll rebuilt while the sheet was open: Cancel returns focus to that
- FIXED: Remove and Withdraw get their own self-shared sentence ('...its outside members cannot be changed here.');
- FIXED: Decided, unchanged: a FIRST members load that fails shows the could-not-check line before ownership is known.

#### Merged-B round 8 (64b26f7f2)
- FIXED: BLOCKER fixed: fedInviteClose's row-key fallback takes only a VISIBLE button. In the consolidated layout the
- FIXED: An expired row goes only once a NEWER code with its label (made at or after it) is pending or joined; an older
- FIXED: A Remove refused as not-owner or self-shared closes the dialog and says it beside the list, which is asked again
- FIXED: An unlabelled row's Remove is 'Remove them' (kind-neutral, as the dialog's button).
- FIXED: Arm IDs are unique: the no-agents rail arm is B17; B16 is listed in the header.
- FIXED: Slice A's comment said the shot 03 withdraw sentence comes with slice B; slice C adds it, and the comment says so.

#### Merged-B round 9 (214b518a7)
- FIXED: A Remove or Withdraw answered after the project was left and reopened (A, B, A) is dropped: FED_GEN is bumped
- FIXED: fedRefocus also stands down while the invite sheet is open (it is a dialog too).
- FIXED: The timeout sentence reads 'Check the list to see whether it went through.'
- FIXED: Arms for outcomes that had none (B18): a first members load the network drops, Remove 403, Remove not-owner end

#### Merged-B round 10 (c5a660f71)
- FIXED: The generation guard now covers the common way out: back to the projects list, then the SAME project reopened.
- FIXED: After each awaited reload, Remove and Withdraw re-check the generation as well as the project before placing

#### Merged-B round 11 (1acf61dea)
- FIXED: openProject resets the From outside list BEFORE its first paint, not after: re-entering a project no longer shows
- FIXED: B18f could not fail on the guard (with the dialog open a 502 writes #mem-msg, not FED_MSGS). It now asserts what

#### Merged-B round 12 (30f2a92b5)
- FIXED: fedMembersReset also drops a members ask still in flight (FED_MEMBERS_SEQ++, FED_MEMBERS_ASKING cleared), so the
- FIXED: It clears the rail's markup memo, so a reopened project's first answer repaints the rail even when it matches
- FIXED: A dropped Remove or Withdraw answer in the SAME project, reopened, repaints, so that row's button is live again at
- FIXED: Comment fixes: the no-agents rail block names B17; a noise comment on the self-shared line removed.

#### Merged-B round 13 (561681392)
- FIXED: A not-owner or self-shared refusal whose reload says this board is not the owner hides the section, but its
- FIXED: Only 'hidden' closes an open outside Remove: a passing 'signup' reading (one poll) left it alone, as slice A's
- FIXED: fedMembersLoad resets only for ANOTHER project's answer (openProject already reset on entry), so an entry no

#### Merged-B round 14 (d5d5ffe43)
- FIXED: Remove pressed during a passing 'signup' reading (the dialog stays open then) sends nothing and says 'Removing is
- FIXED: memConfirmClose focuses its opener only when it is visible: when 'hidden' closes an outside Remove, the row's
- FIXED: After a refusal with the dialog open, focus stays on Cancel (where it moved before Remove was disabled), so Enter
- FIXED: A Remove retry clears its row's earlier sentence, as Withdraw does.
- FIXED: B13 dirties the dialog by hand before the local minus, so only openMemModal's own reset can pass it.

#### Merged-B round 15 (292f58de1)
- FIXED: The Remove dialog names a first name only for a PERSON: an agent's or a computer's label ('Work laptop',
- FIXED: pjFedMessage shows the board's 'joined' and 'unsupported' sentences only for Remove and Withdraw (opts.change);
- FIXED: fedSay keeps one pending sentence: a second call within 50 ms replaces the first instead of racing it.

#### Merged-B round 16 (e3ad649f8)
- FIXED: The owner's 'Someone already joined with this code. Remove them instead.' is no longer in pjFedMessage's shared
- FIXED: fedRemoveGo clears loose sentences only after its gate check, so a press that sends nothing leaves them.
- FIXED: 'Make a new code' is offered only on a row with an invite_id (a row with none has no key of its own).
- FIXED: The arm index lists B11c and B18h and describes B5 and B10b as they run.

#### Merged-B round 17 (545c46ce8)

#### Merged-B round 18 (a70e2cc5c)
- FIXED: Unit test: a code made in the same second as an expired one counts as newer (mutant >= to > goes red).
- FIXED: The failed-refresh comment names its shared:true exception.
- FIXED: Not changed, decided: the members list is still asked while another tab is shown with a project open (requests

#### Merged-B round 18: converged
- [NIT] a code made in the same second as an expired one counts as newer --> FIXED (unit test; mutant >= to > red)
- [NIT] the failed-refresh comment omitted its shared:true exception --> FIXED
- [NIT] the members list is still asked while another tab is shown --> DEFERRED (requests only, no harm)
