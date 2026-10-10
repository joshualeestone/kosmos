# gemmodel-5804: say when a Gemini agent answers on a model other than the one it was started on

Card: #5804 (Liu Kang, measured on 0.7.38). Owner: April (night shift shard).

## Traced (card comment)
The card's model line for a running Gemini agent is `a.modelName`, from the model the Gemini CLI recorded on its newest
reply (engine/geminisession.js, #4416). Gemini CLI 0.61.0 falls back to another model on a failure (fallback/handler.ts,
sometimes silently); its base Flash is gemini-3.5-flash. So "Gemini 3.5 Flash" on an agent started with
`-m gemini-2.5-flash` is most likely true. `ps` shows only the launch argument.

## What
- engine/geminimodelswitch.js `startedModelName(name, deps)`: the display name of the model Kosmos STARTED the agent on
  (its own model or the launcher default: both are what it was started on; review 1 blocker: the reported case may well
  be the default), or null. Null when: the started id has no version number (auto, flash, pro are the CLI's aliases,
  which pick by design); the newest reply was written before this run began (geminisession `modelAt` < the tmux
  session start: after a model change and restart, the newest reply is the previous run's); same model (case/spacing
  aside); anything unreadable. Reads injectable.
- engine/geminisession.js: `modelAt`, when the model-naming reply was written.
- server.js row: `startedModelName`, only for a running Gemini agent of ours with a recorded model. Cost per running
  Gemini agent per poll: one job read, one session read, the cached tmux session list.
- web/index.html modelLine: "<answering model> (started on <started>)" when the board sends it. modelLine feeds the card,
  the list row, the detail meta line, the "Right now" line, the model menu's "Runs on" option and the model sort; all get
  the same words on purpose (one question, one answer; the sort then groups by what the card says).

## Not here
Grok and Antigravity (no report; their fallback not traced). Stopping the CLI's fallback (a rate limit would become a
failed reply). Naming WHY it switched (the session file does not say; only that it did).

## Weakest premise
That the switch is the CLI's fallback: not seen in Liu Kang's session file yet (asked on the card). "(started on X)" is
true whatever made it switch.

## Tests
engine/geminimodelswitch-5804.test.js (injected deps: switch, default, alias, stale reply, same model, unreadable, with a
control); web.gemini-model-switch-5804.test.js (the page's modelLine run; server wiring by source).
