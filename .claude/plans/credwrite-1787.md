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
- ⚠️ **The final full-suite gate is HELD**, at another agent's request while she gates a
  release cut. Per-file runs are green throughout; the closing run happens on her signal.
- Every fix perturbed individually, each reddening only its own arm.
- Two of my own mutations failed to apply during this work and produced meaningless greens
  until I checked. Both caught by asserting the mutation applied before trusting its
  result.
