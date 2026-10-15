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
- engine/accountmove-notes-6231.test.js 8/8 (the eighth, review 3: a put-back that throws past its guard): a failed put-back is noted and a working one is not; an agent changed by
  hand to a third account is noted and one changed back to its old account is not; agents never reached are noted;
  the hold-failure path notes its agents; a throwing note changes nothing; items 10's two wordings. #6214's
  engine/accountmove-stop-6214.test.js still 12/12, web.account-stopmove-6214.test.js 9/9.
- web.movesaid-6231.test.js 2/2: the shipped engineRestartClick with the page's own ENGINE_SAID_PRESS; an earlier
  press's hold does not repaint during a later answer; a single press still repaints.
- server.movenotes-6231.test.js 5/5: boots the real board and captures the route's deps; the note is written with the
  session start and the old account; an unreadable session, or one started after the save, clears; the one-second
  margin on both sides of its edge; a note written while the session is read is kept.
- Mutations, each red: the engine's leftOnOld calls (failed put-back, never reached, hold failure, hand change), the
  press check, a no-op board leftOnOld, the margin set to 0, the newer-note check removed.

## Review 1
- The board notes only a session that started at least a whole second before the move saved the new account (the
  route records that moment per agent, just before the write); a later session, or none read, clears an earlier note.
  The agent is released before the note's read, so a restart from its page could otherwise be noted as the old one.
- The hold-failure path (agents saved, never restarted) notes them too; a missing readAccount gets its own words, as a
  missing putBack does.

## Review 2
- An agent changed by hand to another account since the move is noted (it was never restarted by this move); if that
  change restarted it, the board's time bound clears the note. The rare "put-back threw" fallback notes too.
- The board's note is skipped when the agent's note changed while its session was read (a later move's own note wins).

## Review 3
- engine/accountmove-6173.test.js pinned the route's setAccount line exactly and went red when savedAt was added; its
  pin now allows the save time between the read and the write, and still requires the read first. Lesson recorded:
  every test naming the touched lines is now run (sweep: 14 files, 313/313), not only #6214's suites.
- The branch's web/ change carries a Browser-check trailer (the #1720 gate would refuse it once #6214's own check
  files are no longer in the range after the rebase); the change is a press guard on a timer, driven by
  web.movesaid-6231.test.js, with no rendered surface changed.
- A put-back that throws past its own guard (stop()'s fallback) is tested; the race test waits on the session read.
- Left as is: an agent whose job could not be read is recorded as from the default account (moveFromDir), so a note
  for it can be hidden by #6174's "moved back" rule; that under-marks, the safe side, as #6174 already does.

## Weakest premise
That a session which started before the move saved the new account still runs on the old account. True unless the
process restarted inside the same tmux session onto the new account, which #6174's note already accepts as an
over-mark it cannot see.
