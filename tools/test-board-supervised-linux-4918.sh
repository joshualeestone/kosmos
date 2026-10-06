#!/bin/bash
# #4918: unit-test the Linux systemd supervised detection in install/kosmos.
# Verifies that on Linux (or when KOSMOS_PLATFORM=Linux):
#   1. _kosmos_board_systemd_unit derives 'kosmos-board.service' for default home
#      and hash-suffixed unit for custom home (matching engine/linuxboard.js);
#   2. _kosmos_board_supervised is true ONLY when systemctl --user cat returns
#      an ExecStart running board-run;
#   3. Old 'start' units, missing units, missing systemctl, or sandbox are NOT supervised.
set -u
cd "$(dirname "$0")/.." || exit 1
SRC="$PWD/install/kosmos"
fails=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fails=1; }

# Pull the functions and seam from install/kosmos
SNIP="$(mktemp)"
awk '/^SYSTEMCTL=/{print}
     /^_kosmos_board_systemd_unit\(\) \{/{u=1}
     u{print} u&&/^\}/{u=0}
     /^_kosmos_board_label\(\) \{/{l=1}
     l{print} l&&/^\}/{l=0}
     /^_kosmos_board_supervised\(\) \{/{s=1}
     s{print} s&&/^\}/{s=0}' "$SRC" > "$SNIP"

grep -q '^_kosmos_board_systemd_unit()' "$SNIP" && grep -q '^_kosmos_board_supervised()' "$SNIP" \
  || { echo "FAIL  could not extract the systemd functions from install/kosmos"; rm -f "$SNIP"; exit 1; }

STUBDIR="$(mktemp -d)"
cat > "$STUBDIR/systemctl" <<'SC'
#!/bin/bash
case "$*" in
  "--user is-enabled --quiet "*) [ "${KOSMOS_STUB_ENABLED:-yes}" = yes ]; exit $? ;;
esac
case "$* ${KOSMOS_STUB_CAT:-}" in
  "--user cat "*board-run)
    printf '[Unit]\nDescription=Kosmos Board\n\n[Service]\nExecStart=/bin/bash /home/user/.local/share/kosmos/bin/kosmos board-run\n'
    exit 0
    ;;
  "--user cat "*start)
    printf '[Unit]\nDescription=Kosmos Board\n\n[Service]\nExecStart=/bin/bash /home/user/.local/share/kosmos/bin/kosmos start\n'
    exit 0
    ;;
  "--user cat "*start-pathmatch)
    printf '[Unit]\nDescription=Kosmos Board\n\n[Service]\nExecStart=/bin/bash /opt/board-run/bin/kosmos start\n'
    exit 0
    ;;
  "--user cat "*absent)
    exit 1
    ;;
  *)
    exit 1
    ;;
esac
SC
chmod +x "$STUBDIR/systemctl"

export KOSMOS_PLATFORM=Linux
export KOSMOS_SYSTEMCTL="$STUBDIR/systemctl"
export KOSMOS_HOME="$HOME/.local/share/kosmos"

# shellcheck disable=SC1090
. "$SNIP"

# --- 1. Unit name derivation ---
[ "$(_kosmos_board_systemd_unit)" = "kosmos-board.service" ] \
  && ok "unit: default KOSMOS_HOME -> literal kosmos-board.service" \
  || bad "unit: default home gave '$(_kosmos_board_systemd_unit)'"

( export KOSMOS_HOME="$HOME/.local/share/kosmos/"
  [ "$(_kosmos_board_systemd_unit)" = "kosmos-board.service" ] ) \
  && ok "unit: default KOSMOS_HOME with trailing slash -> literal kosmos-board.service" \
  || bad "unit: default home with trailing slash gave '$(_kosmos_board_systemd_unit)'"

( export KOSMOS_HOME=/opt/custom/kosmos-home
  h="$(printf '%s' "$KOSMOS_HOME" | (shasum -a 256 2>/dev/null || sha256sum 2>/dev/null) | cut -c1-8)"
  exp="kosmos-board.$h.service"
  [ "$(_kosmos_board_systemd_unit)" = "$exp" ] ) \
  && ok "unit: custom KOSMOS_HOME -> hash-suffixed" \
  || bad "unit: custom home not hash-suffixed"

# Cross-check with engine/linuxboard.js boardUnitName
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -n "$NODE_BIN" ]; then
  js_unit="$("$NODE_BIN" -e 'console.log(require("./engine/linuxboard").boardUnitName("/opt/custom/kosmos-home"))')"
  bash_unit="$(KOSMOS_HOME=/opt/custom/kosmos-home _kosmos_board_systemd_unit)"
  [ "$js_unit" = "$bash_unit" ] \
    && ok "unit: install/kosmos matches engine/linuxboard.js ($bash_unit)" \
    || bad "unit: mismatch install/kosmos ($bash_unit) vs linuxboard.js ($js_unit)"
fi

# --- 2. Supervised detection ---
export KOSMOS_STUB_CAT=board-run
unset AGENT_WORKFORCE_LAUNCH 2>/dev/null || true
if _kosmos_board_supervised; then
  ok "supervised: loaded board-run unit -> yes"
else
  bad "supervised: board-run unit not detected"
fi
# #4918 review 4: the same unit, disabled, keeps nothing alive.
export KOSMOS_STUB_ENABLED=no
if _kosmos_board_supervised; then
  bad "supervised: a DISABLED board-run unit counted as supervised"
else
  ok "supervised: disabled board-run unit -> NOT supervised"
fi
unset KOSMOS_STUB_ENABLED

export KOSMOS_STUB_CAT=start
if _kosmos_board_supervised; then
  bad "recursion guard: old 'start' unit treated as supervised"
else
  ok "recursion guard: old 'start' unit -> NOT supervised"
fi

export KOSMOS_STUB_CAT=start-pathmatch
if _kosmos_board_supervised; then
  bad "path false-positive: 'board-run' in path treated as supervised"
else
  ok "path containing 'board-run' on 'start' unit -> NOT supervised"
fi

export KOSMOS_STUB_CAT=absent
if _kosmos_board_supervised; then
  bad "no unit: treated as supervised"
else
  ok "no unit loaded -> NOT supervised"
fi

export KOSMOS_STUB_CAT=board-run
export AGENT_WORKFORCE_LAUNCH=/tmp/fake-launch
if _kosmos_board_supervised; then
  bad "sandbox: treated as supervised"
else
  ok "sandbox (AGENT_WORKFORCE_LAUNCH set) -> NOT supervised"
fi
unset AGENT_WORKFORCE_LAUNCH

export KOSMOS_SYSTEMCTL="/nonexistent/systemctl"
if _kosmos_board_supervised; then
  bad "missing systemctl: treated as supervised"
else
  ok "missing systemctl -> NOT supervised"
fi

rm -rf "$STUBDIR" "$SNIP"
if [ "$fails" = 0 ]; then
  echo "ALL PASS (test-board-supervised-linux-4918)"
else
  echo "FAILURES (test-board-supervised-linux-4918)"
fi
exit "$fails"
