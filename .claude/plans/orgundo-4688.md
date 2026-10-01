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
Each must fail on the base (newagent-4556) and pass here; run on a quiet Mac.

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
