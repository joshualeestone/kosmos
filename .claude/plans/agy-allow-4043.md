# agy-allow-4043: the agy bridge allows ask_question (fixes 0.7.01's regression)

Card: #4043. Blocks: the Mac 0.7.03 cut (0.7.01 is held at staging, Baron, 2026-09-27).

## What broke (measured live on the served 0.7.01 bytes, staging sha 926d0663)
The served agyhooks.js wrote the hook into a scratch folder that is not a git project; real interactive agy 1.2.11 ran on
a private tmux socket (`kitty-agylive`); the served bridge reported to a local listener. Status worked (working per
prompt, idle per turn, `from_pane` %0). But on PreToolUse ask_question agy printed "Error: tool call denied by pre-tool
hook": the bridge's `{}` answer is a DENY. An agy agent on 0.7.01 could not ask its person anything.
The #4043 premise ("an empty decision is no decision since agy 1.0.16", from the changelog) was never measured live and
was wrong: agy's own hooks guide says `decision` is REQUIRED (allow / deny / ask / force_ask).

## Measured, three answers, real agy 1.2.11 (the served bridge with only its PreToolUse answer changed)
- `{}`: denied. `{"decision":""}`: denied (the 1.0.16 note does not make it neutral).
- `{"decision":"allow"}` (agy launched with --dangerously-skip-permissions, as the supervisor does): the question shows
  and waits (needs_you 12:38:13, working 12:38:35 when answered), then idle on the reply. Cancelled with Escape: working
  then idle, so the card clears (release check 4).

## Change
- `bin/agy-report-bridge.js`: PreToolUse answers FROM THE PAYLOAD (review 1): `{"decision":"allow"}` when the tool is
  ask_question, and `{"decision":"ask"}` (agy's own permission prompt) for any other tool, a missing or unparseable
  payload, or a crash before an answer (an exit-path fallback). Every other event still answers `{}` first.
  Why not the event name alone: the matcher `^ask_question$` should keep other tools away, but only PostToolUse's
  matcher is documented as honoured (since 1.1.9); PreToolUse's is assumed. And the hooks file is read by ANY agy started
  in that folder, including a person's own run by hand without --dangerously-skip-permissions: an event-keyed `allow`
  would auto-allow every tool there (a new fail-OPEN; the old `{}` failed closed).
- Comments in the bridge and engine/agyhooks.js that stated the wrong premise are corrected.
- `engine/agyhooks.test.js`: `agyPreToolOutcome`, a model of agy 1.2.11's measured contract (missing/empty decision
  denies); the bridge's REAL stdout (spawned as agy runs it) must come out `run`. Controls: restoring `{}` or
  `{"decision":""}` reds it (and the exact-answer tests).

## Live check of THIS branch's bridge (12:41-12:42)
hello: working, idle. ask_question answered (Red): needs_you "Which colour do you prefer?", working, idle; the question
screen waited. ask_question skipped (Escape): needs_you, working, idle. No denial.

## Live check of the payload-keyed bridge (12:45-12:47)
- A, the real hook, ask_question answered: the question showed and waited 19s; needs_you "Which colour do you prefer?",
  working, idle. No denial.
- B, the matcher deliberately widened to `.*`, agy with --dangerously-skip-permissions, `ls -la`: ran normally, so `ask`
  is agy's normal permission flow, not a deny.
- C, the same without the flag: agy showed its own "Run this command?" prompt. An unexpected tool is neither
  auto-allowed nor denied: the fail-safe holds.

## Rejected
- `ask` for ask_question too: prompts the person for permission before the question, a second prompt for no reason.
- `allow` keyed on the event name alone (this branch's first commit): fails open if the matcher is not honoured (above).
- `{}` for unexpected tools: a deny; `ask` keeps agy's own permission flow instead.

## Weakest premise
Measured on agy 1.2.11 only. `ask`'s meaning comes from agy's guide and runs B/C, not from a contract test; an agy that
changed `allow` or `ask` would need the live check again. The contract test models 1.2.11, it does not run agy. The
PreToolUse matcher being honoured is still assumed, which is why the answer no longer depends on it.
