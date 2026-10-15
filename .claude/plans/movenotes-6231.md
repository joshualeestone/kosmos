# movenotes-6231: #6231 items 9 to 12 (notes on a stopped or cut-short account move)

## Stacking
Built on origin/stopmove-6214 (#6214, Sonya Blade, in review, no PR yet), at Splinter's ask (10:10 CDT): the code
changed here exists only there. These edit lines #6214 may still change (engine/accountmove.js putBack and the move's
end, web/index.html engineRestartClick), so a later #6214 round can mean a rebase with conflicts. PR once #6214 merges.

## Change
- Item 9 (engine/accountmove.js, server.js): an agent left saved on the new account while it still runs on its old one
  gets #6174's note, as a partial restart does: when its put-back after a stop fails, and when the move ended before it
  reached it (its time cap). The engine calls an optional `deps.leftOnOld(name)` (guarded: the note is not the move);
  the bulk-move route supplies it: the agent's session start, read without blocking (sessionStartForAsync), written
  through noteMoveOutcome with the account the route read before the move (fromDirs). An unreadable session clears an
  earlier note rather than guess one, as noteMoveOutcome does for any unconfirmed case.
- Item 10: a caller that supplies no putBack is told "this Kosmos cannot put an agent back on its old account", not
  "we could not read which account it was on".
- Item 11 (web/index.html): each Restart Kosmos press takes a number (ENGINE_SAID_PRESS); a hold whose press is no
  longer the latest stops at its next turn, so an earlier press cannot repaint the toast in the middle of a later
  answer. Rejected: one timer cleared on each press, which rewrites the lines #6214's source-match test pins.
- Item 12: putBack's comment names the Linux case (nothing reloads systemd until a restart; a reload plus a crash during
  the move brings the agent up on the new account although the answer says it stays on the old one).

## Tests
- engine/accountmove-notes-6231.test.js 5/5: a failed put-back is noted and a working one is not; an agent changed by
  hand since is not; agents the move never reached are noted; a throwing note changes nothing; item 10's wording.
  #6214's engine/accountmove-stop-6214.test.js still 12/12.
- web.movesaid-6231.test.js 2/2: runs the shipped engineRestartClick; two refused presses, the first press's hold
  comes due and must not repaint; the second's still does; a single press still repaints.
- server.movenotes-6231.test.js 2/2: boots the real board, captures the route's deps, and the note is written with the
  session start and the old account; an unreadable session clears an earlier note.
- Mutations: removing the engine's two leftOnOld calls reds 3; the press check reds the page test; a no-op board
  leftOnOld reds both board tests.

## Weakest premise
That an agent the move never reached still runs on its old account: true because its restart was never tried (its
saved job names the new account, its session predates the move). A crash between the save and the end of the move
would restart it on the new account while noted as old; the note then clears at its next session change (#6174).
