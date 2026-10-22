# rmguard-3417: Claude's dangerous-rm check never reaches the person, and stays a guard

Card: joshualeestone/kosmos#3417 (Josh 2026-10-22 11:25: "I shouldn't get these warnings").

## Done means

An agent Kosmos launches that runs `rm -f "$S"/*.png` gets no "Needs permission" and nothing in chat, and the rm does
NOT run unguarded: the agent is told why and how to rewrite it, and retries safely. Proven against a control.

## Measured first (Claude Code 2.1.308, interactive, --dangerously-skip-permissions, 2026-10-22 11:28)

- No hook (control): the prompt Josh saw ("Dangerous rm operation on possibly-empty variable path ... automatically
  deny in 1:36"); the file stays.
- PermissionRequest hook answering allow (what Kosmos ships today): no prompt, "Allowed by PermissionRequest hook",
  the rm RAN. So Kosmos agents already auto-ACCEPT this check silently; Irma saw it only because fleet bots launch
  without Kosmos's --settings file.
- Hook answering deny with a message: no prompt, the agent read the message and retried with `"${S:?}"/*.png`, which
  ran with no prompt.
- The hook input carries no reason field (permission_suggestions: []), so the hook must recognise the shape itself.

## Decision: (b), deny with the rewrite hint, for this check

Accepting removes the only guard against `rm -f /*.png` / `rm -rf "$X"/` when the variable is empty, and a delete
with no other copy is irreversible. Denying keeps the person seeing nothing (Josh's ruling) and costs the agent one
retry. Josh can flip it to (a) by removing the rm branch in decide().

## Build

1. engine/kosmos-permission-allow.js: decide() returns a deny with a message for a Bash command whose rm segment
   has a path starting with an unguarded variable ($X/, "$X"/, ${X}/, "${X}"/). Guarded forms (${X:?}) and literal
   paths still get allow. Everything else unchanged.
2. engine/kosmos-report-hook.js kosmosAllows: comment says "answers" (a deny also means no prompt, so working).
3. Tests in engine/agentpermission-5406.test.js (or a new rmguard test file): the deny shape, guarded/literal forms
   allowed, rm-not-first-word and non-rm commands allowed, message names the variable.

## Weakest premise

The shape test is a text heuristic of Claude's own check. A shape Claude flags that I do not match still gets allow
(today's behaviour, no prompt); a shape I flag that Claude would not costs the agent one retry. Neither shows the
person a prompt.

## Out of scope

Fleet bots (Irma etc.) launch without Kosmos's --settings, so they still see Claude's prompt; that is the shared
launchers, routed to Splinter. The raw dump in chat is #6727.
