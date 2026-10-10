# gemmodel-5804: say when a Gemini agent answers on a model other than the one it is set to

Card: #5804 (Liu Kang, measured on 0.7.38). Owner: April (night shift shard).

## Traced (card comment)
The card's model line for a running Gemini agent is `a.modelName`, from the model the Gemini CLI recorded on its newest
reply (engine/geminisession.js, #4416). Gemini CLI 0.61.0 falls back to another model on a failure (fallback/handler.ts,
sometimes silently); its base Flash is gemini-3.5-flash. So "Gemini 3.5 Flash" on an agent started with
`-m gemini-2.5-flash` is most likely true. `ps` shows only the launch argument.

## What
- engine/geminimodelswitch.js `settingModelName(name, deps)`: the display name of the model the agent is SET to
  (its own model or the launcher default: both are its setting; review 1 blocker: the reported case may well
  be the default), or null. Null when: the started id has no version number (auto, flash, pro are the CLI's aliases,
  which pick by design); the newest reply was written before this run began (geminisession `modelAt` < the tmux
  session start: after a model change and restart, the newest reply is the previous run's); same model (case/spacing
  aside); anything unreadable. Reads injectable.
- engine/geminisession.js: `modelAt`, when the model-naming reply was written.
- server.js row: `settingModelName`, only for a running Gemini agent of ours with a recorded model. Cost per running
  Gemini agent per poll: a SECOND job read and a SECOND session read (the status read that produced modelName does not
  carry modelAt out), plus the cached tmux session list. Accepted for now (Gemini agents are few per board); carrying
  model/modelAt out of the status read is the cheaper follow-up if a board runs many (review 2).
- Same-run check: a model change restarts the agent by closing its tmux session (engine/remove.js restart:
  sessionOps.end), and the supervisor starts a fresh one, so the session start moves (review 2 asked; verified).
- web/index.html modelLine: "<answering model> (set to <setting>)" when the board sends it (review 3: "set to" stays true
  when a model change saved the setting but the restart did not happen; "started on" would not). modelLine feeds the card,
  the list row, the detail meta line, the "Right now" line, the model menu's "Runs on" option and the model sort; all get
  the same words on purpose (one question, one answer; the sort then groups by what the card says).

## Scope
Mac and Linux only: the run start comes from tmux; on Windows it is always null (fails safe, no note). Same model by
canonical id (a numeric revision, -latest, -preview, -exp suffix is the same model).

## Not here
Grok and Antigravity (no report; their fallback not traced). Stopping the CLI's fallback (a rate limit would become a
failed reply). Naming WHY it switched (the session file does not say; only that it did). The model menu and sort wording (intended,
same words everywhere). Design shots: the board's shot fixtures have no running Gemini agent whose model switched, and
the change is longer text in the same element (deferred; review on the next release). The per-poll double read: a
follow-up card (filed), carrying model id and modelAt out of the status snapshot.

## Weakest premise
That the switch is the CLI's fallback: not seen in Liu Kang's session file yet (asked on the card). "(set to X)" is
true whatever made it switch.

## Tests
engine/geminisession.runner-3296.test.js (modelAt read from the real captured session); engine/geminimodelswitch-5804.test.js (injected deps: switch, default, alias, stale reply, same model, unreadable, with a
control); web.gemini-model-switch-5804.test.js (the page's modelLine run; server wiring by source).
