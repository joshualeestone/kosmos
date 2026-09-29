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

## Residuals (current, after three separate reviews)
- The dialog can draw in the gap between the one fresh read and the paste (a few chunks). Not closable without a
  read-after-paste that cannot un-type anything.
- A Codex launched through `node` (not the native binary Kosmos installs) reads as Claude until its runner tag lands.
- A future Codex that rewords either footer is not recognised.
- "Codex always draws its composer or a dialog, so a blank read is transient" is reasoned, not measured: a blank or
  failed read refuses and the sender is told to send again; the outbox retries COULD_NOT, the sweeps retry next tick,
  and one-shot lines (membership, task heard, room fan-out) report it to the sender, as the Claude trust refusal does.
- Under dry-run the rule is skipped (nothing is typed anyway, and the dry-run answer is the true one).

## Weakest premise
That the person re-sending is acceptable as "the held message arrives whole". The words are kept, visible and
one press away; they are not sent by themselves.

## Tests
engine/chat.codex-hooks-4589.test.js (19): all three real screens, wrapped at 50/30/20 columns, blank and failed reads,
Stop now's keys, an untagged native pane, option digits 2/3/t, the stale-snapshot and prompt controls. On main's engine
the same delivery to either real screen reports "placed" with Enter typed (control script, measured).

## Blind review round 1 (a separate reviewer agent, 2026-09-29 13:21) and what changed
Earlier "rounds" on this branch were the loop reviewing its own work; this is the first separate reviewer.
- A fresh read that comes back BLANK (Codex still drawing at startup) used to fall back to the startup snapshot and
  type the message as raw keystrokes (paste-buffer without -p), where a "2" or "t" landing on the dialog trusts the
  hooks. Now refused: "it is still starting (its screen is blank), so nothing was typed". Tested with '' and blank rows.
- The footer on a narrow pane (under ~58 columns) wraps, and a last-row match missed the dialog. Now matched at the
  end of the last three rows with whitespace ignored (a wrap may fall inside a word). Tested at 50, 30 and 20 columns,
  with the quoted-then-prompt control.
- The #571 gap test now feeds the capture a real idle screen (a blank capture is refused by design).
Residuals, stated precisely: the claim is that no MESSAGE is typed into the dialog. Stop now (Escape) and the stop
helpers (C-x C-k) are key actions, not messages, and still act on a Codex pane in the dialog; Escape there means "go
back / close". A future Codex that changes the footer words is not recognised.

## Blind review round 2 (Sonnet, a separate reviewer, 2026-09-29 13:25) and what changed
- One rule for messages AND keys: `codexScreenRefusal` (chat.js), used by deliverWithGap and keysAllowed. Stop now's
  Escape and the stop helpers' C-x C-k no longer reach the dialog (the round-1 "messages only" residual is closed).
- A fresh read that FAILS now refuses ("we could not see its screen"), instead of trusting a startup snapshot.
- A native `codex` pane read before its runner tag lands is Codex (status.js card.runner, as Grok/Antigravity already).
Kept, with the reason: a blank screen still refuses. Codex always draws its composer or a dialog, so a blank read is a
transient redraw or startup; the sender is told to send again, and the next read decides (not a permanent trap).
Residuals, stated: the dialog can draw in the gap between the read and the paste; a Codex launched through `node`
reads as Claude until its tag lands; a future Codex that rewords the footers is not recognised.

## Blind review round 3 (Opus, a separate reviewer, 2026-09-29 13:37) and what changed
No blocker, no false refusal of a healthy agent found; confirmed every sender goes through the rule and COULD_NOT
callers retry. Changed: the Codex check now runs after the free paused-swarm check; it is skipped under dry-run; the
command fallback applies only to an UNTAGGED pane (a pane tagged claude or gemini keeps its tag); stale comments fixed;
this plan's residuals rewritten to match the code.

## Blind review round 4 (Sonnet, a separate reviewer, 2026-09-29 13:42)
Nothing above WARNING; no path types into the dialog and no false refusal of a healthy agent. The WARNING (the dry-run
skip had no test) is fixed and the skip itself narrowed to tmux()'s own rule, "dry-run with no injected runner"; both
directions pinned. Dead constant removed, comments placed and corrected. Noted for a follow-up, out of scope here: only
the hook dialog's two footers are guarded; other Codex startup prompts (directory trust, which Kosmos pre-answers by
writing trust_level, and model migration) are not.

## Blind review round 5 (Opus, a separate reviewer, 2026-09-29 13:48) and what changed
One WARNING, and it was real: Enter on the table opens a THIRD screen, one hook's review, which had never been
captured. Captured live the same way (test-support/codex-screens/hook-review-hook-0.149.1.txt, path sanitised): its
footer is "Press t to trust; esc to go back", so a single "t" in a pasted message would have trusted that hook. Now
recognised (footer at the end of the last rows, plus its own "needs review" line or a "[!] Hook N" row), tested at
full width and at 30 columns, with the footer-alone and quoted-then-prompt controls; removing the branch fails it.

## Blind review round 6 (Sonnet, a separate reviewer, 2026-09-29 14:06)
Nothing above WARNING; the WARNING was real: on the per-hook screen a long hook command (an inline script) pushed both
anchors above the last 30 rows, so the screen was missed and a "t" would have been typed. Now anchored on the constant
"Trust ... review required" row just above the footer, and the other anchors are searched over the whole screen; a
40-line command is tested, and reverting to the tail-only search fails it. Stated, not changed: Stop now is refused on
a blank or unreadable Codex screen too (the safe direction; a wedged Codex agent is stopped from its terminal); the menu
is told apart from other Codex popups by its "Hooks need review" title, not by its footer (which may be generic).

## Blind review round 7 (Opus, a separate reviewer, 2026-09-29 14:09)
Two WARNINGs, both real, both fixed:
- A long hook command AND a narrow pane together hid every per-hook anchor. The Trust row is now also matched on the
  last rows joined with whitespace removed; tested with an 80-line command at 30 and 20 columns (removing it fails).
- The per-hook page for an event with TWO hooks (the desktop plugins' "Stop 2 0 2" case) had never been captured.
  Captured live (test-support/codex-screens/hook-review-hook-two-0.149.1.txt): same footer, a "[!] Hook N" row per hook,
  the Trust row; recognised and tested.
Floor, stated (NIT): below about 15 columns the menu, and below about 12 the table, are not recognised.
The round-1 residual paragraph about Stop now's keys is superseded by round 2 (keys obey the same rule).

## Blind review round 8 (Sonnet, a separate reviewer, 2026-09-29 14:13)

Nothing above NIT. NITs: this test count was stale (fixed to 19); the menu is recognised by its title plus footer, so a renamed title goes unrecognised (already a stated residual); a truly empty screen right after `clear` is refused as still starting until the composer redraws (transient, reasoned not measured). Converged.
