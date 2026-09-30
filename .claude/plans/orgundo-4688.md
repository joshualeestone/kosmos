# orgundo-4688: a team created while the person left the panel keeps its Undo (kosmos#4688)

Stacked on newagent-4556 (PR #4625), where the org chart panel moved onto the Team screen. PR once #4625 merges.

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
