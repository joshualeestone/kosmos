# blockdrop-1673: three of five managed blocks vanish without saying so

kosmos#1673, taking the "is never told" half.

## What was already fixed, so nobody re-does it

The card's central claim was corrected by its own author: `engine/create.js:2640` calls `defaults.appendTo(text)` **ungated**, so a custom-instructions agent does receive the operating defaults, and since #1677 those contain "Answering the person who messaged you". **The born-unable-to-answer half is closed.** I am not relitigating it.

## What is still live

Creation appends five managed blocks, each size-capped. Only two said anything when the cap dropped them:

| line | block | warned? |
|---|---|---|
| 2555 | `you` (who the person is) | **no** |
| 2577 | `reports` (who you report to) | **no** |
| 2600 | `messages` | yes |
| 2640 | `defaults` (the operating doctrine) | **no** |
| 2654 | `connections` | yes |

⇒ **The block carrying "how to answer the person who messaged you" was one of the silent three.** So the exact failure this card is named for could still happen with the person told nothing.

⇒ And it is not a custom-instructions problem. The card title would have led me to scope it that way; it is a property of all five appends on every path.

## The design left alone

Not appending to a person's own words uninvited is deliberate, and `#591` settles it: a person who pastes a job has taken authorship of the job, not opted out of the product working. The byte cap's posture is also right, in the source's own words: *"drop the block, never refuse the agent"*.

**Dropping the block is the right failure. Dropping it in silence is not.** Only the silence changes here.

## The cap is reachable, measured rather than read

```
MAX_BYTES             262144
defaults block costs   11807
=> instructions over   250337 bytes lose it
```

That is the top **4.5%** of the permitted range, and `create.js:2113` accepts it. The appends are cumulative, so `defaults`, coming after the others, is the likeliest of the five to be dropped.

I said on the card that until I made a drop actually happen this was a reading rather than a measurement. It is now a measurement.

## Change

Three `steps.push({ ok: false })` warnings, in the same shape and the same non-gating posture as the two that already existed. No behaviour change, no new gate, nothing refused that was not already refused.

## Verification

| arm | result |
|---|---|
| defect test | **RED** without the fix |
| control | **green** throughout |

The control matters more than usual here: a fix that pushed these steps unconditionally would satisfy the defect test and be far worse than the bug, because every creation would claim its agent is broken.

Suite: **exit code 0**, 3262 pass, 0 fail, 0 shell FAIL lines.

## Limits, stated rather than discovered in review

- **The test exercises the `defaults` drop only.** An agent with no manager and no `you` record never reaches the `reports` or `you` appends, so those two warnings cannot fire in that scenario and asserting them would assert a branch that did not run. An earlier draft did exactly that and failed for that reason. Those two are covered by inspection, not by this file.
- **250KB of instructions is an extreme input.** The window is real and accepted, but I would not claim anyone has hit it. The stronger argument for the change is the inconsistency: two siblings already warn, and the silent one is the one that teaches an agent to answer.
