# codexhooks-4589: never type into Codex's "hooks need review" dialog

Card: joshualeestone/kosmos#4589 (Josh, #admin, 2026-09-29 11:42; priority).

## Reproduced (2026-09-29, this Mac, Codex 0.149.1)
Scratch folder with a project `.codex/hooks.json` (one Stop, one SubagentStop hook, command `true`), Codex in a
detached tmux pane. Screen 1 (MENU): "Hooks need review" / "› 1. Review hooks" / "2. Trust all and continue" /
"3. Continue without trusting (hooks won't run)" / "Press enter to confirm or esc to go back". Typing a message
plus Enter, as Kosmos does, lands on screen 2 (TABLE): "⚠ 2 hooks need review before they can run." / the
per-event table / "Press t to trust all; enter to review hooks; esc to close" (the card's words). The message
was gone entirely. Esc returns to an empty prompt. Nothing was trusted. Both screens saved (path sanitised) in
test-support/codex-screens/.

## Done
- engine/status.js `codexHookReview(text)`: both screens, only when the screen's own footer is the last
  non-blank row (trailing padding dropped first: the MENU draws at the top of a 46-row capture, so a raw
  "last 25 rows" read is all blank). `CODEX_HOOK_DIALOG_SENTENCE`, `isCodexHookEvidence`.
- classify, Codex branch: the dialog first -> needs_you, because "it is waiting on a Codex hook approval",
  evidence = the dialog's row. Before: both screens read "unknown" (measured on main).
- engine/chat.js deliverWithGap: for a Codex agent, a FRESH capture before typing; either screen -> could_not
  with the sentence, nothing typed, not even an option number. Covers every sender (person chat, msg, posts,
  task lines, sweeps, the membership line after create). The snapshot refuses only when the fresh read fails.
  A channel-reached (Windows) agent is skipped: no tmux pane.
- Review iteration 1 removed a first-version pass-through for a bare option number: deliverWithGap cannot tell
  the person's button from another agent's message, and "Trust all" lets hooks run outside the sandbox; the
  person's real button answer also arrives inside the operator envelope, so it never matched anyway.

## Decided
- Refuse-and-keep, not queue-and-send-later: the page records a refused person message in the conversation
  with its reason and keeps the composer text when it is the only copy; kosmos msg keeps a piped copy; the
  person sends again after answering. chat.js is a deliberate no-queue design, and a message delivered
  minutes later by itself can land in a different context.
- Fresh read per send to Codex agents only (one capture): the dialog draws at startup, exactly when the first
  message arrives, so the snapshot is the stale read. Claude agents pay nothing (pinned).
- Not done here: a Kosmos-owned CODEX_HOME (3a). It removes the cause but needs its own sign-in and would stop
  sharing the person's Codex login and settings; a product decision with a migration, better as its own card.
  Never `--dangerously-bypass-hook-trust` (3b).
- The weekly-limit line Codex shows is left to the #4588 class.

## Residuals (named, not closed)
- A capture that comes back blank (Codex has not drawn anything yet) falls back to the snapshot, which at
  startup is usually not the dialog, so the message is typed. Typing into a Codex pane that has not drawn is
  unsafe for reasons wider than this dialog; refusing every blank Codex screen would widen this change past
  the card. The race is also narrow in practice: the first message follows the person seeing the agent on the
  board and typing. What would change this: a report of a first message lost to a blank-screen send.
- The dialog is matched to 0.149.1's footers; a later Codex that draws below them reads as no dialog.
- No answer buttons are drawn for either screen (measured: chat.questionIn returns null on both fixtures), so
  the refusal never meets a button the page offered.

## Weakest premise
That the person re-sending is acceptable as "the held message arrives whole". The words are kept, visible and
one press away; they are not sent by themselves.

## Tests
engine/chat.codex-hooks-4589.test.js (9). On main's engine, the same delivery to either real screen reports
"placed" with Enter typed and the card reads "unknown" (control script, measured).
