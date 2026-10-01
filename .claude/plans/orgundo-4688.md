# orgundo-4688: a team created while the person left the panel keeps its Undo (kosmos#4688)

Was stacked on newagent-4556 (PR #4625, now merged); rebased onto main 2026-09-30 evening.

## The defect
A create still being answered when the person leaves the panel (Back to the three-way choice, or closing the panel)
was superseded: its late answer painted nothing, and the next open of the panel ran resetOrgchartPreview, which
emptied ORGCHART_CREATED and hid Undo. Up to 50 agents made with no Undo on the screen that made them.

## The call
- **A created team's Undo stays until it is used or a new batch replaces it.** resetOrgchartPreview no longer
  empties ORGCHART_CREATED; it clears the preview and the file flow as before, then orgchartRestoreCreated paints the
  last create's result (count, list, message) and its Undo. A fresh Preview or a file read still empties it (a new
  batch), and Undo itself empties what it removed.
- **A superseded create records its result.** It works out the same count, list and message as text, stores
  ORGCHART_CREATED and ORGCHART_RESULT, and paints only if the panel is open again and idle (no preview, no file
  read, no Undo running). A superseded create that made nothing replaces nothing.
- The same rule for a normal create then close and reopen: the reopen used to clear its Undo too. One rule is simpler
  than a special case for the in-flight one, and the card asks "until it is used or dismissed".

## Rejected
- Keeping Undo only for the in-flight case: two rules for one state.
- Painting a late answer over whatever the person reopened to (a new preview): it would replace their new batch.

## Weakest premise
That nothing depends on a reopened panel being blank after a create. Searched: no browser check or unit test pins it;
the one related check (CLOSE AFTER CREATE) expects Undo kept, which this extends.

## Proof (browser check render-orgchart-file-4559, new arms)
- LEAVE DURING CREATE, REOPENED: the team made after the person left comes back with its result and Undo.
- CONTROL: a fresh Preview after the reopen drops the old Undo.
- REOPEN BEFORE THE ANSWER: the create is held; the person is back in the idle panel; the late answer paints there.
- CLOSE, REOPEN AFTER CREATE: a normal create, close, reopen: Undo still offered.
Each must fail on the base (main before this branch) and pass here; run on a quiet Mac.

## Blind review round 1 (Sonnet): no blocker; two warnings, both fixed
- The case that matters most (a late OLD create overwriting a NEWER batch's list, so Undo reaches the wrong agents)
  was traced and is safe: while a create is answering, Preview, file reads and consent all wait.
- [WARNING] an Undo left mid-run kept all 7 in the list, so a reopen offered "remove these 7" for agents already
  removed. FIXED: orgchartUndoLeftMidRun drops the ones answered `removed` and rewrites the kept result, only while the
  kept list is still the one that run started from. New arm: UNDO LEFT MID-RUN, REOPENED.
- [WARNING] the kept list now outlived the panel session, and Undo removes by NAME, so a same-named agent made later
  could be reached. FIXED: a reopen restores it for 15 minutes after the create (ORGCHART_UNDO_KEEP_MS), then drops
  it. Weakest premise now: a same-named agent re-made inside those 15 minutes. The page holds no agent list to check
  names against; stated rather than solved.
- [NIT] the control arm also passes on the old code: by design (it pins that a new batch still drops Undo). Its
  needless wait removed.
- [NIT] the post-create paint and orgchartRestoreCreated share about ten lines: left, they agree today.

## Challenge loop after the rebase, iteration 1 (Opus): three warnings, two conventions, all fixed
- A late Undo answer landing while the person was BACK in the panel left the reopened result stale ("remove these 7"
  with 4 gone). orgchartUndoLeftMidRun now repaints an open, idle panel (the late-create path's rule). New arm:
  UNDO LEFT MID-RUN, BACK BEFORE THE ANSWER.
- The 15-minute expiry had no arm and ran only on a reopen. One helper (orgchartDropExpiredUndo) now runs on reopen,
  on Undo, and on Remove; Undo pressed past the window says so and asks nothing. Arms: CONTROL at 14 minutes,
  EXPIRED ON REOPEN and EXPIRED ON SCREEN at 16. The window is measured from the create, not from the last showing.
- Two comments said a reopen resets; corrected. NITs taken: a fixed 800 ms wait is now a wait on the state; the
  all-removed result that could never be painted is gone (ORGCHART_RESULT null); Keep them restores the result's
  own message, as a reopen does.

## Iteration 2 (Sonnet): three warnings, fixed or documented
- An Undo the person left could still shrink the kept list under a NEW Undo ask opened after reopening. Fixed with
  ORGCHART_UNDO_RUN: each ask and each removal run takes a number, and a left run changes the list only if no newer
  Undo has started. (First try was `|| ORGCHART_UNDO_BUSY`; rejected before commit: Back and closing the panel bump
  ORGCHART_GEN without clearing ORGCHART_UNDO_BUSY, so the left run would always have skipped.) New arm: UNDO AGAIN
  BEFORE THE OLD ANSWER. It is an absence check, so it waits on the held DELETE's response plus 500 ms; reasoned to
  fail without the counter (the old run's list is still ORGCHART_CREATED), to be shown in the control run.
- The late-create overwrite's safety (no newer batch can exist) is now stated at the code, naming its guards: Preview,
  choosing a file and reading one return early while ORGCHART_CREATING.
- Second weakest premise: "Back to the list" after a create is NOT a dismissal. It hides the box; a later close and
  reopen within 15 minutes shows the result and Undo again. Consistent with "until used or replaced"; stated, not
  changed. What would change it: Josh or Mona saying Back to the list should end the Undo.
- REOPEN BEFORE THE ANSWER now waits on ORGCHART_CREATING instead of a fixed 300 ms.

## Iteration 3 (Opus): three warnings; the iteration-2 counter RETRACTED
- The iteration-2 run counter (ORGCHART_UNDO_RUN) made it worse: a left run's update, skipped once under a newer ask,
  was never applied, so Keep them brought back "remove these 7" with 4 gone. Removed. The kept list's DATA is now
  always updated by a left run (only the newer-batch identity guard remains). The iteration-2 case stays bounded:
  a removal run takes the list as it stands when Remove is pressed, and counts an agent on the removed list as done.
- The repaint used resetOrgchartPreview, which bumps ORGCHART_GEN and ends the file flow, so a late Undo answer could
  drop a CSV read in flight or hide a consent box (ORGCHART_READ_CTL is null for those). Now it repaints IN PLACE
  (orgchartPaintKeptResult: count, list, Undo button), only when the box is visible showing a create's result
  (ORGCHART_RESULT_SHOWN, which orgchartPaint clears for any preview or file result) and no Undo is asking or
  removing. No generation bump, no file-flow end. The all-removed text is back, since an in-place paint can show it.
- Remove pressed past the window left the ask's count and rows on screen under "no longer offered". The expiry now
  paints the result back, as Keep them does. New arm: EXPIRED AT REMOVE (also asserts no DELETE is sent).
- UNDO AGAIN BEFORE THE OLD ANSWER rewritten as a positive check: the ask stays as drawn, the data drops to 3, and
  Keep them then offers 3 with "Removed 4 of 7 before you left".
- NITs taken: the ORGCHART_CREATED comment names the expiry; the Remove handler's comment no longer says a left run
  "paints nothing".

## Iteration 4 (Sonnet): two warnings, fixed
- An Undo ask open when a left run's answer lands kept naming the 7 while Remove acted on 3. The open ask is now
  drawn again from the updated list (orgchartUndoAsk). Found while fixing it: an ask still CHECKING matched its plans
  to the list by index, and the list could shrink under the await. The ask now keeps the list it checked and starts
  over if that list changed; a left run does not paint over a check. A removal run already under way is left alone.
  UNDO AGAIN BEFORE THE OLD ANSWER now asserts the redrawn ask ("Remove these 3 agents").
- The in-place paint does not check that the panel is open; a hidden panel is painted, harmlessly. Said at the code.
- NITs taken: the leave-rule comments name ORGCHART_UNDO_KEEP_MS; the late-create idle comment matches its
  condition; the Undo result carries msg: '' like the other writers.
