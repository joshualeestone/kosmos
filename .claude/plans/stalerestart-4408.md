# stalerestart-4408: the board's "changed on disk" check reads content, names the file, and offers one Restart Kosmos button (kosmos#4408)

Ben on prod (Josh, #admin 15:01): "Kosmos changed on disk ... Only a restart picks it up: kosmos restart", and
reopening the app did not clear it.

## Root cause (found by Ben's own agent, on the card)
No update. One agent edited an installed app file and another restored it byte-for-byte. engineFreshness() compared
only mtimes, so the moved time read as "running old code": a false positive. Reopening the window never restarts the
board process, so it never cleared.

## What changes
1. server.js engineFreshness: each loaded file's content is hashed when the board starts (and when a later-loaded
   module is first seen). A moved mtime only triggers a re-hash; a file counts as changed only when its content
   differs, and `engine.changed` names those files (relative to the app folder). Tested in server.test.js with a
   throwaway module under engine/: touched (not stale, Ben's case) then edited (stale, named). Mutation to the old
   time-only rule turns it red.
2. server.js POST /api/engine/restart: restarts through engine/boardrestart (the world-switch path). 409 when current
   or when the board cannot bring itself back. One restart at a time (a second press, e.g. another open page, gets 202
   without a second spawn). If the process is still here 90 s after the restart started, that is logged.
   server.engine-restart-4408.test.js (boardrestart stubbed; CONTROL; double press). Mutation removing the latch: red.
3. web/index.html: "Kosmos needs a quick restart" / "A Kosmos file was changed on this computer (<file> and N more),
   and Kosmos is still running the old copy." With canRestart: "A restart picks it up. Your agents keep running." and
   one Restart Kosmos button; without, on a Mac: "Restarting your computer picks it up." (Windows keeps its own copy).
   No Terminal wording (#996). The button POSTs, says Restarting, keeps the did-not-answer screen down, reloads when
   a board with a new start time answers; an already-current 409 reloads; other refusals are plain words, the detail
   to the console. Browser check render-engine-restart-4408.

## Rejected / moved out
- The installer change (restart instead of start on update) from the first cut: the update path was not the cause,
  and review found ways `restart` can fail where `start` did not. Follow-up card if wanted.
- Guarding the installed app folder against agent edits: the right next step (it would stop the edit itself), but it
  needs sandbox/permission rules for every runner; a separate card.
- An automatic restart: it interrupts every open page; one button keeps the person in charge of when.

## Weakest premises
- A file changed on disk may be one the board never re-reads (e.g. a web asset); only loaded modules are compared,
  as before.
- canSelfRestart decides the button; a board where it says no gets words, not a button.
