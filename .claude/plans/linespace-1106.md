# linespace-1106: message line spacing 1.6 in the project room

Josh, 2026-11-06 (relayed by Splinter 18:04): "yes 1.6", picked from Files/kosmos-line-spacing-options.png.

## Finished looks like
- The project room draws a message paragraph at line spacing 1.6 (24px per line at 15px), in Chromium and WebKit, light and dark.
- A browser check measures the drawn height per line, is wired into tools/browser-checks.sh and the README, and reds on 1.55.

## Change
- web/index.html `.msg p { line-height: 1.55 }` to 1.6. Nothing else.

## Out of scope, on purpose
- The agent chat. dmRow writes its words straight into .msg-bd (no <p>), so it takes the body font (13px/16px) and `.msg p` never reached it. The options picture said both threads were 1.55; that was true only of the room. Splinter's ruling 18:08: ship the room, leave the agent chat out of this PR; a separate picture (Files/agent-chat-line-spacing-options.png: 16, 17, 18, 21 px per line) goes to Josh first.
- Other 1.55 values (.dhint, .usage-method, line ~10372) are hints and notes, not message threads.
- iPhone: `git grep lineSpacing origin/main -- ios/` finds nothing, so it uses the system default; no change.

## Weakest premise
- That nothing else in the room overrides `.msg p` in some state (new look, plus-active, phone width). Grep found no other line-height on .msg/.msg-bd/#pj-room, and the check measures the computed value, but only at desktop width with the default look.
