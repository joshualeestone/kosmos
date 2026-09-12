#!/usr/bin/env bash
# win-staging-verified.sh - the Windows staging gate for `promote-channel.sh --family win`.
#
# The Mac promote asks a fresh enforcing board whether the staged build works
# (staging-experience-check.sh, staging-agent-online-check.sh). A Windows build is verified on
# the Windows box instead, by hand-driven live checks (Z0-Z6, an in-app update from staging, a
# reply reaching the board). Those checks end by writing a VERIFICATION RECORD on that box. This
# gate reads the record for the exact bytes the staging pointer names, and answers with the Mac
# gates' exit contract:
#
#   0  a record on this box names the pointer's sha256 AND version, and says "pass";
#   1  the record says "fail", or it is ambiguous (unparseable, a sha or version that disagrees
#      with the pointer, no checks, no source_sha/at, a result other than pass/fail) -> refuse;
#   2  no record for this sha on this box, or the pointer cannot be read -> HOLD.
#
# 🛑 IT CAN NEVER BE FORCED. promote-channel.sh refuses --force for the Windows family, so a HOLD
# here means "verify this build on the Windows box first", never "promote anyway".
#
# THE RECORD
#   Where: <dir>/win-staging-<sha256>.json, where <dir> is
#     $KOSMOS_WIN_VERIFY_DIR                          when set (tests, or a copied record);
#     %LOCALAPPDATA%\Kosmos\release-verify            on Windows (beside the Kosmos anchor, which
#                                                     is %LOCALAPPDATA%\Kosmos);
#     $HOME/.local/state/kosmos/release-verify        elsewhere.
#   The Mac gates find their state through store.ROOT (overridable with KOSMOS_STORE_ROOT) and keep
#   no record; this is the Windows equivalent: one fixed place on the verifying box, one override.
#   One file per sha, so a record for an older build can never be read as the record for this one.
#   Shape (one JSON object):
#     {
#       "version":    "0.6.60",               the staging pointer's version
#       "sha256":     "<64 hex>",             the staging pointer's sha256 (= the file name's)
#       "source_sha": "<git sha>",            the commit the build came from
#       "checks":     [ ... ],                a non-empty list of the checks that ran
#       "at":         "2026-09-12T16:10:00Z", when the verification finished (UTC)
#       "result":     "pass" | "fail"
#     }
#   The writer is the Windows box's staging-verify script (a later slice of the updater work).
#
#   bash tools/win-staging-verified.sh <site>/dist/latest-win-staging.json
set -uo pipefail

say() { printf '%s\n' "$*"; }
POINTER="${1:-}"
[ -n "$POINTER" ] || { say "win-staging-verified: usage: win-staging-verified.sh <latest-win-staging.json> - cannot tell" >&2; exit 2; }
[ -f "$POINTER" ] || { say "win-staging-verified: no staging pointer at $POINTER - cannot tell" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { say "win-staging-verified: node is required to read the pointer and the record - cannot tell" >&2; exit 2; }

if [ -n "${KOSMOS_WIN_VERIFY_DIR:-}" ]; then
  RECORD_DIR="$KOSMOS_WIN_VERIFY_DIR"
elif [ -n "${LOCALAPPDATA:-}" ]; then
  RECORD_DIR="$LOCALAPPDATA"
  # Git Bash hands %LOCALAPPDATA% over as C:\Users\...; convert it so the path joins cleanly.
  command -v cygpath >/dev/null 2>&1 && RECORD_DIR="$(cygpath -u "$LOCALAPPDATA")"
  RECORD_DIR="$RECORD_DIR/Kosmos/release-verify"
else
  RECORD_DIR="$HOME/.local/state/kosmos/release-verify"
fi

read_pointer_field() { node -e 'try{process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]]||""))}catch{}' "$POINTER" "$1" 2>/dev/null || true; }
V="$(read_pointer_field version)"; SHA="$(read_pointer_field sha256)"
[ -n "$V" ] || { say "win-staging-verified: $POINTER names no version - cannot tell" >&2; exit 2; }
# The sha becomes part of a file name below, so it must be exactly a sha256 (64 lowercase hex).
case "$SHA" in
  *[!0-9a-f]*|'') say "win-staging-verified: $POINTER does not name a sha256 ('$SHA') - cannot tell" >&2; exit 2 ;;
esac
[ "${#SHA}" -eq 64 ] || { say "win-staging-verified: $POINTER's sha256 is ${#SHA} characters, not 64 - cannot tell" >&2; exit 2; }

RECORD="$RECORD_DIR/win-staging-$SHA.json"
if [ ! -f "$RECORD" ]; then
  say "win-staging-verified: HOLD - no verification record for $V ($SHA) on this box (looked for $RECORD). Verify the staged build on the Windows box first; its verify script writes this record." >&2
  exit 2
fi

# Validate the record exactly (node parses JSON; no sed heuristics). Node's own exit codes:
# 0 pass, 3 ambiguous, 4 fail. Anything else (a crash) is ambiguous too.
VERDICT="$(node -e '
  const [file, wantVersion, wantSha] = process.argv.slice(1);
  let record;
  try { record = JSON.parse(require("node:fs").readFileSync(file, "utf8")); }
  catch (error) { process.stdout.write("the record is unreadable (" + error.message + ")"); process.exit(3); }
  if (!record || typeof record !== "object" || Array.isArray(record)) { process.stdout.write("the record is not a JSON object"); process.exit(3); }
  const problems = [];
  if (record.sha256 !== wantSha) problems.push("its sha256 (" + record.sha256 + ") is not the pointer sha256");
  if (record.version !== wantVersion) problems.push("its version (" + record.version + ") is not the pointer version " + wantVersion);
  if (typeof record.source_sha !== "string" || !record.source_sha) problems.push("it names no source_sha");
  if (typeof record.at !== "string" || !record.at) problems.push("it names no time (at)");
  if (!Array.isArray(record.checks) || record.checks.length === 0) problems.push("it lists no checks");
  if (record.result !== "pass" && record.result !== "fail") problems.push("its result is " + JSON.stringify(record.result) + ", not pass or fail");
  if (problems.length) { process.stdout.write(problems.join("; ")); process.exit(3); }
  const summary = "verified at " + record.at + " from source " + record.source_sha + " (" + record.checks.length + " checks)";
  if (record.result === "fail") { process.stdout.write(summary + "; checks: " + JSON.stringify(record.checks).slice(0, 400)); process.exit(4); }
  process.stdout.write(summary);
' "$RECORD" "$V" "$SHA" 2>&1)"
NODE_RC=$?
case "$NODE_RC" in
  0) say "win-staging-verified: PASS - the record $RECORD says $V ($SHA) passed: $VERDICT."; exit 0 ;;
  4) say "win-staging-verified: FAIL - the record $RECORD says $V ($SHA) FAILED: $VERDICT. Refusing." >&2; exit 1 ;;
  *) say "win-staging-verified: the record $RECORD is ambiguous: $VERDICT. Refusing to treat it as a pass." >&2; exit 1 ;;
esac
