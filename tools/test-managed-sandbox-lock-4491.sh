#!/bin/bash
# kosmos#4491: tools/managed-sandbox-lock.sh, the root-owned lock on the token-only guard. Through its seam
# (KOSMOS_MANAGED_DIR), so nothing here needs root or touches /Library. macOS only (it uses /usr/bin/plutil).
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
LOCK="$ROOT/tools/managed-sandbox-lock.sh"
fail=0
ok() { echo "ok    $1"; }
bad() { echo "FAIL  $1"; fail=1; }
if [ "$(uname -s)" != Darwin ]; then echo "skip  managed-sandbox-lock: macOS only (plutil)"; exit 0; fi
T=$(mktemp -d "${TMPDIR:-/tmp}/managed-lock-test.XXXXXX") || exit 1
trap 'rm -rf "$T"' EXIT
D="$T/ClaudeCode"; F="$D/managed-settings.d/kosmos-token-guard.json"
WANT='{"sandbox":{"filesystem":{"denyRead":["~/Library/Application Support/Kosmos/board.token"]}}}'
run() { OUT=$(KOSMOS_MANAGED_DIR="$D" bash "$LOCK" "$@" 2>&1); RC=$?; }

# 1. The dry run (the default) writes nothing and shows the drop-in.
run
[ "$RC" = 0 ] && [ ! -e "$D" ] && case "$OUT" in *"DRY RUN"*"$WANT"*) true ;; *) false ;; esac \
  && ok "the default is a dry run: it shows the drop-in and writes nothing" || bad "dry run: rc $RC -- $OUT"

# 2. --install: the drop-in, exactly; JSON plutil reads; only the filesystem deny (nothing that reaches every session).
run --install
[ "$RC" = 0 ] && [ "$(cat "$F" 2>/dev/null)" = "$WANT" ] && ok "--install writes managed-settings.d/kosmos-token-guard.json, exactly" || bad "install: rc $RC -- $OUT"
plutil -convert json -o - "$F" >/dev/null 2>&1 && ok "the file is JSON plutil reads" || bad "the file does not parse"
for k in sandbox.enabled sandbox.allowUnsandboxedCommands sandbox.filesystem.allowManagedReadPathsOnly; do
  plutil -extract "$k" raw "$F" >/dev/null 2>&1 && bad "it sets $k (reaches every session, or drops the sandbox's own folders)" || ok "it does not set $k"
done
[ "$(stat -f %Lp "$F")" = 644 ] && ok "the file is mode 644" || bad "mode $(stat -f %Lp "$F")"
ls -A "$D/managed-settings.d" | grep -q '^\.kosmos-token-guard\.' && bad "a temp file was left behind" || ok "no temp file left behind"
# 3. Idempotent, and --uninstall removes only this file.
run --install
[ "$RC" = 0 ] && case "$OUT" in *"already in place"*) true ;; *) false ;; esac && ok "a second --install changes nothing and says so" || bad "second install: $OUT"
printf '{"env":{"A":"1"}}\n' > "$D/managed-settings.json"; printf '{"x":1}\n' > "$D/managed-settings.d/other.json"
cp "$D/managed-settings.json" "$T/base.json"
run --uninstall
[ "$RC" = 0 ] && [ ! -e "$F" ] && cmp -s "$D/managed-settings.json" "$T/base.json" && [ -f "$D/managed-settings.d/other.json" ] \
  && ok "--uninstall removes only the drop-in; the base file and other drop-ins are untouched" || bad "uninstall: rc $RC -- $OUT"
run --install
cmp -s "$D/managed-settings.json" "$T/base.json" && ok "--install never edits managed-settings.json" || bad "install changed the base file"
run --uninstall; run --uninstall
[ "$RC" = 0 ] && case "$OUT" in *"nothing to undo"*) true ;; *) false ;; esac && ok "--uninstall with nothing there says so" || bad "empty uninstall: $OUT"

# 4. A managed file that already sets sandbox.filesystem.disabled: refused (the lock would do nothing), in either place.
for where in base dropin; do
  rm -f "$F"
  case $where in
    base) printf '{"sandbox":{"filesystem":{"disabled":true}}}\n' > "$D/managed-settings.json" ;;
    dropin) printf '{"env":{"A":"1"}}\n' > "$D/managed-settings.json"; printf '{"sandbox":{"filesystem":{"disabled":true}}}\n' > "$D/managed-settings.d/zz.json" ;;
  esac
  run --install
  [ "$RC" = 1 ] && [ ! -e "$F" ] && case "$OUT" in *"disabled is true"*) true ;; *) false ;; esac && ok "refuses when the $where file sets sandbox.filesystem.disabled" || bad "disabled in $where: rc $RC -- $OUT"
  run; case "$OUT" in *"would REFUSE"*) ok "and the dry run says it would refuse ($where)" ;; *) bad "dry run did not warn ($where): $OUT" ;; esac
  rm -f "$D/managed-settings.d/zz.json"
done
printf '{"sandbox":{"filesystem":{"disabled":false}}}\n' > "$D/managed-settings.json"; run --install
[ "$RC" = 0 ] && [ -f "$F" ] && ok "CONTROL: disabled false does not block it" || bad "disabled false blocked: $OUT"
rm -f "$D/managed-settings.json"

# 5. Links are never written through: the drop-in itself, the folder.
rm -f "$F"; printf 'victim\n' > "$T/victim"; ln -s "$T/victim" "$F"
run --install
[ "$RC" = 1 ] && [ "$(cat "$T/victim")" = victim ] && [ -L "$F" ] && ok "refuses a link at the drop-in's path, and the target is untouched" || bad "link file: rc $RC -- $OUT"
run --uninstall
[ "$RC" = 1 ] && [ -L "$F" ] && ok "--uninstall refuses it too" || bad "link uninstall: rc $RC -- $OUT"
rm -f "$F"; mv "$D/managed-settings.d" "$T/realdir"; ln -s "$T/realdir" "$D/managed-settings.d"
run --install
[ "$RC" = 1 ] && [ ! -e "$T/realdir/kosmos-token-guard.json" ] && ok "refuses a linked managed-settings.d folder" || bad "link dir: rc $RC -- $OUT"

# 6. Without the seam and without root, it refuses before touching anything; a bad argument prints usage.
OUT=$(env -u KOSMOS_MANAGED_DIR bash "$LOCK" --install 2>&1); RC=$?
if [ "$(id -u)" != 0 ]; then
  [ "$RC" = 2 ] && case "$OUT" in *"run it with sudo"*) true ;; *) false ;; esac && ok "--install without root refuses and says to use sudo" || bad "non-root install: rc $RC -- $OUT"
else echo "skip  the non-root refusal (running as root)"; fi
OUT=$(bash "$LOCK" --bogus 2>&1); RC=$?
[ "$RC" = 2 ] && case "$OUT" in *usage*) true ;; *) false ;; esac && ok "an unknown argument prints usage" || bad "bad argument: rc $RC -- $OUT"

[ "$fail" = 0 ] && echo "managed-sandbox-lock: all passed" || echo "managed-sandbox-lock: FAILURES above"
exit "$fail"
