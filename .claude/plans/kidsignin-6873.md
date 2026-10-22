# kidsignin-6873: the child's own computer says which account a child signs in with (kosmos#6873, follow-up to #6379)

PigeonPete's #6379 decision: an under-13 child uses Kosmos+ only on an account the parent makes for them, at an
address the parent reads. Baron's family console (kosmos-relay kidacct-6379, converged) tells the PARENT. This tells
the child's computer, in the console's words, so the decision does not depend on the parent relaying them.

## Change (web/index.html)
- Settings > Kosmos+, the sign-in email step: one line under the field (`plus-si-child`, the field's
  aria-describedby): a child's computer signs in with the child's account, not the address the parent signs in with
  (the computer would be signed in as the parent); under 13, one the parent makes, at an address the parent reads.
- The family's words before Accept (`plus-org-family-account`): which account this computer is signed in as (the
  engine's email, from the Allow poll's /api/remote/pending), and the rule; if it is the wrong account, Not now, Remove
  this computer, sign in again. With no address known yet, the rule alone.

## Step 2 of the card (how an account is created), measured from source
- The app's "Email me a code" runs the connector's `setup start` (engine/remote.js setupStart) on Mac and Windows
  alike (the connector is kosmos-tunnel / kosmos-tunnel.exe). The coordinator's setup door mails ANY address and makes
  the account at setup complete when the address has none ("it is how an account is born", signin.rs setup_start).
  The web sign-in door, by contrast, mails nothing for an unknown address.
- Windows: Homer walked the app on 0.7.61 up to the email-code screen (#6835); past it is from the code, not measured.
- So the lines say nothing about where the account is made (Baron's review point): "an account you make for them" is
  true whichever door makes it.

## Decided, not missed
- One line on the sign-in step for everyone: the board cannot know before joining that this is a child's computer.
  Weakest premise: that one quiet line costs an adult nothing; it says "Setting up a child's computer?" first so it
  reads as not about them.
- Wording follows Baron's final console line (relay kidacct-6379, iteration 7): "not the address you sign in with
  yourself" for every child, the under-13 rule on top. No /signup link (in a signed-in browser it opens the parent's
  session).
- Rejected: refusing Accept when the signed-in address looks like the parent's own: the board does not know the
  parent's address.

## Tests
- docs/browser-checks/render-org-family-6239.js F11: the account line with no address known (rule and what to do) and
  with one (named first), chromium and webkit; 96 PASS. render-plus-signin-3478.js: the email step's line and the
  field's aria-describedby; 186 PASS.
- Mutations: the address never named (2 red); the under-13 sentence removed (4 red).
- 14 test files naming these screens and the page guards: 230 pass, 0 fail.
