# Plan: project-page-761

Josh, 2026-08-24 21:56: "I have to hard refresh the page to get files in
this project to refresh" and "I created three new tasks and assigned them
but I don't know that the agent was notified." Two fixes on one branch,
both scoped to the project page and both unblocked by Angel's #809 engine
merge (the `stamp` field on `listFiles`, and the `heard` delivery verdict
on task-create/reassign).

## Scope

1. **Files card never repaints.** `pjLoadDocs` painted once, on
   `openProject`, and nothing repainted it after. Put it on the 5s poll
   (`tick()`), gated on the project view actually being on screen, and
   make `pjLoadDocs` itself skip its repaint when the folder's `stamp`
   has not moved -- otherwise the poll blanks the list for a beat every
   5 seconds.
2. **Nobody says the agent was told.** `heardBy` (server.js, #809) already
   computes a three-state delivery verdict (`placed` / `could_not` /
   `unconfirmed`) for New Task and task-part reassignment, and neither
   surface said anything about it. Add `heardSentence`/`spokenHeard` and
   wire both call sites.

## Steps

- [x] `tick()`: call `pjLoadDocs(PJ_CURRENT)` when the project view is open.
- [x] `pjLoadDocs`: stamp-based skip-repaint (`PJ_DOCS_STAMP`), with a
      `PJ_DOCS_OK` flag so a transient failure between two identical
      successes cannot leave a stale error on screen forever (the same
      "need a hard refresh" bug, relocated).
- [x] `openProject`: reset `PJ_DOCS_STAMP`/`PJ_DOCS_OK` on switch, so a
      stale stamp from the project just left does not read as "nothing
      changed" against the new project's first read.
- [x] `heardSentence(heard)` / `spokenHeard(p, heard)`: the three states,
      three sentences; `spokenHeard` translates the wire's raw
      `sessionName` to the display name the same way every other
      member-facing sentence on this page already does.
- [x] Wire into `nt-go` (New Task) and `tkPartPost` (task-part actions),
      both set AFTER `pjReload()`/`leaveNewTask()` so the sentence
      survives the repaint that would otherwise wipe it.
- [x] Tests in `web.project-page.test.js` for all of the above, built
      through `test-support/fleet` + `engine/projects` per this repo's
      fixture-discipline lint (no hand-built roster objects).

## Independent review (self, since /code-review stalled twice in this
   session's forked-agent context -- see proof file)

- [x] `pjLoadDocs` had no epoch guard: two callers (`openProject`'s
      immediate call, and the next `tick()` poll) can race on a slow
      fetch, and an older response resolving after a newer one would
      overwrite fresher data with stale. Same class of bug as `PLUS_EPOCH`
      (#743), fixed here with `PJ_DOCS_EPOCH`. Covered by a new test that
      dispatches two overlapping calls and resolves them out of order.
- [x] Confirmed `tkPartPost`'s captured `msg` DOM reference survives
      `pjReload()` (which calls `paintTaskPage()`, which only rewrites
      `#tk-who`'s innerHTML, never touches `#tk-msg`) -- not the same
      stale-target bug `dropMemberTarget()` was built to fix earlier this
      session.

## Verification

- [x] `node --test web.project-page.test.js` -- 9/9.
- [x] `npm test` (full suite) -- 0 failures (one `site-deploy-export`
      failure on the first combined run was contention, not this change;
      reran that suite alone, 0 failures, unrelated to any file this
      branch touches).
- [x] `bash tools/browser-checks.sh` -- all page checks passed, twice
      (once before the epoch-guard fix, once after).
