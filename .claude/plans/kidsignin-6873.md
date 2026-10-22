# kidsignin-6873: the child's own computer says which account a child signs in with (kosmos#6873, follow-up to #6379)

PigeonPete's #6379 decision: an under-13 child uses Kosmos+ only on an account the parent makes for them, at an
address the parent reads. Baron's family console (kosmos-relay kidacct-6379, converged) tells the PARENT. This tells
the child's computer, in the console's words, so the decision does not depend on the parent relaying them.

## Change (web/index.html)
- Settings > Kosmos+, the sign-in email step: one line under the field (`plus-si-child`, the field's
  aria-describedby): a child's computer signs in with the child's account, not the address the parent signs in with
  (the computer would be signed in as the parent); under 13, one the parent makes, at an address the parent reads.
- The family's words before Accept (`plus-org-family-account`): whose account this computer must be signed in with,
  and, if it is the wrong one, Not now, Remove this computer, sign in again. It names no address (review 1).

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
- docs/browser-checks/render-org-family-6239.js F11: the rule and the recovery, no address, Remove this computer on
  screen, in the join flow and the review flow, chromium and webkit; 96 PASS. render-plus-signin-3478.js: the email step's line and the
  field's aria-describedby; 186 PASS.
- Mutations: the under-13 sentence removed from the sign-in line (4 red); the family line never filled (4 red, review 1).
- 14 test files naming these screens and the page guards: 230 pass, 0 fail.

## Review 1 (sonnet)
- SHOULD-FIX taken, by removing the claim: the family words named "This computer is signed in to Kosmos+ as X" from
  the engine's stored email, painted once and never refreshed. Worse than stale: that email is the last one a sign-in
  STARTED with (setupStart writes it before the code) and Remove keeps it, so it can name an account this computer is
  not signed in as. No dependable "enrolled as" address exists on the page (View account opens whatever the browser
  is signed in as), so the line now states the rule and the way to change account, and names no address.
- SHOULD-FIX taken: Remove this computer is asserted on screen with the words, in the join flow and the review flow.
- NIT declined: aria-describedby on the whole sign-in line. The rule is what a screen-reader user needs before typing
  an address, and it is read once on focus.
- NIT kept as is: straight apostrophes in HTML, ’ in the JS string, as the surrounding code does.
- Mutation: the line never filled (2 red per engine run).

## Review 2 (opus)
- SHOULD-FIX fixed: the recovery stopped at "sign in again", which leaves the computer in no family (and in the review
  flow, Remove has taken it out of the family). It now ends "and enter the family's join code again", as the console's
  steps do. F11 holds the full sentence in the join flow and its ending in the review flow. Mutation: the step
  dropped (4 red).
- NIT fixed: "If it is the wrong one" assumed the parent can tell, with no address on screen; it is now "If this
  computer was signed in with your own address", which the parent knows.
- NIT fixed: the console's "Do not use a child's own email address for a child under 13." is in the family line.
  The sign-in line keeps the shorter form ("an email address you read") to stay one quiet line for adults.
- NIT fixed: a computer its company manages is not shown the sign-in line (render-plus-company-5628: shown unmanaged
  as the control, hidden managed). Mutation: the hide removed (1 red).
