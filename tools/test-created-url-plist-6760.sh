#!/bin/sh
# kosmos#6760: install/setup.sh carries AGENT_WORKFORCE_CREATED_URL into the board's launchd job (EnvironmentVariables)
# only when the installer has a plain http(s) one, the rule engine/linuxboard.js applies to a systemd unit; unset, the
# plist gets zero added bytes. The block and its two helpers are EXTRACTED from setup.sh's source and run under /bin/sh
# (setup.sh's own shell), as tools/test-board-supervised-detect-2956.sh does: a change the extraction cannot find fails.
#
#   sh tools/test-created-url-plist-6760.sh
set -u
cd "$(dirname "$0")/.." || exit 1
SRC=install/setup.sh
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/created-url-6760.XXXXXX")" || exit 1; trap 'rm -rf "$T"' EXIT

# The two helpers, verbatim from the source.
grep -E '^_xmlq\(\) ' "$SRC" > "$T/lib.sh"
sed -n '/^_env_kv() {/,/^}/p' "$SRC" >> "$T/lib.sh"
# The block: from its case line to the first esac at column 0 after it.
sed -n '/^case "\${AGENT_WORKFORCE_CREATED_URL:-}" in$/,/^esac$/p' "$SRC" > "$T/block.sh"
[ -s "$T/block.sh" ] && [ "$(grep -c '^_xmlq()' "$T/lib.sh")" = 1 ] && grep -q '^_env_kv()' "$T/lib.sh" \
  && ok "the block and both helpers were found in setup.sh" || { bad "extraction found nothing; setup.sh moved"; echo "created-url-plist-6760: $FAILS failures"; exit 1; }

# Where it sits: after _extra_env_kv is initialised, before the board plist is written (which inserts $_extra_env_kv).
l_init=$(grep -n '^_extra_env_kv=""' "$SRC" | head -1 | cut -d: -f1)
l_case=$(grep -n '^case "\${AGENT_WORKFORCE_CREATED_URL:-}" in$' "$SRC" | head -1 | cut -d: -f1)
l_plist=$(grep -n 'cat > "\$_board_plist.new" <<PLIST' "$SRC" | head -1 | cut -d: -f1)
[ -n "$l_init" ] && [ -n "$l_case" ] && [ -n "$l_plist" ] && [ "$l_init" -lt "$l_case" ] && [ "$l_case" -lt "$l_plist" ] \
  && ok "the block runs after _extra_env_kv is set and before the board plist uses it" || bad "the block is out of order ($l_init, $l_case, $l_plist)"

run() { # $1 = the value, or the word UNSET -> prints what the block adds
  /bin/sh -c '. "$1"; _extra_env_kv="";
    if [ "$2" = UNSET ]; then unset AGENT_WORKFORCE_CREATED_URL; else AGENT_WORKFORCE_CREATED_URL="$2"; fi
    . "$3"; printf "%s" "$_extra_env_kv"' sh "$T/lib.sh" "$1" "$T/block.sh"
}
[ -z "$(run UNSET)" ] && ok "unset (every real install): zero bytes added" || bad "unset added: $(run UNSET)"
want='    <key>AGENT_WORKFORCE_CREATED_URL</key><string>http://127.0.0.1:9/api/created</string>'
got="$(run http://127.0.0.1:9/api/created; printf X)"   # X keeps the trailing newline $(...) would strip
[ "$got" = "$want
X" ] && ok "a plain http address is carried as one EnvironmentVariables entry, ending in its newline (so </dict> stays on its own line)" || bad "carried wrong: [$got]"
got="$(run 'https://x.example/c?a=1&b=2')"
printf '%s' "$got" | grep -qF '<string>https://x.example/c?a=1&amp;b=2</string>' && ok "https is carried, XML-escaped" || bad "https: [$got]"
for v in 'http://x/a b' 'http://x/"' "http://x/'" 'http://x/%h' 'file:///etc/passwd' 'http://x/\' '' 'http://' 'ftp://x' "$(printf 'http://x/\001')" "$(printf 'http://x/\177')"; do
  [ -z "$(run "$v")" ] || bad "carried an unsafe value: [$v] -> [$(run "$v")]"
done
ok "unsafe values (space, quotes, %, backslash, empty, other schemes) add nothing"

echo "created-url-plist-6760: $FAILS failures"; [ "$FAILS" -eq 0 ]
