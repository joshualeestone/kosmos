#!/bin/bash
# kosmos#8786: setup.sh's _kosmos_own_runtime_dir keeps an inherited XDG_RUNTIME_DIR only when it is this user's own
# folder. Measured on a Cloud box: a root login's /run/user/0, passed through `runuser -u kosmos`, made installBoard's
# `systemctl --user` fail ("Failed to connect to bus"), so the nightly timer was written and never enabled. The helper is
# lifted out of setup.sh (it cannot be sourced: it installs) and run under sh, as setup.sh is.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
fails=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fails=1; }

fn="$(awk '/^_kosmos_own_runtime_dir\(\) \{$/,/^\}$/' "$REPO/install/setup.sh")"
[ -n "$fn" ] || { echo "FAIL  premise: _kosmos_own_runtime_dir is not in setup.sh"; exit 1; }
# Every place setup.sh needs the user manager goes through it: no unset-only default is left behind.
n="$(grep -cE '^[[:space:]]+_kosmos_own_runtime_dir([[:space:]]|$)' "$REPO/install/setup.sh")"
[ "$n" -ge 3 ] && ok "setup.sh calls it at its $n systemd sites" || bad "setup.sh calls it at only $n sites"
# Any spelling of a second default: the only export of the variable in setup.sh is the helper's.
e="$(grep -c 'export XDG_RUNTIME_DIR=' "$REPO/install/setup.sh")"
[ "$e" = 1 ] && ok "the helper is setup.sh's only export of XDG_RUNTIME_DIR" || bad "setup.sh exports XDG_RUNTIME_DIR in $e places"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/test-xdg-own-8786.XXXXXX")" || { echo "FAIL  no temp dir"; exit 1; }
trap 'rm -rf "${ROOT:?}"' EXIT
OWN="$ROOT/own"; mkdir -p "$OWN"
WANT="/run/user/$(id -u)"
run() { XDG_RUNTIME_DIR="$1" sh -c "$fn"'
_kosmos_own_runtime_dir; printf "%s" "$XDG_RUNTIME_DIR"'; }
run_unset() { env -u XDG_RUNTIME_DIR sh -c "$fn"'
_kosmos_own_runtime_dir; printf "%s" "$XDG_RUNTIME_DIR"'; }

[ "$(run_unset)" = "$WANT" ] && ok "unset: this user's /run/user/<uid>" || bad "unset gave '$(run_unset)'"
[ "$(run "$OWN")" = "$OWN" ] && ok "CONTROL: this user's own folder is kept" || bad "own folder became '$(run "$OWN")'"
# Someone else's folder: / is owned by root, and this test does not run as root (refused below if it does).
if [ "$(id -u)" = 0 ]; then bad "run this test as a normal user: / is root's, so as root it is not another user's folder"
else
  [ "$(run /)" = "$WANT" ] && ok "another user's folder (as a root login's /run/user/0) is replaced" || bad "another user's folder kept: '$(run /)'"
fi
[ "$(run "$ROOT/gone")" = "$WANT" ] && ok "a folder that does not exist is replaced" || bad "a missing folder kept: '$(run "$ROOT/gone")'"

# install/kosmos's own default (#4918 review 13): the same ownership rule, lifted and run under bash. It only switches
# when this user's /run/user/<uid> exists, which is true on a Linux runner and not on a Mac (said, not passed).
cli="$(awk '/^# kosmos#8786: and one inherited/,/^fi$/' "$REPO/install/kosmos")"
[ -n "$cli" ] || bad "premise: install/kosmos's XDG_RUNTIME_DIR block was not found"
runcli() { XDG_RUNTIME_DIR="$1" KOSMOS_PLATFORM=Linux bash -c "$cli"'
printf "%s" "${XDG_RUNTIME_DIR:-}"'; }
if [ -d "$WANT" ]; then
  [ "$(runcli /)" = "$WANT" ] && ok "install/kosmos: another user's folder is replaced" || bad "install/kosmos kept '$(runcli /)'"
  [ "$(runcli "$OWN")" = "$OWN" ] && ok "install/kosmos CONTROL: its own folder is kept" || bad "install/kosmos replaced its own folder"
else
  echo "SKIP  install/kosmos cases: $WANT does not exist here (not Linux); the Linux CI shard runs them"
fi

[ "$fails" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fails"
