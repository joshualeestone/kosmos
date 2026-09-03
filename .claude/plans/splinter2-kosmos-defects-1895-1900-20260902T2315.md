# splinter2-kosmos-defects-1895-1900

**Provenance: this patch was AUTHORED BY SPLINTER2 on the second Mac and relayed here.**
Applied with `git am`, so both commits carry his authorship. Splinter (claudebot) applied,
verified and opened the PR. Stated plainly because the reviewer should know the person who
wrote it and the person who pushed it are different, and the commits already say so.

## Why it came by patch rather than a push

That machine has **no GitHub credential** - `fatal: could not read Username`, confirmed by a
dry-run push before any of this. Josh cleared him to push branches, then the measurement showed
he could not. So the patch went Splinter2 -> Josh -> Discord attachment -> here.

⚠️ **Worth recording: his FIRST auth check printed exit 0.** He had piped `git` through `head`
and read the pipeline's status rather than git's. He caught it by writing stdout and stderr to
separate files. Had he stopped there, this branch would have been pushed from a machine that
could not push.

## What it does

**#1895 - two defects five lines apart in the `?as=text` arm of the room endpoint.** Both read by
AGENTS via `kosmos room`, never by the page, which is why neither was visible from the dashboard.

1. **The clock was UTC and named no zone.** The line sliced characters 11-15 out of the stored
   ISO string. The page has always been right (`toLocaleTimeString`, three places), so the same
   post read `19:50` on one surface and `14:50` on the other. **The wrong surface is the one a
   machine reads and then quotes back to a person.**
   `roomClock()` takes the operator's stored zone (#1668) and falls back to the board's machine.
   A stale zone id falls through to the machine **rather than dropping the time** - losing every
   timestamp because one setting went stale is worse than showing the board's zone.
2. **The fallback could not reach its own case.** A room post stores `to: []`; `Array.isArray([])`
   is **true**, so the join branch produced `''` and the line rendered `splinter2 -> : hello`.
   The words "the room" appeared only when `to` was absent or not an array - which for a room post
   it never is. Checking `.length` is the whole fix.

**#1900 / #1896 - the CLI.** `adopt` was dispatched and `--help`-allowlisted but named in neither
verb list. And the help said *"Run any of them with no arguments to see what that one takes"* -
true for five verbs, **false for `stop` and `restart`, which ACT with no confirmation.** The
discovery move the help recommended was destructive on two of eight verbs.

## Verification performed HERE

| check | result |
|---|---|
| read all 321 lines before applying | done; nothing credential-shaped |
| `git am` | clean, authorship preserved |
| new test file | 7 tests, 7 pass |
| **full suite** | **3,814 node tests, 0 fail + 33 shell arms, terminal verdict line present** |
| **perturbation** | **reverted `roomClock` to the UTC slice -> 4 of 7 RED**, matching his claim of four load-bearing assertions; restored, green, tree clean |

A killed suite prints a passing tally, so the terminal verdict was checked rather than the tally.

## 🛑 NO CHALLENGE LOOP WAS RUN HERE, and this file will not imply one

Splinter2 ran his own review on his machine before sending the patch. **I did not run the
challenge loop against it**, and there is no `-pre-challenge.md` proof file for this branch
because there is no loop to prove. What I did is listed above and is verification, not
adversarial review.

⇒ **A reviewer should treat this as single-reviewed, not loop-converged.**

## Known limit a reviewer should see

The new test's `postLine()` **replicates** the expression `server.js` composes rather than
executing `server.js`. Deliberate and reasonable, but it means **a future edit to `server.js`
reverting either fix would not red this suite.** Worth a follow-up that exercises the endpoint.

📌 The test **sandboxes `AGENT_WORKFORCE_DATA` before requiring store** - the exact defect he
filed as #1912 hours earlier. He applied his own finding to his own work.

## Deliberately not done

Making bare `stop`/`restart` a dry-run needing `--confirm`. `tools/test-install.sh` invokes
`kosmos stop` at a dozen sites, **every one `|| true` guarded**, so the contract change would
break that suite **silently**, leaving tests running against a board that was never stopped.
A product decision with real blast radius, correctly not taken unilaterally.
