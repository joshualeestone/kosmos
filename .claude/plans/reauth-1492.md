# reauth-1492: a way back into an account you already have

## What a real person hit

Josh's sister, first outside install. Her Claude login expired. Settings correctly said
**not connected**. The only affordance was **"add a provider"**, which made a **second
record** for the same login, and she then could not move her agent onto either.

## The engine could always do this

`connect.start()` has taken a `configDir` since it was written, and `another: true` already
uses it. `/api/connect/start` had exactly two shapes:

```
(nothing)        -> the default account
another: true    -> accounts.nextWorkDir()  ->  A NEW RECORD     <- the duplicate maker
```

⇒ **There was no way to ASK for a directory that already exists.** Not a missing capability,
a missing request shape.

## The change

A third mode: `{ accountDir: '<an existing account>' }`, validated against
`accounts.list()` and **`path.resolve`d before comparing** (the #1486 reason: `list()`
stores a resolved dir, so a trailing slash would miss a real account and send the person
straight back to the duplicate-making route).

## The refusal is the point

🛑 **An unknown folder is REFUSED, never quietly created.** Without that, this mode is a
back door that makes accounts from any string, which is the defect it exists to remove
arriving under a helpful name. Asking for both `another` and `accountDir` is refused too.

## Perturbed, four arms

Drop `path.resolve` -> the non-canonical test. Accept an unknown folder -> the control
**and a pre-existing #248 test**, so the refusal is load-bearing beyond my own tests. Drop
the both-flags guard -> that control. Remove the mode -> five failures.

## A fixture note that is really a finding

My first fixture used a **prepared but never-signed-in** directory, and the route correctly
refused it: `accounts.list()` reports an account only when `identityOf()` finds an
`oauthAccount`. **That is not her state.** Hers existed, Settings named it, and only the
token had expired. The fixture now writes an identity, and asserts the account is one the
engine reports, so the test cannot pass on the wrong refusal.

## NOT done here

**The UI affordance.** A person still cannot reach this from the screen. That belongs in
`web/index.html`, which Angel's held `switch-acct-1373` also differs from, so it should
land after hers rather than widen a branch on its eighteenth review pass.
