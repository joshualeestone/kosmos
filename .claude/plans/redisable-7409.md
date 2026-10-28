# redisable-7409: a removed agent stays off after a machine move

Card: kosmos#7409 (an outside user's issue list, 0.7.70). Claimed by Mona Lisa on Splinter's routing.

## Done means
- On a Mac moved with Migration Assistant, an agent the person removed does not keep running: the board, at start,
  gives it removal's own steps again (its startup job disabled and unloaded, and its running session ended when the
  board can tie it to the agent), and says so on the board's log. Restore still puts it back.

## Cause (from engine/remove.js)
Removal is three steps: `launchctl disable` (kept in launchd's own per-machine database, never in the plist),
`launchctl bootout`, and ending the agent's tmux session, which the launchd job does not own. Migration Assistant copies
~/Library/LaunchAgents and Kosmos's own data (the removed list included), not launchd's database, so on the new Mac the
plist loads at login, enabled, and its supervisor starts the agent's session again.

## Change
- `engine/remove.js` reapplyRemovedDisables (Mac only; nothing in a dry run, `commandsAreReal`):
  - reads the removed list with readRemovedForWrite, so an unreadable one does nothing and says so;
  - takes only a label removal itself would record for the record's own name: create.serviceLabel(name, this Kosmos),
    or in the default Kosmos the legacy com.<name>.discord. removed.json is a file a person can edit, so any other
    label is never touched;
  - asks `launchctl print-disabled gui/<uid>` once and reads the board's roster once (not once per agent, which would
    block the board's thread at start); for each such label launchd does not hold disabled (`=> disabled` or
    `=> true`), runs `disable` and `bootout` (code 3, "not loaded", counts as done), then ends the agent's session only
    when the roster ties it to the agent (FOUND.OURS), as removeInner does;
  - for a label launchd already holds disabled, still ends a session the roster ties to the agent (one missed at login
    is otherwise never looked at again); an untied or unknown one is left alone silently, as on every start before;
  - reports names: reapplied, failed (launchd or tmux refused a step), unsure (a session it could not tie to the
    agent, or could not ask tmux about, left alone as removal leaves it).
- `engine/remove.js` reapplyAtBoardStart: a real board (`enforcing`; a sandboxed fixture never is) runs it 2 s after
  start, and once more 30 s later only when the first run was not clean (a board up before the login session answers),
  and writes what it did to the board's log (stdout, stderr). `server.js` onListening only calls it.
- `engine/remove.redisable-7409.test.js`: through remove.setRunner (every launchctl and tmux call recorded), a sandboxed
  removed.json, and the board's roster from test-support/fleet.

## Decided
- Re-apply at board start; nothing is written into the plist. Rejected: the plist's own `Disabled` key, or moving the
  plist aside, as the card suggested: each is a file change Restore would then have to undo, and the record Kosmos
  already keeps (removed.json, which travels) is enough to re-apply the steps Restore undoes.
- The session is ended only when the board ties it to the agent, and only after launchd accepted both job steps;
  otherwise it is reported and left alone, the same rule removeInner keeps.
- Weakest premise: after a move, the agent runs from the first login until the board starts (a few seconds after
  login, then 2 s). A plist key would close that window, at the cost above.
- A Restore that started the agent but could not take it off the removed list (writeRemoved threw; the person is told
  it was only partly done) leaves the record, so the next board start switches it off again. Accepted: it needs a
  failed write, on the path that already told the person it was half done.
- It runs on the board's thread, synchronously (one roster read, and launchctl and tmux calls only for agents that need
  them; an unmoved Mac pays one print-disabled and one roster read). Not moved to the async driver: the work is small
  after the single roster read.
- A record of an agent the person chose to leave running is swept too: they asked for it to be removed.
- What it does is said on the board's log only. Not done here: a notice on the board for a failed or unsure agent.

## Mutation checks (run by hand, code restored after each)
- The session not ended: the moved-agent case goes red.
- Any launchd-shaped label accepted (no ownership check): the hand-edited-list case goes red.
- No dry-run guard: the dry-run case goes red.
- No real-board gate: the board-start case goes red.
- An already-disabled agent's session not looked at: the review-2 recheck case goes red.
- No second try: the board-start case goes red.
- A label launchd already holds disabled not skipped (first round): the already-disabled case goes red.
