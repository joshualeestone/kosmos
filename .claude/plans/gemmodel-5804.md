# gemmodel-5804: say when a Gemini agent answers on a model other than the one chosen

Card: #5804 (Liu Kang, measured on 0.7.38). Owner: April (night shift shard).

## Traced (card comment)
The card's model line for a running Gemini agent is `a.modelName`, from the model the Gemini CLI recorded on its newest
reply (engine/geminisession.js, #4416). Gemini CLI 0.61.0 falls back to another model on a failure (fallback/handler.ts,
sometimes silently), and its base Flash model is gemini-3.5-flash. So "Gemini 3.5 Flash" on an agent launched with
`-m gemini-2.5-flash` is most likely true: that reply came from 3.5 Flash. `ps` shows only the launch argument.

## What
- server.js /api/status agent row: `chosenModelName`, only for a running Gemini agent of ours whose session names a model:
  the model the person chose for it (create.plannedModelOf), as display words; null when the job has no model of its own
  (the launcher's default is not a choice) or cannot be read. One launch-file read per running Gemini agent per poll
  (the precedent: plannedModelId for codex agents).
- web/index.html modelLine: for a Gemini agent, when the answering model's words differ from the chosen model's (case and
  spacing aside), "<answering> (you chose <chosen>)". Otherwise unchanged.

## Not here
Grok and Antigravity (no report; their CLIs' fallback not traced). Stopping the CLI's fallback (a rate limit would become
a failed reply). The detail panel's "Right now" line (follows modelLine? check; if it does, it gets the same words).

## Weakest premise
That the switch is the CLI's fallback; not seen in a session file yet (asked Liu Kang on the card). The words "you chose"
are true whatever made it switch.

## Tests
A pure helper for the words (vm-evaluated from index.html), the server field (source + a route test if a Gemini agent can
be faked in the fleet fixture), mutation checks.
