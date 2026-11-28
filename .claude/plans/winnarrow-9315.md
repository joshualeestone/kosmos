# winnarrow-9315: four Windows test skips narrowed or made exact (kosmos#9315, follow-up to #8378 cluster 1)

## Items
1. engine/automove-7548.test.js "kosmos#7621 item 2" was skipped whole on Windows, but only its second block (a chmod
   0o555 folder) needs the lock. The written-person-line half now runs everywhere; the chmod block is guarded.
2. The other chmod-lock skips IN CLUSTER 1's FILES (the card's list), read by BODY: a script listed each skipped test,
   the line of its first chmodSync lock, and the assertions before it. Read: chat x2, commitments, communityretire-4994
   x9, autobalance-sweep-7152 x2, communityavatar, usage-world-5532 x3, and automove-7548's own three others (641, 668,
   881). Every assertion before a lock is a CONTROL or setup for the lock's own subject (881's `calls.starts.length` is
   the moved agent the locked part is about); none has a subject of its own, so none is a mixed arm. No change.
   NOT read: the same reason in other clusters' files (backuptick, communityswitch, register, and the server.* files
   that use it); those are other clusters' and other owners'.
3. engine/anthropiccompat-7206.test.js launch-env: off macOS the arm now PINS the refusal (exit 2, the "so this agent
   was not started on it" sentence, no NAME=VALUE pairs, no key) instead of skipping. Its NO_LAUNCH_ENV skip is gone.
4. engine/allowance.test.js: the one NO_SETUP_SH reason ("setup.sh never runs on Windows") was false for this file,
   whose other setup.sh arms run there. Split into two exact reasons: NO_SETUP_SH_BAKE (the command setup.sh bakes for
   the Mac and Linux bundle's runtime/bin/node) and NO_SETUP_SH_RUN (a block of setup.sh's uninstaller run under sh).
tools/windows-tests.js carries each file's reasons verbatim (engine/windows-tests-1777.test.js checks it).

## Measured on windows-latest
- Run 46169273371 (an experiment on the never-merge branch only: both allowance setup.sh arms unskipped): the bake
  arm's hooks and status line pass on Windows, and only the baked-node check fails (allowance.ensureStatusLine writes
  the winCommandFor form there, kosmos#6213). The uninstall arm did not name the default account under Git Bash; that
  cause is not traced, and the skip stands on Windows uninstalling through its own installer.
- Run 46169422391 (the change itself): allowance 33 pass 1 skip, anthropiccompat 22 pass 1 skip (the pinned refusal
  arm ran and passed there), automove 61 pass 4 skip.

## Review rounds 1-2
- automove item 2 split in two: the written half asserts personMoved returned true (a waiting line can no longer pass
  it) and runs everywhere; the waiting half is its own test with a visible skip.
- allowance's bake arm: the host-specific check is a SUBTEST with its own skip, so the skip shows in node:test's count
  (an early return had hidden it). The entry's count reads "one arm and two assertions".
- anthropiccompat: the whole refusal sentence is pinned (it proves the vendor was named, not "That provider").

## Weakest premise
Item 2 judges a pre-lock assertion as a CONTROL by reading it; a CONTROL that also checks something independent would
be missed. Items 1 and 3 were proven on windows-latest (above); Linux was not run (linux.yml is not a live gate on main).
