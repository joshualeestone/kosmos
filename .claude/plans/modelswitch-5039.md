# #5039 fast fix: Kosmos-run Claude agents switch to Opus 4.8 instead of stopping on the safeguards modal

Card: joshualeestone/kosmos#5039. Ruling: Josh, #admin, 2026-10-02 11:14 CDT ("get that change in quickly and get it
out in a very short fast update so that users aren't getting hit with that block"). Routed by Splinter to Renet.
Detection as needs-you stays with Ice Cream Kitty and does not hold this.

## Change
`engine/trust.js` `preacceptBypassInner` already writes `skipDangerousModePermissionPrompt` into the agent's
account settings.json at create and on an account move (both platforms), and on every Mac launch
(ensure-launch-trust.js, from bin/agent-supervisor.sh). Windows' launch path (engine/win32launch.js) does not call
it, so a Windows agent created before this change gets the key only when re-created or moved; that relaunch call is
handed to Homer as a spec (Windows-side rule). It now also
writes `switchModelsOnFlag: true` there, only when the key is absent. An explicit value (false) is kept.
`already` now means both keys are in place.

Measured: Claude Code wrote exactly `"switchModelsOnFlag": true`, top level, beside the bypass key in
~/.claude/settings.json at 11:06:52 when Angel picked "Switch automatically".

Not measured: that an agent launched the way Kosmos launches it honours the key and skips the modal when flagged.
Only the write side is measured (above). Done on the card = an agent seen continuing on 4.8 after a flag.

The only lasting opt-out is an explicit false (a deleted key is written again at the next launch); the uninstall
notice names the key and says so.

Weakest premise: a default-account agent's target is the operator's own ~/.claude/settings.json, so the operator's
own Claude Code sessions also switch automatically from then on. That is the same scope the bypass key already takes
there. Rejected: a separate writer with its own call sites (three call sites to keep in step).

## Tests (engine/trust.test.js)
- a new settings file holds exactly the two keys
- bypass already true and no switch key: the switch key is added, other keys kept, already=false
- an explicit false is kept, already=true
- both keys present: already, no rewrite (existing test updated)
- the key name is pinned
Mutations: no switch write (2 reds), overwrite an explicit false (1 red), early return ignoring the switch (1 red).
Related files green: ensure-launch-trust, trust.createifabsent-2129, trust.wedge-update-2129b,
create.trust-reverify-3424, create (214).
