# kosmos#9268: securewrite's temp open follows a planted link on Windows (branch wxlink-9268)

## The defect

engine/securewrite.js writes a file through a fresh temp name opened with `'wx'`, and relies on that open refusing
anything already at the name, a link included. On Windows it does not: Node maps `'wx'` to CREATE_NEW, and CreateFile
follows a reparse point, so a dangling link planted at the temp name makes the open create the link's TARGET. The save
then wrote the config there. Measured on GitHub's Windows runner: engine/trust.test.js "a file planted at the temp
path the module is ABOUT to write ..." failed with "the config was written through the planted link" (run 46116329603).

## The fix

Right after the open, `refuseFollowedLink(tmp, fd)` asks whether the temp name is still the file the open made: a
regular file with the same device and inode as the fd (both read as bigints, so a large Windows file index is exact).
If not, the write refuses that name: it closes the fd, removes the file the open made when the name is still a link
to it (same device and inode, still empty), never touches the name itself, and throws ERR_KOSMOS_SYMLINK (the code
refuseSymlinkTarget raises) so the existing three-attempt loop takes a fresh name. `created` is still false at that
point, so the loop's cleanup never unlinks the name, which may be the planted link.

Review 1 found the first version asked only "is the name a link now", which a name swapped after the open defeats
(measured with a probe: the link removed, or replaced by another file, and the secret went to the link's target).
The same-file question closes both; a test arm now swaps the name after the open and fails on the first version.

A POSIX exclusive open refuses a link itself, so there the name is the opened file unless someone swaps it after the
open, and then the write moves to a fresh name as on Windows.

## Decided, and what I rejected

- Rejected: a pre-open lstat. The plant can land between the lstat and the open (the test plants inside openSync).
- Rejected: leaving the created target in place. It is empty and ours (the exclusive open made it), and leaving it
  would leave a file where somebody else chose, which the test pins as the failure.
- Rejected: a Windows-only branch. The check is the same question on every platform.
- It fails closed: a name or fd that cannot be read is refused, and three refusals reach the existing in-place
  fallback, which checks the target file itself (refuseSymlinkTarget).

## Weakest premise

That `fstat` on the open fd and `lstat` on the temp name agree on device and inode on Windows for an ordinary file.
If they do not, every write there is refused three times and takes the in-place fallback, which is safe but not
atomic. The first Windows run showed fstat and lstat agree on the link's target (the cleanup removed it); the run
after review 1 checks the ordinary write.

## Checked

- engine/securewrite.test.js new arm (stands in for the Windows open): passes with the check, fails with it off.
- securewrite, securewrite.fsync-5434 and trust tests green on the Mac.
- Windows, run 46118787881 (never-merged branch `wincl3-8378-never-merge`, with this branch merged in):
  engine/trust.test.js 51 pass, 0 fail, the planted-link arm included (it failed before this fix, run 46116329603);
  engine/securewrite.test.js: the new #9268 arm passes; 9 other arms fail there (the #1787 file-mode and #1793
  foreign-pid arms); a colleague measured 9 failing there on main too (#8378 comment 7235424591, fail=9 pass=20), so this
  branch leaves them to that cluster.
