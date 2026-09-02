# kosmos#1787: three modules write a plaintext credential and chmod it afterwards

## The mechanism, measured rather than assumed

`writeFileSync(FILE, secret, { mode: 0o600 })` applies the mode **on create only**. On a
path that already exists it is silently ignored. All arms:

    fresh create with mode 0600                  -> 600
    pre-existing 644, rewritten with mode 0600   -> 644   <- IGNORED
    then chmodSync 0600                          -> 600   <- the old "fix"

⇒ The secret bytes land at the OLD permissions and are tightened only afterwards. Three
modules did exactly that with real credentials:

| file | what is in it |
|---|---|
| `engine/tokendoor.js` | a service token, per `envVar` |
| `engine/githubdevice.js` | a GitHub `access_token` |
| `engine/cloudflare.js` | a Cloudflare API token |

## 🛑 The catch comment stated the belief #1761 disproved

    try { fs.chmodSync(FILE, 0o600); } catch { /* mode set at write */ }

**It is false on the only path that matters.** If that chmod threw, the credential stayed
world-readable **and the comment said that was fine.** The comment is not merely stale; it
is the reason nobody looked. It is deleted with the code, because a correct fix that leaves
it in place leaves the next reader believing the old thing.

## One writer, not three patches

`engine/securewrite.js` is **EXTRACTED from `sendertoken.js`** after #1776, not copied, and
`sendertoken.js` now uses it. Measured before deciding: no such helper existed on the JS
side (`writeFileAtomic`, `writeSecret`, `writeTight`, `atomicWrite`, `writeFileMode` all
returned zero files, against a control of 103 files using `writeFileSync`). #1470 built one
for the Rust side for the same reason.

Three separate edits would fix three sites and leave the order gettable-wrong at the next
one, and would leave two implementations of the same pattern to drift.

⚠️ **The weakest premise in that decision, named rather than buried:** that #1776's 37 arms
actually cover the extraction. Several stub `fs.writeFileSync` and `fs.renameSync`, and a
moved call could have broken the stubbing rather than the behaviour. It did not, and one
arm did break for a different reason (below), which is evidence the arms were live.

## 🛑 The extraction was verified AT THE NEW LOCATION

**A passing suite proves nothing if the arms point at a file that no longer holds the
code.** That is the real risk of moving code, and it is the step most likely to be skipped.

All of #1776's arms pass against the moved code (37 at the time; 36 now, one having been relocated to `engine/securewrite.test.js` where the code it tests lives), **and all five of #1776's mutation-verified guards
still redden when the code is mutated in `securewrite.js`**, checked one at a time:

| mutation, in the NEW location | arm that fires |
|---|---|
| delete the `refuseSymlinkTarget(file, undefined)` call | the fallback symlink arm |
| remove the restore-on-failure block | the token-destruction arm |
| disable the temp retry loop | the retry arm, on the INODE |
| make the temp chmod fatal | the chmod-cost arm, on the RETRY COUNT |
| swap `fchmodSync` and `writeFileSync` | the write-time observer arm |

📌 **One arm broke during the migration and it was the right one to break.** The refusal
message changed from "a token" to "a secret" when the writer became generic, and the arm
pins the sentence. That is the guard-keyed-on-wording defect this branch has already paid
for twice, catching me a third time. Updated, with the reason recorded beside it: the
property pinned is unchanged, only the wording moved.

## 🛑 The call sites were unguarded and I nearly shipped that

Before writing a single arm, I reverted `tokendoor.js` **entirely** to the old vulnerable
shape and ran everything:

    engine/tokendoors.test.js    5/5   GREEN
    engine/sendertoken.test.js  37/37  GREEN
    engine/cloudflare.test.js    3/3   GREEN

**A guard on the writer is not a guard on its invocation.** #1776's whole finding was that
eleven arms guarded `refuseSymlinkTarget`'s body while nothing guarded the call. **The same
shape reappeared in the fix for that card's sibling**, and I found it only because #1776
taught me the question.

## The arms assert the INODE, and that is the reusable part

**A mode assertion cannot discriminate: both shapes end at 0600.** Every pre-existing
`assert.equal(fs.statSync(FILE).mode & 0o777, 0o600)` in these three files passes either
way. They are not weak tests. They are aimed at an observable that does not differ.

`rename` **REPLACES** the target's inode; a write in place **REUSES** it. That is the only
externally observable difference between the two shapes.

    const inodeBefore = fs.statSync(FILE).ino;
    // ... perform the save ...
    assert.notEqual(fs.statSync(FILE).ino, inodeBefore);

Each arm carries a precondition asserting the loose plant actually took, because a plant
that silently failed would make the arm pass for the wrong reason. Verified by reverting
each site individually: `cloudflare` RED, `tokendoor` RED, `githubdevice` RED, each with
its own message.

⭐ **The general move: when a guard will not bite, do not reach for a STRONGER assertion on
the same observable. Find an observable that DIFFERS between the two states.** A stronger
mode assertion would still have passed. Same lesson as #1776's fallback chmod order, where
the end state was identical and only observation from inside the write could separate them.

## Out of scope, on the author's stated intent

`engine/githubdevice.js:131` writes `APP_FILE` with no mode argument. **I put it on the
card as a fourth site and I was wrong.**

    DIR      = store.ROOT/secrets
    FILE     = store.ROOT/secrets/github.token     the credential
    APP_FILE = store.ROOT/github-app.json          NOT in secrets/

And three lines above the write:

> *The one value Josh hands over. Not a secret (a device-flow client_id is public by
> design), so it lives beside the store's records, not in secrets/.*

⇒ **The absent mode is the author declining to restrict a public value, in writing.**
Folding it in would ADD a restriction rather than enforce a declared one, which is the
#1774 principle inverted and the error I have now made twice on #1763.

📌 I judged it originally from a `grep -n` hit that showed the write and hid the intent
three lines above it. **A grep hit tells you a call exists; it cannot tell you the author
already considered and rejected what you are about to add.**

## Verification

- Full suite **`EXIT_CODE=0`**, read from the log rather than a tally line, on a
  **committed** tree. The count is deliberately not quoted: it moved from 3601 to 3615
  across seven review iterations, and a number in a plan about a branch still under
  review is stale by construction.
- Full suite at 8508e47c (after iteration 10), tree clean, `tools/run-tests.sh` with the
  exit code written to the log by the runner's own last line: **`EXIT_CODE=0`, 3626 tests,
  0 fail**, 19:25 to 19:27 CDT on 2026-09-01, load 1.6 at start. Re-run at f888d39f (after
  iteration 11): **`EXIT_CODE=0`, 3627 tests, 0 fail**, 19:36 to 19:38. The hold that preceded it
  (a colleague's browser-gate bisect on main) was lifted at 19:13.
- Every fix perturbed individually, each reddening only its own arm.
- Two of my own mutations failed to apply during this work and produced meaningless greens
  until I checked. Both caught by asserting the mutation applied before trusting its
  result.

## Iteration 9 (2026-09-01 evening): the read half of iteration 8, and what it found

The blind reviewer that was reading iteration 8 was lost with a session restart; a fresh
one read dfbca17a. Its first finding was real, reproduced, and worse than it looked.

### Create and write were one call, and `created` flipped after it

`writeFileSync(tmp, data, { flag: 'wx', mode })` both creates and writes. A write that
failed after the create (ENOSPC mid-write) left `created` false, so the catch never
unlinked the temp. Measured on a scratch copy: **three attempts, three 0600 temps each
holding the first bytes of the NEW secret, then the fallback succeeded and the caller saw
a clean write.** The header's "litter needs a process death" claim was false. Fixed at the
create: open `wx`, mark created, `fchmod` on the fd, write through the fd, close, rename.

**Six arms across two files went blind to the fix**, because they had instrumented the
old `writeFileSync` on the temp path. Each repointed at the `wx` open; the planted-file
arms now let the kernel refuse the plant. Coverage that does not follow a defect when the
defect moves is decoration that still passes.

### The three unguarded mutations from the iteration-8 battery

| mutation | arm, red by name | how it discriminates |
|---|---|---|
| drop `O_NOFOLLOW` from the fallback open | the fallback OPEN refuses a symlink swapped in AFTER the path check | plants the link from inside `readFileSync`, which runs after the path check and before the open; victim bytes and mode unchanged |
| restore via a PATH write | the restore writes through the DESCRIPTOR | hard-links the open inode, swaps the path for a link mid-failure; the inode has the previous secret, the victim does not |
| drop `mode` from `secureDir`'s mkdir | secureDir creates AT the mode | observes the directory's mode at the instant chmod is called, before chmod applies |

The path-write mutation was first written in a form that also truncated the fd, which
reddened two existing arms and overstated the guard. Re-run faithful: only the new arm reds.

### #1799, fixed here

The githubdevice flake (1 in 13 whole-file runs) was traced twice with instrumentation:
the cancel arm's poll, still in flight two arms later, consumed the next arm's token and
the new flow overwrote the failure. Product fix: a generation counter at every flow
boundary, captured before the round trip and checked after. Fixture fix: answers bound to
the issuing flow. An arm holds a stale answer in flight across a cancel and a restart and
asserts it touches nothing; red by name without the check. Landed on this branch because
the branch already edits the file and its gate was flaking on the race; the card stays
open until served. Keying the fixture on the CURRENT code was tried first and made it
worse (7 of 30): a stale chain that can never consume polls forever at interval 0.

### Also corrected

The writer's refusal code has been `ERR_KOSMOS_SYMLINK` since iteration 7; two consumer
stubs and two comments still said `ELOOP`. Corrected. The two clock-dependent arms in the
githubdevice suite now wait for a terminal phase rather than a fixed sleep.

## Iteration 10 (2026-09-01 19:15): the generation check had two holes, and the reviewer reproduced both

Iteration 9's #1799 fix read the generation when the poll FIRED rather than binding it
when the flow scheduled it, and `start()` never re-checked after its own await. A blind
reviewer built two probes: a cancel during the device-code request that did not cancel
(start resolved `awaiting` afterwards and the cancelled flow's token was stored), and a
second start whose first poll timer the superseded flow's reschedule cleared, so the code
on screen was never polled and the sign-in hung to expiry. The card's own symptom, still
reachable, one commit after the card said it was closed.

**Now:** `start()` takes its generation right after the bump and binds it into every poll
it schedules; `pollOnce` checks after the round trip; `schedulePoll` refuses a stale
generation (the fetch-failure path reschedules through it); `start()` bails after its own
device request if the generation moved. **A fourth check at `pollOnce` entry was written and
then removed:** a timer only exists for the live flow, so it could never go red, and a guard
that cannot go red is decoration.

| mutation | arm red by name |
|---|---|
| start() installs AWAITING when superseded | a cancel while the device-code request is out CANCELS |
| schedulePoll accepts a stale generation | a superseded poll whose request FAILS does not reschedule over the live flow |
| no check after the fetch | an answer to a flow the person already left cannot complete or reset the next flow |

The arms hold the stub (device-code response, token answer, or a dropped socket) so the
ordering is forced rather than raced, and wait on the stub's "sent" signal rather than a
sleep. The second-start arm gives flow 2 a real one-second interval so it has a pending
timer at the moment the stale poll returns, which is the condition the reviewer's probe
needed. 20 of 20 whole-file runs green.

Also from iteration 10: the atomic write loop now refuses a zero-byte write like the
restore loop does; a garbled sentence in the restore comment is fixed. From iteration 8's
tail: the fallback's best-effort fchmod names its cost (the sentence the extraction had
dropped from sendertoken.js), and three "victim was written through" assertions that could
not fail are replaced by the reason they could not.

## Iteration 11 (2026-09-01 19:45): forget() had no arm

The reviewer cleared the generation binding (every bump is an abandonment, every
abandonment clears the one timer, no path discards a live flow, two concurrent starts
resolve in either order) and found the one edit nothing watched: `forget()`'s bump.
Replacing it with `stopPolling()` left all fifteen arms green while a token arriving
after Forget was written into the file the person had just deleted. An arm now holds
that answer across the forget and asserts nothing is stored and nothing is held; red by
name under the mutation. Also: the header no longer claims the entry check iteration 10
removed; a stale comment about path-addressed writes is corrected; the partial-temp
arm's fd set forgets a descriptor on close (numbers are reused, and the set had been
sabotaging the fallback too); the two `connected === false` assertions say they pin the
fixture rather than the contract.

## Iteration 12: consumer-attached coverage, one more time

The reviewer cleared the generation binding (six mutations, each red by name), the atomic
path and the fallback, and found the temp's `fchmodSync` guarded only through
sendertoken's umask arm: deleting it left this module's own file green 19 of 19. That is
the consumer-attached shape this file's header exists to remove, in the file written to
remove it. An arm here now writes under umask 0600 and asserts 0600 (the wx create lands
at mode 0 under that umask; the fchmod is the only thing restoring the owner bits). A
second arm pins the zero-byte-write refusal by its real harm: an EMPTY temp renamed over
the secret. Both red by name. The failed-OPEN arm's prose now states its scope (it guards
against a path write being re-added, not the `fd`/`wrote` gate, which the fd-addressed
restore made unreachable). The two arms that wait on a real one-second poll timer have a
ten-second budget, since the box has run at load 17 during cuts and the failure direction
was red-while-correct.
