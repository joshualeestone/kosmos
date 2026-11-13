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
  the bin; whether the community account is retired; the name to type, or none. Rejected: hashing the dialog text
  (question, reassurance, loses). "Last changed 3 minutes ago" ages while the dialog is open, so it would refuse a delete
  that had not changed and train people to click through the refusal. Rejected: the folder's size and file count. A
  leftover folder is not being written to, and a size change does not change what the act does to it. Short form:
  `1.` + the first 16 hex of a sha256 of the fields (the `1.` lets a later change of fields refuse cleanly rather than
  match by accident).
- **The page sends what the dialog shows, not `DEL_PLAN`.** `DEL_PLAN` can be replaced by the detail page's fresher read
  (`loadLeftover`) while the dialog stays painted with the older plan, which is this card's bug in miniature. A new
  `DEL_SHOWN`, set only by `openDeleteModal` and cleared by `closeDeleteModal`, is what is confirmed.
- **The refusal:** "What is left of this agent changed since you looked, so nothing was deleted. Look at what it says
  now before deleting." It returns `changed: true` and the fresh plan; the page repaints the dialog with it (the #7820
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

## Weakest part of this reasoning

The `confirmed === undefined` exemption. A future production caller of `del`/`delAsync` that forgets to pass `confirmed`
gets today's unchecked behaviour silently. It is pinned only by the test that the route passes it and that the route
holds one delete call. What would change my mind: a second production caller appearing; then the exemption should go
and the tests should pass `confirmed` explicitly. Second weakest: the community-account field reads
`communitysend.hasAccount`, which answers "yes" when it cannot tell. A flapping answer would refuse a delete that did
not really change; the refusal is safe (nothing touched, the dialog repaints) but could repeat.

## Callers checked

`grep` for `delete-leftover'` and `leftover.`: `server.js` route (the only `delAsync` caller); `accountmove`, `create`,
`discover`, `remove`, `teamseed` use only `deletingName`, `deletingNow`, `startsAgainWords`, `settingsLeftovers`.
Page: `web/index.html` del-go handler is the only DELETE sender.

## Tests

- New `engine/delete-leftover.confirmed-plan-8477.test.js` (8): fingerprint present and stable; task-only confirmed then
  the folder back, refused, nothing touched, fresh plan returned; same plan runs (task-only and full to the Recycle
  Bin); Recycle Bin confirmed vs for good now refused, and the reverse; `confirmed: null` refuses the full delete and the
  raced case, still lets the task-only delete run; no `confirmed` key unchanged; `delAsync` refuses the same way; the
  route passes it (source pin). Negative control: 6 of 8 fail on origin's source (the two that pass are the "runs" arms).
- `server.test.js` "kosmos#7825 PR 2": the real route refuses with no fingerprint and with a wrong one (400, settings
  kept), then deletes with the plan's own. Fails against origin's server.js.
- `web.delete-leftover.test.js`: route regex and the #7835 item 6 focus regex updated.
- Browser check `render-settings-leftover-7825.js`: sends the shown plan's confirm, not a fresher `DEL_PLAN`; a
  `changed` refusal repaints with the new plan, Delete on, and the next click confirms the new plan. Its 4 new checks
  fail against origin's page.
- Policy: fixture-discipline, no-name-refs-3071, engine.reachable, windows-tests-1777, win32-separator-guard,
  windows-coupling-audit-1732, web.api-routes-3957; both browser-check gates.
