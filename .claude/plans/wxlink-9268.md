# kosmos#9268: securewrite's temp open follows a planted link on Windows (branch wxlink-9268)

## The defect

engine/securewrite.js writes a file through a fresh temp name opened with `'wx'`, and relies on that open refusing
anything already at the name, a link included. On Windows it does not: Node maps `'wx'` to CREATE_NEW, and CreateFile
follows a reparse point, so a dangling link planted at the temp name makes the open create the link's TARGET. The save
then wrote the config there. Measured on GitHub's Windows runner: engine/trust.test.js "a file planted at the temp
path the module is ABOUT to write ..." failed with "the config was written through the planted link" (run 46116329603).

## The fix

Right after the open, `refuseFollowedLink(tmp, fd)`: if the temp name is now a link, the open followed it. Close the
file, remove the file the open just made (only when it is the same device and inode as the open's, and still empty),
leave the link, and throw an EEXIST-coded error so the existing three-attempt loop takes a fresh name. `created` is
still false at that point, so the loop's cleanup never unlinks the temp name (which is the planted link).

A POSIX exclusive open refuses a link itself, so on the Mac and Linux the check costs one lstat and never fires.

## Decided, and what I rejected

- Rejected: a pre-open lstat. The plant can land between the lstat and the open (the test plants inside openSync).
- Rejected: leaving the created target in place. It is empty and ours (the exclusive open made it), and leaving it
  would leave a file where somebody else chose, which the test pins as the failure.
- Rejected: a Windows-only branch. The check is the same question on every platform; only Windows can answer yes.

## Weakest premise

That `fstat` on the open fd and `lstat` on the resolved target agree on device and inode on Windows (Node's file
index and volume serial). If they do not, the target is not removed, the config is still not written through the
link, but an empty file is left there; the Windows run of trust.test.js's arm is the check.

## Checked

- engine/securewrite.test.js new arm (stands in for the Windows open): passes with the check, fails with it off.
- securewrite, securewrite.fsync-5434 and trust tests green on the Mac.
- Windows, run 46118787881 (never-merged branch `wincl3-8378-never-merge`, with this branch merged in):
  engine/trust.test.js 51 pass, 0 fail, the planted-link arm included (it failed before this fix, run 46116329603);
  engine/securewrite.test.js: the new #9268 arm passes; 9 other arms fail there (the #1787 file-mode and #1793
  foreign-pid arms); a colleague measured 9 failing there on main too (#8378 comment 7235424591, fail=9 pass=20), so this
  branch leaves them to that cluster.
