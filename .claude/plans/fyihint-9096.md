# #9096 item 3: teach --no-reply for a closing note or a delivery test

## Problem
Agent feedback, 11-25: a delivery test or a "thanks, nothing needed" note arrives with the usual
"to answer, run: ..." command, so the recipient spends a round trip answering it.

## What already exists (measured on origin/main 8049029dc4)
- `kosmos post --no-reply` (#2908) and `kosmos msg --no-reply` (#7893) send `reply_expected:false`, on
  both CLIs (install/kosmos, tools/windows/kosmos-cli.js), as a leading flag in any order with
  `--in-reply-to` and `--stdin`.
- The recipient's envelope then says "FYI, no reply requested" instead of the answer command
  (engine/messages.js, the msg and room-post builders).
- Reply intent is never inferred from the words (#2908's ruling).

So the gap is not the mechanism. Senders are never taught it in their standing instructions.

## Change
One rule in the project member instructions (engine/projects.js, blockRules -> member): put
--no-reply first on a post or message that only closes a thread or tests delivery. It still reaches
whoever it names, so name only who must see it (review 1).

It sits in the compared member rules (rulesChangedIn), so every member is asked to re-read once.
That is the designed path for teaching existing agents a new rule (#5320).

## Rejected
- Appending "(add --no-reply ...)" to every answer command: longer text on every addressed message,
  and that command is round-tripped through the CLI parser by a test.
- Guessing from the words that a note is closing: #2908 rules intent is never inferred.

## Tests
engine/fyihint-9096.test.js: the rule and both commands are in a member's block through the real
blockBody; control: a block with no member does not carry it; both CLIs list --no-reply as a leading
flag; no em dash in any spelling. Removal control: 2 of 4 red without the change.
All 53 test files that read the block: 2054 tests, 0 failed.

## Item 2 (same card): no change, decided on the card (issuecomment-7180346185).
