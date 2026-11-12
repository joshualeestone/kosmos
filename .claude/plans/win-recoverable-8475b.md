# win-recoverable-8475b: a Windows startup task left with no folder can be seen and removed, recoverably (kosmos#8475)

**Posture:** production

## Problem
On Windows a Kosmos Scheduled Task with no agent folder showed nowhere on the board, so nobody could remove it from the
screen. #8476 (#8471 part 1) stopped Kosmos making new ones but did not list existing ones, because its listing's delete
lost the settings for good, and nothing can tell an agent folder that was DELETED from one renamed or moved elsewhere:
nine review rounds kept finding healthy agents that read as "no folder" (a dead junction, an unplugged drive, a missing
workers folder, a renamed workers folder plus one create, a recorded folder on an unconnected drive).

## Change (Windows only; macOS and Linux unchanged, except one label)

On every platform, a removed agent's row button now says "Delete what is left…" instead of "Delete its files…" (review
3): the row cannot know whether its click removes files, settings alone or only a startup job, and the neutral label is
true on every platform. The dialog it opens then names the exact act.
- engine/delete-leftover.js settingsLeftovers: on win32 it also lists a name with a profile, no folder and a task known
  to be registered (job === true; a failed look lists nothing), not removed, not running, not waiting to start, while
  the workers folder is there; marked startsAtLogin. server.js /api/removed passes it; web/index.html's row says "Its
  startup job is still set up, but Kosmos cannot find its folder" (true whether the folder was deleted or moved).
- plan() and del() for a Windows task with no folder: a taskOnly delete that removes ONLY the Scheduled Task. It keeps
  the settings and picture, revokes no tokens, clears no history, retires no community account, resets no standing,
  records no removal, and asks for no typing, except (review 4) where its recorded folder is outside the workers
  folder and out of sight, gone or behind a dead link (where main refused): then the name is typed and the plan first
  says the folder is recorded at that path and cannot be reached, and to connect it if it is a disk or share (or, for a
  file or link at that path, that what is there is not a folder Kosmos can use). Typing is also asked in the
  "unchecked" case, where the profile could not be read and Kosmos says it could not check where the folder is (a
  recorded folder whose own look fails gets the "cannot reach" words; a link left there, the "not a folder" words). Damaged settings (a profile that does not read as settings) now get the untyped task-only delete with the
  settings kept; main deleted them for good after a typed name. Afterwards a name whose recorded folder is in the workers folder (or
  records none) is a settings-only row whose delete can go to the Recycle Bin; a name recording a folder outside the
  workers folder shows no settings-only row (its folder may only be out of sight), so its settings stay until that
  folder is back, and the sentences then say only that they stay. The sentences say exactly that, and how to get the agent back if its folder was only moved (put it back
  at the recorded path, Restore it first if removed, then Start at login when Kosmos offers it: register.survey's
  missing list and register.repair, which re-registers the task). Not as it was: a Claude or Codex agent's account
  folder and set model lived only in the task, so it starts on the main account and the model it last ran, and the
  sentences say so (a Qwen or vendor agent's account is in its profile and comes back).
- Review fixes: a name with nothing stored (or only settings another agent shares) gets the full delete as on main,
  so a removed one is freed in one click rather than stuck on the removed list; "delete what is left again" is said only
  when that delete would be offered (strandedRefusal and the outside-the-workers-folder rule), after the way back; the
  dialog's cancel button and the row's button say "startup job"; Restore after a task-only delete says to use Start at
  login (only on a look that answered "not registered").
- It still refuses while the name is waiting to start, and while the whole workers folder is missing or behind a dead
  link (the way-out sentence names the task to delete in Task Scheduler).
- Tests: new engine/delete-leftover.win32-recoverable-task-8475.test.js (15); the 8471 file's tests updated to the new
  rule (test 7 now pins "Windows lists the task, marked; macOS and Linux do not"); the 7820 pin updated; a Windows-only
  server.test.js test for startsAtLogin; docs/browser-checks/render-settings-leftover-7825.js asserts the row.

## Decided, not missed
- A Windows task with no folder and a profile gets the taskOnly delete whenever anything of its own is stored
  (settings or picture), or whenever it is not on the removed list, including from a removed agent's row, which used
  to delete the settings for good after a typed name: plan() knows the name, not the row clicked, and an action taken
  on an inference that a move can fake must be recoverable. Such a removed agent's leftover now takes two clicks (the
  task, then the settings). Two exceptions get main's full delete (task, tokens, community account, removal record; the
  name is free; typed when a picture goes for good), after the same checks main ran (strandedRefusal and the
  workers-folder refusals): a REMOVED name with nothing of its own stored (none, or only settings another agent's name
  shares), whose name would otherwise stay on the removed list for good; and (review 5) a name with NO profile, which
  is never a healthy moved agent (neither Start at login nor a settings-only row can come without one). Would change my mind: a need for a one-step delete where settings exist.
- The weakest part: the way back appears only for an agent that has run on this computer (register.survey's hasRun;
  a removed agent keeps only its self-report history, so one that never wrote a report is not offered Start at login);
  the account and model it ran on are lost with the task (saving the account in the profile is carded as #8478);
  and an agent whose recorded folder is outside the workers folder shows no settings-only row after its task goes, and
  its settings alone are refused: on a disk not connected they cannot be deleted from the screen until the disk
  returns, and if the folder is gone from a disk that IS connected they cannot be deleted from the screen at all (as on
  main, kosmos#7825's rule). Safe, as nothing is lost, but they stay.
  Also: the list leaves out a name with anything at its folder path (review 6: plan()'s lstat test, so a junction that
  leads nowhere is not a row whose click always refuses).

## Measured on the Windows box
New file 15/15 (14/15 fail with main's source: test 11 pins main's refusal, so it passes there by design; 2/15 fail
with review 5's source 94d67af328: 12, 15). 8471 file 7/0, 7820 file 34/0/1, delete-leftover.test 70/0/10, server
"removed list" 3 pass; each changed test fails on main's source. Both browser-check gates exit 0. Policy tests pass.

## Review log
- Round 1 (no blocker; 4 warnings, 3 nits). Fixed: (1) a removed name with nothing stored was a dead end after the
  task-only delete; it now gets the full delete as on main (one click frees it; not just clearing the record, which
  would leave its tokens working and its account unretired). (2) "delete what is left again" only when that delete
  would be offered (shared recordedOutsideWorkers), after the way back. (3) every way-back sentence says it starts on
  the main account and the last model (Qwen/vendor: the model only). Nits: Restore after a task-only delete says to use
  Start at login; stale comments; per-plan button words ("Keep its startup job"). (4) carded #8477: the act can differ
  from the confirmed act (del re-plans), pre-existing on main. Both browser-check gates exit 0.
- Round 2 (no blocker; 1 warning, 2 nits), all fixed. (1) The "nothing stored -> full delete" fallback reached a
  NON-removed healthy agent whose stored key collided with another folder (pear.8475 beside pear8475): listed, then one
  click revoked its tokens and retired its account. Now only a name on the removed list gets that fallback; every other
  name gets the task-only delete (an unreadable removed list reads as not removed). New test with the collision;
  negative control fails on the round-1 source. (2) The task-only hint no longer promises to free the name, and the
  agent page's button says "Remove its startup job" over a task-only plan (browser check arm added; both gates exit 0).
  (3) Restore's sentence says "Once its folder is back" while the folder is still missing.
- Round 3 (no blocker; 1 warning, 2 nits), all fixed. (1) REGRESSION vs main: the round-2 full-delete fallback skipped
  strandedRefusal, so a removed name with a shared stored key and a folder recorded on an unconnected drive was deleted
  for good where main refused. It now runs strandedRefusal (and keeps damagedSettings) first, as main did; test 11
  builds that case (negative control fails on the round-2 source). (2) A removed agent's own row button says "Delete
  what is left..." (it cannot know the act until the plan is fetched). (3) The plan's two inexact sentences corrected.
- Round 4 (compared every case with main; no blocker; 1 warning, 4 nits), all fixed. Main refused (strandedRefusal) six
  cases this branch removes the task in: a recorded folder outside the workers folder on a drive not connected, gone, or
  behind a dead link, each removed or not. DECIDED: keep the task-only act (refusing would bring back a row that cannot
  act) but ask for the name to be typed, and say first that the folder is recorded where Kosmos cannot reach it and that
  connecting the disk brings the agent back. Rejected: removing it silently; saving the account now (#8478). Test 12
  covers the six cases and the untyped control. Nits: the plan's counts, the refusal comment, "(or connect that disk
  again)", and del reads isRemoved === true as plan() does.
- Round 5 (compared with main; no blocker; 1 warning, 3 nits), all fixed. (1) A name with NO profile (a picture or
  nothing) got the task-only delete with a way back and a "delete again" that can never come; such a name is never a
  healthy moved agent, so it gets main's full delete with main's checks (test 14). (2) A FILE at the recorded path says
  so plainly (test 13). (3) The out-of-sight lead says to connect the disk BEFORE removing anything, said once.
  (4) The plan notes the removed row's label changed on every platform.
- Round 6 (no blocker; 1 warning, 3 nits), all fixed: the list uses plan()'s lstat folder test, so a dead junction at
  the agent's folder is no longer a listed row that always refuses (test 15); way-back words; stale "Delete its files"
  comments; plan accuracy (typing in the could-not-check case; damaged settings now kept).
- Round 7 (no blocker; 1 warning, 1 nit), both wording: with no lead sentence the way back no longer mentions a disk
  that cannot be involved there (the disk clause stays only in the outcome after a "cannot reach" plan); "delete what is
  left again" now names the row and button to use.
- Round 8 (the cap; no blocker, no warning; 3 nits). Every case compared with main: the same, gentler, or (the review-4
  trade) the task alone after typing where main refused; no listed row refuses. Fixed: this plan's "could not check"
  sentence. Not changed, so no code moves after the final round: the outcome after a removed agent's typed "cannot
  reach" delete reads "...connect it, use Restore ..." (true, a little run-on); a comment at ~1414 says the recorded
  folder is never looked at, while task rows look at it via create.workerDir, as the survey already does.
- After round 8, CI on PR #8480 failed one test on both runners (macOS and Windows): test 3 compared the recycled
  settings path to store.profilePath as exact strings, and a runner's temp folder has another spelling (macOS
  /var vs /private/var; the Windows runner's 8.3 TEMP). Reproduced on the box with an 8.3 TEMP (14/15), fixed in the TEST
  only by comparing real paths (15/15). No product code changed. Repo rule (no commits onto an open PR): #8480 closed,
  this branch (win-recoverable-8475b) opened in its place.
