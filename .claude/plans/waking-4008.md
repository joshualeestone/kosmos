# #4008: the Sweep loader on "Waking them...", a clear Ready finish, and a Runs on line that updates

Josh, #admin, 2026-09-26 11:58: after switching an agent to Opus 5.5 he sat "staring at the Done button,
waiting for it to go away", with "Waking them..." and no sign of progress; it resolved to "Say hello to
Priya Raman to reactivate them on Claude", and Runs on behind the dialog still said Claude Sonnet 5.

## Done looks like
- "Waking them..." carries the app's own loader (the Sweep dots, Josh's pick, not the .kspin mark) in the
  change dialog (model and provider switch), after Restart, and after Start.
- The change dialog ENDS: its title stops being the question ("Changed to Claude Opus 5.5" / "Switched to
  OpenAI"), the line is "Ready: <agent> is on <model>." behind a green check, and Done becomes the gold
  button with the focus only then. If the hello could not be placed, the line says what to do plainly
  ("<agent> is on <model>. Send them a message to wake them."), no check, Done gold (the wait is over).
- Runs on reads "Right now: <the new model>" once the switch has restarted the agent.
- Shared page code, so Windows gets it too.

## Calls, and what was rejected
- Loader: WAKE_SPIN_HTML is the Sweep markup (.spin.spin-sweep, eight <i>, aria-hidden), inserted in front
  of the words. It carries no text, so the line's textContent stays exactly the waiting sentence, which
  the wake helper matches on (untouched logic). Rejected: the .kspin mark (Josh ruled it is not a loader).
- Finished state lives in autoHelloOnSwitchRestart (the one place that knows the wake finished), with
  two new arguments (what the agent is on, the finished title). Done's gold is removed at every opening.
- Runs on: the live reading comes from the newest transcript, which is the OLD session's until the
  restarted one writes (engine byWorkdir fallback). Rejected changing the engine's transcript choice here
  (a shared engine read used by memory and context too, wider than this card). Instead the page records
  the model a switch restarted the agent on (SWITCHED_MODEL, set only on the engine's "changed") and
  runsOnLine takes it as a PARAMETER (it is lifted by tests) while the agent is running; the record is
  dropped once the live reading agrees. Weakest premise: an agent switched and then changed again outside
  Kosmos before it ever writes a transcript would show the Kosmos switch until the next reload; accepted
  (the record is page-lifetime only).
- Start and Restart keep their own resolved lines (their wording was not what Josh flagged); they get the
  loader on "Waking them...".
- Provider switch names the provider ("Ready: April is on OpenAI.") because that dialog's vocabulary is
  the provider's (#2463), and it does not pick a model.

## Checks
- render-autohello-switch-2716: finished lines updated; new arms on the REAL model and provider switch:
  title, check, gold Done with the focus. 7 of 21 red on the page without the change.
- render-model-restart-interstitial: new arm, the waiting line carries the Sweep loader (8 dots,
  aria-hidden, no .kspin) and Done is not gold yet. Red without the change.
- server.test.js: runsOnLine with a switched model (running: the switch; stopped: the job; no switch: the
  live reading) and the clear-on-agree source pin. Red without the change.
- web.change-dialog.test.js: pins updated (waking flag, new helper arguments, the plain manual line).
- render-restart-kloader-2831, render-autohello-2686, render-start-agent-3410: pass.

## Review rounds 1 to 3
- Round 1 (opus): Runs on was painted only on opening the agent's page, so the switch never showed there
  (BLOCKER, fixed: repaintRunsOnName); the record could pin a wrong model (cleared by any model or provider
  change; Claude runners only); the picker now agrees with Runs on; the instructions flow's waiting line
  has the loader; README and comments updated; surface-gate trailers.
- Round 2 (sonnet): the fallback finish and a superseded Start are now checked; switchedModelFor is the one
  gate Runs on and the picker both read; the Start waiting sentence is built once.
- Round 3 (opus): the provider switch now repaints Runs on too, in modelLine's words for a runner with no
  transcript yet ("OpenAI Codex", "Gemini", "Grok", "Gemini (Google subscription)", "Claude"). And Start
  and Restart NO LONGER drop the record: they start from the same job the switch wrote, so it is still
  true; a model changed while stopped is already covered because changeModelNow drops the record first.
