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
