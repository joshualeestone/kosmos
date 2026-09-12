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
  (marker: a top-level `server.js` AND an `engine/` directory, both of which
  `stage_app` always writes). The apply swap does `mv "$DEST" "$DEST.old.$$"` then
  `rm -rf` that old tree, so a misconfigured `KOSMOS_BOARD_LIBEXEC=$HOME` (or `/usr`,
  `/Applications`) would rename that directory aside and delete it. A first adoption
  (dest absent) or an empty existing dir is safe to swap and is allowed. An unreadable
  existing dir fails CLOSED (see below). (Added by the challenge-loop after blind
  reviews independently flagged the destructive-swap gap.) RESIDUAL, accepted: a
  directory that happens to carry BOTH a top-level `server.js` and an `engine/` dir but
  is not actually a Kosmos board would still be accepted -- vanishingly unlikely for a
  misconfiguration, and requiring both markers (not `server.js` alone) already excludes
  the common case of a user's own Node project.

`validate_dest` runs in the MAIN shell (not a captured `$(...)` subshell) so that
`fail()`'s `exit 1` is terminal rather than exiting only a subshell.

## Tests

`tools/test-install-board-paths-2870.sh` drives every refusal through the dry run
(no swap, so no live board/plist/libexec is touched) with isolated `mktemp`
fixtures, PLUS one `--refresh-only` case that reaches the real destructive swap: it
asserts a non-board dest is refused with its contents left byte-for-byte intact. The
fixture SOURCE repo is a deliberately NON-git temp copy of the script (so the
repo-equality/ancestry refusals fire for the right reason rather than being masked by
the git-worktree refusal) and is made fully stageable, so the `--refresh-only` case
would genuinely destroy its fixture file if the guard were removed -- the "nothing
touched" assertion is load-bearing, not vacuous. `--refresh-only` exits right after
the swap, before any plist/launchctl, so the case stays hermetic. Wired into
`test:shell` after `tools/test-board-deploy-manifest.sh` (itself after the retained
`sh -n deploy/install-board.sh` syntax check).

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
- `validate_dest` is now on the release cut's `--refresh-only` path
  (`tools/release.sh`), which runs under `set -e`, so a refusal reds the cut. For a
  normally adopted libexec board (exists, has `server.js`, outside any checkout) it
  passes cleanly; the only new exposure is a cut box whose `$HOME` is itself a `git`
  repo, where the default dest would be refused. That is fail-closed-correct (the
  board must not run from a working tree) and low-probability, and the error names the
  way out, so it is accepted rather than special-cased.
- A destination whose LEAF is a symlink is validated on its resolved target while the
  swap's `mv` acts on the symlink itself (moving the link, not the target). This only
  ever over-refuses (safe) and is never a data-loss path, and the resolved-path checks
  are required to catch a dest that resolves INTO the repo/git-tree, so the two sites
  reasoning about different objects is accepted.
- The emptiness test uses `ls -A`, a BSD/GNU extension outside strict POSIX. macOS is
  the sole target and its `ls` supports `-A`, so it is kept as-is. It captures `ls`'s
  exit status (not only its output), so an unreadable directory (execute-only /
  root-owned) fails CLOSED rather than being misread as empty and swapped. Because
  `-A` counts dotfiles, a Finder-touched existing dir carrying only a `.DS_Store` (and
  no `server.js`+`engine/`) is treated as non-empty and refused. That only over-refuses
  in the safe direction (the error names the way out), and the swap target is normally
  created by the script itself, so it is left as-is.
- The empty-`$DEST` guard (`[ -n "$DEST" ] || fail`) cannot fire today because the
  `${KOSMOS_BOARD_LIBEXEC:-<default>}` substitution replaces both unset and empty with
  the default; it is kept as cheap defense-in-depth against a future change to how
  `$DEST` is derived.
- `_dest_real` collapses a doubled leading slash. It only arises when an ancestor
  component is a symlink to the filesystem root (so `pwd -P` yields `/` and the tail
  keeps its leading slash); left uncollapsed, a `//`-prefixed path could slip past the
  string-prefix repo checks (a false-accept). Extremely low probability, but the
  false-accept direction is the dangerous one, so it is normalized rather than deferred.
- The explicit filesystem-root refusal compares the RAW `$DEST` string, so a
  destination that is a symlink to `/` does not trip it; it is caught downstream by the
  non-empty/marker check instead (`/` has no top-level `server.js`+`engine/`), so there
  is no live false-accept. Not adding a second root check on `_dest_real` because the
  marker check is the real backstop.
- A `KOSMOS_BOARD_LIBEXEC` hand-set with a literal leading `//` is not explicitly
  rejected, but macOS collapses it and such a dest is still refused by the marker check;
  nobody hand-sets a doubled-slash env var, so this is left as-is.
- The `--refresh-only` regression test's red-capability is proven OUT OF BAND (neutering
  the marker deletes the fixture file) and documented in the test, not re-proven
  mechanically inside the suite: an in-suite proof would need a guard-disable knob in the
  production script, a worse hazard than the prose assertion for a destructive path.

## Follow-up (out of scope here)

Card items 7-8 (canonicalize configured libexec paths consistently across adoption,
release detection, and restart detection; and read deployed `package.json` paths
through argv rather than interpolating them into JS) touch the release/restart
detection SIBLING scripts, not `install-board.sh`, and are a separate change.
