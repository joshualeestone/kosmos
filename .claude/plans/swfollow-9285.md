# kosmos#9285: what a #9268 refusal leads to, said and pinned (branch swfollow-9285)

Follow-up from #9268 (PR #9289), whose review stopped at the fleet's 8-round rule with two WARNINGs and three NITs
open. Built on wxlink-9268 because both edit engine/securewrite.js; rebased onto main once #9289 merges.

## The call on the first WARNING: three forced refusals reach the in-place fallback

Said, not changed. An atomicOnly caller gets ERR_KOSMOS_TEMP_SWAPPED and its file is untouched (already pinned).
Any other caller takes the in-place fallback, as after any three failed atomic attempts: it refuses a link at the
config itself (refuseSymlinkTarget) and rewrites the config in place. That is not atomic, but it writes nothing
through the links this check refuses, which sit at temp names. So the attacker costs a write its atomicity, not its
secrecy.

Rejected: making an exhausted refusal throw for callers that hold secrets. Either way that save is spoiled, and a
throw would turn every planted link into a failed save, for callers that chose a fallback precisely so a write fails
soft. What would change my mind: a caller whose file is worse half-written than not written (that caller should pass
atomicOnly, which it can today).

A new arm pins it: three followed links, no atomicOnly; the save lands in the config, the config is not a link, and
no planted target holds the secret.

## The second WARNING: unmeasured mounts

Not settled here, and still open on #9285. The same-file rules are measured on the Mac, GitHub's Windows runner and a
Linux container on overlay; network shares, FUSE and OneDrive-style folders are not. No machine here has one.

## The NITs

- The doc block's long sentence is rewrapped, and what a refusal leaves is said for every case (the planted name
  always stays; the made file stays, empty, unless the name is still a link to it).
- The hard-link and folder arms now assert the planted name is left as it was; the removed arm asserts nothing was
  written at the removed name. (The swap arm already asserted it.)

## Weakest premise

That refuseSymlinkTarget on the config is enough for the fallback on Windows, which has no O_NOFOLLOW for the
in-place open. That is the module's existing posture, unchanged by #9268 or this, and its own tests cover it.

## Checked

- engine/securewrite.test.js and engine/trust.test.js on the Mac: 92 pass, 0 fail.
