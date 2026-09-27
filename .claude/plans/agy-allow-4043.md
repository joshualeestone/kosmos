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
- `bin/agy-report-bridge.js`: PreToolUse answers `{"decision":"allow"}`; every other event still `{}`. Only ask_question
  reaches PreToolUse (matcher `^ask_question$`, honoured by agy >= 1.1.9, which the version gate requires), and with
  --dangerously-skip-permissions `allow` is exactly what agy does with no hook.
- Comments in the bridge and engine/agyhooks.js that stated the wrong premise are corrected.
- `engine/agyhooks.test.js`: `agyPreToolOutcome`, a model of agy 1.2.11's measured contract (missing/empty decision
  denies); the bridge's REAL stdout (spawned as agy runs it) must come out `run`. Controls: restoring `{}` or
  `{"decision":""}` reds it (and the exact-answer tests).

## Live check of THIS branch's bridge (12:41-12:42)
hello: working, idle. ask_question answered (Red): needs_you "Which colour do you prefer?", working, idle; the question
screen waited. ask_question skipped (Escape): needs_you, working, idle. No denial.

## Rejected
- `ask`: prompts the person for permission before the question, a second prompt for no reason.
- Deciding by tool name after reading stdin: the answer is printed first so a crash cannot leave agy without one, and
  the matcher already limits PreToolUse to ask_question.

## Weakest premise
Measured on agy 1.2.11 only. An agy that changed `allow`'s meaning would need the live check again; the contract test
models 1.2.11, it does not run agy.
