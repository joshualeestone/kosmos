# #7284: the account dialog Tab check drives #7198's Refresh login opener

## The call
docs/browser-checks/render-acct-modal-trap-7202.js gains a fifth opener: loginAdvGo, the path kosmos#7198's Refresh
login takes into the dialog. On Settings, where the page has read its account list, loginAdvGo opens the dialog only for
a row it lists, so the arm hands the page one listed row through its own accountsRead (as #7198's
render-refreshlogin-5407 does). It calls loginAdvGo with the focused control as the opener, then puts the page's
account state back after the arm. The opener is found by its label, not by position.

What it adds, honestly: loginAdvGo ends in openAcctReauth (opener 2), so the Tab walk repeats the Claude dialog. The new
coverage is (a) loginAdvGo routes into the dialog, not to AI Models (a fall-through fails "the dialog is open"), and
(b) closing hands focus back to the control passed as its opener, never the fallback, Add a provider's button. The
notice's own button, and its inert-slot fallback, stay with render-refreshlogin-5407 (D4). Check only; web/index.html
is unchanged.

## Rejected
- Driving a real login notice end to end: render-refreshlogin-5407 does that.

## Proof
- The check: 259 PASS, 0 FAIL (217 before).
- Mutation: loginAdvGo's ACCT_ADD_RETURN_FOCUS assignment removed. Exactly the 6 focus-return lines red (3 pages x 2
  engines), nothing else. Restored, cmp-checked.
- Mutation (first version): the trap standing down only after loginAdvGo opened the dialog reds the Refresh login
  arms on every page while the four earlier openers stay green.
- Browser-check guards: selectors, indexed, wired, reason-grep, bounded-close, teardown, 40 of 40.

## Weakest premise
That a row handed to accountsRead is the same as one the board's account list would give. It is the shape
render-refreshlogin-5407 uses, and loginAdvGo reads only dir and apiKey from it.

## Review rounds
1. (default model, 21:2x CDT) No BLOCKER. Applied: (W) the label and comment said a notice's button got focus back;
   no notice is involved. Reworded, and the notice's button is pointed to render-refreshlogin-5407 D4. (W) The plan
   claimed 7 new arms of coverage; the walk repeats opener 2. Restated as (a) and (b) above. (W) The focus-return
   assert was never shown to fail; the mutation above now shows it. (N) The arm relied on staying last; it is now found
   by label and the page's account state is restored after it. (N) The assert also rules out Add a provider's own
   button, where closing falls back. (N) The header says the feed matters on Settings.
