---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: xsite-1636
diff_hash: 91a13b2812618314c5002a1da682cba1d4177ae2b2845cd3fc4ec113dcd3b48e
subdir_audit: passed
timestamp: 2026-08-31T00:02:56Z
converged: true
---

## [PRE-CHALLENGE] Single-pass self-review

One pair of eyes, plus two peers who each set a requirement this branch had to meet:
**assert at the doors, not the status code**, and **drive the same-origin arm through the real
screen rather than a synthetic header**. Both are met below, with controls.

## [BLOCKER] (mine) My first negative control silently did not perturb anything

I perturbed the guard by string replacement and asserted `count == 1`. **The assert fired
because the text appears TWICE** - `/api/unfurl` carries an identical guard - and I first read
that as "the text did not match". The board that then ran was **unperturbed**, and the drive
reported `BOARD_PASSES`, which would have been recorded as a passing control that never
tested anything --> FIXED: perturbed by LINE NUMBER with an assertion on the line's content,
and the control then produced `REFUSED_THE_BOARD`.

⭐ **The assertion is the only reason I know.** A bare `replace()` would have perturbed nothing,
printed nothing, and handed me a green control.

## [BLOCKER] (mine) My first real-screen drive never requested the route

The Connections shelf paints only through `settingsOpen('connect')`. My drive expanded the
`<details>` elements, which looks like opening the section and is not: the page painted 66 door
pills and requested `/api/connections` **zero times**, so the verdict was `NEVER_REQUESTED` -
a non-result I could easily have read as "no problem found" --> FIXED: click the nav button the
way the real user does.

⚠️ **Both of my failures this hour were controls that produced a REASSURING answer without
exercising the subject.** Different mechanisms, same shape.

## [WARNING] (mine) I retired a verification method I used twice tonight

I have written "that is N + my M, which is the arithmetic that confirms they all ran" in two
proofs today. **It is not sound in this repo**: several test files call `test()` inside loops,
so the total is data-dependent on the tree, and this branch (main + 6 tests) came out with a
LOWER total than the previous one. ✅ The sound check is grepping the suite output for the test
NAMES, which I also ran. **The earlier arithmetic happened to come out right, which is worse
than coming out wrong.**

## [STRENGTH] The placement, not the line, is the fix

With the guard moved AFTER the sweep, the response is **still 403** and the door assertions go
RED. A test reading the status code would have passed while the money was still being spent.

## [STRENGTH] The coverage claim was established rather than inherited

The card said the same line is already used at three sibling routes, and then refused to let
that settle whether THIS route's caller still passes. It does not: none of those siblings is
what the board reads. Driven in a real browser, both arms.

## Verification

| perturbation | status | doors | real screen |
|---|---|---|---|
| guard removed | 200 | **RED** (7) | - |
| guard AFTER the sweep | still 403 | **RED** | - |
| guard forced to refuse all | - | - | **REFUSED_THE_BOARD** |
| shipped | 403 / 200 | green | **BOARD_PASSES**, 200, 66 door pills |

`server.js` restored to its exact sha after every perturbation, checked each time. Full suite
**3214 pass, 0 fail**, all six present by name.

📌 Handler-only: one additive hunk at 3772, zero touches to `readConnectionsShelf`, `askDoor`,
`settleDoors` or `readFirstPartyDoors`, which Angel is refactoring on `connect-verdict-1034`.
She confirmed that boundary is what makes this clean, and asked me not to hold.
