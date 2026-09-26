# auto-restart-4006 (hotfix: items 1 and 2 of #4006)

Card: joshualeestone/kosmos#4006. Josh's Grok agent Elon (2026-09-26): about a minute after an ordinary turn end,
grok's Notification hook ("Waiting for your next prompt") was reported as needs_you by:auto; the class-1 auto-handler
read that as Claude Code's folder-trust prompt and restarted Elon; the restart did not come back and nobody was told
(23 minutes dead). Splinter 12:01: it fired again at 11:52; every quiet Grok agent is being restarted and losing its
conversation. Ship (1)+(2) now as a hotfix; (3) surfacing, (4) launchctl diagnostics and the retry follow in a
separate branch.

## Change
1. `bin/grok-report-bridge.js`: `Notification` is no longer mapped (reports nothing). Kosmos always launches grok with
   --always-approve / bypassPermissions, so there is no permission prompt for it to be about; Stop / StopCancelled /
   StopFailure already report the turn's end.
2. `engine/class1-autohandle.js`: `standingFromAgent` carries the card's `runner`; `planClass1Handle` returns `none` for
   any runner other than Claude (empty or 'claude'). The handle exists for Claude Code's trust/bypass prompt, which no
   other runner has (create.trustAgentFolder is already a no-op for grok).

- `engine/groksettings.js` HOOK_EVENTS drops Notification too (a test pins it equal to the bridge's map), so new
  agents' hook files no longer fire the bridge for it; existing hook files still list it and the bridge ignores it.
- A card whose runner is null (a paneless win32/remote row that could not say what it runs) is NOT eligible: fail
  closed, since a restart on the wrong runner cannot be undone. A paneless Claude agent is therefore no longer
  auto-handled; it stays red for a person, which is the safe direction.

## Decided
- Gemini's bridge keeps its Notification -> needs_you: under yolo it should not fire for tool approvals, and it may be
  the only signal for a real "needs you" such as #4004's quota prompt. The runner gate means it can never trigger a
  restart. Antigravity has no report bridge.
- Gate on runner rather than on the words "Waiting for your next prompt": the words are one runner's current text;
  the runner is the structural reason the handle does not apply.

- Deferred to the follow-up branch: bin/class1-autohandle.js's dry-run CLI reads selfreport (no runner), so its plan
  output still lists a grok agent; it acts on nothing.

## Weakest premise
- That a grok Notification is never a real attention signal under --always-approve. If grok later fires one for
  something that does need the person, it will be missed rather than shown; a missed signal is recoverable, a
  restart that loses the conversation is not.

## Tests
- grok-report-bridge.test.js: the turn-end Notification (and any Notification) reports nothing; a Stop CONTROL still
  reports idle. Re-adding the mapping: red.
- engine/class1-autohandle.test.js: grok/gemini/codex/antigravity plan `none`, Claude (empty/'claude') still
  trust-and-restart; sweepOnce end to end restarts the Claude control and not the Grok agent. Removing the gate: red.
