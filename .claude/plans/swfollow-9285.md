# kosmos#9285: what a #9268 refusal leads to, decided and pinned (branch swfollow-9285)

Follow-up from #9268 (PR #9289, merged), whose review stopped at the fleet's 8-round rule with two WARNINGs and three
NITs open. One commit on main.

## The call on the first WARNING: three forced refusals reached the in-place fallback

Changed: when all three atomic attempts are refused because the temp name was not the opened file
(ERR_KOSMOS_TEMP_SWAPPED), the write throws that error and leaves the file as it was, for every caller. It never takes
the in-place fallback. Any other mix of atomic failures falls back as before.

Why: three such refusals are positive evidence that somebody is planting links in the config's folder, and on Windows
the fallback has no O_NOFOLLOW (refuseSymlinkTarget checks the config, then opens it), so falling back hands the same
person a race at the config itself, easiest when the config does not exist yet. An ordinary save never sees this
refusal, so the cost is a failed save while somebody is tampering.

What I first decided, and what changed my mind: the first version of this branch kept the fallback and documented it
("costs a write its atomicity, not its secrecy"). Review 1 showed that is only true when nobody races the fallback, and
that #9268's refusals let an attacker force every save into that race on purpose. For a secret, a refused save is the
smaller harm. Rejected now: keeping the fallback. Weakest premise of the new call: that no caller relies on a save
always landing; a caller that cannot tolerate a refusal already has none to fall back on with atomicOnly, and no
caller branches on ERR_KOSMOS_TEMP_SWAPPED (grep).

A new arm pins it: three followed links, no atomicOnly; the save throws ERR_KOSMOS_TEMP_SWAPPED, the in-place open is
never made, the config keeps its old bytes, and no planted target holds the secret. It fails with the new rule removed.

## The second WARNING: unmeasured mounts

Not settled here, and still open on #9285. The same-file rules are measured on the Mac, GitHub's Windows runner and a
Linux container on overlay; network shares, FUSE and OneDrive-style folders are not. No machine here has one.

## The NITs

- The doc block's long sentence is rewrapped, and what a refusal leaves is said with each leftover's lifetime: what
  was planted at the temp name stays until the reaper takes it after this writer ends; the made file left where a link
  pointed carries no temp name, so nothing reaps it.
- The hard-link and folder arms assert the planted name is left as it was.
- The comment that calls the fallback "essentially unreachable" now says the one thing that refuses every fresh name
  never falls back.

## Checked

- engine/securewrite.test.js and engine/trust.test.js on the Mac: 92 pass, 0 fail; the new arm fails with the rule
  removed.
