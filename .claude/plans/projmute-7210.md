# projmute-7210: per-project notifications (All / Mentions only / Muted)

Card: kosmos#7210 (Josh, 2026-10-26 10:33 CDT, #admin: "You ever figure out a way to mute projects so that I can
select the notifications on a project-by-project basis?"). The builder decides the options and placement; Josh adjusts
after trying it. Design shots before merge. The call is written on the card (comment 6421068332).

## What it does

| level | phone push from the project | new-message sound | unread count |
|---|---|---|---|
| All (default) | as today | as today (the per-device sound switch still applies) | yes |
| Mentions only | needs you, a post naming you, work waiting for your check; NOT any other room post | off | yes |
| Muted | none | off | yes |

- **engine/projects.js**: `notify` on the project record. `'all'` is never stored (absent reads as all, as every older
  record does); anything but the three words is refused by `edit`. `notifyLevel(id)` reads 'all' for a project not
  found or an unreadable store (never quieter than chosen). The view carries `notify`.
- **server.js**: `PUT /api/project/:id {notify}` only from the person's screen (`isViaScreen`), else 403, as the folder
  move does: an agent must not quiet the person's project (it could hide its own needs_you). The phone module asks the
  project's level through `phonenotify.setProjectLevel(projects.notifyLevel)`, wired once at load. The needs_you
  (self-report) and ready (task built) sends pass `levelProjectId`, a board-only field never in the payload; a room
  post already carries `projectId`.
- **engine/phonenotify.js**: `levelAllows` runs before the cooldown, so a muted event spends no window. An event with no
  project (a crash loop, a stuck terminal, an answer to the person) belongs to an agent and is never muted.
- **web/index.html**: a three-way choice in project settings above the sound switch, saved as chosen (a sequence number
  keeps a late answer from repainting over a later choice; a refusal puts back the board's value and says why). A label
  beside the title ("Muted" / "Mentions only") when not on All opens the settings. The new-message sound rings only for
  a project on All.

## Decisions

- **On the board, not the browser.** The ask says it follows the person; the Mac app, web board and phone all read one
  board, so no sync is needed. Rejected: a per-device setting like the #2407 sound switch.
- **Mentions only keeps "work waiting for your check" (ready).** It is addressed to the person. WEAKEST PREMISE of the
  build: if that is too noisy, it moves to off in one line of `levelAllows`.
- **Muted silences needs_you from the project too**, as the card asks ("silences that project's sound, banner and phone
  push"). What would change it: Josh saying Muted should still let needs_you through.
- **No Mac banner.** The Mac app raises no system banners today (native-app/main.swift asks no notification
  permission); its signals are the sound, the dock badge and in-page notices, so there is nothing to silence there.
- **Person-only.** An agent's token is refused even though agents may rename or pause a project.

## Deliberate gaps

- The dock badge (counts.waiting) is not muted: it counts agents waiting on the person, not messages, and belongs to
  agents rather than projects.
- An event whose project cannot be told (a needs_you with no project in its self-report) is never muted.

## Tests

- server.projmute-7210.test.js: engine keeps/refuses/reads; route 403 for agent token and bare request, 200 from the
  screen; push gating per level with an All control, the no-project arm, no payload leak, no cooldown spent.
  Mutations red: route guard, mute gate, mentions gate, gate removed.
- web.projmute-7210.test.js: the shipped choose/paint functions (mutations red: sequence guard, refusal revert).
- docs/browser-checks/render-projmute-7210.js (new) and render-bubblepop-2407.js (level arm).
