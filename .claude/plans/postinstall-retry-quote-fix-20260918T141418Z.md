# postinstall-retry-quote-fix -- 0.6.77 .pkg installer P0: empty-pattern '' vanishes inside the inline /bin/sh -c block

Addresses #3261. P0: the 0.6.77 macOS .pkg installer aborts on a fresh Mac
(surfaced as "installed for another user" + "sits on the install screen"; Mona's
install.log carries the exact "syntax error near |").

## The bug

`install/pkg-scripts/postinstall` runs the real installer inside the console
user's GUI launchd session via a single-quoted inline argument:
`/usr/bin/sudo ... /bin/sh -c '<multi-line body>' "$SETUP_URL" "$PAGE_OPENED"`.

Inside that body, the bounded-retry hardening (#3115, the #1670 retry, 2026-09-15)
sanitises two env-driven numbers:

```
case "$_rmax"   in ''|*[!0-9]*) _rmax=5;; esac
case "$_rsleep" in ''|*[!0-9]*) _rsleep=3;; esac
```

The empty-string pattern `''` is INSIDE the outer single-quoted `-c` argument, so
the OUTER shell reads each `''` as close-quote + open-quote and it VANISHES from
the string the inner `sh` receives, leaving `case "$_rmax" in |*[!0-9]*)` =
"syntax error near |". The inner script fails to parse, setup.sh never runs, and
the install aborts.

Why it was missed: `sh -n install/pkg-scripts/postinstall` on the FILE sees `''`
as balanced literals and passes. The defect only exists in the string the shell
BUILDS for `-c` at install time.

## The fix

`''` -> `""` on both lines. A double-quote pair is literal inside the outer
single quotes (it does not toggle the outer quoting), passes through to the inner
`sh` intact, and matches the empty string in `case` identically. Reproduced (the
`''` form fails with the exact "syntax error near |"; the `""` form parses) and
verified. The `''` at postinstall:99 is top-level file code (run by postinstall's
own interpreter, not an inline `-c` arg) and is correctly left unchanged; every
other `''` empty-pattern in the tree (setup.sh, install/kosmos) is a standalone
file, also correct.

## The guard: tools/test-postinstall-inline-quoting.sh (wired into test:shell)

The file-level `sh -n` cannot see this class, so a new guard reconstructs the
string the shell builds for each inline `/bin/sh -c` block (single quotes are
delimiters, so the inner string is the block with its single quotes removed) and
runs `/bin/sh -n` THROUGH that. It covers BOTH inline blocks (the same-line-open
form at postinstall:111 and the backslash-continuation form at :158), with three
anti-vacuity checks: an independent open-count oracle (`n -eq opens`, catches a
dropped block), a positive coverage anchor (the two guarded `case` lines must sit
inside a reconstructed+checked block, catches a too-early close), and a documented
scope boundary. Red-capable: reintroducing `''` in either block fails loud.

## Scope

Three files only: `install/pkg-scripts/postinstall` (the 2-char fix + an
apostrophe-free explanatory comment at the fix site), `tools/test-postinstall-inline-quoting.sh`
(new guard), and `package.json` (test:shell wiring). Rides the next .pkg cut.

The block-1 sed-perm (installing.html read as the console user; non-fatal,
progress page absent) is a SEPARATE follow-up noted on the card, not this PR.

## Verification

- `bash tools/test-postinstall-inline-quoting.sh` -> both blocks parse; red-capable
  (injected `''` in either block fails).
- `bash tools/test-resolve-install-user.sh` and full `yarn test` (incl. `test:shell`) green.
- No em dashes.
