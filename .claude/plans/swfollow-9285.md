# kosmos#9285: what a #9268 refusal leads to, decided and pinned (branch swfollow-9285)

Follow-up from #9268 (PR #9289, merged), whose review stopped at the fleet's 8-round rule with two WARNINGs and three
NITs open. Built on main.

## The call on the first WARNING: three forced refusals reached the in-place fallback

Changed: when the three atomic attempts all fail and at least one was refused because its temp name was not the
opened file, the write throws ERR_KOSMOS_TEMP_SWAPPED and leaves the file as it was, for every caller. It never takes
the in-place fallback. Three failures with no such refusal fall back as before. (Review 2: "all three" was a hole: the
temp names are guessable, so a plain file planted at one name made it two of three and opened the fallback.)

Why: one such refusal is positive evidence that somebody is planting in the config's folder, and on Windows
the fallback has no O_NOFOLLOW (refuseSymlinkTarget checks the config, then opens it), so falling back hands the same
person a race at the config itself, easiest when the config does not exist yet. On no measured mount does an ordinary
save see this refusal. The cost is wider than three such refusals (review 5): ONE is enough when the other two
attempts fail for any reason, so a sync client or antivirus that moved one fresh temp, with two renames failing EPERM
(the usual reason Windows reaches the fallback), now fails that save instead of rewriting in place. The unmeasured
mounts below are where it would show.

What I first decided, and what changed my mind: the first version of this branch kept the fallback and documented it
("costs a write its atomicity, not its secrecy"). Review 1 showed that is only true when nobody races the fallback, and
that #9268's refusals let an attacker force every save into that race on purpose. For a secret, a refused save is the
smaller harm. Rejected now: keeping the fallback. Weakest premise of the new call: that no caller relies on a save
always landing; a caller that cannot tolerate a refusal already has none to fall back on with atomicOnly, and no
caller branches on ERR_KOSMOS_TEMP_SWAPPED (grep); that each caller's catch takes it is reasoned from their already
meeting ENOSPC and EACCES, not shown caller by caller.

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
- Review 2: a mixed arm (links at two names, a plain file at the third) refuses the save with no in-place open, and
  fails with the old "all three" rule; the rule runs before the atomicOnly exit, so an atomicOnly write gets the same
  code; the header, the writeSecret doc and the leftovers sentence (a planted folder is never reaped) match the code.

## Not closed, and said in the code

Review 3 measured that a plain file planted at all three temp names (each create fails EEXIST, none is a swap) still
reaches the in-place fallback, as it did before #9268. Counting EEXIST as planting would close it, and I did not:
EEXIST on every create is how this module's own tests (securewrite.fsync-5434, settingswrite, accounts, sendertoken and
others) reach the fallback on purpose, so it would change what the fallback is for every caller, which is a change of
its own with its own review, not a follow-up wording fix. The comments that claimed otherwise now say this. This is
not only an atomicity cost: the same Windows race at the config that made me refuse in the swap case applies here, so it
is carded as #9307 rather than called harmless.
- Review 4: the callers of the non-atomicOnly writers that have no catch of their own were traced for webhooks, the
  one named: every entry point catches (create, rename and remove in their server routes, touch inside itself,
  removeProject at its one caller in projects.js). The other callers' catches stay reasoned. Long lines rewrapped; the
  thrown error notes its cause may be a plain EEXIST; the reaper sentence says a later process does it.
- Review 5: the stated cost says one swapped refusal is enough when the other two attempts fail for any reason (with
  the EPERM-rename case named). The refusal keeps the first swap as its cause and the last attempt's error beside it;
  a mixed-plant atomicOnly arm pins that the rule runs before the atomicOnly exit (it fails with the order swapped).
