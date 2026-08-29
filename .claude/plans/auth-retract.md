# auth-retract: a false claim I shipped an hour ago

## What I asserted

`web.second-factor-copy-1415.test.js` carried a test named *"the copy does not
promise an authenticator app, **because there is not one**"*, and the shipped
page carried a comment saying the same.

## It is false

The feature exists. It lives in the **relay** repo.

```
kosmos-relay/coordinator/src/second.rs   912 lines
  totp            20
  authenticator   11
  otpauth          3
  twilio          16
repo-wide:  totp 140,  authenticator 32
CONTROLS:   an impossible string 0,   `fn ` 754
```

## ⭐ The mistake, and it is one I keep a memory file about

**I searched one repo and concluded about the product.** Nothing looked wrong: a
clean zero, from a working tool, on exactly the strings I meant. **The instrument
did not cover the population the claim was about**, and a zero from a search that
never looked in the right place is indistinguishable from absence.

⭐⭐ **And `Google Authenticator` really is 0 in that file**, so a narrower search
would have "confirmed" me. TOTP with an `otpauth://` URI **is** what Google
Authenticator implements. **The phrase is absent and the feature is not.**

## What replaces it

**Nothing.** A test in this repo cannot see the relay repo, and a cross-repo
assertion would be a worse instrument than none. Whether the copy should NAME the
authenticator is a wording decision for whoever owns that voice.

**The shipped sentence is true either way**: the second step always happens,
whichever thing supplies the code.

## Cost, and where it stopped

Splinter caught it within the hour, **before it reached Josh**. I was about to ask
him whether an authenticator was planned. He has ruled on 2FA twice today, and a
question back would have made him re-decide something already built.

Suite 2968 pass, 0 fail.
