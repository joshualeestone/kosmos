# second-kind-3796: the in-app second step names the account's ONE factor (kosmos#3796 addendum 3)

Josh's live test: his account is authenticator-only, and the wizard told him to check his phone for a text.
- The coordinator already says which factor (open_challenge: "second" is the account's kind, "sent_to" the
  masked phone tail for sms), and the tunnel passes every field through. The engine dropped them, returning
  only the stage. It now passes second_kind ('totp' | 'sms' only) and sent_to (only the coordinator's
  masked shape, bullets then 4 digits). The server's signin-verify route forwards both, and never the challenge.
- The page names the one factor: "Enter the 6-digit code from your authenticator app." (totp) or "Enter
  the code we texted to <masked tail>." (sms). An unknown kind gets words true of either; it never guesses.
- An account has exactly one second factor (accounts.second_kind), so there is no other factor to offer.
  "Can't get a code?" opens the one recovery path: "I lost my phone" on a computer already connected to
  Kosmos+ (#733). There is no server unlock, by design.

## Addenda 4 to 10, #3820 and #3827 (Josh's live tests, 2026-09-25 16:34 to 17:28)
- 4: the way out: Cancel on the email step, Start over mid sign-in (keeps the email), Sign out once signed in.
  A sign-in the coordinator has ended shows "That sign-in timed out. Start over and we'll send a new code." with
  Start over, and no raw 401. The code step says "It works for 10 minutes."
- 5 and 6: capitals are fine. The engine lowercases before the name rule (both sites, and before the #1010
  recognition), and both name fields are cleaned as typed (#3791's rule). 7: a live n/32 count.
- 8, 9 and 10: an account that owns an address skips the address step. The wizard registers to that address
  itself and lands on "You're signed in to Kosmos+" plus one line ("To use Kosmos on another device, sign in at
  login.kosmosplus.com.") and Done. The address comes from the sign-in answer's account_address (kosmos-relay
  #136) or, until that's deployed, the "already owns the name" refusal. A failed automatic register gets Try
  again. Without an address, the field reads "Choose your Kosmos+ address".
- #3827: a successful register switches Kosmos+ on, so the tunnel starts.
- #1012 reversed: "I lost my phone" shows on every enrolled computer (every account has a second step now).
