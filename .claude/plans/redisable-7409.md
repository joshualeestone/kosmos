# redisable-7409: a removed agent stays off after a machine move

Card: kosmos#7409 (an outside user's issue list, 0.7.70). Claimed by Mona Lisa on Splinter's routing.

## Done means
- On a Mac moved with Migration Assistant, an agent the person removed does not keep running: the board, at start,
  disables its startup job again and stops it. Restore still puts it back.

## Cause (from engine/remove.js)
Remove stops the job with `bootout` and keeps it from starting with `launchctl disable`, which launchd keeps in its own
per-machine database and never in the plist. Migration Assistant copies ~/Library/LaunchAgents and Kosmos's own data
(the removed list included), not launchd's database, so on the new Mac the plist loads at login, enabled.

## Change
- `engine/remove.js` reapplyRemovedDisables: on a Mac, read the removed list (readRemovedForWrite, so an unreadable one
  does nothing and says so), ask `launchctl print-disabled gui/<uid>` once, and for every recorded label launchd does
  not hold disabled (`=> disabled` or `=> true`), `disable` it and `bootout` it. Only launchd-shaped labels are used.
- `server.js` onListening: a real board (boardAuthState.on; a sandboxed fixture never) runs it once, 2 s after start,
  and logs the labels it set again, or why it could not.
- `engine/remove.redisable-7409.test.js`: through remove.setRunner against a sandboxed removed.json.

## Decided
- The board re-applies the disable at start; nothing is written into the plist. Rejected: the plist's own `Disabled`
  key, or moving the plist aside, as the card suggested: each is a file change Restore would then have to undo, and the
  record Kosmos already keeps (removed.json, which travels) is enough to re-apply the same disable Restore undoes.
- Weakest premise: after a move, the job can load at the first login and run for the few seconds before the board
  starts and stops it. A removed agent briefly running is the residual; a plist key would close it at the cost above.
- Restore is unchanged: it already `enable`s the recorded label.

## Mutation checks (run by hand, code restored after each)
- A label launchd already holds disabled not skipped: the already-disabled case goes red.
- The bootout after the disable removed: the move case goes red.
