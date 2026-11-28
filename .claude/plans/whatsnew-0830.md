# whatsnew-0830: What's New for 0.8.30

The gap alarm (kosmos#1050), 2026-11-27 19:27 CST: main 54 commits past staging 0.8.29.

## The change
- The window's one line, for #8720 (PigeonPete, the idle-retire sweep): "Kosmos can retire agents that sit idle" (38) /
  "Settings > Automation > Idle agents removes agents that have not run for the days you pick. It is off by default;
  Restore brings one back." (138). Rank 10.9, since 0.8.30, untagged: the Settings section is on the shared board page,
  and engine/idleretire.js stops a session "on Mac, Linux and Windows alike" (its header); the only Windows test
  exclusion is a chmod arm Windows cannot express.
  Every clause is the Settings hint's own claim (web/index.html, #8720): days you pick, off by default, Restore under
  Show removed agents.
- Two notes-only lines (ranks 159, 160): `kosmos post --file` (#9242/#9244) and the restart greeting and `kosmos away`
  naming open tasks and unanswered messages (#9239/#9241).
- `build 0.8.30` recorded prod 0.8.29 and Windows prod 0.8.29 itself (0.8.29 shipped a window, so its commit is
  readable), marking the heavy-job line shown in 0.8.29.
- First build refused: my line was 142 characters, over the 140 limit; shortened by turning ", and" into ";".

## Checks
- whats-new-check 0.8.30: mac 1, windows 1. prod-check exit 0. notes 0.8.30 exit 0 on mac, linux and windows.
- What's New tests by name (whats-new-check-3955, pool-5711, pool-sync-5713, pool-win-8924, web.whatsnew-3955,
  web.whatsnew-phone-7839): 74 pass, 0 fail.

## Rejected
- The iPhone changes in this window (#8959 usage charts, #9212 tall-chat freeze, #9227): they ship through the App
  Store, not the board, so they get no board line.
- #9237 (`kosmos task list` leads with "nobody" for a task owned only through its tree) and #9222 (a heavy job's
  12 h ceiling): small refinements of agent output and of 0.8.29's heavy-job record, no new verb or screen; no line.
- Spelling out every rule idle-retire keeps (busy, waiting, task-named, live-project agents; only days Kosmos ran):
  the 140-character line cannot hold them, and the Settings section it names states them all.

## Weakest premise
That idle-retire behaves the same on Windows. I read it from the engine header and the test exclusion, not on a
Windows box.
