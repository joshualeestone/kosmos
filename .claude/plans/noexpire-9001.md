# noexpire-9001: no phone push for Claude Code's self-declining safety prompt (part 1 of kosmos#9001)

Finished means: when Claude Code shows its own safety check ("Dangerous rm operation not ruled out ...", "Claude Code
will automatically block this request in 1:59"), Kosmos sends no phone push and shows no "Needs permission"; the agent's
card says "Claude Code declined a shell command it could not read safely; the agent will retry it in a safe form". A
prompt that waits for a person still pushes, as today. Part 2 (a hook rejecting the trigger shapes) is a later slice.

## Measured (Claude Code 2.1.331, a throwaway session on a private tmux socket, user settings left out)
- The `${(f)...}` shape in bypass mode drew the safety check with the timed line; the PermissionRequest hook fired.
- The hook's payload has no "self-expiring" field: permission_mode "bypassPermissions", permission_suggestions [].
  CONTROL: a prompt from an `ask` rule in the same mode also says "bypassPermissions" (suggestions absent) and has NO
  timed line. So the mode cannot tell them apart; the screen's timed line can.
- At the moment the hook runs, the timed line is already on screen (captured inside the hook, and again 1 s later).

## Built
- engine/status.js: claudeSelfExpiringPrompt(text) (a Claude permission prompt whose own rows carry the timed line) and
  SELF_EXPIRING_DECLINE (the card line). classify reads that screen as working with the line, never NEEDS_YOU.
- server.js report route: an automatic "asking permission to use ..." needs_you from a Claude agent whose screen shows
  that prompt is recorded as working with the line, so no push and nothing keys "Needs permission" on it. Any doubt (no
  screen, a read that fails, another runner, an agent's own question) keeps the report as sent.
- Fixtures: the two real captures. Test: server.selfexpiring-9001.test.js (route + screen, the control, the doubt arms).

## Rejected
- Deciding in the report hook: it would need a tmux binary inside the agent's pane, which the board already has.
- Deciding by permission_mode: an ask-rule prompt has the same mode and waits for a person.

## Weakest premise
The timed line's wording is Claude Code's ("will automatically block this request in"). If it changes, these prompts
push again (the old behaviour), never the reverse; the fixture pins the wording seen on 2.1.331.

## Round 1 (opus) fixes
- BLOCKER fixed: the check matched the phrase anywhere in the six rows above the question, including the command inside
  the box, so a real prompt for a command quoting it (an agent grepping this code) was silenced. Now it needs, in the
  prompt's own rows: a "Bash command" box, and BELOW the box's closing dashed rule both the safety reason ("not ruled
  out" / "rule out" / "the shell may read") and Claude Code's own timed line (anchored: its warning mark, its words,
  an M:SS countdown). Tests: a command quoting the phrase, even the whole timed line, still waits and pushes; another
  box kind, no reason, no timer, or the words without the mark are not it. Mutations checked (unanchored, any box).
- The card line no longer claims the agent will retry: "Claude Code is declining a shell command it could not read
  safely, by itself; nothing for you to do".
- Typing into the agent while it is up is held with matching words ("declining a command on its screen by itself ...
  send this again in a couple of minutes"), not "answer it in its window".
- Deferred, with reason: install/kosmos-report-hook.sh's header says PermissionRequest fires before the box renders;
  measured the other way on 2.1.331, but older versions may still do that, and editing an installed hook's bytes can
  trip deploy guards. If the hook arrives first, the report stays needs_you and pushes (the old behaviour, safe side).

## Round 2 (sonnet) fixes
- The report is tied to THE prompt on screen: only "asking permission to use Bash: <cmd>" whose command (spacing folded)
  is the start of the command in the safety prompt's box (status.selfExpiringCommand) is rewritten; another tool's or
  another command's real wait, while the safety check is up, is kept and pushes. Mutation checked.
- The warning mark may carry U+FE0F.
- Residual, recorded: a pane frozen on the safety prompt (hung Claude Code) reads as working with the line, not as a
  wait; the stale-report nudge still sees the open prompt. A narrow-pane wrap is joined by viewport's -J; a split
  reason line fails to the old push (safe side).
