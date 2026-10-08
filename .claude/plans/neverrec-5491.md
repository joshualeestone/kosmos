# neverrec-5491: a never-recorded agent's AI Settings says it once

Card: #5491 (found in the 0.7.27 look-over).

Finished means: on an agent Kosmos never recorded the launch of, the Runs on card says the state once (its heading, the ruled "Made before Kosmos recorded this", card #150) and the way in once (#d-runson-why). The model block (menu, Change & Restart, hint, and its refusal "Made before Kosmos recorded how it starts, so its model cannot change here. Stop it, then add it from Found agents in Settings...") is not shown for that agent. A recorded agent's model block is unchanged and comes back when you move to it from a never-recorded one.

Built: paintModelPicker hides the model block's `.mstep` for `a.neverRecorded === true`, on every paint and before any provider's path (Claude and OpenAI), and returns. The two refusal sentences that only that state reached are removed (Claude's, and the OpenAI path's "did not record" one); the "Kosmos did not start this one" refusal stays.

Rejected: keeping the block with only the menu (a disabled menu reading "Made before Kosmos recorded this" is the third telling); rewording the refusal shorter (still a second telling of the explainer).

Also (review 1): the line under the card about changing the model ("Changing the model restarts the agent...") now has an id, #d-model-restart-hint, and is hidden for a never-recorded agent by the two painters that already own those lines (paintProviderPicker shows them, fillSwitchAccounts hides them while a switch is armed); the line about moving stays, since Move is still there. Adding the hide to paintModelPicker instead would have been undone by paintProviderPicker, which runs after it.

Weakest premise: the explainer is always shown for a never-recorded agent (it is set from the same flag, a.neverRecorded), so hiding the block never leaves the person with no reason at all.

Checks: web.made-before.test.js (pins: the block is hidden for neverRec; the old refusal is absent; the "no control to re-record" sentence is now on one surface). render-made-before.js: Rick and the stopped agent show no model block and the way in once; CONTROL Bob (recorded) shows his block after Rick. With main's page the three new arms go red and the control stays green.

Review 3 found web.runs-on-990.test.js went red: it took the FIRST `go.disabled =` in paintModelPicker, which became this branch's literal `go.disabled = true`. Fixed in the test, not by moving code: it now checks EVERY computed gate in the function compares against the current model (a literal true cannot arm the button), which is stronger; proven red by removing the compare from the Claude gate. Every web.*.test.js run: 2522 pass, 0 fail.
