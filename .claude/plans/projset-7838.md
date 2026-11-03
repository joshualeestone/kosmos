# projset-7838: the iPhone project page's Settings (kosmos#7838 slice B) and no tab bar in a room (kosmos#7847)

Cards: kosmos#7838 (Josh, 11-03 04:15: "We need to do the project info screens"; slice A merged as #7846) and kosmos#7847
(Josh, 11-03 06:49: "I don't want to see the nav if I am inside a project").

## Finished looks like

From a project's room a person can rename the project, change its description, choose its notifications and pause or
resume it, from the phone, with the board's own words for each; a cleared name, a refusal or no answer says so. Inside
a project (its room, its page and anything opened from them) there is no bottom tab bar, as in a direct conversation.

## Built

- ProjectInfoView.swift: a Settings segment between About and Files. Name and description (Save changes: only changed,
  trimmed fields; what counts as saved is what was sent), notifications (All / Mentions only / Muted, the board's line
  for each), Pause it / Resume it (the board's paused line, "An agent paused it." when an agent did), a row to the board.
  Choices show at once (pending) and give way to the stored value; after a save the store's live row is read, never the
  save Task's copy of the view. The spinner shows on the saving row.
- BoardRoom.swift: ProjectRow.notify and pausedByPerson; the change body, request and result; the board's sentences.
- RoomView.swift: the tab bar hidden in the room (#7847); `live` and `reload` passed to the page.
- Tests: room LogicTests (the board's sentences checked against web/index.html); ProjectInfoUITests: Settings opens,
  no tab bar in the room (control: the list has one; fails with the old rule), none on a task opened from the page.

## Decided

- Archive stays on the board (what the phone shows after a project leaves the list needs its own design).
- No per-screen tab-bar rule: measured on iOS 27.0 and 26.5, the room's hidden bar carries down the stack.

## Left

- History wording for a late VoiceOver "Saved." after Back (minor).
