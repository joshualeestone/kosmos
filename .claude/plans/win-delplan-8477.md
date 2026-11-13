# win-delplan-8477: the leftover delete runs only what the person confirmed (kosmos#8477)

**Posture:** production

Written 2026-11-13 (UTC, from `date -u`), off origin/main 7f6b48cf61. Rewritten after review 7 to describe the code as
it stands; each review's change is named where it lives.

## The defect

`DELETE /api/agent/:name/leftover` re-plans in `delSteps` (engine/delete-leftover.js) and the page sent only `typed`.
So what runs is the plan at click time, not the plan the dialog showed. On Windows: the dialog for a task left with no
folder says "Remove X's startup job?" (task only, recoverable, nothing typed). If the folder comes back before the click,
the re-plan is the FULL delete, folder to the Recycle Bin with nothing to type, so it runs: folder recycled, community
standing reset, community account retired, tokens revoked. Nobody confirmed that.

## Finished looks like

1. A delete whose fresh plan promises something other than the dialog's plan deletes nothing and says so in a true
   sentence; the dialog repaints with the new plan, so the next click confirms what will really happen.
2. The same plan confirmed runs exactly as before.
3. A request or caller that says nothing about what was confirmed can never reach the full delete.

## Decisions

### The fingerprint (engine)

- **Computed by the engine, once; the page only echoes it.** `plan()` adds `confirm` to every offered plan (task-only
  and full) through one helper, `confirmFingerprint(plan, { retiresCommunity, marksUnsent })`, built from the plan
  object plus the two facts it does not carry, so the GET and the re-plan cannot derive it two ways (convention 5). The
  page sends it back as `confirmed`; it never computes one.
- **Fields: what decides what happens, never the words.** Task-only or full; the folder path or none; whether the
  folder holds a git repository and whether its count is capped ("more than N files", review 2); going for good only,
  the folder's size step (below, review 4); the startup job's label or none; Recycle Bin (or Trash) or for good
  (`toTrash`); which settings and picture files, and whether they go to the bin; whether the community account is
  retired; whether unsent community posts are marked never to send (review 1: true exactly when the loses list names
  them, whenever `unsentCount` is non-zero, account or not, since `requestRetire` marks them either way).
- **Not the name to type** (review 1): a disk coming back drops it on an identical act, and the other way, a name newly
  asked for, is refused by the typed-name check before anything is touched (both pinned by a test).
- **Not the dialog text** (question, reassurance, loses): "last changed 3 minutes ago" ages while the dialog is open, so
  it would refuse a delete that had not changed and train people to click through refusals.
- **The size, only going for good, and only coarsely** (review 4, step fixed in review 5). `sizeStep(n)` is
  `floor(log10(n))`, with none (0) a step of its own: 0 | 1-9 | 10-99 | 100-999 ..., for the file count and for the
  bytes. "3 files, 12 KB" grown to thousands is refused; a small write is not. A Recycle Bin delete carries no size,
  since everything can be got back. A for-good folder may grow up to tenfold inside one step without a refusal; the
  name is typed there, and that is the margin accepted.
- **Short form:** `4.` + the first 16 hex of a sha256 of the fields. The version lets a change of fields refuse cleanly
  rather than match by accident (2: review 1; 3: review 2; 4: review 4).

### The check (engine)

- **Where:** in `delSteps`, after the fresh plan is made and before the task-only branch and the typed-name check, so a
  mismatch refuses even when the name typed would satisfy the new plan: the typed name confirms the name, not the act.
- **Fails closed** (review 7). A string `confirmed` is compared. Anything else, null or left out, lets through only the
  task-only delete (Start at login undoes it); the full delete is refused with "Kosmos was not told what you agreed to
  delete, perhaps because this page is from before an update, so nothing was deleted. Reload the page and look again
  before deleting." ("perhaps": the route passes `null` for any request that carried none, which an old page sends but
  so could any other client.) Only a caller that says so by name, `unchecked: true`, skips the check; only tests that
  plan in the same tick pass it (19 call sites in 9 files, counting this card's own test file, each a wrapper or a
  single call).
- **The refusals.** A mismatch says "What Kosmos would do here is different now, so nothing was deleted. Look at what it
  says now before deleting." (review 5: true even when nothing on disk changed and only a drive probe answered
  differently). When the fresh plan's community read threw (`readFailed`, review 4) it says "Kosmos could not read part
  of what is left of this agent just now, so nothing was deleted. Look at what it says now before deleting." Both
  return `changed: true` and the fresh plan.
- **The route** always passes `confirmed`: the string sent, or `null`. It is the only production caller of
  `delAsync`/`del` in the engine. Callers of the ROUTE (review 8, grep of the whole repo for the leftover path in
  tools/, install/, docs/, *.sh, *.ps1, *.js, *.mjs): the page (web/index.html, the del-go handler) and
  `tools/staging-agent-online-check.sh` (`tidy_agent`, run by `tools/promote-channel.sh` in a release promote), which
  clears its own throwaway agents. No CLI or other script calls the route.
- **The engine's three `changed` refusals.** `changed: true` (with the fresh plan) on all three, which is what the page
  reads to repaint; `unconfirmed: true` only when no fingerprint was sent (review 10), so a script can tell "not told"
  from "different now" and "could not read part of it".

### The release gate's tidy (`tidy_agent`), rebuilt in review 11

Reviews 8 to 11 each found a new regression against main in special-case retry branches (#8496 among them), so the
DELETE part was rebuilt as ONE bounded loop. Up to `TIDY_ATTEMPTS` (4) attempts; each reads the plan afresh (label,
typed words, confirm), then sends one DELETE with the newest confirm the board gave (this read's, or when the read fails,
the one the last refusal sent back with its plan). The answer:

- deleted, or "nothing of" it: stop (a "nothing of" after a lost answer is cleared, as on main);
- a safety refusal (no steps, not `changed`: running, a move holding it): as main, the first waits 3 s and tries
  again, a second stops; it is remembered, and the files are then never deleted here;
- `changed` (either kind): wait 3 s, as main waits after a refusal, and try again;
- no answer: wait 1 s, as main does, and try again;
- anything else (steps, PARTIAL, 404, 409, 5xx): stop. No pause after the last attempt.

After the loop the fallback (the gate deletes the files itself) runs on main's triggers exactly (review 12): two lost
answers in a row, a 404 or a 5xx, a PARTIAL, or a refusal with steps; and the first three never after any refusal in
the run, safety or `changed`.

Why 4: main's two DELETEs, plus one to learn the board's plan from a refusal when every plan read fails, plus one to act
on it. It runs in cleanup, where signals are ignored, so the bound matters: at worst 4 x (20 s read + 60 s DELETE + 3 s).

Every log line is the script's own (`changed_words`): "the board deletes only a plan it was sent back, and this script
had none to send", "the board could not read part of what is left of it", "the board's plan for it kept changing
between this script's plan read and its delete" (only when a plan read succeeded and the plan changed more than once),
or "the board's plan for it was not the one this script sent". A safety refusal is quoted from the board's plan
sentence, as main does. The final line names what came before the last answer ("before that ..."), safety and `changed`
alike, so a lost answer at the end does not hide a refusal (review 12), and says "once it is not running" only after a
safety refusal.

**The combination table** (reviews 11 and 12). Each combination was run with the scripted fake board (`MOCK_SEQ`, added
to the script's test file) on an origin/main export and on the branch. Answers past the listed ones are "ok". On main's
tree `changed` and `unconfirmed` cannot occur (main's board has no fingerprint), so they are answered as a delete there:
that is what main would have done at that point. On the branch the board enforces the confirm as the engine does
(`MOCK_SEQ_ENFORCE=1`): a DELETE that should delete but carries no confirm is refused `unconfirmed`, and one with a stale
confirm `changed`, with the plan; an `unconfirmed` answer to a DELETE that did carry a confirm is `changed` (review 12, as
the engine). "fallback" is the gate deleting the files itself; on this Windows box its delete reports "could not delete
its files here" (the known Mac-path failures), which is counted as the fallback having run.

| Plan read | 1st DELETE | 2nd DELETE | main | branch |
|---|---|---|---|---|
| ok | ok | ok | cleared | cleared |
| ok | ok | lost | cleared | cleared |
| ok | ok | safety | cleared | cleared |
| ok | ok | changed | cleared | cleared |
| ok | ok | unconfirmed | cleared | cleared |
| ok | lost | ok | cleared | cleared |
| ok | lost | lost | fallback | cleared (differs) |
| ok | lost | safety | kept | cleared (differs) |
| ok | lost | changed | cleared | cleared |
| ok | lost | unconfirmed | cleared | cleared |
| ok | safety | ok | cleared | cleared |
| ok | safety | lost | kept | cleared (differs) |
| ok | safety | safety | kept | kept |
| ok | safety | changed | cleared | cleared |
| ok | safety | unconfirmed | cleared | cleared |
| ok | changed | ok | cleared | cleared |
| ok | changed | lost | cleared | cleared |
| ok | changed | safety | cleared | cleared |
| ok | changed | changed | cleared | cleared |
| ok | changed | unconfirmed | cleared | cleared |
| ok | unconfirmed | ok | cleared | cleared |
| ok | unconfirmed | lost | cleared | cleared |
| ok | unconfirmed | safety | cleared | cleared |
| ok | unconfirmed | changed | cleared | cleared |
| ok | unconfirmed | unconfirmed | cleared | cleared |
| fail | ok | ok | cleared | cleared |
| fail | ok | lost | cleared | cleared |
| fail | ok | safety | cleared | cleared |
| fail | ok | changed | cleared | cleared |
| fail | ok | unconfirmed | cleared | cleared |
| fail | lost | ok | cleared | cleared |
| fail | lost | lost | fallback | cleared (differs) |
| fail | lost | safety | kept | cleared (differs) |
| fail | lost | changed | cleared | cleared |
| fail | lost | unconfirmed | cleared | cleared |
| fail | safety | ok | cleared | cleared |
| fail | safety | lost | kept | cleared (differs) |
| fail | safety | safety | kept | kept |
| fail | safety | changed | cleared | cleared |
| fail | safety | unconfirmed | cleared | cleared |
| fail | changed | ok | cleared | cleared |
| fail | changed | lost | cleared | cleared |
| fail | changed | safety | cleared | cleared |
| fail | changed | changed | cleared | cleared |
| fail | changed | unconfirmed | cleared | cleared |
| fail | unconfirmed | ok | cleared | cleared |
| fail | unconfirmed | lost | cleared | cleared |
| fail | unconfirmed | safety | cleared | cleared |
| fail | unconfirmed | changed | cleared | cleared |
| fail | unconfirmed | unconfirmed | cleared | cleared |

Four answers (review 12; the plan read ok, or failing every time):

| Plan read | Answers 1 to 4 | main | branch |
|---|---|---|---|
| ok | changed, changed, changed, lost | cleared | kept (differs) |
| ok | lost, lost, lost, lost | fallback | fallback |
| ok | safety, changed, lost, lost | cleared | kept (differs) |
| ok | lost, changed, lost, safety | cleared | kept (differs) |
| ok | changed, safety, changed, changed | cleared | kept (differs) |
| ok | unconfirmed, unconfirmed, unconfirmed, unconfirmed | cleared | kept (differs) |
| fail | changed, changed, changed, lost | cleared | kept (differs) |
| fail | lost, lost, lost, lost | fallback | fallback |
| fail | safety, changed, lost, lost | cleared | kept (differs) |
| fail | lost, changed, lost, safety | cleared | kept (differs) |
| fail | changed, safety, changed, changed | cleared | kept (differs) |
| fail | unconfirmed, unconfirmed, unconfirmed, unconfirmed | cleared | kept (differs) |

The reviewer's cases and the plan-changed-once cases:

| Case | main | branch |
|---|---|---|
| Plan reads fail; the DELETE that carries the plan back lands, its answer lost (fail:ok,landed) | cleared | cleared |
| Plan reads fail; the DELETE that carries the plan back is lost (fail:ok,lost) | cleared | cleared |
| Plan read ok; the first DELETE lands, its answer lost (ok:landed) | cleared | cleared |
| Only the first plan read answers; the first DELETE meets a changed plan (the newer confirm must be used) (okonce:changed) | cleared | cleared |
| As above, then a lost answer (okonce:changed,lost) | cleared | cleared |

66 rows (50 two-answer combinations, 12 four-answer rows, 4 more cases with one landed or a plan changed once). The
branch clears every two-answer combination main clears, and falls back only on lost, lost, lost, lost (main falls back
after two). It differs in 16 rows:

- 6 better than main: lost/lost (main falls back), lost/safety and safety/lost (main keeps the files), each with the
  plan read ok and failing. The branch's third attempt is answered and clears; the board re-checks safety itself.
- 10 four-answer rows where main "clears" only because main's board has no `changed` or `unconfirmed` refusal and so
  deletes at the first one: changed x3 then lost; safety, changed, lost, lost; lost, changed, lost, safety; changed,
  safety, changed, changed; unconfirmed x4 (each with the plan read ok and failing). On the branch the board refuses
  every confirmed DELETE in those rows, so the attempts run out and the files are kept (never deleted here after a
  refusal, review 12). None hangs: changed, safety, changed, changed ends after its four attempts, files kept.

### The page

- **It sends what the dialog shows.** `DEL_SHOWN`, set only by `openDeleteModal` and cleared by `closeDeleteModal`, is
  the dialog's plan. `DEL_PLAN` can be replaced by the detail page's fresher read (`loadLeftover`) while the dialog stays
  painted with the older plan, which is this card's bug in miniature. So the click sends `DEL_SHOWN.confirm`, the click
  handler's `onScreen` is `DEL_SHOWN` (review 2), the #7820 name-asked repaint compares with it (review 2), and the name
  box enables Delete from `DEL_SHOWN.typeToConfirm` (review 1). The remaining `DEL_PLAN` reads are the detail page's own
  Delete button, which opens the page's plan, not the dialog's.
- **One repaint helper** (review 3), `repaintDeleteModal`, used by the changed refusal, a delete with no answer, and a
  running delete that ended. When `confirm` changed and no name is asked for, Delete stays off for
  `DEL_CHANGED_PAUSE_MS` (1 s) so a click already on its way cannot confirm a plan nobody read. The pause has a deadline,
  `DEL_PAUSE_UNTIL`, so a second repaint inside it keeps Delete off (review 4). A pause ending leaves Delete off in a
  dialog that `paintLeftoverRunning` turned off because a delete of its agent is running elsewhere (`DEL_HELD_RUNNING`,
  review 5), and typing the name there does not turn it back on (review 8). A dialog closed or opened again meanwhile
  is left alone (`DEL_OPENED`).
- **A delete with no answer** whose plan, asked again, differs from the dialog's says "We could not reach the board just
  now, so we cannot tell whether anything was deleted, and what Kosmos would do here is different now. Look at what it
  says now before deleting." (review 6; review 7: the likeliest cause is the delete getting partway, so it does not imply
  nothing happened). The same plan still says "still here. Try again."

### Considered and not done

- **"For good" becoming "Recycle Bin" is still refused** (review 3). A drive probe that timed out (kept 5 s) can make the
  dialog say "for good" and the delete's own probe "Recycle Bin". Accepting the gentler act was rejected: the person read
  "this cannot be undone" and typed the name, and would get files left in the Recycle Bin they did not see offered, with
  an outcome sentence that does not match the dialog; and a field-by-field "gentler" rule would replace one equality with
  a comparison every later field must keep right. The refusal is true, touches nothing, and repaints the gentler plan.
- **A community read that fails inside communitysend** (it answers true, or 1, rather than throwing) still reads as
  "different now". Telling it apart needs communitysend to report "could not read" separately, a change to that module
  outside this card; the refusal is safe.
- Left as safe (review 6): a flapping drive probe refusing more than once; a refusal dropped after the dialog is reopened.

## Weakest part of this reasoning

1. The size step is a bucket: a for-good folder can grow up to tenfold inside one step (3 files to 9) without a refusal,
   and a tiny write that crosses a power of ten (9 to 10) is refused. A finer rule would refuse ordinary writes.
2. `communitysend.hasAccount` and `unsentCount` answer "yes" when they cannot read their files, so a flapping read can
   refuse a delete that did not really change; each refusal is safe but could repeat.
3. On a flaky drive the Recycle Bin probe can time out on one read and answer on the next, so "for good" and "Recycle
   Bin" can alternate and refuse more than once in a row. What would change my mind is seeing it repeat in practice; the
   probe's 5 s failure keep is then the place to look, not the fingerprint.
4. `unchecked: true` is a named way around the check. Only tests pass it today; a production caller passing it would
   reintroduce the race, and nothing but review stops that.

## Callers checked

`grep` for `delete-leftover'` and `leftover.`: `server.js` route (the only `delAsync` caller); `accountmove`, `create`,
`discover`, `remove`, `teamseed` use only `deletingName`, `deletingNow`, `startsAgainWords`, `settingsLeftovers`.
Route callers: the page's del-go handler and `tools/staging-agent-online-check.sh` (see The route above). Test callers of `del`/`delAsync`: the delete-leftover
suites, `create.win32-namehold-8466`, `jobexists.win32-570` and `linuxwiring-4918`, all now `unchecked: true`.

## Tests

- New `engine/delete-leftover.win32-confirmed-plan-8477.test.js` (15; "win32" in the name so the Windows CI job selects
  it, as windows-tests-1777 requires for its host-branching skip): fingerprint present and stable; task-only confirmed
  then the folder back, refused, nothing touched, fresh plan returned; the same plan runs (task-only, and full to the
  Recycle Bin); Recycle Bin vs for good refused both ways; `confirmed: null` refuses the full delete and the raced case
  and lets the task-only delete run; `confirmed` left out refuses the full delete, `unchecked: true` runs it, and the
  refusal's exact words; unsent posts appearing refused with `requestRetire` never called; the typed name dropped on
  the same act runs, newly asked for is refused by the typed check; a `.git` appearing refused, a file written not; a
  for-good folder grown to 2000 files refused, a small write not, the Recycle Bin case not; the size-step edges (0, 1,
  9, 10, 99, 100, 999, 1000); the refusal sentence; a throwing community read refused with the could-not-read words;
  `delAsync` refuses the same way; the route passes `confirmed` (source pin). Each round's new tests failed against the
  previous round's engine (negative controls, recorded in the round reports).
- `server.test.js` "kosmos#7825 PR 2": the real route refuses with no fingerprint and with a wrong one (400, settings
  kept), then deletes with the plan's own. Fails against origin's server.js.
- `web.delete-leftover.test.js`, `web.delete-noanswer-7852.test.js` and the 7820 source pins updated for the shown-plan
  reads and the repaint helper.
- Browser check `render-settings-leftover-7825.js`: the confirm sent is the shown plan's; a changed refusal repaints,
  Delete off at once and on after the pause, the next click confirms the new plan; typing the shown name enables Delete;
  a name-asked refusal shows the name box whatever the poll stored; the no-answer and running-ended repaints pause only
  on a changed plan; a second repaint inside the pause keeps Delete off; a delete running elsewhere keeps it off after
  the pause; the no-answer words for a changed plan. Each assertion failed against the previous round's page.
- `tools/test-staging-agent-online-check.sh` (review 8): its fake board's leftover route now refuses a DELETE without
  the plan's confirm, as the real route does, and sends the plan back; so a gate that stops sending it fails the cases
  that expect a clear. Review 11 adds the scripted board (`MOCK_SEQ`, `MOCK_SEQ_GET`, `MOCK_SEQ_ENFORCE`) used for the
  combination table above, and cases for: a failed plan read with a lost first DELETE (clears); every plan read failing
  with a lost first DELETE, or a closing pane (clears, as on main); the reviewer's three (the DELETE carrying the plan
  back lands with its answer lost, or is lost; a plan that changed once with every later read failing, which must send
  the newer confirm); a plan changing, or unreadable, on every attempt (files kept, said in the script's own words, never
  the page's); and two safety refusals (files kept, never deleted here). The round-9 and round-10 cases that tested
  the removed special branches (a board that sends no plan back) are gone with them. Review 12 adds: changed three
  times then lost (files kept, the earlier refusal named), and four lost answers (the gate's own delete, main's trigger).
- Policy: fixture-discipline, no-name-refs-3071, engine.reachable, windows-tests-1777, win32-separator-guard,
  windows-coupling-audit-1732, web.api-routes-3957; both browser-check gates.
