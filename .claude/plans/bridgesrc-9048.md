# bridgesrc-9048: Grok and Gemini bridges stop reporting `started` on a reopened session (#9048)

## Problem
bin/grok-report-bridge.js and bin/gemini-report-bridge.js mapped EVERY SessionStart to `started`, so a resumed
session landed `started` over the agent's own needs_you or blocked and retired it, though the conversation went on.
The Claude hook reports `started` only for `source: startup` (#1058).

## What the runners send (measured how)
- No Grok or Gemini account is signed in on this Mac (`kosmos accounts`), so neither runner reaches SessionStart in a
  scratch home: both refuse at sign-in first. A live payload could not be captured. Read instead:
- Gemini 0.61.0, installed bundle: SessionStartSource = startup | resume | clear; the payload is
  `{...base, source}`; `resume` when it starts with resumed session data; /clear fires SessionEnd(clear) and then
  SessionStart(clear).
- Grok 1.0.77, its own hooks doc inside the binary: the SessionStart start source is `new` (fresh, including /new and
  /clear) or `load` (reopened via --resume, --continue, /resume); "Claude Code's startup, resume, clear and compact
  never match". The existing grok test already sends `source: 'new'`; the header says `{source}` was measured in 1.0.41.

## Decision
Skip `started` only for the known reopen values: Grok `load`, Gemini `resume`. Everything else (fresh, missing,
unseen) reports `started` as before.
Rejected:
- Copying the Claude rule (only `startup` reports): Grok never sends `startup`, so every fresh Grok start would lose
  `started` and a restarted agent would inherit the old run's state.
- Skipping Gemini `clear` as Claude does: SessionEnd(clear) -> stopped fires first and already replaces a deliberate
  wait, so skipping `started` protects nothing and leaves a live agent showing stopped.
Weakest premise: Grok's `load` is read from its doc (the matcher section), not from a captured payload; if Grok puts
the value under another key, nothing changes (the old behaviour), it does not get worse.

## Tests
grok-report-bridge.test.js and gemini-report-bridge.test.js: one #9048 test each (pure table + driven end to end).
Control: both fail against origin/main's bridges, pass with the change.
