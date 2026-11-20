# stepupsheet-8791: Sign in again from the iPhone's sheets and the cloud Open (kosmos#8791, #8795)

Cards: #8791 (native sheets show a step-up refusal as text only), #8795 (a Cloud machine's Open silently bounces to
sign-in on the 10-minute step-up). Design: Mona Lisa's ruling on both cards (23:40 CST 11-19).

## Finished means
1. A step-up refusal (403, code step_up_required) under New Agent, New Team, or the cloud Open shows Sign in again.
2. It opens a fresh sign-in for the SAME account: its address read from /v1/account/me and fixed, the words "This needs
   you to sign in again. We will send a code to <email>.", Send code and Not now (Not now on every step). Nothing is
   ended before Kosmos+ issues the new session.
3. The refused thing is tried once more, only once the board is let in again under the new session; a second refusal
   says so (SignIn.Fresh.still) and offers no second fresh sign-in.
4. The sheet never outlives an account: it stays through exactly the fresh sign-in's own change, never a sign-out or
   another account.
5. LogicTests for the words, the no-loop rule, the passes and the retry rule, each with a control; simulator shots of
   the first step, light and dark.

## Design
- Reuse the native sign-in (SignInModel, SignInView) with `fixedEmail`: a second model in FreshSignInCenter, shown as a
  cover over the sheet or the tabs.
- The new session goes through the normal handover, so the usual account-change reset and reconnect run: the cloud box
  needs a NEW box session minted under the fresh sign-in, which is what the reconnect does. Rejected: exempting a
  same-account refresh from the account-separation checks (every identity guard keys on the session).
- The retry waits on BoardClient.admissions / admittedUnder, since `phase` still reads .live from before the reset.

## Weakest premise
That a code verified for the fixed address is always that same account (no different-email or company link is shown
on a fresh sign-in; the account is not re-read after issue).

## Not covered (next slice)
The New Project sheet.
