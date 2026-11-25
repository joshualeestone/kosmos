# kosmos#8959 slice C: delete account, native (branch delete-8959)

Plan as posted on the card 2026-11-25 02:4x UTC (issuecomment-7151149115):


**What exists.** kosmos-relay `coordinator/src/account_delete.rs`: `start {email}` (same answer whether or not the account exists), `verify {email, code}` (a grant, or a second-step challenge when one is set up), `second {challenge, code}` (the grant), `confirm {grant, understood: true}` with three outcomes (`deleted` 200, `still_deleting` 202, `nothing_changed` 503). None takes a session. All refuse with `deletion_off` while `KOSMOS_ACCOUNT_DELETION` is unset. The page is `signin.html` at `/delete-account` (`DELETE` mode, `delConfirm`, `delSend`).

**The call.** The Settings row "Delete account" opens a native `DeleteAccountView` (logic in `DeleteAccountLogic.swift`, proved in `ios/LogicTests/deleteaccount`). Five screens, the page's words only:
1. Email: the page's title, intro, How it works / What is deleted / What we keep. The field is filled with this iPhone's account email when `/v1/account/me` gives one, and stays editable. Continue.
2. Check your email: the page's code line. Continue.
3. One more code (only when Kosmos+ opens one): the page's `secondWords`.
4. Confirm: every line of `step-del-confirm`, both plan variants and the only-admin warning from `preview`. "I understand this cannot be undone." must be on before the red "Delete my account" works; red nowhere else. Keep my account goes back to Settings.
5. Deleted / still deleting / could not (with Try again on the same grant), each with the page's words.
- Any other confirm answer (an expired grant) goes back to the email screen with Kosmos+'s sentence, as the page does. Refusals at every step are Kosmos+'s own sentence, so the off switch reads "Deleting an account is not open yet."
- After `deleted`, this iPhone signs out through Settings' own sign-out path (`signedOut`) when the person leaves the done screen, as the page forgets every session it holds.

**Rejected.** Locking the email to the signed-in account (the page lets anyone delete their account from it; an email code still proves it); signing out the instant `deleted` lands (it would pull the done screen away before it is read); a native screen with fewer words than the page (an irreversible step that moves money must not say less than the web does).

**Weakest premise.** That signing out on leaving the done screen is enough: an app killed on that screen keeps a dead session until its next request is refused, which the existing 401 path already turns into signed out.

**What would change my mind.** Kosmos+ adding a session-bound delete (then the email step goes), or Josh changing any of the four billing calls in the module header (the phone only repeats the page's lines, so it changes with them).

## Built
- ios/Kosmos/DeleteAccountLogic.swift: requests, answers, the page's words. ios/LogicTests/run-deleteaccount.sh (CI step in ios.yml).
- ios/Kosmos/DeleteAccountView.swift: the five screens; SettingsView's row is a NavigationLink to it; Settings.deleteAccountURL removed (no callers).
- ios/KosmosUITests/DeleteAccountUITests.swift: sample walk with screenshots, the tick gate, Keep my account.
- Departures from the page, on purpose: an unknown plan reads as the subscription words (the page reads it as none; never understate); the pending screen drops "and you can close this page".

## Review ledger
- r1 opus: 2B/6W. FIXED B1 confirm timeout 15 s -> 180 s (Stripe calls in finish). FIXED B2 back hidden while busy, and a
  deletion answered off-screen signs out at the answer (gone flag, DeleteAccount.signsOut, tested). FIXED W3 401 "that
  account is already gone" reads as deleted. FIXED W4 another account's deletion signs nothing out (own email from /me).
  FIXED W5 the sign-out rule is logic, tested (sample UI run skips the callback by design). REJECTED W6 page words on CI:
  the sibling suites (accountsecond, accountsecurity) run with KOSMOS_RELAY= on CI the same way; kosmos-relay is another
  private repo, and the comparison runs on every local validation. FIXED W7 Send the code again + "New code sent.".
  FIXED W8 focus moves to the answer's title; the tick has a value.
- r2 sonnet: 0B/8W. FIXED W1 sign out only the session held at the start, and only while still held. FIXED W2 /me read
  whatever the field holds; a nil own email still signs out (the page's rule; weakest premise, kept). FIXED W3 focus set on
  the next turn, every answer. FIXED W4 "New code sent." cleared on the next submit. FIXED W5 a background task around
  confirm. W6 tab switch on the done screen counts as leaving: commented, as planned. FIXED W7 back hidden only during a
  confirm. FIXED W8 UI test queries the answer by identifier plus label, reveals Continue past the keyboard, checks the
  company line before scrolling past it.
- r3 opus: 0B/5W. FIXED W1 a confirm whose answer was lost, then a refused grant, reads as a new "could not tell" screen
  (Outcome.unknown; words NOT the page's, which has the same gap: they point at the email Kosmos+ sends when a deletion
  finishes). FIXED W2 an answer with no outcome and no sentence keeps the grant, as the page's catch. FIXED W3 the
  background task ends at iOS's expiry. FIXED W4 long waits in words (plainWait), and Send the code again waits 90 s or
  Kosmos+'s retry_after_secs. FIXED W5c the texted code's lifetime line. ACCEPTED W5a (static ten-minute line is true:
  ttl::CODE = 600), W5b mail-trouble line (a new route for the phone: filed as follow-up on the card), W5d (cosmetic).
  NOTED for Josh's billing calls, not this slice: still_deleting says "You will not be charged again" while the sweep may
  still be ending billing (the page's words; account_delete.rs).
