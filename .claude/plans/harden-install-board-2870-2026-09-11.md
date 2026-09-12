# #2870: Harden deploy/install-board.sh destination path handling

## Context

`deploy/install-board.sh` installs the board app tree to a location OUTSIDE the git
checkout (so the board stops serving straight out of a working tree, the #1051 bug)
and SWAPS the destination: it moves `$DEST` aside to `$DEST.old.$$` and moves a
freshly staged tree into place, then optionally repoints the launchd job. The #1164
blind challenge loop found hardening opportunities in the destination handling that
were deliberately cut from that PR to keep it on its committed plan; this is that
follow-up.

Note: the maintenance-refresh half of the card (`--refresh-only`, separating first
adoption from a release-owned refresh) already landed on main via the #1164 work, so
this focuses on the path-safety half.

## The change

Add a `validate_dest` function that refuses a destination unsafe to swap into,
BEFORE anything is copied or moved, and in dry run too so the refusal is visible
before `--apply`:

- reject an empty or relative destination (a relative dest makes the `.new`/`.old`
  swap siblings resolve against an unknown cwd);
- reject a `.` or `..` path component (normalizing them would require the path to
  exist; refusing is unambiguous and a real destination never carries them);
- normalize trailing slashes so `/foo/` and `/foo` derive the same swap sibling;
- reject the filesystem root explicitly (`mv / /.old.$$` is catastrophic);
- walk up to the nearest EXISTING ancestor (the dest and its parent may not exist on
  a first adoption) and fail closed if it is a file or unresolvable;
- canonicalize that ancestor with `cd` + `pwd -P` and re-append the not-yet-created
  tail, so symlink aliases cannot slip past the string comparisons;
- reject a destination that already EXISTS but is not a directory (the swap cannot
  sensibly replace a plain file);
- reject a destination inside a git working tree (installing into a checkout is the
  exact #1051 hazard this script prevents);
- reject a destination equal to, inside, or above the source repo (equal/above means
  the swap would move the source out from under us; inside means the board would serve
  from the checkout again);
- reject an existing NON-EMPTY directory that is not itself a prior board install
  (no `server.js` marker). The apply swap does `mv "$DEST" "$DEST.old.$$"` then
  `rm -rf` that old tree, so a misconfigured `KOSMOS_BOARD_LIBEXEC=$HOME` (or `/usr`,
  `/Applications`) would rename that directory aside and delete it. A first adoption
  (dest absent) or an empty existing dir is safe to swap and is allowed. (Added by the
  challenge-loop after two blind reviews independently flagged the destructive-swap gap.)

`validate_dest` runs in the MAIN shell (not a captured `$(...)` subshell) so that
`fail()`'s `exit 1` is terminal rather than exiting only a subshell.

## Tests

`tools/test-install-board-paths-2870.sh` drives every refusal through the dry run
(no `--apply`, so no live board/plist/libexec is touched) with isolated `mktemp`
fixtures. The fixture SOURCE repo is a deliberately NON-git temp copy of the script,
so the repo-equality/ancestry refusals fire for the right reason rather than being
masked by the git-worktree refusal. Wired into `test:shell` after the retained
`sh -n deploy/install-board.sh` syntax check.

## Deliberate calls

- The git-working-tree refusal is broad by design: it refuses any destination inside
  a working tree even if the dest itself would be gitignored. That is the point (the
  script's stated purpose is to install somewhere that is NOT a working tree). A user
  whose `$HOME` is a non-bare `git init` repo would have the default dest refused; the
  error names the way out (set `KOSMOS_BOARD_LIBEXEC` outside any working tree).
- Interior double slashes (`/foo//bar`) are left as-is: `mv` and the `case`
  comparisons treat them correctly, so this is cosmetic only.
- The repo comparisons are byte-exact/case-sensitive. A case-only collision is
  unreachable: the differing component would have to live in the not-yet-existing
  tail, which by definition cannot collide with the already-existing repo.

## Follow-up (out of scope here)

Card items 7-8 (canonicalize configured libexec paths consistently across adoption,
release detection, and restart detection; and read deployed `package.json` paths
through argv rather than interpolating them into JS) touch the release/restart
detection SIBLING scripts, not `install-board.sh`, and are a separate change.
