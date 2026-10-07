# neverrec-5491: a never-recorded agent's AI Settings says it once

Card: #5491 (found in the 0.7.27 look-over).

Finished means: on an agent Kosmos never recorded the launch of, the Runs on card says the state once (its heading, the ruled "Made before Kosmos recorded this", card #150) and the way in once (#d-runson-why). The model block (menu, Change & Restart, hint, and its refusal "Made before Kosmos recorded how it starts, so its model cannot change here. Stop it, then add it from Found agents in Settings...") is not shown for that agent. A recorded agent's model block is unchanged and comes back when you move to it from a never-recorded one.

Built: paintModelPicker hides the model block's `.mstep` for `a.neverRecorded === true`, on every paint and before any provider's path (Claude and OpenAI), and returns. The two refusal sentences that only that state reached are removed (Claude's, and the OpenAI path's "did not record" one); the "Kosmos did not start this one" refusal stays.

Rejected: keeping the block with only the menu (a disabled menu reading "Made before Kosmos recorded this" is the third telling); rewording the refusal shorter (still a second telling of the explainer).

Left, written on the card: the static hint "Changing the model restarts the agent..." still shows under a never-recorded agent's card. The provider switch already owns showing and hiding those hint lines (fillSwitchAccounts), so changing it here would fight that code.

Weakest premise: the explainer is always shown for a never-recorded agent (it is set from the same flag, a.neverRecorded), so hiding the block never leaves the person with no reason at all.

Checks: web.made-before.test.js (pins: the block is hidden for neverRec; the old refusal is absent; the "no control to re-record" sentence is now on one surface). render-made-before.js: Rick and the stopped agent show no model block and the way in once; CONTROL Bob (recorded) shows his block after Rick. With main's page the three new arms go red and the control stays green.
