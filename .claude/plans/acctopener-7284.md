# #7284: the account dialog Tab check drives #7198's Refresh login opener

## The call
docs/browser-checks/render-acct-modal-trap-7202.js gains a fifth opener: the login notice's Refresh login
(loginAdvGo, kosmos#7198). loginAdvGo opens the dialog only for an account the page lists, so the arm hands the page one
listed row through its own accountsRead (as #7198's render-refreshlogin-5407 does), then calls loginAdvGo with the
control that had focus as the opener, as the notice's button passes itself. The same per-opener arms run for it. One more:
closing the dialog gives focus back to that control (ACCT_ADD_RETURN_FOCUS, which only this opener and Add a provider
set). Check only; web/index.html is unchanged.

## Rejected
- Driving a real login notice end to end: #7198's own check does that. The trap keys on the dialog being open, so
  this check needs the opener's path into the dialog, not the notice's painting.

## Proof
- The check: 259 PASS, 0 FAIL (217 before; +42 = 7 arms x 3 pages x 2 engines).
- Mutation: the trap made to stand down only after loginAdvGo opened the dialog. The Refresh login arms red on every
  page. The four openers before it stay green, so the arm sees this opener specifically. Restored, cmp-checked.
- Browser-check guards: selectors, indexed, wired, reason-grep, bounded-close, teardown.

## Weakest premise
That a row handed to accountsRead is the same as one the board's account list would give. It is the shape
render-refreshlogin-5407 uses, and loginAdvGo reads only dir and apiKey from it.

## Review rounds
