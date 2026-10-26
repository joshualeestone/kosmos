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

- RETRACTED (review 2): this plan first said the Dock badge counts only agents waiting on the person, so it was left
  alone. False: counts.waiting adds counts.projectsUnread (engine/status.js waitingTotal; native-app/main.swift says
  "needs-you + unread DMs + unread project messages"). Now a project on Mentions only or Muted is left out of
  projectsUnreadTotal (the Dock and Windows taskbar badge, and the Projects tab badge) and of the page's Messages tally
  (pjDmTotal), which must agree with it; the open room is subtracted only when it is on All. Its own row keeps its count.
- An event whose project cannot be told (a needs_you with no project in its self-report) is never muted.
- A needs_you is attributed to the project in the agent's self-report, carried forward; an agent that moved to another
  project without reporting it is muted or not by its last-reported room (review 1, accepted: it follows "work in a
  muted room", and a report naming the new project corrects it).

## Challenge loop
- Iteration 1 (sonnet): no BLOCKER or WARNING. N3 a save answered after a later choice was dropped from the page's
  cache, so a later refusal put back an older level -> FIXED (kept, only the paint waits; test). N1 carried project
  -> accepted above. N2 tokenless local Origin passes isViaScreen -> pre-existing, same as pause. N4 copy -> fine.
- Iteration 2 (opus): W1 going back to the held level while a save was in flight sent nothing, so the earlier save
  landed and the board held a level the choice no longer showed -> FIXED (sent while any save is in flight; test).
  W2 the Dock badge premise above was false -> FIXED (quiet projects leave the badge and tally; tests on both sides;
  web.pj-tally-2863's harness now lifts pjNotifyLevel). W3 nothing tested the server's wiring of the project id ->
  FIXED (needs_you through /api/report and ready through the built route, muted and All arms). N4 two doc comments
  above the wrong code -> FIXED. N5 the sound switch reads On while quiet -> a note under it. Mutations red: in-flight
  send, needs_you wiring, ready wiring, badge exclusion.

## Tests

- server.projmute-7210.test.js: engine keeps/refuses/reads; route 403 for agent token and bare request, 200 from the
  screen; push gating per level with an All control, the no-project arm, no payload leak, no cooldown spent.
  Mutations red: route guard, mute gate, mentions gate, gate removed.
- web.projmute-7210.test.js: the shipped choose/paint functions (mutations red: sequence guard, refusal revert).
- docs/browser-checks/render-projmute-7210.js (new) and render-bubblepop-2407.js (level arm).
- Iteration 3 (sonnet): CONVERGED, no BLOCKER or WARNING. N1 the in-flight counter would stay up only if
  #pjs-notify-msg were missing from the page (it ships) -> accepted. N2 another device changing the level while this
  page is on the Agents tab can under-report the nav badge by the open room's unread (about 0 there) until the next
  projects poll -> accepted, self-heals. N3 tally and nav badge use different feeds (pre-existing).
- Design review (Mona Lisa, m428): approved with one should-fix -> FIXED 980dddf2e0: the sound switch is dimmed and not
  pressable while the project is not on All, with the reason under it; on a phone the title label is the bell alone;
  the label looks like a state (no outline, muted ink); All's words end on the sound. Round 2 (m430): approved; one
  light phone shot caught the room before its first read painted (two re-runs showed it painted) -> the shot screen
  now waits for the room's words (be491a20a7).
- Review 4 (opus, on 980dddf2e0): W1 the bell-only label was about 24px wide on a phone -> FIXED (36px min-width, a
  40x36 tap with its ring). W2 the sound switch's handler relied only on the browser skipping a disabled button's click
  -> FIXED (it refuses itself; test). N3 a disabled switch's description is not reached by Tab (the note is visible
  above it in reading order) -> accepted. N4 hover tint on the quiet label -> kept for mouse users.
