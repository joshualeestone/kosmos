# #4963: the switch dialog shows a clickable Done while it is still waking the agent

Card: joshualeestone/kosmos#4963. Josh, 0.7.16, 2026-10-01 22:19 CDT: "you should not be able to press Done ... we
shouldnt even show that button until the process is totally complete"; follow-up: it is grey and clickable during the
work and turns yellow at Ready.

## Cause
`changeDialog`'s `say(sentence, ok, waking)` rendered the "Restarted on X. Waking them..." line AND showed Done
(plain). `autoHelloOnSwitchRestart` turned it gold when the wake finished. Both the provider switch and the model
switch use this path.

## Change (web/index.html)
1. While waking, the dialog shows no button. `autoHelloOnSwitchRestart`'s finish shows Done, gold, focused, whichever
   way the wait ends (placed hello, or the manual line).
2. Never a trap (#1313): once a restart is waking, Escape or a tap on the backdrop (a phone has no Escape) closes the
   dialog (the switch has happened; the wake goes on without it). If the helper never reports, Close returns
   RESTART_READY_WINDOW_MS + 30 s after the waking render: a bound past the readiness window, not a guaranteed upper
   bound on the helper (its fetches have no timeout). A late report matches the fallback's line too, so it still
   finishes the dialog with gold Done and the ready line. The timer is
   keyed to the opening (`back.__openGen`) so it cannot act on a later opening; so are the Escape and backdrop
   exits. While waking, the dialog box itself takes focus (nothing else can). When the fallback fires, the line stops
   saying "Waking them…" and says "Send them a message to wake them."

## Closing early never breaks the switch (card item 2)
Read from source, not reproduced: `autoHelloAfterRestart` runs independently of the dialog; closing only hides it,
and the report stands down on a hidden dialog. Arm 4 of render-autohello-switch-2716 already shows the hello is
still sent when the dialog closes mid-wait. I could not find, in source, how pressing Done broke Josh's agent; this
change removes the press. Weakest premise: if the "weird state" came from something other than the dialog closing
(for example the Gemini subscription runner's own wake), this card fixes the button but not that.

## Other in-progress dialogs (card item 3), checked
- Restart modal: closes before the wake and shows "Restarted. Waking them..." on the page, with no button.
- Start: inline line, no dialog.
- Kosmos+ sign-in Done (`plus-si-done`) and the world-add dialog's Done: shown only at their end states.
So the change dialog was the only place with a button during work in progress.

## Validation
- web.change-dialog-exit-1313.test.js: five new #4963 tests, all on mock timers: no button while waking + Escape
  closes; a backdrop tap closes (an inside tap does not); a non-waking dialog does not close on a backdrop tap
  (control); the fallback returns Close, not Done, and stops saying it is waking; a stale opening's Escape cannot close a
  later in-flight dialog. Negative control: the waking tests fail on origin/main's page.
- web.change-dialog.test.js: the real model switch now asserts no button while waking.
- Focused runs cover every test that reads this dialog: web.change-dialog, web.change-dialog-exit-1313,
  web.modal-way-out-1316, web.modal-exit-1438, web.restart-confirm, web.handoff-restart-3492, web.project-page.
- render-autohello-switch-2716: the dialog starts hidden while waking; Done appears on both finishes; a dialog
  closed mid-wait gets no button back.
- render-model-restart-interstitial: the model and provider waking lines now assert no button.
- render-model-change: waits for the button to appear rather than clicking at once (its fixture does not reach the
  waking state, so it asserts nothing about it).
- Queued on Agent1s: render-autohello-switch-2716, render-model-change, render-model-restart-interstitial,
  render-autohello-2686. Full suite before merge.

## Review 4 (sonnet, 2026-10-01 22:38 CDT): 0 BLOCKER, 0 SHOULD-FIX = CONVERGED at 7309edf65. Two NITs DEFERRED:
- The fallback sentence ('Send them a message to wake them.' and the /Waking them…$/ match) is written in two places
  (changeDialog and autoHelloOnSwitchRestart). A reword of one loses gold Done on a late report; only browser arm 4b
  catches it. Follow-up: one shared constant.
- No single test drives the real changeDialog and the helper together (the unit tests prove the hide; browser check
  2716 proves the reveal with a stubbed hidden button).
Deferred because either edit would have staled the queued checks and reopened the loop for a NIT.

## Validation results (2026-10-02 01:20 CDT)
- b-4963 (Agent1s, 00:35, head 7309edf65): render-autohello-switch-2716, render-model-change,
  render-model-restart-interstitial, render-autohello-2686 all rc 0; selectors 0.
- Mortals full suite on 7309edf65: 13687 pass, 0 fail. RED only on the browser-check SURFACE gate: render-unread-edge-3743
  and render-agentdm-3414 (token 'msg'). Both queued to RUN on this head (b-4963s); then per-check trailers citing it.
