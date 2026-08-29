# 2fa-copy-1415: two shipping sentences contradicted a same-day ruling

## What they said

```
9550  "None yet. The first time you sign in FROM A PHONE, it asks here."
9561  "Signing in FROM A PHONE asks for a second code after the email code."
```

## What Josh ruled, 2026-08-29 14:04

> *"The phone verification will ALWAYS happen. It's NOT if you're coming from a
> phone... It's true two-factor."*

## Why this is not ordinary copy

**A wrong sentence about a feature costs a click. A wrong sentence about what
protects an account teaches a false model of the person's own security.**
Somebody reading the old line concludes their laptop sign-in is single-factor,
and does not think the second step is theirs to lose.

## What I deliberately did NOT write

**His ruling also names an authenticator app.** `authenticator` and `TOTP` appear
**zero** times in the page, the server and the engine.

⇒ **Promising one would be the same defect pointing the other way**: true about
the intended design, false about the shipped software. There is a test asserting
its absence **which goes red the day somebody builds it**, with a message saying
to delete the assertion rather than work around it.

## Guard

Pins **the claim, not the wording**, so a rewrite does not have to touch this
file: the second-step copy must not make the step conditional, and the device
list must not describe itself as being for phones.

Perturbed four arms, each failing its own test.

## Two instrument failures caught by the control, and both are classes

**1. The detector matched its own description.** My comment explaining why the
copy does not promise an authenticator app contains the words `authenticator`
and `TOTP`, so the check found its own explanation and failed. Comments are
stripped before every assertion now.

**2. Slicing forward from an `id` starts INSIDE the tag.** `plus-devempty` is a
`<p>` whose opening tag is behind the id, so the paragraph scan silently picked
up the NEXT element, which is an empty message paragraph. **Every assertion would
have run against `""` and passed.** The control is the only reason it surfaced.

Suite 2969 pass, 0 fail.
