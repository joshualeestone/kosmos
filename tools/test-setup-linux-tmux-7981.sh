#!/bin/bash
# kosmos#7981: run from the installed CLI, which puts $KOSMOS_HOME/tmux/bin first on PATH (install/kosmos), the Linux
# installer found Kosmos's own tmux link, removed it and linked it to itself, then aborted with the board paused.
# Runs the real setup_linux_tmux, cut out of install/setup.sh, under the shell the installer runs in.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SETUP="$HERE/../install/setup.sh"
fails=0
ok() { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }
TMP="$(mktemp -d "${TMPDIR:-/tmp}/test-setup-linux-tmux-7981.XXXXXXXXXX")"; trap 'rm -rf "$TMP"' EXIT

awk '/^setup_linux_tmux\(\) \{/{on=1} on{print} on&&/^}/{exit}' "$SETUP" > "$TMP/fn.sh"
grep -q 'setup_linux_tmux() {' "$TMP/fn.sh" && [ "$(tail -1 "$TMP/fn.sh")" = "}" ] && ok "the function was cut out of the installer" || bad "could not cut the function out of $SETUP"

# A system tmux, somewhere else on PATH, and only the tools the shell needs from the real system.
SYS="$TMP/usr-bin"; mkdir -p "$SYS"
printf '#!/bin/sh\necho system-tmux\n' > "$SYS/tmux"; chmod 755 "$SYS/tmux"
run() {  # <dest> <PATH>: the installer's function, under sh, with that PATH
  sh -c '. "$1/fn.sh"; info() { printf "%s\n" "$*"; }; PATH="$3"; setup_linux_tmux "$2"' _ "$TMP" "$1" "$2" 2>&1
}
fresh() { rm -rf "$TMP/home"; mkdir -p "$TMP/home/tmux/bin"; D="$TMP/home/tmux"; }
works() { [ "$("$D/bin/tmux" 2>/dev/null)" = system-tmux ]; }
kept() { works && [ "$(readlink "$D/bin/tmux")" = "$SYS/tmux" ]; }
BASE="$SYS:/usr/bin:/bin"
mkdir -p "$TMP/empty"

# CONTROL: a login shell's PATH, the case that always worked.
fresh; o="$(run "$D" "$BASE")"; rc=$?
if [ "$rc" = 0 ] && kept; then ok "CONTROL: a login shell's PATH links the system tmux"; else bad "login shell: rc=$rc $o"; fi

# The installed CLI's PATH, with the link already in place from the install before: the reported failure.
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"
o="$(run "$D" "$D/bin:$BASE")"; rc=$?
if [ "$rc" = 0 ] && kept; then ok "with Kosmos's own folder first on PATH, the link still points at the system tmux"; else bad "own folder first: rc=$rc link=$(readlink "$D/bin/tmux") $o"; fi

# Its own folder anywhere on PATH, not only first.
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"
o="$(run "$D" "$TMP/empty:$D/bin:$SYS:/usr/bin:/bin")"; rc=$?
if [ "$rc" = 0 ] && kept; then ok "with Kosmos's own folder in the middle of PATH, the same"; else bad "own folder in the middle: rc=$rc $o"; fi

# Other spellings of the same folder: the CLI and the installer do not always spell one home alike.
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"
o="$(run "$D" "$D/bin/:$BASE")"; rc=$?
if [ "$rc" = 0 ] && kept; then ok "a trailing slash on the PATH element is the same file"; else bad "trailing slash: rc=$rc $o"; fi
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"; rm -f "$TMP/homelink"; ln -s "$TMP/home" "$TMP/homelink"
o="$(run "$D" "$TMP/homelink/tmux/bin:$BASE")"; rc=$?
if [ "$rc" = 0 ] && kept; then ok "PATH reaching the folder through a link is the same file"; else bad "PATH through a link: rc=$rc $o"; fi
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"
o="$(run "$TMP/homelink/tmux" "$D/bin:$BASE")"; rc=$?
if [ "$rc" = 0 ] && kept; then ok "the installer reaching the folder through a link is the same file"; else bad "dest through a link: rc=$rc $o"; fi
# One hop away: a link of the person's own pointing at Kosmos's link, earlier on PATH.
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"; mkdir -p "$TMP/hop"; rm -f "$TMP/hop/tmux"; ln -s "$D/bin/tmux" "$TMP/hop/tmux"
o="$(run "$D" "$TMP/hop:$BASE")"; rc=$?
if [ "$rc" = 0 ] && kept; then ok "a link elsewhere that points back at Kosmos's link is the same file"; else bad "one hop: rc=$rc link=$(readlink "$D/bin/tmux") $o"; fi

# A link an earlier failed update left pointing at itself is not picked, so the next run repairs it.
fresh; ln -s "$D/bin/tmux" "$D/bin/tmux"
o="$(run "$D" "$D/bin:$BASE")"; rc=$?
if [ "$rc" = 0 ] && kept; then ok "a link an earlier update left pointing at itself is repaired"; else bad "self-link repair: rc=$rc $o"; fi

# The two commonest updates: from a login shell, the link already there and the same tmux found first; and from the CLI
# when a system tmux won its picker, so that tmux's folder comes before Kosmos's own.
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"
o="$(run "$D" "$BASE")"; rc=$?
if [ "$rc" = 0 ] && kept; then ok "a login-shell update with the link already there leaves it"; else bad "login update: rc=$rc $o"; fi
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"
o="$(run "$D" "$SYS:$D/bin:/usr/bin:/bin")"; rc=$?
if [ "$rc" = 0 ] && kept; then ok "the system tmux's folder ahead of Kosmos's own leaves it too"; else bad "system folder first: rc=$rc $o"; fi

# A different live tmux found first, as on a login shell's PATH: the link moves to it, as it always has.
OLDER="$TMP/older"; mkdir -p "$OLDER"; printf '#!/bin/sh\necho older-tmux\n' > "$OLDER/tmux"; chmod 755 "$OLDER/tmux"
fresh; ln -s "$OLDER/tmux" "$D/bin/tmux"
o="$(run "$D" "$BASE")"; rc=$?
if [ "$rc" = 0 ] && kept; then ok "a different live tmux found first moves the link to it"; else bad "different tmux: rc=$rc link=$(readlink "$D/bin/tmux") $o"; fi

# A link to something gone is replaced by the tmux found.
fresh; ln -s "$TMP/empty/gone" "$D/bin/tmux"
o="$(run "$D" "$BASE")"; rc=$?
if [ "$rc" = 0 ] && kept; then ok "a dead link is replaced by the tmux found"; else bad "dead link: rc=$rc $o"; fi

# Only the tools the function needs, so a real tmux on this machine cannot answer for the rest.
TOOLS="$TMP/tools"; mkdir -p "$TOOLS"
for t in mkdir rm ln; do ln -s "$(command -v "$t")" "$TOOLS/$t"; done

# The commonest path of all: a fresh install has no bin folder yet. As the real installer runs: set -eu, in a || list.
rm -rf "$TMP/home"; D="$TMP/home/tmux"; mkdir -p "$TMP/home"
o="$(sh -c 'set -eu; . "$1/fn.sh"; info() { printf "%s\n" "$*"; }; PATH="$3"; setup_linux_tmux "$2" || exit 9; echo finished' _ "$TMP" "$D" "$SYS:$TOOLS" 2>&1)"; rc=$?
if [ "$rc" = 0 ] && kept && printf '%s' "$o" | grep -q finished; then ok "a fresh install under set -eu links the system tmux"; else bad "fresh install: rc=$rc $o"; fi

# No tmux anywhere and no link: refused, saying what to do.
NOTMUX="$TMP/empty"
fresh
o="$(run "$D" "$NOTMUX:$TOOLS")"; rc=$?
if [ "$rc" != 0 ] && printf '%s' "$o" | grep -q 'Kosmos needs tmux on Linux'; then ok "with no tmux at all it refuses and says what to do"; else bad "no tmux: rc=$rc $o"; fi

# Kosmos's own link is the only tmux on PATH, on a machine with apt-get: nothing is installed, and tmux is not swapped
# under running agents. A tmux of another version cannot read a live server.
APT="$TMP/apt"; mkdir -p "$APT"
cat > "$APT/apt-get" <<APTEOF
#!/bin/sh
: > "$TMP/apt-ran"
case "\$*" in *install*) printf '#!/bin/sh\necho system-tmux\n' > "$APT/tmux"; /bin/chmod 755 "$APT/tmux" ;; esac
exit 0
APTEOF
printf '#!/bin/sh\n[ "$1" = -n ] && shift\nexec "$@"\n' > "$APT/sudo"
printf '#!/bin/sh\nexit 0\n' > "$APT/true"
chmod 755 "$APT/apt-get" "$APT/sudo" "$APT/true"
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"; rm -f "$TMP/apt-ran"
o="$(run "$D" "$D/bin:$APT:$TOOLS")"; rc=$?
if [ "$rc" = 0 ] && kept && [ ! -e "$TMP/apt-ran" ]; then ok "with its own link the only tmux on PATH, apt-get is not run and the link stays"; else bad "own link only: rc=$rc link=$(readlink "$D/bin/tmux") apt=$([ -e "$TMP/apt-ran" ] && echo ran) $o"; fi
# CONTROL for that arm: no tmux at all with apt-get there, and apt-get does run and the link is made to what it installed.
fresh; rm -f "$TMP/apt-ran" "$APT/tmux"
o="$(run "$D" "$APT:$TOOLS")"; rc=$?
if [ "$rc" = 0 ] && [ -e "$TMP/apt-ran" ] && [ "$(readlink "$D/bin/tmux")" = "$APT/tmux" ]; then ok "CONTROL: with no tmux, apt-get runs and the link points at what it installed"; else bad "apt control: rc=$rc link=$(readlink "$D/bin/tmux") $o"; fi

[ "$fails" -eq 0 ] && { echo "test-setup-linux-tmux-7981: all passed"; exit 0; }
echo "test-setup-linux-tmux-7981: $fails failed"; exit 1
