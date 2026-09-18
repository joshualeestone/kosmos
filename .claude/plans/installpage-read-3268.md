# installpage-read-3268 - .pkg install progress page renders from a world-readable copy

Card: kosmos#3268 (non-fatal fast-follow split out of #3254; the fatal half was #3261, fixed in 0.6.78).

## Problem

On a .pkg install, the install-time progress page (installing.html, the #3233 determinate download
bar) does not show. Josh's /var/log/install.log:
```
./postinstall: sed: /tmp/PKInstallSandbox.../Scripts/.../installing.html: Permission denied
./postinstall: Kosmos: install page opened=0
```
`install/pkg-scripts/postinstall` block 1 renders the page by dropping to the console user
(`sudo -u "$CONSOLE_USER" -H /bin/sh -c '... sed "s/__KOSMOS_PORT__/$5/" "$0" > "$2" ...'`) where
`$0` = `PAGE_SRC = $(dirname "$0")/installing.html`. That source lives inside the root-owned
PKInstallSandbox Scripts dir, which the console user cannot READ, so `sed` fails, the inner `set -e`
aborts the sub-shell, and `PAGE_OPENED` stays 0. The rendered OUTPUT (`$PAGE`) goes to the
user-owned `$USER_HOME/Library/Caches/Kosmos`, which is writable; only the READ of the root-owned
source is the problem. Non-fatal (the install proceeds), but it defeats #3233's progress bar on the
.pkg path, so a ~200MB download reads as stuck rather than slow.

## Fix (reversible, minimal)

Before dropping to the console user, stage a world-readable copy of `installing.html` AS ROOT and
render from that:
```
_PAGE_READABLE="$PAGE_SRC"
_pr_tmp="$(/usr/bin/mktemp /tmp/kosmos-installing.XXXXXX 2>/dev/null || true)"
if [ -n "$_pr_tmp" ] && /bin/cp "$PAGE_SRC" "$_pr_tmp" 2>/dev/null && /bin/chmod 644 "$_pr_tmp" 2>/dev/null; then
  _PAGE_READABLE="$_pr_tmp"
fi
```
Then pass `$_PAGE_READABLE` (not `$PAGE_SRC`) as the render source, and remove the temp after.

Decisions:
- **Explicit `/tmp` path, NOT mktemp's default dir.** Under installd, `$TMPDIR` IS the root-owned
  PKInstallSandbox, so a temp created there would be unreadable too, the exact trap this fix exists
  to avoid. Rejected `mktemp -t` / bare `mktemp` for that reason.
- **Fall back to the original source on any copy failure.** No worse than today (the page just does
  not show, as before); never abort the install for a cosmetic page. Safe because the outer
  postinstall does not use `set -e`.
- **World-readable (chmod 644) is safe:** installing.html is static public content bundled in the
  .pkg; a world-readable copy leaks nothing.
- Rejected the larger refactor (render the whole page as root, do only the gui-launchd parts as the
  console user): more surface area for a cosmetic fix; the copy-stage is minimal and local.

## Test

`tools/test-install-page-readable-3268.sh` (wired into package.json test:shell after
test-postinstall-inline-quoting.sh):
- non-vacuity: the staging block exists (a silent revert fails loud);
- structural: the copy uses an explicit `/tmp/` path (guards the $TMPDIR trap); the sudo -u render's
  source arg is `$_PAGE_READABLE`, not `$PAGE_SRC`;
- behavioural (no root needed): a mode-600 fixture (stand-in for the unreadable root-owned source)
  is turned into a world-readable, byte-identical copy.
Red-capability proven: reverting postinstall to origin/main makes the test fail
("no readable-copy staging block", exit 1).

## Scope

`install/pkg-scripts/postinstall` (block 1 only), `tools/test-install-page-readable-3268.sh` (new),
`package.json` (wire the test). No behaviour change to the real install path, the port guard, or the
setup.sh exec. The sh -n and #3261 inline-quoting guard still pass (the change is outside the -c
blocks).
