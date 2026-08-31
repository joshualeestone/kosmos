---
method: pre-challenge
branch: pwpreflight-1594
diff_hash: 143962faf54c40b4c8ef95c8b64648a57a046db5c487b3dab8c82eefa8d939cb
explicit_override: true
---

# Pre-challenge: #1594 launch pre-flight

**Override reason:** self-review, not a `/challenge-loop` run. Recorded honestly rather than
relabelled.

## What I challenged in my own change

**1. Is the engine derivation right, or does it just happen to work?**
Measured rather than assumed: 7 raw `ENGINES` lines across the check files, union
`[chromium webkit]`. They genuinely differ, which is why the list is derived and not
hardcoded. Falls back to `chromium` if the grep ever returns nothing, so a refactor of the
check files degrades to the old behaviour instead of skipping the pre-flight silently.

**2. Does the refusal actually refuse, or does it print and continue?**
End to end through the real script with the browser cache pointed at an empty directory:
`EXIT=2` and **zero checks ran**. That is the arm that matters, and a pre-flight that warns
and proceeds would have looked identical in the log.

**3. Does the positive arm still proceed?**
Yes, verified through the real script: both engines print as launching and the run enters the
checks. A pre-flight that blocked a healthy box would be worse than the defect.

**4. Is the error message the diagnostic, or Playwright's banner?**
First line only, split on the banner's box-drawing character. What survives is
`Executable doesn't exist at .../webkit-2336`, which names the engine AND the build number.
The card's whole complaint is 2342-versus-2336, so the build number is the payload.

## Weakest premise, named

**The engine derivation greps for a literal `ENGINES = [...]` shape.** A check that computes
its engine list at runtime, or spells it differently, would be invisible to the derivation, and
the pre-flight would pass while that check still could not launch. I accept this: the fallback
keeps chromium covered, the failure mode is the status quo rather than a regression, and every
current check uses the literal form (measured, 7 of 7). **What would change my mind:** the
first check that computes its engines dynamically. At that point the derivation should move
into the check files themselves, exporting their engines rather than having them scraped.

## Verified before opening this PR

- full suite: **3225/3225, fail 0, rc=0**
- `bash -n tools/browser-checks.sh` clean
- 0 em dashes, 0 zsh-tied variable names in my diff
- cut guard rc=0 and browser guard rc=0 before I launched any browser
- the four headless shells my testing orphaned were traced to one tree, killed by PID, and
  **verified gone by `ps`** with a control showing the check could still see live processes
