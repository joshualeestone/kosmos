# Plan: the Task-Settings reveal button for task conversations (#992, slice 2)

## Context
#992 gave tasks a transcript (engine/taskchat.js, a per-task append-only JSONL
store under app data), merged in PR #2305. Josh's ask was REACHABILITY, not just
recording: *"a button that I can use to open and find that dialog"*, in BOTH
project and task settings. The project half already shipped (#969: a "Show me
where the conversations live" button in Project Settings → POST /api/chats/reveal).
This slice is the task half — plan follow-up #1 of the merged engine slice.

## What this delivers
- **server.js** — POST /api/task-chats/reveal, the task-side companion to
  /api/chats/reveal. Opens taskchat.taskChatsDir() (<data>/task-chats) via
  projects.revealFolder; 409 when the dir does not exist yet (an answer, not an
  error); 409 with the Finder message when open refuses. The cross-site write
  guard is inherited (crossSiteWrite runs before every route).
- **web/index.html** — a "Show me where this task's conversation lives" button in
  the task view (#pj-task-view, the "This task" aside), with a hint and a live
  message element, plus a click handler mirroring pjs-chats-reveal exactly
  (disable / say nothing / ask / report).
- **server.projects.test.js** — a route test mirroring the #969 chats-reveal test:
  the cross-site 403 (guard inherited), the empty-dir 409, the 200 that opens the
  right folder, and the Finder-refused 409.

## Decisions (Josh decide-and-continue)
- **Global by name, opens the FOLDER, mirroring #969.** Every task's transcript is
  one flat file in ONE directory, and this codebase deliberately opens the folder
  rather than `open -R`-selecting a single file (see the projects.revealFolder
  docblock: an earlier `open -R` ruling was reversed). So the route is
  /api/task-chats/reveal (global), not /api/task/<projectId>/<n>/reveal which
  would promise a per-task destination the storage does not give. The button copy
  says so ("one folder, with a file for each task's conversation") — the same
  honesty the #969 project button carries.
- **No new store work.** taskchat.taskChatsDir() already exists and is exported;
  this slice only reveals it.
- **Verified server-side, no browser check.** #969 shipped its reveal button with
  a server.projects.test.js route test and NO docs/browser-checks entry; this
  mirrors that. The route + button are small and the behaviour that matters (the
  route's states) is unit-testable.

## Rejected
- A per-task route/URL (/api/task/<id>/<n>/reveal): rejected because the store is
  a flat dir and the codebase opens folders not files, so per-task params would
  be cosmetic (every one opens the same dir) and the URL would over-promise.
- Restructuring the store into per-task subfolders so a per-task reveal could open
  a task's own folder: rejected — it would change the just-merged retention-optimal
  flat store for the sole benefit of the reveal, and open -R was already ruled out.

## Weakest premise
That a global folder reveal from a task's view satisfies Josh's "find THAT dialog"
intent as well as it did for projects. It is the same shape he accepted for #969
(a global reveal from a per-project settings page), and the copy is honest about
it; if he wants a per-task destination later, that is a store-shape change (see
Rejected) and a separate decision. Reversible: the route and button do not change
the store.

## Challenge-loop iteration 1 (2026-09-05): copy fix (global framing)
Fresh review found one CONVENTION: the button label said "this task's
conversation", reintroducing the per-scope framing the sibling pjs-chats-reveal
button deliberately avoids (it says "the conversations", with a comment explaining
a global-folder reveal must not be framed as per-scope). Fixed: label is now
"Show me where the task conversations live", matching the sibling, and the comment
now carries the same 🛑 reasoning so it is not reintroduced. Three STRENGTHs (route
is a line-for-line mirror of /api/chats/reveal with the guard inherited and a
server-derived path; test mirrors #969 arm-for-arm; handler mirrors pjs-chats-reveal).

## Challenge-loop iteration 2 + the #1720 gate (2026-09-05)
Iteration 2: converged (1 NIT mirroring the #969 sibling test's exact lifecycle,
deferred; 4 strengths). The 6j gate then flagged #1720 (a web/ change with no
docs/browser-checks/ assertion). Resolved the PREFERRED way (a real assertion, not
a trailer): render-tasks.js already opens #pj-task-view and has a page-error net,
so added a visibility assertion for #tk-chats-reveal there. Coverage now: route +
fail-soft behaviour by the server route test; presence + wiring by render-tasks.js
at step-3b; per-pixel contrast by .btn class-equivalence (render-fields.js only
visits the initial screen -- it does NOT traverse the task view, so it does not
directly check this button's styling). FOLLOW-UP (noted, not this slice):
extend render-fields.js to traverse #pj-task-view so task-view buttons get a
direct contrast assertion.
