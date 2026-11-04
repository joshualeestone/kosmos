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
BASE="$SYS:/usr/bin:/bin"
mkdir -p "$TMP/empty"

# CONTROL: a login shell's PATH, the case that always worked.
fresh; o="$(run "$D" "$BASE")"; rc=$?
if [ "$rc" = 0 ] && works; then ok "CONTROL: a login shell's PATH links the system tmux"; else bad "login shell: rc=$rc $o"; fi

# The installed CLI's PATH, with the link already in place from the install before: the reported failure.
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"
o="$(run "$D" "$D/bin:$BASE")"; rc=$?
if [ "$rc" = 0 ] && works && [ "$(readlink "$D/bin/tmux")" = "$SYS/tmux" ]; then ok "with Kosmos's own folder first on PATH, the link still points at the system tmux"; else bad "own folder first: rc=$rc link=$(readlink "$D/bin/tmux") $o"; fi

# Its own folder anywhere on PATH, not only first.
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"
o="$(run "$D" "$TMP/empty:$D/bin:$SYS:/usr/bin:/bin")"; rc=$?
if [ "$rc" = 0 ] && works; then ok "with Kosmos's own folder in the middle of PATH, the same"; else bad "own folder in the middle: rc=$rc $o"; fi

# Other spellings of the same folder: the CLI and the installer do not always spell one home alike.
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"
o="$(run "$D" "$D/bin/:$BASE")"; rc=$?
if [ "$rc" = 0 ] && works; then ok "a trailing slash on the PATH element is the same folder"; else bad "trailing slash: rc=$rc $o"; fi
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"
o="$(run "$D" "$TMP/home//tmux/bin:$BASE")"; rc=$?
if [ "$rc" = 0 ] && works; then ok "a doubled slash on the PATH element is the same folder"; else bad "doubled slash: rc=$rc $o"; fi
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"; rm -f "$TMP/homelink"; ln -s "$TMP/home" "$TMP/homelink"
o="$(run "$D" "$TMP/homelink/tmux/bin:$BASE")"; rc=$?
if [ "$rc" = 0 ] && works; then ok "PATH reaching the folder through a link is the same folder"; else bad "PATH through a link: rc=$rc $o"; fi
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"
o="$(run "$TMP/homelink/tmux" "$D/bin:$BASE")"; rc=$?
if [ "$rc" = 0 ] && works; then ok "the installer reaching the folder through a link is the same folder"; else bad "dest through a link: rc=$rc $o"; fi

# A glob character in PATH stays a literal folder name.
fresh; mkdir -p "$TMP/globbed-x/bin"; printf '#!/bin/sh\necho wrong-tmux\n' > "$TMP/globbed-x/bin/tmux"; chmod 755 "$TMP/globbed-x/bin/tmux"
o="$(run "$D" "$TMP/globbed-*/bin:$BASE")"; rc=$?
if [ "$rc" = 0 ] && works; then ok "a glob character in PATH is not expanded"; else bad "glob in PATH: rc=$rc link=$(readlink "$D/bin/tmux") $o"; fi

# A link an earlier failed update left pointing at itself is not picked, so a run after this fix repairs it.
fresh; ln -s "$D/bin/tmux" "$D/bin/tmux"
o="$(run "$D" "$D/bin:$BASE")"; rc=$?
if [ "$rc" = 0 ] && works; then ok "a link an earlier update left pointing at itself is repaired"; else bad "self-link repair: rc=$rc $o"; fi

# Only the tools the function needs, so a real tmux on this machine cannot answer for these two.
TOOLS="$TMP/tools"; mkdir -p "$TOOLS"
for t in mkdir rm ln; do ln -s "$(command -v "$t")" "$TOOLS/$t"; done

# No tmux anywhere else: refused, saying what to do, and the working link it could not replace is not destroyed.
NOTMUX="$TMP/empty"
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"
o="$(run "$D" "$D/bin:$NOTMUX:$TOOLS")"; rc=$?
if [ "$rc" != 0 ] && printf '%s' "$o" | grep -q 'Kosmos needs tmux on Linux' && works; then ok "with no other tmux it refuses, says what to do, and leaves the link alone"; else bad "no other tmux: rc=$rc works=$(works && echo yes || echo no) $o"; fi

# Kosmos's folder holds the only tmux, and apt-get installs a real one: the look after it stays outside the folder too.
APT="$TMP/apt"; mkdir -p "$APT"
cat > "$APT/apt-get" <<APTEOF
#!/bin/sh
case "\$*" in *install*) printf '#!/bin/sh\necho system-tmux\n' > "$APT/tmux"; /bin/chmod 755 "$APT/tmux" ;; esac
exit 0
APTEOF
printf '#!/bin/sh\n[ "$1" = -n ] && shift\nexec "$@"\n' > "$APT/sudo"
printf '#!/bin/sh\nexit 0\n' > "$APT/true"
chmod 755 "$APT/apt-get" "$APT/sudo" "$APT/true"
fresh; ln -s "$SYS/tmux" "$D/bin/tmux"
o="$(run "$D" "$D/bin:$APT:$TOOLS")"; rc=$?
if [ "$rc" = 0 ] && [ -x "$APT/tmux" ] && works && [ "$(readlink "$D/bin/tmux")" = "$APT/tmux" ]; then ok "after apt-get installs tmux, the link points at that one"; else bad "after apt-get: rc=$rc link=$(readlink "$D/bin/tmux") $o"; fi

[ "$fails" -eq 0 ] && { echo "test-setup-linux-tmux-7981: all passed"; exit 0; }
echo "test-setup-linux-tmux-7981: $fails failed"; exit 1
