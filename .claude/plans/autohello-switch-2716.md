# autohello-switch-2716: auto-hello on model-switch and provider-switch restarts

Card: joshualeestone/kosmos#2716 (follow-up to #2686). Branch: autohello-switch-2716.

## Problem

#2686 auto-sends the wake `hello` after a user-initiated restart, but only on the two
restart-modal sites. The model-switch (`changeModelNow`) and provider-switch
(`changeProviderNow`) dialogs also restart the agent (`out.outcome === 'changed'`) and
still tell the person to say hello by hand ("Say hello to <agent> to reactivate them
on <provider>."). Those should auto-send it too.

## The call

Both dialogs run through `changeDialog`, whose `say(text, ok)` is a ONE-SHOT exit that
renders the final line after a success-only `minBusyMs` floor (~2s, RESTART_HOLD_MS)
and shows a Done button. So the auto-hello cannot reuse `say` for a second update;
instead a shared helper fires `autoHelloAfterRestart` (the #2686 helper, unchanged) and
resolves the message by writing to `chg-msg` directly. Each site builds the manual line
ONCE and passes it to BOTH say/tell AND the helper, so the helper's content check
compares against exactly what was painted (final shape after iterations 2-3):

    // at each call site (changeModelNow / changeProviderNow), when restarted:
    const switchShown = agentShown();
    const switchManual = 'Say hello to ' + switchShown + ' to reactivate them on ' + provName + '.';
    say/tell(restarted ? switchManual : <default>, restarted);
    if (restarted) autoHelloOnSwitchRestart(forAgent, switchShown, provName, switchManual);

    function autoHelloOnSwitchRestart(forAgent, shown, provName, manualLine) {
      const saidLine = 'Reactivated on ' + provName + ', and said hello to wake ' + shown + '.';
      autoHelloAfterRestart(forAgent,
        (t) => { const m = document.getElementById('chg-msg');
                 const back = document.getElementById('chg-modal');
                 if (m && back && !back.hidden
                     && CURRENT && CURRENT.sessionName === forAgent
                     && m.textContent === manualLine) m.textContent = t; },
        saidLine, manualLine);
    }

### Why this is safe on Josh's tuned dialogs

- The existing `say`/`tell` call is UNCHANGED, so the interstitial and its 2s floor
  behave exactly as today.
- The manual fallback string is byte-identical to the existing "Say hello to
  reactivate" line (it IS that line, `switchManual`, built once and shared), so on
  timeout/failure the message is what it is today: no regression.
- The `chg-msg` write is TRIPLE-guarded: the dialog still open (`chg-modal` not hidden),
  still the same agent (`CURRENT.sessionName === forAgent`), AND `chg-msg` still showing
  the exact `manualLine` say/tell painted. The first two mirror `say`'s own hidden-modal
  bail; the third (content-match, added in iteration 3's review) closes the
  Done-then-reopen-another-dialog window that the first two alone leave open, because
  `RESTART_HELLO_SEQ` supersedes only on a NEW restart, not a new dialog open. A reopen
  resets `chg-msg` to '' then to that action's own message, so it no longer equals
  `manualLine` and the resolution stands down.
- No race with the floor render: `autoHelloAfterRestart` requires observing the gap
  (`sawUnready`) before accepting ready, so its earliest resolution is ~2 polls
  (~4s), after the ~2s floor render has painted the manual line. This rests on
  `2 * RESTART_READY_POLL_MS > RESTART_HOLD_MS`, which the browser-check asserts against
  the production constants so a future retune reds it.
- Success is claimed only on `delivery.state === 'placed'`; unconfirmed/throw/timeout
  fall to the manual line, so a person is never falsely told the agent was greeted.
- Per-agent supersession is inherited from the helper.

### provName vocabulary (kept, per #768/#2463)

- Provider switch names the provider moved to: 'OpenAI' / 'Anthropic'.
- Model switch names the agent's current provider: 'OpenAI' / 'Claude'.

### Scope boundary: moveAccountNow is NOT covered (and why)

`moveAccountNow` (the account-MOVE dialog, `/api/agent/<name>/account`) is a THIRD
changeDialog restart path, distinct from the model/provider switch. The code comment
says an account move restarts the agent, but its dialog says "Moved." and has NEVER
carried a manual "Say hello to reactivate" line. #2716's scope, from its title and from
#2686's pattern, is "replace the manual-hello prompt with auto-hello" on the two
switch dialogs; moveAccountNow has no such prompt to replace, so it is deliberately
excluded here. Whether an account move actually leaves the agent needing a wake (and
should therefore auto-hello, or already comes back active) is an open question for
Josh's review, not something to resolve by widening this change.

## Held for Josh's review (draft PR)

These are Josh-personally-tuned dialogs. The auto-hello pattern should be confirmed on
#2686's restart-modal path in the running app first, so this ships as a DRAFT PR held
for that, then un-drafted. One interim-wording question for Josh: the line reads "Say
hello to reactivate ..." for ~4s before it changes to "Reactivated ... said hello" on
success; an alternative is a present-tense interim ("Waking <agent> ..."), which would
touch the tuned `say` call and is left out of the minimal version.

## Verification (headless)

A committed browser-check `docs/browser-checks/render-autohello-switch-2716.js`
(pw-runtime, file://) that seeds a #chg-modal/#chg-msg, drives `autoHelloOnSwitchRestart`
against a stubbed status+thread. 10 arms: success updates chg-msg to the confirmation
(one hello posted); unconfirmed leaves the manual line AND asserts the hello WAS posted
(not a silent no-op); a stays-restarting timeout posts no hello and leaves the manual
line; a closed modal, a switched agent, and a REOPENED different dialog for the same
agent each suppress the write (each asserts the hello still fired, only the write was
suppressed); and the no-race invariant (`2 * RESTART_READY_POLL_MS > RESTART_HOLD_MS`)
parsed from the production constants. Wired into tools/browser-checks.sh.

`web.change-dialog.test.js` also carries a source-slice test pinning that both
changeModelNow and changeProviderNow wire `autoHelloOnSwitchRestart(forAgent,
switchShown, provName, switchManual)` and build `switchManual` once to share with
say/tell, and its behavioural driver stubs the helper no-op (it now runs on a real
restart, so without the stub it would throw a ReferenceError).

## Weakest premise

That writing to `chg-msg` after `say` has settled is a clean second update on this
surface (the dialog stays open showing the reduced line + Done, per #768). If Josh's
review wants a different interim, the wording moves; the mechanism stands.
