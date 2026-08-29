# reauth-ui-1492: the button that calls the route #1497 built

## The state this was in

**#1497 merged the route and nothing called it.** `POST /api/connect/start
{ accountDir }` has been live on main since 12:18 today; `web/index.html`
mentioned it **zero** times. That is the merged-but-inert shape this codebase
ships repeatedly and which reads as done from every angle except the screen.

## What a person sees now

Every Claude account row gets **Sign in again**. It opens the one sign-in
dialog, aimed at that account's own directory, and the dialog says which
account and promises not to make a second one.

## Three decisions, with the reasoning

**1. On EVERY Claude row, including signed-in ones.** #874 measured that the
badge cannot see a REJECTED token: `claude auth status` answers `loggedIn:true`
for a transparently invalid one. Josh's own case was a green row and a token
being 401'd ten times in a row. **Gating the remedy on "not signed in" would
hide it from exactly the state the card came from.**

**2. Claude rows only.** `connect.start()` is the browser sign-in. An OpenAI
account is a pasted key and re-keying it is a different act with a different
form. A Claude-flow button on an OpenAI row runs the wrong sign-in.

**3. One dialog, not a per-row flow.** The engine has ONE connect flow, so two
rows showing their own spinner would be two renderings of a single fact and the
second would be a lie. Reusing the dialog also reuses its code step, its cancel
button and its way out, which the modal-exit tables already guard.

## The dangerous direction, and it has its own test

**A stale `ACCT_REAUTH_DIR` would make the next press of "+ Add a provider"
quietly sign in to an account that already exists.** That is the mirror image of
this card's defect and it is worse, because it silently succeeds.
`openAcctAdd()` clears it on every visit and the test pins that specifically.

## A stale sibling assertion, fixed rather than left green

`web.accounts-add.test.js` said *"the ONE request this button makes carries
{ another: true }"*. #1492 makes that sentence false, and **the assertion stayed
green through the change** because the new shape is a ternary and the old arm is
still in the source. Restated as the invariant that is actually true: **never a
plain start, and both shapes reachable.**

## Perturbed, six arms

Each site broken separately; each fails **exactly one** test, and the right one.
Restores sha-verified against the pre-perturbation file.

```
openAcctAdd stops clearing the aim      -> the stock-door test
openAcctAdd stops restoring the chrome  -> the stock-door test
the body always asks for a new account  -> the two-requests test
OpenAI rows get the Claude button       -> the row test
nothing listens to the buttons          -> the row test
the provider picker stays offered       -> the aim test
```

Suite 2955 pass, 0 fail (2951 before, plus these four).

## NOT done

**Nobody has clicked it.** These run the lifted functions against a stub DOM,
which is stronger than a source match and is not a browser.
