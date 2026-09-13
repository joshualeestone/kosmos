# #2694 - the reactivate-model dialog's "Done" button becomes "Say hello to <agent>" (one-click hello + jump to Talk)

## What finished looks like
On the change-model confirm dialog, after a real restart the success button reads "Say hello to
<agent>" (not "Done"); clicking it sends the wake hello into the agent's dialog AND navigates to
the Talk-to-Agent screen, instead of dropping the person back on the model picker to do it by hand.
The helper line beneath reads "to reactivate them on <provider>."

## Josh's design (card #2694, 2026-09-10, with screenshot)
His words: the button "instead of saying Done, said 'Say hello to agent name'", and clicking it
"actually fired that hello straight into that agent's dialog box and also took you to the Talk to
the Agent screen"; "the text out to the right of it says 'to reactivate them on model name'."

## The decision this OVERRULES (recorded, not ignored)
changeModelNow carried a deliberate comment: "Moving them to Talk is their click, not ours." #2694
postdates and overrules it - Josh now wants the one-click trip to Talk. The reversal is recorded IN
the comment (the trip is still THEIR click, now on the "Say hello" button, folded into one action).

## Approach - ADDITIVE, low blast radius
`changeDialog` is shared by ~5 callers. Extended it ADDITIVELY with optional `doneLabel` + `onDone`:
on a success outcome (ok) with an onDone, the close button carries `doneLabel` and its click runs
`onDone()` then closes; every other path (non-success, or a caller passing neither) keeps the plain
`Done`/`Close` close - so the other callers are byte-unchanged (proven by the unchanged synthetic
`rendered` arm and the provider arms in render-model-restart-interstitial.js still asserting 'Done').

Then the model-change call site (`d-model-go`) passes `doneLabel: 'Say hello to <agent>'` +
`onDone: reactivateSayHello(forAgent, shown)` (a shared helper: `detailGo('talk')` +
`autoHelloAfterRestart`, reusing existing tested paths with the same open-agent guard its other
callers use). changeModelNow's success message drops to the "to reactivate them on <provider>"
helper half (the "Say hello to <agent>" half is now the button).

## Scope (deliberately just the model-change dialog, per the card)
The card and its screenshot are the MODEL change (`changeModelNow` / `d-model-go`). The sibling
reactivate flows - provider change (`changeProviderNow` / `d-provider-go`) and account move
(`moveAccountNow` / `d-account-go`) - share the same "Say hello to X to reactivate" pattern and
would want the same one-click treatment for consistency, but they are distinct functions with
distinct semantics and are out of this card's scope. Noted as a consistency follow-up; left on the
plain 'Done' close for now (their browser-check + node assertions are intentionally unchanged).

## Weakest premise
That firing the hello only on `onDone` (the button click), and only when the outcome was a real
restart (ok), is the right gate - a partial (saved, not restarted) keeps the plain Close and no
hello, which is correct (nothing to greet). What would change my mind: if Josh wants the hello even
on a partial, but that contradicts "reactivate" (the agent didn't restart).

## Verify
- `web.change-dialog.test.js` - 3/3 (the reactivate message is now the helper half; a new #2694 test
  pins the doneLabel/onDone mechanics: label on success, onDone fires on click, non-success keeps
  Close and never fires).
- `docs/browser-checks/render-model-restart-interstitial.js` - EXTENDED (not paralleled): the MODEL
  reduce now asserts the "Say hello to <agent>" button + the "to reactivate them on <provider>"
  helper; the model-arm close is direct (the button now navigates, which would disrupt the
  sequential provider arms); the provider arms are unchanged.
- Full node suite + browser-checks green; challenge-loop to convergence.
