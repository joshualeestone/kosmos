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
