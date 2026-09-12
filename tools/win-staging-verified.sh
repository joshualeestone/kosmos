#!/usr/bin/env bash
# win-staging-verified.sh - the Windows staging gate for `promote-channel.sh --family win`.
#
# The Mac promote asks a fresh enforcing board whether the staged build works
# (staging-experience-check.sh, staging-agent-online-check.sh). A Windows build is verified on
# the Windows box instead (tools/win-staging-verify.js: the sha check, then the operator's
# Explorer unpack, Z0-Z6, multiline and msg checks). That run ends by writing a VERIFICATION
# RECORD on that box. This gate reads the record for the exact bytes the staging pointer names,
# and answers with the Mac gates' exit contract:
#
#   0  a record on this box names the pointer's sha256 AND version, and says "pass";
#   1  the record says "fail", or it is ambiguous (unparseable, a sha or version that disagrees
#      with the pointer, a missing or unknown check, a check marked by the wrong performer, no
#      source_sha/at, a pass whose source_sha is not a commit, a result other than pass/fail, or a
#      result its checks do not support) -> refuse;
#   2  no record for this sha on this box, or the pointer cannot be read -> HOLD.
#
# 🛑 IT CAN NEVER BE FORCED. promote-channel.sh refuses --force for the Windows family, so a HOLD
# here means "verify this build on the Windows box first", never "promote anyway".
#
# THE RECORD: its location, shape and validation are defined ONCE, in tools/lib/win-staging-record.js,
# which the writer (tools/win-staging-verify.js) also uses. In short:
#   Where: <dir>/win-staging-<sha256>.json, where <dir> is
#     $KOSMOS_WIN_VERIFY_DIR                          when set (tests, or a copied record);
#     %LOCALAPPDATA%\Kosmos\release-verify            on Windows (beside the Kosmos anchor);
#     $HOME/.local/state/kosmos/release-verify        elsewhere.
#   One file per sha, so a record for an older build can never be read as the record for this one.
#   Shape: {version, sha256, source_sha, checks: [{id, label, by, result, detail?}], at, result},
#     where every required check is listed once, `by` is automated or operator (fixed per check),
#     and `result` is "pass" only when every check passed.
#
#   bash tools/win-staging-verified.sh <site>/dist/latest-win-staging.json
set -uo pipefail

say() { printf '%s\n' "$*"; }
POINTER="${1:-}"
[ -n "$POINTER" ] || { say "win-staging-verified: usage: win-staging-verified.sh <latest-win-staging.json> - cannot tell" >&2; exit 2; }
[ -f "$POINTER" ] || { say "win-staging-verified: no staging pointer at $POINTER - cannot tell" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { say "win-staging-verified: node is required to read the pointer and the record - cannot tell" >&2; exit 2; }
RECORD_SPEC="$(cd "$(dirname "$0")" && pwd)/lib/win-staging-record.js"
[ -f "$RECORD_SPEC" ] || { say "win-staging-verified: the record spec $RECORD_SPEC is missing - cannot tell" >&2; exit 2; }

read_pointer_field() { node -e 'try{process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]]||""))}catch{}' "$POINTER" "$1" 2>/dev/null || true; }
V="$(read_pointer_field version)"; SHA="$(read_pointer_field sha256)"
[ -n "$V" ] || { say "win-staging-verified: $POINTER names no version - cannot tell" >&2; exit 2; }
# The sha becomes part of a file name below, so it must be exactly a sha256 (64 lowercase hex).
case "$SHA" in
  *[!0-9a-f]*|'') say "win-staging-verified: $POINTER does not name a sha256 ('$SHA') - cannot tell" >&2; exit 2 ;;
esac
[ "${#SHA}" -eq 64 ] || { say "win-staging-verified: $POINTER's sha256 is ${#SHA} characters, not 64 - cannot tell" >&2; exit 2; }

# The record path comes from the spec (the writer derives it from the same function).
RECORD="$(node -e 'process.stdout.write(require(process.argv[1]).recordPath(process.env, process.argv[2]))' "$RECORD_SPEC" "$SHA" 2>/dev/null)"
[ -n "$RECORD" ] || { say "win-staging-verified: could not derive the record path from $RECORD_SPEC - cannot tell" >&2; exit 2; }
# Git Bash: node answers C:\Users\...; convert it so the path is a POSIX one like the rest.
command -v cygpath >/dev/null 2>&1 && RECORD="$(cygpath -u "$RECORD")"
if [ ! -f "$RECORD" ]; then
  say "win-staging-verified: HOLD - no verification record for $V ($SHA) on this box (looked for $RECORD). Verify the staged build on the Windows box first; tools/win-staging-verify.js writes this record." >&2
  exit 2
fi

# Validate the record exactly, through the spec (node parses JSON; no sed heuristics). Node's own
# exit codes: 0 pass, 3 ambiguous, 4 fail. Anything else (a crash) is ambiguous too.
# The FIRST line node prints is the sha256 of the exact record bytes it validated (empty when the
# file could not be read), so the promote logs a hash of the record that actually decided.
VERDICT="$(node -e '
  const [specFile, file, wantVersion, wantSha] = process.argv.slice(1);
  let spec;
  try { spec = require(specFile); }
  catch (error) { process.stdout.write("\nthe record spec could not be loaded (" + error.message + ")"); process.exit(3); }
  let bytes;
  try { bytes = require("node:fs").readFileSync(file); }
  catch (error) { process.stdout.write("\nthe record is unreadable (" + error.message + ")"); process.exit(3); }
  process.stdout.write(require("node:crypto").createHash("sha256").update(bytes).digest("hex") + "\n");
  let record;
  try { record = JSON.parse(bytes.toString("utf8")); }
  catch (error) { process.stdout.write("the record is unreadable (" + error.message + ")"); process.exit(3); }
  const { problems, verdict } = spec.validateRecord(record, { version: wantVersion, sha256: wantSha });
  if (problems.length) { process.stdout.write(problems.join("; ")); process.exit(3); }
  const summary = "verified at " + record.at + " from source " + record.source_sha + " (" + record.checks.length + " checks)";
  if (verdict === "fail") { process.stdout.write(summary + "; checks: " + spec.summarizeChecks(record.checks).slice(0, 400)); process.exit(4); }
  process.stdout.write(summary);
' "$RECORD_SPEC" "$RECORD" "$V" "$SHA" 2>&1)"
NODE_RC=$?
RECORD_DIGEST="${VERDICT%%$'\n'*}"; VERDICT="${VERDICT#*$'\n'}"
case "$RECORD_DIGEST" in
  *[!0-9a-f]*|'') [ "$NODE_RC" = 0 ] && NODE_RC=3 && VERDICT="its bytes could not be hashed" ;;
esac
case "$NODE_RC" in
  0)
    # The promote logs this line (the record that decided, and a hash of its exact bytes), which is
    # the link back to the file the Windows box wrote when the record was copied to another box.
    say "win-staging-verified: record_sha256=$RECORD_DIGEST record=$RECORD"
    say "win-staging-verified: PASS - the record $RECORD says $V ($SHA) passed: $VERDICT."; exit 0 ;;
  4) say "win-staging-verified: FAIL - the record $RECORD says $V ($SHA) FAILED: $VERDICT. Refusing." >&2; exit 1 ;;
  *) say "win-staging-verified: the record $RECORD is ambiguous: $VERDICT. Refusing to treat it as a pass." >&2; exit 1 ;;
esac
