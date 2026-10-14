# cant-tell-hold-5949: a Windows Claude card keeps its last state through a failed check, and says why (kosmos#5949)

**Posture:** production

## Problem
On Windows a Claude agent's working/idle comes from `claude agents --json` (engine/win32roster.js's shared
`cachedRun`, then engine/win32capture.js, then status.js's win32 classify arm). One failed or timed-out read
blanked every Claude card at once ("Can't tell", or the whole board's "we cannot read the agents" when the
roster read failed), nothing logged why, and the card's explanation line is gone (#3729).

## Measured on the Windows box (2026-10-12)
- 270 reads of `claude agents --json` (Claude Code 2.1.296, 8 sessions), through the same execFile and 15 s
  timeout the board uses: 100 serial (p50 249 ms, max 314 ms), 90 three at a time (max 269 ms), 80 eight at a
  time (p50 376 ms, max 432 ms). Zero failures, zero slow reads. The failure does not reproduce here.
- 300 reads of the live board's /api/status at 2 s (about 10 minutes, 2100 card readings): all 200, zero
  unknown, 8 answers slower than 3 s.
- Every listed session now carries `status` (busy/idle); the streaming state file is the fallback.
- Nothing logs a fall to unknown today: the board's task does not keep its stderr, and the agents'
  win32-logs/<name>.log files hold only supervisor lines.

## Change
1. engine/win32roster.js: both readers keep WHY a read failed (timed out, exited with a code, could not
   start, not JSON, not a list); `makeCachedRun` keeps that beside a null (`cachedRun.problem()`). `make()`
   (the roster source) keeps the Claude list from the last good read for 15 s and uses it when a read fails,
   so one failed read no longer refuses the whole board. Past 15 s the null goes through as before.
2. engine/win32capture.js: per agent, the last good token is held through failed looks, counted once per
   read (memo window), until 3 failed reads in a row AND 15 s since the last good one; then null (Can't tell)
   as before. Causes: read failed / timed out (from the roster), an unknown status token, a state file that
   does not match, never read well. Each change (held, gave up, back) is one line in the agent's own log
   (win32-logs/<name>.log, via win32supervisorlog, redacted and bounded). `capture.note(target)` says whether
   the answer was held or unreadable. An agent a good read no longer lists is forgotten quietly.
3. engine/status.js: for a Windows row only, `captureNote` asks the capture, and the card carries
   `stateRead: 'remembered' | 'unreadable'` (absent otherwise, and on every Mac card). A held WORKING is not
   counted as a witnessed turn for the account badge (#1921). A state decided by a fresh self-report gets no mark.
4. web/index.html: the page turns that word into its own fixed sentence on hover (card pill, list row, agent
   page): "Kosmos could not check on this agent just now. It will try again in a few seconds." (held: "...so
   this is what it was doing when last seen..."). A held state is dimmed on the card and carries #991's
   "· when last seen" on the agent page (its own attribute, so the presence check's data-remembered and this
   never clear each other).

5. After a board start (an update restarts it), a card shows its last known state, marked as remembered, until its
   first live reading (Josh's 09:21 "Can't tell" lined up with the 0.7.38 board restart, per the card). The capture
   keeps each agent's last good token on disk (`win32-laststate.json` under the store root, through
   store.saveFlushed), with when it was last SEEN: written when a state changes and confirmed at most once a minute
   otherwise, so an agent idle all morning still carries; entries for agents no longer running drop out once too old
   to carry. server.js wires it on Windows (`fileLastState`). A state last seen more than 10 minutes before is not used. Its hold runs from the first look this run, so the usual 3 looks and 15 s apply.
6. Code that ACTS because an agent reads idle waits for a fresh look: the Assigner (`assigner.idleCard`), the
   limit backlog release (`chat.limitReleased`, both its arms), the failover tell sweep (server.js `isIdle`) and the first-reply reminder (`firstreply-nudge`, both `plan` and `sweepOnce`) skip
   a card whose screen reading is held (`status.stateIsRemembered`, reading `screenRead`, which is set even when a
   report decided the state, since a limit wait carries the screen along as `screenState`). The other readers of a
   held state draw it (cards, counts, project rows). Found by grepping engine/ and server.js for code keyed on idle.
7. One fact, not two: the tokens are win32streamstate's BUSY/IDLE (classify's win32 arm and the capture both read
   them), and the hold length is win32roster.HOLD_MS (the capture gives up when the roster stops standing in).

8. A Claude read that fails while a Codex agent is up is a failed Claude read (win32live keeps the map alive with the
   codex rows), so the Claude cards are held, not forgotten; the capture asks the shared read itself whether it
   answered (`claudeOk`).
9. The board-start carry is used only until this run's first good read: after that, an agent not yet read well is a
   new start (a relaunch), and a past session's state says nothing about it. The file is written at most once every
   5 s for a change (a flushed write on the status path) and once a minute to confirm.
10. The remembered mark is set only when the card shows the held reading itself (the reconciled state equals the
   held screen's), never on a state something else decided that tick. (Defensive: on a Windows card today only a
   report decides otherwise, and a reported state already carries no mark; no test drives the other case.)

## #3729, reconciled
#3729 removed the agent-card "conflict" line and its slot: no diagnostic sentences on cards, nothing that can
be injected. This adds no line and no slot. The sentence is a `title` (hover only), written by the page from a
fixed table keyed by one engine word, so no engine text reaches a card; the cause stays in the agent's log.
Josh asked for exactly this surface on #5949 ("on hover or on the agent page").

## Mac
Unchanged: `captureNote` is asked only for a row `isWin32Pane` says is Windows, so `stateRead` never appears on
a Mac card, and the tmux path has no `note`.

## Tests
- engine/win32capture.hold-5949.test.js (22): hold, give-up timing (count AND time), recovery, per-cause log
  lines once per change (and none, nor a card mark, for a first look with no state yet), unknown token and state-file causes, a
  stopped agent forgotten quietly, a throwing log, end to end through status.snapshot (one failed read keeps EVERY
  card, marked; the roster refuses after 15 s; a good read clears the mark), a held working is not "Working now"
  beside a wait, the roster's 15 s hold, the cached read's why, the causes on the error shapes measured on this
  box (a sync buffer overflow also carries SIGTERM), the board-start carry (used, replaced by the first live
  reading, written only on change, not used when old, the file read safely), and the Assigner and limit release
  waiting for a fresh look, the carry aged on when a state was last seen, and a failed capture memo served after a newer good roster (held, marked, counted once), a failed Claude read with a codex agent up (held), a relaunch after the first good read (not carried), and the write rate. All but the throwing-log guard fail on origin/main (the throwing-log guard passes there trivially).
- web.stateread-5949.test.js (5): the lifted helpers run; source pins on the card, list row and agent page.
- Selected for the Windows CI job automatically (the engine file has "win32" in its name).

## Weakest premise
That the reported intermittent "Can't tell" is a failed or unusable read at all. I could not make one fail on
this box (270 reads, 2100 card readings, none). The capture's memo can also serve an older failed read to a
newer good roster for up to 1.5 s, which the hold now covers too, and the new log lines are what will tell
which cause it really is on Josh's laptop. The board-start carry rests on the same premise: it covers a card whose first look gives no usable token; a first READ that fails outright still refuses the whole board, since the roster has no earlier list to stand in.

## Follow-up, not in this PR: the Windows Codex agent that decays to "Can't tell" (card comment 2)
A self-reported `working` decays after REPORT_WORKING_DECAY_MS (5 minutes, status.js) unless the agent heartbeats,
which a Claude agent does through its tool-call hooks; the Codex agent on Windows does not, so after 5 minutes its
card falls back to what the board can read itself. The project view reads the report without that decay, so the two
views disagree. Repairing the Codex heartbeat on Windows and making every view read one effective state is a
separate change (written up on #5949), not this one.

## Per-turn runners after #5972 (rebased onto main 2026-10-13)
The hold covers every live row, not only Claude ones, so a Codex, Gemini, Grok or Antigravity agent whose state file
stops matching for a moment (a relaunch) also keeps its last token, marked. #5972 lets a per-turn runner's idle
(`liveToken`) end a stale automatic "working" report, because that idle is the supervisor's record read this tick. A
HELD idle is not that record, so snapshot drops `liveToken` from a held reading and the card falls to "Can't tell",
with the hover's why (`stateRead: 'unreadable'`), exactly as a failed look under a stale report now does.

## A held reading never outranks a report
reconcileReport lets a screen read this tick lead a report (a working screen over an idle report). A held reading is
not a look taken this tick, so snapshot reconciles first as if the look had failed, and lets the held reading stand
in only when that leaves the card unknown. A fresh idle from a Stop hook therefore wins over a remembered working.
That reported idle is the agent's own word, so it carries no `screenRead` and the code that acts on idle may use it;
any other reported state keeps `screenRead`, since a limit wait carries the held screen along as `screenState`.

## Restarts, and boxes without a Claude read
- A held reading never stands in while a restart is on record (#2019): it is from before the restart, and the
  self-heal would read it as the restart having come back and clear the record, or a shown failure (#4006). The card
  then reads as it does on main for a failed look.
- Any good read ends the board-start window and is remembered, including one where only the per-turn agents' own
  source answered, so a box where `claude agents --json` never answers does not carry a past session's state.
- A status token Claude Code adds in a later version (not busy or idle) is held like a failed look for up to 15 s and
  then logged as "a status Kosmos does not know"; before, it showed as unknown at once. A real new state (an
  input wait, say) would sit behind "remembered" for those seconds.

## Not done
A browser check: the change is a hover title and a CSS qualifier behind no click (Browser-check trailer).
