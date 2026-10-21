#!/bin/bash
# kosmos#4491: tools/managed-sandbox-lock.sh, the root-owned lock on the token-only guard. Through its seam
# (KOSMOS_MANAGED_SETTINGS_PATH), so nothing here needs root or touches /Library. macOS only (it uses /usr/bin/plutil).
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
LOCK="$ROOT/tools/managed-sandbox-lock.sh"
fail=0
ok() { echo "ok    $1"; }
bad() { echo "FAIL  $1"; fail=1; }
if [ "$(uname -s)" != Darwin ]; then echo "skip  managed-sandbox-lock: macOS only (plutil)"; exit 0; fi
T=$(mktemp -d "${TMPDIR:-/tmp}/managed-lock-test.XXXXXX") || exit 1
trap 'rm -rf "$T"' EXIT
M="$T/ClaudeCode/managed-settings.json"
run() { OUT=$(KOSMOS_MANAGED_SETTINGS_PATH="$M" bash "$LOCK" "$@" 2>&1); RC=$?; }
get() { plutil -extract "$1" json -o - "$M" 2>/dev/null || plutil -extract "$1" raw "$M" 2>/dev/null; }   # raw: a lone true

# 1. The dry run (the default) writes nothing and shows the lock.
run
[ "$RC" = 0 ] && [ ! -e "$M" ] && case "$OUT" in *DRY\ RUN*) true ;; *) false ;; esac && case "$OUT" in *'"allowManagedReadPathsOnly":true'*) true ;; *) false ;; esac && case "$OUT" in *'Kosmos\/board.token'*) true ;; *) false ;; esac \
  && ok "the default is a dry run: it shows the lock and writes nothing" || bad "dry run: rc $RC, file $( [ -e "$M" ] && echo written || echo absent) -- $OUT"

# 2. --install on no file: the lock and nothing else (no sandbox.enabled: managed settings reach every session).
run --install
[ "$RC" = 0 ] && [ "$(get sandbox.filesystem.allowManagedReadPathsOnly)" = true ] && [ "$(get sandbox.filesystem.denyRead)" = '["~\/Library\/Application Support\/Kosmos\/board.token"]' ] \
  && ok "--install writes sandbox.filesystem: allowManagedReadPathsOnly and the board.token deny" || bad "install: rc $RC -- $OUT -- $(cat "$M" 2>/dev/null)"
plutil -extract sandbox.enabled raw "$M" >/dev/null 2>&1 && bad "it set sandbox.enabled (that would sandbox every agent on the Mac)" || ok "it does not set sandbox.enabled"
plutil -extract sandbox.allowUnsandboxedCommands raw "$M" >/dev/null 2>&1 && bad "it set allowUnsandboxedCommands" || ok "it does not set allowUnsandboxedCommands"
[ "$(stat -f %Lp "$M")" = 644 ] && ok "the file is mode 644" || bad "mode $(stat -f %Lp "$M")"
[ ! -e "$M.before-kosmos-4491" ] && ok "with no file before, nothing is kept" || bad "a keep file appeared with nothing to keep"
# 3. A second --install changes nothing (the deny is not added twice).
cp "$M" "$T/first.json"; run --install
[ "$RC" = 0 ] && cmp -s "$M" "$T/first.json" && ok "a second --install leaves the file as it was" || bad "second install changed it: $(cat "$M")"
# 4. --uninstall with nothing kept removes the file.
run --uninstall
[ "$RC" = 0 ] && [ ! -e "$M" ] && ok "--uninstall removes a file that was not there before" || bad "uninstall: rc $RC -- $OUT"

# 5. An existing managed file: every other key is kept, its own denyRead is kept, and --uninstall puts it back byte for byte.
mkdir -p "$(dirname "$M")"
printf '{"hooks":{"Stop":[]},"sandbox":{"filesystem":{"denyRead":["/etc/secret"]},"network":{"allowLocalBinding":true}}}\n' > "$M"
cp "$M" "$T/orig.json"
run --install
[ "$RC" = 0 ] && [ "$(get hooks.Stop)" = '[]' ] && [ "$(get sandbox.network.allowLocalBinding)" = true ] \
  && [ "$(get sandbox.filesystem.denyRead)" = '["\/etc\/secret","~\/Library\/Application Support\/Kosmos\/board.token"]' ] \
  && ok "an existing file keeps its other keys and its own denies; the lock is added beside them" || bad "merge: rc $RC -- $(cat "$M")"
cmp -s "$M.before-kosmos-4491" "$T/orig.json" && ok "the file that was there is kept, unchanged" || bad "the kept copy differs from the original"
run --install
cmp -s "$M.before-kosmos-4491" "$T/orig.json" && ok "a second --install does not overwrite the kept original" || bad "a second install replaced the kept original"
run --uninstall
[ "$RC" = 0 ] && cmp -s "$M" "$T/orig.json" && [ ! -e "$M.before-kosmos-4491" ] && ok "--uninstall puts the original back, byte for byte" || bad "uninstall restore: rc $RC -- $(cat "$M")"

# 6. Files it must refuse, unchanged: an empty object is fine (CONTROL), an XML plist, a sandbox that is not a block, junk.
printf '{}\n' > "$M"; run --install
[ "$RC" = 0 ] && [ "$(get sandbox.filesystem.allowManagedReadPathsOnly)" = true ] && ok "CONTROL: an empty {} file takes the lock" || bad "empty file: rc $RC -- $OUT"
rm -f "$M" "$M.before-kosmos-4491"
for c in xml notblock junk; do
  case $c in
    xml) printf '<?xml version="1.0"?>\n<plist version="1.0"><dict/></plist>\n' > "$M" ;;
    notblock) printf '{"sandbox":"off"}\n' > "$M" ;;
    junk) printf 'not json at all\n' > "$M" ;;
  esac
  cp "$M" "$T/before.$c"; run --install
  [ "$RC" != 0 ] && cmp -s "$M" "$T/before.$c" && [ ! -e "$M.before-kosmos-4491" ] && ok "refuses a $c file and leaves it as it was" || bad "$c file: rc $RC, $(cmp -s "$M" "$T/before.$c" && echo unchanged || echo CHANGED) -- $OUT"
  rm -f "$M" "$M.before-kosmos-4491"
done

# 7. Without the seam and without root, --install and --uninstall refuse before touching anything.
OUT=$(env -u KOSMOS_MANAGED_SETTINGS_PATH bash "$LOCK" --install 2>&1); RC=$?
if [ "$(id -u)" != 0 ]; then
  [ "$RC" = 2 ] && case "$OUT" in *"run it with sudo"*) true ;; *) false ;; esac && ok "--install without root refuses and says to use sudo" || bad "non-root install: rc $RC -- $OUT"
fi
OUT=$(bash "$LOCK" --bogus 2>&1); RC=$?
[ "$RC" = 2 ] && case "$OUT" in *usage*) true ;; *) false ;; esac && ok "an unknown argument prints usage" || bad "bad argument: rc $RC -- $OUT"

[ "$fail" = 0 ] && echo "managed-sandbox-lock: all passed" || echo "managed-sandbox-lock: FAILURES above"
exit "$fail"
