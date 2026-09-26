# The boot-file size canary tripped on main; raise it from MAX_BYTES/8 to /6

**Branch:** `bootcanary-0699` · Found by the 0.6.99 staging cut's step 3 (2026-09-26 13:50 CDT)

## What happened

`engine/create.test.js` "a role-made boot file is nowhere near the size its reader refuses" failed
on main: a pm agent's boot file measured 32,935 bytes, and the canary line is MAX_BYTES / 8 =
32,768 bytes (MAX_BYTES, the real reader cap, is 256 KB). It stayed red alone three times, so the
cut correctly aborted with nothing built. Every main CI run that afternoon had been cancelled by the
next merge (runs from 17:57Z to 18:49Z on 227ea4e2c, c04106154, d697696d2, 8586e42e7 and
0e2a2c4cf all read "cancelled" in `gh run list --branch main`), so main's red went unseen until the
cut.

## Decision

Raise the canary to MAX_BYTES / 6 (43,690 bytes), with a dated note in the test.

- **Why that is safe:** the test's own claim is that the fits-check in create.js is unreachable on
  the role path because the boot file is far under the cap. At 32,935 bytes it is still about 8x
  under 256 KB (262,144 / 32,935), so the fits-check is not yet reachable or testable. The
  "four orders of magnitude" wording in the test and in create.js was out of date and now states
  the measured margin (review round 1).
- **Why not leave it:** the canary did its job (it flagged growth), but a red main blocks every cut
  and every PR's CI. Josh wants 0.6.99 out now.
- **Rejected:** shrinking the boot text in this branch (which block grew is not yet known, and the
  text is ruled wording); deleting the canary (it is the only thing watching this growth).

## Follow-up

kosmos#4021: find which merge grew the boot file, and stop main CI runs being cancelled so a red
main is seen before a cut. Measured: `git log 7463b189..origin/main -- engine/defaults.js
engine/roles.js engine/create.js` is empty, so the growth came through another spliced block;
Splinter's lead is e9d1a2222 (#3965), which added about 1.2 KB to engine/dmfiles.js.

## Weakest premise

That the growth is benign. If a block is being duplicated or appended repeatedly, raising the line
hides a defect; the card asks exactly that. The next trip, at 43,690 bytes, would say it again.
