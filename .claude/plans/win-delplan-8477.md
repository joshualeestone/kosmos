# win-delplan-8477: the leftover delete runs only what the person confirmed (kosmos#8477)

**Posture:** production

Written 2026-11-13 (UTC, from `date -u`), off origin/main 7f6b48cf61.

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
3. A request that says nothing about what was confirmed can never reach the full delete.

## Decisions

- **The fingerprint is computed by the engine, once, and the page only echoes it.** `plan()` adds `confirm` to every
  offered plan (task-only and full) through one helper, `confirmFingerprint(plan, retiresCommunity)`, built from the
  plan object itself, so the GET and the re-plan cannot derive it two ways (convention 5). The page sends it back as
  `confirmed`; it never computes one.
- **Fields: what decides what happens, never the words.** Task-only or full; the folder path or none; the startup job's
  label or none; Recycle Bin (or Trash) or for good (`toTrash`); which settings and picture files, and whether they go to
  the bin; whether the community account is retired; whether unsent community posts are marked never to send (review 1;
  true exactly when the loses list names them, which is whenever `unsentCount` is non-zero, with or without an account:
  `requestRetire` marks them either way). Not the name to type (review 1): a disk coming back drops it on an identical
  act, and the other way, a name newly asked for, is refused by the typed-name check before anything is touched (both
  pinned by a test). Rejected: hashing the dialog text
  (question, reassurance, loses). "Last changed 3 minutes ago" ages while the dialog is open, so it would refuse a delete
  that had not changed and train people to click through the refusal. Rejected: the folder's size and file count. A
  leftover folder is not being written to, and a size change does not change what the act does to it. Short form:
  `2.` + the first 16 hex of a sha256 of the fields (the version lets a change of fields refuse cleanly rather than
  match by accident; 2 since review 1).
- **Review 1, the page:** the typed-name box enables Delete from `DEL_SHOWN.typeToConfirm`, not `DEL_PLAN`'s (a fresher
  plan asking for no name left Delete off for good). After a `changed` repaint that asks for no name, Delete stays off
  for `DEL_CHANGED_PAUSE_MS` (1 s), so the second click of a double click cannot confirm a plan nobody read; a dialog
  opened again meanwhile is left alone (the `DEL_OPENED` token).
- **The page sends what the dialog shows, not `DEL_PLAN`.** `DEL_PLAN` can be replaced by the detail page's fresher read
  (`loadLeftover`) while the dialog stays painted with the older plan, which is this card's bug in miniature. A new
  `DEL_SHOWN`, set only by `openDeleteModal` and cleared by `closeDeleteModal`, is what is confirmed.
- **The refusal:** "What Kosmos would do here is different now, so nothing was deleted. Look at what it says now before
  deleting." (Review 5: it was "What is left of this agent changed since you looked", false when only a drive probe's
  answer changed.) It returns `changed: true` and the fresh plan; the page repaints the dialog with it (the #7820
  repaint, widened to `body.changed`), cursor on Keep unless a name is now to be typed.
- **Checked before the typed-name check**, so a mismatch refuses even when the name typed would satisfy the new plan:
  the typed name confirms the name, not the act.
- **Missing fingerprint.** The route always passes `confirmed`: the string sent, or `null` when the request carried none
  (or a non-string). `null` lets through only the task-only delete (Start at login undoes it); the full delete is
  refused with "This page did not say what you agreed to delete, so nothing was deleted. Reload the page and look again
  before deleting." Why: a page opened before this change sends no fingerprint and can hit the exact race (it showed the
  task-only dialog, the folder came back), and the full delete retires the account and standing whatever the Recycle
  Bin keeps. The cost is one reload for anyone whose page predates the update. There is no CLI caller (grep of
  install/kosmos and tools/windows/kosmos-cli.js finds none); the route is the only production caller of `delAsync`/`del`.
- **In-process callers that pass no `confirmed` key at all are not checked**, as before. Only tests do this today
  (about 115 calls across the delete-leftover suites), and each plans itself in the same tick.

- **Review 2:** the click handler's `onScreen` is `DEL_SHOWN`, and the #7820 repaint compares the refusal's plan with
  it (a poll storing the same plan now asking for a name left every click refused with the name box hidden). The other
  `DEL_PLAN` reads are the detail page's own Delete button, which opens the page's plan, not the dialog's. The
  fingerprint gains the folder's git repository and "more than N files" (capped), what the dialog says about the
  contents that does not age; not the count or size. Left as is: a community file that cannot be read reads as
  "changed since you looked". Telling the two apart needs communitysend to report "could not read" separately (its
  answers of 1 and true are made inside it, at several reads), a change to that module outside this card; the refusal
  itself is safe.

- **Review 3, the page:** one helper, `repaintDeleteModal`, paints the dialog again from a plan the board sent (the
  changed refusal, a delete with no answer, a running delete that ended) and holds Delete off for the pause whenever
  `confirm` changed and no name is asked for.
- **Review 3, "for good" becoming "Recycle Bin": still refused.** A drive probe that timed out (kept 5 s) can make the
  dialog say "for good" and the delete's own probe then say "Recycle Bin", so a strictly gentler act is refused as
  changed. Accepting it was rejected: the person read "this cannot be undone" and typed the name, and would get files
  left in the Recycle Bin they did not see offered (some people delete for good on purpose, for space or privacy), with
  an outcome sentence that does not match the dialog; and a field-by-field "gentler" rule would replace one equality
  with a comparison that has to be kept right for every field added later. The refusal is true, touches nothing, and
  repaints the gentler plan, so the cost is one more click.

- **Review 4:** a folder deleted FOR GOOD is confirmed at a coarse size, one step per factor of ten in the file count
  and in the bytes (`sizeStep`), so "3 files, 12 KB" grown to thousands is refused and a small write is not; a Recycle
  Bin delete is unchanged. The pause keeps a deadline (`DEL_PAUSE_UNTIL`), so a second repaint inside it keeps Delete off.
  A community read that THROWS marks the fresh plan `readFailed`, and a mismatch then says "Kosmos could not read part of
  what is left of this agent just now"; a read failure communitysend answers inside itself (true, or 1) still reads as
  "changed" (review 2's note).

- **Review 5:** the size step is `floor(log10(n))`, with none (0) a step of its own, so it falls at the powers of ten
  (9 and 10 differ, 10 and 99 do not). A pause timer leaves Delete off while a delete of the dialog's agent is running
  (`DEL_RUNNING_FOR`), which `paintLeftoverRunning` turned off.

- **Review 6:** a delete that got no answer, whose plan asked again promises something other than the dialog's, says
  "We could not reach the board just now, and what Kosmos would do here is different now. Look at what it says now
  before deleting." rather than "still here. Try again." The size-step comment now says plainly that a for-good folder
  may grow up to tenfold without a refusal (the name is typed there). Left, as safe: a flapping drive probe refusing
  more than once, and a refusal dropped after the dialog is reopened.

## Weakest part of this reasoning

The `confirmed === undefined` exemption. A future production caller of `del`/`delAsync` that forgets to pass `confirmed`
gets today's unchecked behaviour silently. It is pinned only by the test that the route passes it and that the route
holds one delete call. What would change my mind: a second production caller appearing; then the exemption should go
and the tests should pass `confirmed` explicitly. Second weakest: the community-account field reads
`communitysend.hasAccount`, which answers "yes" when it cannot tell. A flapping answer would refuse a delete that did
not really change; the refusal is safe (nothing touched, the dialog repaints) but could repeat. Third (review 3): on a
flaky drive the Recycle Bin probe can time out on one read and answer on the next, so "for good" and "Recycle Bin" can
alternate between the dialog and the delete and refuse more than once in a row. Each refusal is true and touches
nothing; what would change my mind is seeing it repeat in practice, and then the probe's 5 s failure keep is the place
to look, not the fingerprint. Fourth (review 4): the size step is a bucket, so a for-good folder can still grow up to
nearly tenfold inside one step (3 files to 9) without a refusal, and a tiny write that crosses a power of ten (9 to 10)
is refused. A finer rule would refuse ordinary writes; a refusal touches nothing.

## Callers checked

`grep` for `delete-leftover'` and `leftover.`: `server.js` route (the only `delAsync` caller); `accountmove`, `create`,
`discover`, `remove`, `teamseed` use only `deletingName`, `deletingNow`, `startsAgainWords`, `settingsLeftovers`.
Page: `web/index.html` del-go handler is the only DELETE sender.

## Tests

- New `engine/delete-leftover.win32-confirmed-plan-8477.test.js` (10; "win32" in the name so the Windows CI job selects it,
  as windows-tests-1777 requires for its host-branching skip). Review 1 added: unsent posts appearing after the dialog
  opened, refused with `requestRetire` never called, and the same delete runs once confirmed; the typed name dropped on
  the same task-only act still runs, and newly asked for is refused by the typed check with the plan sent back. Both
  fail on the round-0 engine. Round 0's 8: fingerprint present and stable; task-only confirmed then
  the folder back, refused, nothing touched, fresh plan returned; same plan runs (task-only and full to the Recycle
  Bin); Recycle Bin confirmed vs for good now refused, and the reverse; `confirmed: null` refuses the full delete and the
  raced case, still lets the task-only delete run; no `confirmed` key unchanged; `delAsync` refuses the same way; the
  route passes it (source pin). Negative control: 6 of 8 fail on origin's source (the two that pass are the "runs" arms).
- `server.test.js` "kosmos#7825 PR 2": the real route refuses with no fingerprint and with a wrong one (400, settings
  kept), then deletes with the plan's own. Fails against origin's server.js.
- `web.delete-leftover.test.js`: route regex and the #7835 item 6 focus regex updated.
- Browser check `render-settings-leftover-7825.js`: sends the shown plan's confirm, not a fresher `DEL_PLAN`; a
  `changed` refusal repaints with the new plan, Delete off at once (a click then sends nothing), on after the pause, and
  the next click confirms the new plan; typing the shown name enables Delete when a fresher `DEL_PLAN` asks for none.
  Its 4 round-0 checks fail against origin's page; the 2 review-1 checks fail against the round-0 page.
- Policy: fixture-discipline, no-name-refs-3071, engine.reachable, windows-tests-1777, win32-separator-guard,
  windows-coupling-audit-1732, web.api-routes-3957; both browser-check gates.
