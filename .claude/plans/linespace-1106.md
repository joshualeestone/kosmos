# linespace-1106: message line spacing 1.6 in the project room

Josh, 2026-11-06 (relayed by Splinter 18:04): "yes 1.6", picked from Files/kosmos-line-spacing-options.png.

## Finished looks like
- The project room draws a message paragraph (every message from Kosmos's own agents and people) at line spacing 1.6 (24px per line at 15px), in Chromium and WebKit, light and dark.
- A browser check measures the drawn height per line, is wired into tools/browser-checks.sh and the README, and reds on 1.55.

## Change
- web/index.html `.msg p { line-height: 1.55 }` to 1.6. Nothing else.

## Out of scope, on purpose
- The agent chat. dmRow writes its words straight into .msg-bd (no <p>), so it takes the body font (13px/16px) and `.msg p` never reached it. The options picture said both threads were 1.55; that was true only of the room. Splinter's ruling 18:08: ship the room, leave the agent chat out of this PR; a separate picture (Files/agent-chat-line-spacing-options.png: 16, 17, 18, 21 px per line) goes to Josh first.
- Other 1.55 values (.dhint, .usage-method, .fr-body p in first run) are hints and notes, not message threads.
- A message from outside Kosmos in a shared project (`.msg.ext`, words in `.msg-ext-tx`, no <p>) is drawn at 13px/16px, on main and here alike. Same kind of gap as the agent chat, inside the room; it goes to Splinter with the agent chat question, not into this PR (review 1).
- iPhone: `git grep lineSpacing origin/main -- ios/` finds nothing, so it uses the system default; no change.

## Weakest premise
- That nothing else in the room overrides `.msg p` in some state. Review 1 measured it: default and new look, no class / plus-active / consolidated / both, light and dark, 1100 and 390 wide, both engines, all 64 at 1.600. The committed check covers only desktop width, default look.
