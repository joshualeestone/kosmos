# bksink-5536: E0.7 (#5536) step 3, the restore sink

Builds on engine/backuprestore.js (PR #5572, merged 10-08 as 336360560).

`engine/restoresink.js`, `createRestoreSink(root)`: the folder sink `restoreSnapshot` writes through, meeting the duties backuprestore.js states for any sink and that the bkrestore plan made REQUIRED before restore is wired to anything:

1. **Fresh root:** absolute, a real directory (lstat, not a symlink), empty. Otherwise it throws.
2. **Never at the final path before commit:** bytes go to a temp file in a random-named folder inside the root (same filesystem, so link works); begin() refuses that folder's name; close() removes it.
3. **Atomic, no-replace publish:** `link()` into the final name fails with EEXIST when anything holds it, so nothing is ever overwritten, including a case variant on a case-insensitive volume. Stronger than comparing file identities: there is no overwrite to compare.
4. **No escape through a symlink:** folders are made only at commit, one at a time, and each is refused if lstat shows a symlink or a file there, before the next is made in it. The check and the link are separate steps, so a process writing into the root during the restore could still race them (see the weakest premise).
5. **Unicode on Windows:** Node uses the wide APIs on every platform; the test pins a fullwidth `．．` name staying literal. The test file is added to `tools/windows-tests.js` ALSO, so CI's Windows runner will measure link on NTFS, junction refusal, the profile rule and Unicode names; no Windows run of it is green yet.
6. **Private by default:** files 0600, folders 0700 (a manifest carries no modes; this is someone's work). Checked where POSIX modes exist.

An abort removes its temp file at once, not only at close.

Tests (13: 9 everywhere, 1 POSIX only, 1 Windows only, 2 macOS only), each refusal with a control; every guard mutation-checked red, including the abort cleanup that close() would otherwise mask. The end-to-end test runs restoreSnapshot through the real sink: byte for byte on disk, and a bad file leaves no half file and no temp folder.

Weakest premise: the lstat check on each folder and the mkdir/link that follow are separate steps, so a process that can write into the restore root during the restore can still race them. The sink limits who that can be (a POSIX root other users cannot write in; on Windows a root inside the user's own profile) and does not claim more.

Not done here: the restore engine that calls this (needs E0.1/E0.2 keys and grants), and a real Windows run on a Kosmos install (CI's Windows runner is a server image run as admin).

Review round 1 (opus): parent folders were made all at once and checked after, so a symlink on an early segment let later folders be made outside the root (measured; now each folder is made and checked one at a time, at commit); link() needs a volume with hard links (exFAT, FAT32, some shares fail every file; now probed when the sink is made, with a clear error); begin made folders before any byte verified and abort never removed them (now folders are made only at commit, and a failed commit removes the folders it made). Also: the temp-folder name is refused case-insensitively, the folder is fsynced after link (not on Windows), a commit whose temp cleanup fails still counts, and the header says the sink assumes pathProblem ran and what a crash leaves.

Review round 2 (sonnet): a folder fsync refused by the filesystem after link() failed a commit whose file was already published (now best effort, and the temp link is still removed); the header claimed more about symlinks than the check-then-link order gives (now narrowed, race named); symlink tests skip with a reason on a Windows account that cannot make them. Also: a write that makes no progress fails instead of spinning. (Round 3 removed the realpath check, so the Windows realpath question no longer applies.)

Review round 3 (opus): a trailing separator on a symlinked root got past the lstat check (now the root is resolved first); the per-folder realpath comparison could never decide anything once lstat refuses symlinks (removed, rather than claimed); plan item 4 still described begin-time checks (rewritten). Also: a file where a folder goes has its own message, the no-hard-links wording only follows a failed link, begin backstops ':' control characters and trailing dots or spaces, and the header names the Windows, fsync and open-handle limits.

Review round 4 (sonnet): the engine.reachable excuse still named the realpath checks (corrected); the fresh-root premise was only documented (now a root group or others can write in is refused, POSIX); the sink's narrower path backstop is now stated as use-only-through-restoreSnapshot; close() throwing on an open Windows handle is in the contract. Not measured everywhere: the case-variant collision refusal is asserted only on case-insensitive volumes (macOS, Windows); on a case-sensitive one the two names are two files, and the test accepts that.

Review round 5 (opus): on Windows the owner-only check was skipped, and a folder made at C:\ lets other users swap in a junction (now a Windows root must be inside the user's profile); junctions, the unprivileged Windows link, were never tested (directory links in the tests are now junctions, so no skip is needed); the mode check refused group-writable roots and preceded the hard-link probe (now only other-writable is refused, after the probe). Also: the caller creates the root (a picked folder may hold .DS_Store), long-name failures are pinned, control sinks are closed, and the plan's weakest premise describes lstat, not realpath.

Review round 6 (sonnet): one test link was still an untyped symlink (now a junction, like the rest); the comment and the excuse said owner-only while the check refuses only other-writable (wording narrowed to match the deliberate group allowance). Also: the Windows '..' test is exact, probe cleanup no longer reads as no hard links, folders at 0700 are pinned, and the header says +x is not kept and the backstop applies everywhere.

Review round 7 (opus): BLOCKER, mine: the Windows profile check used the JS realpath, which does not expand 8.3 short names, so on the runner (TEMP under RUNNER~1, home runneradmin) every test would have been refused (now realpathSync.native, plus a Windows-only test with a short-name control and an outside-the-profile refusal). Also: group write is no longer trusted (macOS's shared staff group); the root is made 0700 once it passes. The parent-must-be-private premise and Windows device names are stated.

Review round 8 (sonnet): nothing checked the root was the person's own (now a POSIX owner check runs before anything is made in it); a chmod failure left the temp folder behind (now cleaned up, with its own message). Deferred, deliberate: the temp folder and probe come before the other-writable check so a drive without hard links reports that reason; the owner check and the 0700 chmod close the window that leaves.

Review round 9 (opus): round 8's note that the owner check and chmod close the window was wrong (measured: a folder planted at 0777 before the chmod survived and was written into). Now the root is trusted before anything is written: other-writable refused, made 0700, then checked empty again; the probe uses exclusive create; an existing folder owned by another user refuses. Also close() retries Windows holds (the codes test-support/remove-tree.js retries), and the no-temp-link test checks before close.

Review round 10 (sonnet): on a Windows box whose TEMP is outside the profile every test would have failed for that reason alone (now the test helper makes roots in the profile there); the header now says a same-user process is not defended against. A round-8 test assertion was vacuous once the chmod moved before the temp folder (reworded to what it checks).

Review round 11 (opus): a macOS ACL on the root survived chmod 0700 (measured; now stripped with chmod -N and confirmed gone, macOS only); the root was lstat'ed by path and only then resolved, and the parent-must-be-private premise was stated, not checked (now the resolved root must be the same dev/ino, and a parent others can write in without the sticky bit refuses). Also: probe cleanup uses the same retrying remove as close().

Review round 12 (sonnet): only the immediate parent was checked, and only for other-write (now every ancestor up to / must be owned by the user or root and not group- or other-writable unless sticky); the probe cleanup could leave the temp folder (now removed on failure). Also: Linux ACLs are named as not read, and a broken comment is rewritten.

Review round 13 (opus): the ancestor walk refused every group-writable folder, which on a stock Linux desktop (user-private groups, umask 002) refused ordinary roots (now group write is allowed when the folder is the user's and its group is the user's private group per /etc/group; macOS staff is still refused). Also: ancestor ACLs named as not read, dev/ino compared as bigint (NTFS ids exceed 2^53), comment tidied.

Review round 14 (sonnet): three limits now stated in the header for whoever wires restore: the sink is synchronous (run the restore in a worker or child process), Windows roots outside the profile are refused (the folder picker must offer one inside it), and a shared group-writable ancestor or an exFAT mount refuses with a message that names both causes. Also (POSIX) on the modes, macOS fsync durability, and a test comment.

For the restore engine slice (product limits to carry into the UI): Windows restore folder must be inside the user's profile; a restore root must be a fresh, empty folder the engine creates itself (a picked folder may already hold .DS_Store).

Review round 15 (opus): two Windows-only flake risks in the temp-empty assertions (now polled briefly on Windows); deferred, documented: on Linux a folder above the root in the user's private group carrying an ACL for another user passes the private-group exemption (Node cannot read Linux ACLs without an outside tool, and only a user who granted that ACL is exposed; named in the header). Also: the root-ACL sentence narrowed to the real gap, and the ancestor refusal split into owner versus write.

Review round 16 (sonnet): the temp folder's NTFS short name (KOSMOS~1) passed the sink's backstop (now short-name shapes are refused, as pathProblem already does upstream); a second commit threw a TypeError (now a clear refusal). Deferred: splitting the long first test into several. Each arm asserts its own distinct message and every stub is restored in finally, so a failure already names its guard; a mechanical split mid-loop risks more than it buys.

Review round 17 (opus): the group-write refusal arm depended on the host's groups and would red on a Linux box with user-private groups (now /etc/group is stubbed to a shared group there). Also: isPrivateGroup's comment says only /etc/group is read, the header says a refused probe leaves the root 0700, and write() after a finish refuses clearly.

Review round 18 (sonnet): a chmod -N failure (a share without ACL support) gave a message naming the wrong cause (now the tool's status and output, and a folder on the Mac's own disk is suggested); SHORT_NAME_RE was a second copy of backuprestore.js's (now exported there and required here); the temp-prefix comment oversold the prefix rule (now says the random name is the protection and why the prefix matters at all).
