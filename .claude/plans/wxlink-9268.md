# kosmos#9268: securewrite's temp open follows a planted link on Windows (branch wxlink-9268)

## The defect

engine/securewrite.js writes a file through a fresh temp name opened with `'wx'`, and relies on that open refusing
anything already at the name, a link included. On Windows it does not: Node maps `'wx'` to CREATE_NEW, and CreateFile
follows a reparse point, so a dangling link planted at the temp name makes the open create the link's TARGET. The save
then wrote the config there. Measured on GitHub's Windows runner: engine/trust.test.js "a file planted at the temp
path the module is ABOUT to write ..." failed with "the config was written through the planted link" (run 46116329603).

## The fix

Right after the open, `refuseFollowedLink(tmp, fd)` asks whether the open landed somewhere other than the temp name,
and refuses only on POSITIVE evidence: the name is gone, is a link, is not a regular file, has more than one hard
link, or has a device and inode (read as bigints, readable and nonzero on both sides) that differ from the fd's.
Something that cannot be read is not evidence, so a share or FUSE mount with unusual stat answers writes as before.
Refused, the fd is closed once, the file the open made is removed when the name is still a link to it (same device
and inode, still empty), the name itself is never touched, and ERR_KOSMOS_TEMP_SWAPPED (its own code, so callers
that read ERR_KOSMOS_SYMLINK as "the config target is a link" are not misled) sends the existing three-attempt loop
to a fresh name. `created` is still false at that point, so the loop's cleanup never unlinks the name.

Accepted residue: after a swap the file the open made has no name the writer can find, so it is left where the link
pointed, empty. Nothing is ever written to it; the swap test asserts exactly that.

Review 1 found the first version asked only "is the name a link now", which a name swapped after the open defeats
(measured with a probe). Review 2 found the second version failed closed on unreadable stat answers (which would
refuse every save on such a mount) and passed a hard link to the made file; both are closed, each with a test arm.

## Decided, and what I rejected

- Rejected: a pre-open lstat. The plant can land between the lstat and the open (the test plants inside openSync).
- Rejected: leaving the created target when the name is still a link to it. It is empty and ours.
- Rejected: a Windows-only branch. The check is the same question everywhere; a POSIX exclusive open refuses a link
  itself, so there it fires only if somebody swaps the name after the open.
- Rejected: failing closed on unreadable stat answers. A refusal there would push every save on that mount to the
  in-place fallback, and an atomicOnly caller could not save at all.

## Weakest premise

That a device and inode readable and nonzero on both sides mean the same thing to fstat and lstat on every mount the
product writes to. Where they would disagree for an ordinary file, every save there is refused three times and takes
the in-place fallback (safe, not atomic). GitHub's Windows runner and this Mac agree (the ordinary-save control).

A second, of the same kind: that a fresh regular file reports one hard link. A mount that inflated the count would
have every save there refused the same way.

## Checked

- engine/securewrite.test.js #9268 arms, each with a control that removes the rule it pins: the followed link (fails
  with the check off), the name swapped after the open (fails when identities read as unknown), a second hard link
  (fails without the link-count rule), and the ordinary-save control (fails when the same-file answer is forced no).
- securewrite, securewrite.fsync-5434 and trust tests green on the Mac.
- Windows, run 46118787881 (never-merged branch `wincl3-8378-never-merge`, with this branch merged in):
  engine/trust.test.js 51 pass, 0 fail, the planted-link arm included (it failed before this fix, run 46116329603);
  engine/securewrite.test.js: the new #9268 arm passes; 9 other arms fail there (the #1787 file-mode and #1793
  foreign-pid arms); a colleague measured 9 failing there on main too (#8378 comment 7235424591, fail=9 pass=20), so this
  branch leaves them to that cluster.
- Windows, run 46119679376, after review 1: all three #9268 arms of engine/securewrite.test.js pass there (the
  followed link, the name swapped after the open, and the ordinary-save control with atomicOnly), so an ordinary
  save is not refused on Windows; trust.test.js 51 pass. The same 9 #1787 and #1793 arms as before fail, by name.
- Windows, run 46119979883, after review 2: all four #9268 arms pass (24 pass in securewrite.test.js, the hard-link
  arm among them); trust.test.js 51 pass; the same 9 #1787 and #1793 arms fail, by name.
- Review 3's mutants, each now failing an arm: the cleanup guard replaced with `true` (the re-pointed-link arm: it
  deleted somebody's file) and `refuse = gone` replaced with `false` (the removed-name arm: the secret reached where
  the link pointed). Removing the "not a regular file" rule fails no arm, on the Mac or on Windows (run 46120311980,
  a never-merged mutant build): a folder at the name has more than one link on the Mac and another inode on both,
  so the link-count or identity rule refuses it first. The
  rule stays for a mount whose identities cannot be read, where no test can reach it, and the code says so.
- Accepted residue, stated in the code: the check runs once, right after the open, so a name swapped between it and
  the rename still goes over the config. That window is the rename's own (it takes a path) and predates #9268.
- Review 5: an arm with a link followed at every attempt and atomicOnly pins the error code (fails with
  ERR_KOSMOS_SYMLINK in its place), the config left as it was, three fresh names, and each refused fd closed once
  (fails with the close removed). A second accepted residue is stated in the code: on Windows, somebody who can write
  in the config's folder can move the made file back to the temp name before the check, so it passes, and the config
  keeps the access list it was created with where the link pointed. Closing that needs the access list set or checked
  at the open, which this does not do; it is reasoned from Windows semantics, not measured.
- Review 6: the check's call is wrapped so an unexpected throw from it still closes the fd. Deferred, with reason: the
  new code reaches only atomicOnly callers, none of which branches on it, and what it reports is the safe failure
  (the config untouched).
