# kosmos#9175: the task list in an agent's instructions file goes stale

## What was measured (origin/main 0f16043fe1)
- The block's list (`engine/projects.js` blockBody, `mine`) filters by `tasks.whoOf` and `progressOf().closed`, the same
  owner test the live list's `whoNames` uses (`tasks.js` whoOf). So the OWNER filter already agrees.
- The block is rewritten only by `projects.syncAgent`, which server.js calls on membership, close/reopen, part give,
  part add, hold, title edit. **The built route (`POST /api/project/<id>/task/<n>/built`, mark and clear) never calls it.**
- The live list groups by `tasks.listGroup` (open, held, built, done); `kosmos task list --mine` and `--open` leave a built
  task out of the open list. **The block listed a built task as plain open work**, with no mark.
- Reassignment: #8989 (in 0.8.26) already re-syncs a part's previous holder (server.js givePart, `before`). The 11-26
  report most likely came from an older board. Locked here by a test, not changed.

## Change
1. `blockBody`: a task in the built group (tasks.listGroup, the live list's own grouping) is marked
   `[built<, waiting on ...>: nothing to start; it comes back as open work if it is reopened]`. A held or paused one keeps
   only its hold mark (it says more). Kept on the list, as a held task is: it is still the agent's until closed.
2. Built route: on a changed mark or clear, `tellEveryoneOn(out.task, roster, { notice: { projectId, by } })`, as close
   does: each holder's section is rewritten, and a holder who did not make the change is owed a re-read (#8989).

## Decided, and the weakest premise
- Mark, not drop: dropping would match `--mine` exactly, but the agent would lose sight of a task still on it that can
  be reopened onto it; the per-project list shows built tasks with a [built] mark, which this matches. Weakest premise:
  that agents read the mark as "nothing to start". Would change my mind: an agent restarting built work after this.
- The person's screen mark owes the holder a re-read (by is null for the screen, as owesNotice treats it for a close).

## Test
`server.taskblock-built-9175.test.js`, end to end, nothing stubbed: mark, clear, the owed re-read both arms, and a
reassignment. Red without the fix (2 of 3; the reassignment one passes on main, by #8989), and red with either site
reverted alone.

## Review round 1 (sonnet, blind): no critical
- [WARNING] paused project + built showed only the pause mark, though the live list groups it built --> FIXED: both marks; a task ON HOLD keeps only the hold (listGroup puts it in held). Test added.
- [WARNING] the repeat route drops the built mark (tasks.setRepeat) and never re-synced holders --> FIXED: tellEveryoneOn after a repeat change. Test added.
- [NIT] an agent's mark covers only itself (builtWho, as agentnudge and the Assigner read it), so a co-holder read "nothing to start" --> FIXED: a co-holder not covered is told its part is still to finish. Test added.
- [WARNING] done-when says "matches the live list"; built tasks stay listed, marked, while --mine omits them --> ACCEPTED as the decided call above (the per-project list shows them marked [built]); stated on the card.
- [NIT] the reassignment test passes on main --> ACCEPTED: it locks #8989, which already fixed that half.
Each new site perturbed alone turns exactly its own test red.

## Review round 2 (opus, blind, whole branch)
- [CRITICAL] the built mark after the hold mark broke holdsOf (it reads the hold as the line's LAST mark), so pausing a project with a built task owed no re-read --> FIXED: built mark first (also the live list's [built] [project paused] order). Route test: a pause owes the holder the re-read.
- [WARNING] a co-holder whose own part is closed was told its part is still to finish --> FIXED: whoIsLeft's rule (not marked AND holds an open part). Test added.
- [WARNING] an unnamed mark (empty builtWho) was called "built by another agent" --> FIXED: "marked built, but not by you". Test added. (This also showed my round-1 test's "screen" arm was an unnamed process call: no sec-fetch-site. Fixed to a real page call, and it now asserts the frees-everyone wording, which guards the builtFreesAll branch.)
- [WARNING] the repeat route's sync passed no notice --> FIXED: notice { projectId, by } (null for the page), as the built route. Test added.
- [NIT] repeat sync runs on no-op successes; both syncs are synchronous --> ACCEPTED: a section is written only when it changed; each holder is one file read, as every other task route does.
Every round-2 site perturbed alone turns its own test red (order, closed part, builtFreesAll, repeat notice).

## Review round 3 (sonnet, blind, whole branch): no critical
- [WARNING] a task's own words could print a mark ("... [built: nothing to start ...]" on open work talks the agent out of it; a trailing "[on hold: ...]" fools holdsOf) --> FIXED: in the block, a "[" opening on hold / built / marked built inside the words becomes "(". Test added; the neutraliser removed turns it red. The hold half predates this branch; closed here because the built mark made it worse.
- [NIT] tests share agent names and the owed file; every test that asserts the owed file clears it first --> ACCEPTED.
- Readers of the task line (holdsOf, rulesChangedIn): only holdsOf reads the line's end, and the hold mark stays last. Confirmed.
Neighbours re-run on this commit: engine/projects.test.js, the pause and re-read tests (190/190), and the webhook-text tests (74/74).
