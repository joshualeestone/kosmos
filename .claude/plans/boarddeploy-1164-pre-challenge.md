---
method: pre-challenge
branch: boarddeploy-1164
diff_hash: 436683c9199da94f0a140636edb2e7f5512362767925a1119efad673d065b760
explicit_override: true
---

# Pre-challenge: #1164 board deploy step

**Override reason:** self-review, not a `/challenge-loop` run. Stated rather than relabelled.

## What I challenged in my own change

**1. Is a new deploy step even needed, or does one already exist?**
This is the question that mattered most and it nearly went the wrong way. An installed app copy
exists at `~/.local/share/kosmos/app/` and repointing the plist at it looked like a one-line fix.
**Measured: 0.2.36 from 2026-08-21 against a tree at 0.6.18.** Nine days, about ninety versions.
⇒ Repointing would have been a severe regression wearing a fix's clothes. **Check a thing before
reusing it**, which is the same lesson as finding the fleet-liveness log already existed earlier
tonight, arriving from the opposite direction.

**2. Is a copy actually sufficient, or does the board need more?**
Measured, not assumed: `dependencies: {}`, no `node_modules` anywhere in the repo, and
`server.js` requires only `node:` builtins. **Control: the same grep found 60 relative requires**,
so it could see requires at all and the empty external list is a real result rather than a broken
pattern.

**3. Does the refusal actually refuse?**
The arm that matters, and a pipe nearly hid it: my first check read `rc=0` because I had piped the
script into `tail`, which is `pipe-erases-exit-status` in my own verification. Measured properly:
**`--apply` from a dirty tree exits 1**, creates nothing, and leaves the live plist untouched.
**Control: the dry run exits 0.**

**4. Does the drift guard fail on demand?**
Three perturbations, each restored, each firing the right message: a dropped file, an extra file,
and a broken extraction. ⭐ **The third is the one worth having**: with both lists empty the
comparison passes vacuously, and the control names that rather than reporting success.

## The guard found two defects in itself before it found anything else

Both are this week's recurring class and both are recorded in the test's own comments:

- it compared the **whole bundle** to the app deploy and reported six false differences, because the
  bundle also stages the installer and the native app. **An instrument answering an adjacent
  question.**
- scoping it to the app section still failed, because `/^# ---- the app /` **also matches**
  `# ---- the app can tell when it is the stale half` three hundred lines later, reopening the
  range. **The dashes separate a section header from a sentence that starts the same way.**

## Weakest premise, named

**I have not run the board from the deployed copy.** The dry run is verified and the refusal is
verified; the `--apply` path's copy-and-swap and plist rewrite are **not exercised end to end**,
because doing so repoints the live board eighteen agents watch. So the code most likely to be wrong
is the part I deliberately did not run.
⇒ **What would change my mind, and it is cheap:** point `KOSMOS_BOARD_LIBEXEC` and
`KOSMOS_BOARD_PLIST` at scratch paths and apply into them. I built both overrides for exactly that
and did not spend the night on it, because the card is latent and the mechanism is the deliverable.
**Anyone applying this for real should do that first.**

## Deliberate non-scope

**Not applied.** This PR does not change what the board serves. Applying is a one-command,
operator-timed step and the plan says so in those words, because "merged" read as "deployed" is the
error that cost me a wrong card closure on #1554 tonight.

## Verified before opening this PR

- node suite **3236/3236, fail 0, rc=0**
- shell suite **rc=0**, **0 FAIL lines** against a control of **481 PASS lines**, with the new guard
  reporting `Results: 3 passed, 0 failed`
- 0 em dashes in the diff

## Known imprecision

`diff_hash` is computed against local `main`, which trails `origin/main`, so it binds more files
than this branch changes. That is kosmos#1472. I did not fast-forward shared `main`: it can
invalidate a colleague's in-flight proof, and over-binding costs fidelity on my own proof only.
