# agentinfo-7267: the agent "i" page is Profile | AI Settings (kosmos#7267, Josh 2026-10-26 18:26)

## Finished looks like
The chat's info button opens a native, styled page for the agent with a Profile | AI Settings segmented control, light
and dark, and never the conversation again.

## Built
- AgentInfoLogic.swift (tested, LogicTests/agentinfo, its own CI step): the agent's /api/status row (parseAgentDetails),
  the board's modelLine with no tense, the runner's mark, reports-to words, the name and role save (PUT .../profile,
  the name only when changed), instructions and skills reads, Fresh start (POST .../compact|clear) with the board's
  dialog words and result sentences.
- AgentInfoView.swift: face, name, role, segmented control. Profile: Name and What they do (editable, Save), Reports
  to (read, shown only with more than one agent, as the board), Instructions (read, 12 lines), Skills (names).
  AI Settings: Runs on (mark, model, account), Memory (how full), Fresh start (Compact, Clear, each confirmed in the
  board's words), More on your computer (the board page, for model, account, restart, Terminal, remove).
- ChatView.swift: the info button opens it (a hidden link on the chat body; inside the toolbar item it never pushed).
  Debug-only KOSMOS_SAMPLE_INFO=profile|ai opens it for shots.

## Decided
- What the phone does here is what the routes let a phone session do without a step-up: name, role, compact, clear.
  Rejected for now: provider/model/account pickers, Restart (the board's restart has a hand-off flow), editing
  instructions (a version-conflict editor), Terminal, Remove. They are one row away on the board page.
- No tense on the model (the board's card rule), so a stopped agent never reads "Right now".
- Weakest premise: that the board page the last row opens is acceptable for those few rarer settings (it is the page
  Josh called unstyled). Would change my mind: Josh wanting model switching on the phone; then a native picker next.

## Review
- Round 1 (agentinfo-7267-review1.md): 0 blockers, 5 warnings, 4 nits, all fixed. The model line decides "not
  running" from the state, as the board's card; Save compares against what the boxes were filled with (a rename made on
  the computer is never undone, the board's #4421); after Save the board's sentences (rename while running names both
  names and says to restart from the computer, partial saves say so, reports-to told); names and roles are cut to 80
  (never a false "could not reach"); the account in the board's order (name, email, API key ending, label); a
  Fresh start refused before delivery says the route's words; result lines are announced to VoiceOver; the mark
  scales with text; shots retaken.
- Round 2 (agentinfo-7267-review2.md): 1 blocker, 2 warnings, 5 nits, all fixed. BLOCKER: the role is the person's
  saved role first (profile.role), then the file's line, as the board reads it, in the fields and the header. The
  fields are locked while a save is in flight; "No instructions yet." only when there is no file (an unreadable one
  says it cannot be read); a failed restart counts as not running for the model line; skills keyed by key; the 80
  cap counted in UTF-16 units, as the route; an empty `was` falls back to the shown name; the Debug sample opens the
  page once a launch.
- Round 3 (agentinfo-7267-review3.md): 0 blockers, 2 warnings, 2 nits. Fixed: the role is the board's roleLine (a
  parsed role matched against the catalogue's labels from GET /api/roles, else a capital first letter only), in the
  fields and the header, so a name-only save never writes "project manager" into the profile; the footer no longer
  offers the Terminal (a phone cannot open it); the reports-to sentence says where to restart. KEPT: the segmented
  control does not grow at accessibility sizes (a system control; still readable).
- Round 4 (agentinfo-7267-review4.md): 0 blockers, 1 warning, 4 nits. Fixed: an agent whose session the phone will not
  put in a request path says its settings are changed on the computer's board (never "could not reach"); an unreadable
  200 says it cannot tell whether it saved; the row reads "More on your computer's board"; the info button's label
  uses the agent's current name. KEPT: the segmented control at accessibility sizes (a system control).
- Round 5 (agentinfo-7267-review5.md): 0 blockers, 1 warning, 3 nits, all fixed. The last row reads "Open on your
  computer's board" and says the board opens on the conversation with AI Settings beside it (the board reads ?sec=
  only for Settings; the deep link to AI Settings is filed as #7280); the segmented control is hidden for an agent the
  page cannot load; the fields are locked until the first read; the after-save sentence follows the board's order when
  both halves could not. Shots retaken at this commit.
