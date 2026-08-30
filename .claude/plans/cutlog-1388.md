# cutlog-1388: a killed cut step and a failed one must be different rows

Card kosmos#1388. Angel, 2026-08-30.

## What finished looks like

Reading `cut-suite-runs.log`, somebody can tell a cut that was **killed** from a cut that
**failed**, without asking anybody. Two rows that were byte-identical apart from an exit
number now differ on a field that says which happened.

## The defect

Baron's 0.6.03 re-cut died at step 3b with exit 143. The page checks were killed, not red:
`suite_exit=0`, twenty-one seconds in, every assertion passing until the moment it died.
Two browser gates were live and stopping one took the other down. The log wrote a bare
`exit=143` and it read as a failure, so the response was to hunt a product defect on a cut
that had nothing wrong with it.

⭐ **The tell is that `suite_exit=0` was already in the log and the summary line overrode
it.** A step line contradicting its own detail line is worse than one that omits it.

## The decode, and the trap inside it

128+n is the shell convention for a signal death. **It is a convention, not a guarantee**,
and treating it as one produced a worse defect than the original:

- A first version claimed `killed` for any status over 128, **fabricating signal names**:
  255 became `SIG127`, 192 became `SIG64`, 160 became `SIG32`. This bash has no such
  signals (`kill -l 32` exits 1; control `kill -l 15` prints `TERM`).
- 🛑 **That is this card's defect inverted and worse.** A bare `exit=143` sent a reader
  hunting a defect that was not there. A fabricated `signal=SIG127` tells a reader to
  **stop** looking for one that is.

✅ **So the signal name is resolved FIRST and `killed` is only claimed if it resolves.**
An unresolvable status stays `failed` and carries no `signal=` field.

## ⚠️ The residual, named rather than buried

**Even a resolvable signal number is ambiguous.** `git` exits **129** for any usage error
(measured: `git commit --bogus` → 129, control `git status` → 0), and this script makes
several unguarded `git` calls. So a genuine git usage error logs as
`outcome=killed signal=SIGHUP`, and nothing in the status can separate that from a real
`SIGHUP`. The comment says so at the site. **A reader seeing `SIGHUP` should check whether
anything actually signalled the cut.**

## Proof

Guarded in `tools/test-cut-step-record.sh`, and the guard is proven against real code
rather than assumed:

- **8 arms go red** against the genuine pre-#1388 `origin/main:tools/release.sh`.
- **2 arms go red** specifically against the fabricated-signal version.
- Arms cover 0, 1, 128 (the boundary), 143, 137, 160, 255.

⚠️ **One arm had to be rewritten because it could not fail.** It asserted the killed and
failed rows merely *differed*, which passes against the unfixed code: they always differed
on `exit=143` versus `exit=1`, which is the field the card says is insufficient. It now
compares the `outcome=` values.

## Scope

**In:** the decode, its guard, and the continuation-aware extraction in
`tools.release-gate.test.js#1449` that #1388's line-wrapping broke.

**Out:** serialising browser gates, which is the reason the two cuts collided at all and is
a separate and probably better fix; and the variable arity of the log line (`signal=` is
conditional), which nothing parses positionally today.

## Weakest premise, named by me

**The classification is a heuristic and always will be.** Nothing in an exit status proves
a signal happened. This change makes the common case readable and the ambiguous case
honest; it cannot make the status unambiguous, because the information is not there.
