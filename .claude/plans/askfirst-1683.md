# askfirst-1683: removing an account must ask first

kosmos#1683.

## Problem

Josh asked for this in #770, in his own words: *"one box per account, a green Connected mark, a Disconnect link at the bottom that asks first."*

The asking half did not ship. A single click on **Remove** fired `DELETE /api/accounts/openai` immediately.

## Scope correction, measured on origin/main rather than taken from the card

The card says *"Both provider rows in Settings render a live Disconnect."* **On `main` only the OpenAI one is live.**

```
OpenAI row    <button class="acct-disconnect" data-forget=...>Remove</button>      LIVE
Claude row    <button class="acct-disconnect" disabled
                title="Not built yet: ...">Disconnect</button>                     DISABLED
```

The Claude button becomes live in **#1659, which is unmerged**. So this card, like #1697, is partly premised on an unmerged branch.

⇒ **This PR fixes the half that is live today.** The Claude half needs the same treatment when #1659 lands, and the idiom is now in place beside it to copy.

## Why it is worth doing rather than filing as cosmetic

The two providers are not equivalent, and calling this "inherited from #1372" understates it:

| | undo cost | who has it |
|---|---|---|
| OpenAI | re-paste an API key | people who added one |
| Claude | a full OAuth sign-in | every user |

## Change

The arm-in-place idiom already used three times in this file (17800, 18285, 20522): first press arms and relabels, second press acts, blur disarms. No modal, no state outside the closure, no repaint.

### Two decisions worth arguing with

**1. The label says "Remove it?", not "Remove it for good?".** The sibling idioms say "for good". Copying that would have been wrong here: the engine **forgets rather than deletes**, renaming the directory so the sign-in file survives, and the success sentence a few lines below is careful to say exactly that. A confirm that promises more than the sentence that follows it is worse than no confirm.

**2. A refused remove disarms.** This matches the established behaviour of the sibling confirm, asserted in `web.lost-phone.test.js`: a refusal disarms and the following click re-arms. Without it the button sits reading "Remove it?" after a failure and one press acts.

## Verification

Driven **through the real click binding**, not asserted against the source: the binding loop is sliced out of the shipped page and run in a VM against a fake button. A source-level `assert.match` would prove the text is present and say nothing about whether the first click reaches the engine, which is the only thing this card is about.

| arm | result |
|---|---|
| all four tests | **RED** without the fix |
| all four tests | green with it |

Suite: **exit code 0**, 3264 pass, 0 fail, 0 shell FAIL lines.

**Swept for stale assertions before changing rendered markup**, per the defect that broke three release cuts this week: two files reference these buttons, and the sibling (`web.provider-groups-1393.test.js`) asserts query **rooting**, not button text, so it is unaffected. I checked what it asserts, not merely that it mentions the selector.

## Limits

- **No test in this file stays green under the perturbation**, because every test in it targets the changed behaviour. The two-arm evidence is red-without and green-with, not a green control.
- **The browser gate was not run.** It can run on this machine, contrary to what I said when I declined this card earlier. I did not run it because a release cut owns the browser while it is serving, and taking it during a freeze risks a contended failure that says nothing about this change. The arming logic is exercised through the real binding.
