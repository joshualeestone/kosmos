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
resolves the message by writing to `chg-msg` directly:

    function autoHelloOnSwitchRestart(forAgent, shown, provName) {
      autoHelloAfterRestart(forAgent,
        (t) => { const m = document.getElementById('chg-msg');
                 if (m && !document.getElementById('chg-modal').hidden
                     && CURRENT && CURRENT.sessionName === forAgent) m.textContent = t; },
        'Reactivated on ' + provName + ', and said hello to wake ' + shown + '.',
        'Say hello to ' + shown + ' to reactivate them on ' + provName + '.');
    }

Called after the existing `tell`/`say` at each site, only when `restarted`:

    if (restarted) autoHelloOnSwitchRestart(forAgent, agentShown(), provName);

### Why this is safe on Josh's tuned dialogs

- The existing `say`/`tell` call is UNCHANGED, so the interstitial and its 2s floor
  behave exactly as today.
- The manual fallback string is byte-identical to the existing "Say hello to
  reactivate" line, so on timeout/failure the message is what it is today: no
  regression.
- The `chg-msg` write is guarded on the dialog still being open (`chg-modal` not
  hidden) AND still the same agent (`CURRENT.sessionName === forAgent`), so a late
  resolution never lands in a closed dialog or another agent's dialog. `say`'s own
  held render already bails on a hidden modal, and this mirrors that.
- No race with the floor render: `autoHelloAfterRestart` requires observing the gap
  (`sawUnready`) before accepting ready, so its earliest resolution is ~2 polls
  (~4s), after the ~2s floor render has painted the manual line.
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
against a stubbed status+thread, and asserts: success updates chg-msg to the
confirmation; unconfirmed/timeout leaves the manual line; a closed modal is not written;
a different open agent is not written. Wired into tools/browser-checks.sh.

## Weakest premise

That writing to `chg-msg` after `say` has settled is a clean second update on this
surface (the dialog stays open showing the reduced line + Done, per #768). If Josh's
review wants a different interim, the wording moves; the mechanism stands.
