#!/bin/sh
# test-release-diff-summary.sh -- kosmos#615. Unit-tests tools/lib/release-diff-summary.sh
# against a synthetic git repo. The release.sh call site is best-effort and not
# cut-testable here; this proves the LIB (the summary + the bump-sha derivation) with
# controls that can return the dangerous answer.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
LIB="$HERE/tools/lib/release-diff-summary.sh"
[ -f "$LIB" ] || { echo "FAIL: cannot find $LIB" >&2; exit 1; }
# shellcheck disable=SC1090
. "$LIB"

PASS=0; FAIL=0
chk() { desc="$1"; shift; if "$@"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "FAIL: $desc" >&2; fi; }
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }
hasnt() { case "$1" in *"$2"*) return 1 ;; *) return 0 ;; esac; }

R="$(mktemp -d "${TMPDIR:-/tmp}/reldiff.XXXXXX")"
trap 'rm -rf "$R"' EXIT
git -C "$R" init -q
git -C "$R" config user.email t@t; git -C "$R" config user.name t

# --- history: a prior bump (v0605), then a release's changes, then this bump (v0606) ---
mkdir -p "$R/web" "$R/engine"
printf 'unchanged\n' > "$R/untouched.txt"          # a file present at v0605 and never changed
printf 'old\n' > "$R/web/index.html"
git -C "$R" add -A; git -C "$R" commit -q -m "v0605 -- version"
PREV_BUMP="$(git -C "$R" rev-parse HEAD)"

# a decoy: a later commit whose BODY (not subject) mentions the prior bump string,
# to prove the bump-sha lookup is anchored to the SUBJECT and a body mention cannot match.
printf 'x\n' > "$R/engine/decoy.js"
git -C "$R" add -A; git -C "$R" commit -q -m "unrelated work" -m "this body mentions v0605 -- version in prose"

# the release's real changes: a drive-by edit to web/index.html with SECRET content,
# and a new engine file -- neither carded nor mentioned in a subject.
printf 'old\nDRIVEBY_SECRET_TOKEN_abc123\n' > "$R/web/index.html"
printf 'export const x = 1;\n' > "$R/engine/newfix.js"
git -C "$R" add -A; git -C "$R" commit -q -m "page gate goes green"   # no mention of the drive-by fix
THIS="$(git -C "$R" rev-parse HEAD)"
git -C "$R" commit -q --allow-empty -m "v0606 -- version"             # this cut's bump

# ---- summary lists the changed files (the drive-by fix surfaces via its path) ----
S="$(kosmos_release_diff_summary "$R" "$PREV_BUMP" "$THIS")"
chk "summary names web/index.html (the uncarded drive-by fix surfaces via its path)" has "$S" "web/index.html"
chk "summary names the new engine/newfix.js" has "$S" "engine/newfix.js"
chk "summary names engine/decoy.js (also changed in the range)" has "$S" "engine/decoy.js"
# CONTROL: a file that did NOT change must be absent -- a summary that listed everything would 'pass' the arms above and be useless.
chk "CONTROL: an unchanged file (untouched.txt) is NOT in the summary" hasnt "$S" "untouched.txt"
# 🛑 CONTENT-LEAK GUARD: --stat is paths + counts only. The secret CONTENT of the change must never appear.
chk "GUARD: the changed CONTENT (a secret line) never leaks into the file/area-level summary" hasnt "$S" "DRIVEBY_SECRET_TOKEN"

# ---- unresolvable refs -> return 1, no output (best-effort caller must not fail a cut) ----
OUT="$(kosmos_release_diff_summary "$R" "no-such-ref-xyz" "$THIS" 2>/dev/null)"; RC=$?
chk "unresolvable from-ref returns non-zero" test "$RC" -ne 0
chk "unresolvable from-ref prints nothing" test -z "$OUT"
OUT="$(kosmos_release_diff_summary "$R" "$PREV_BUMP" "also-not-a-ref" 2>/dev/null)"; RC=$?
chk "unresolvable to-ref returns non-zero" test "$RC" -ne 0

# ---- bump-sha derivation from release.sh's own distinctive subject ----
GOT="$(kosmos_release_bump_sha "$R" "0.6.05")"
chk "bump-sha finds the v0605 bump commit" test "$GOT" = "$PREV_BUMP"
# CONTROL: the anchored subject match must NOT be fooled by the decoy commit whose BODY says 'v0605 -- version'.
DECOY_BODY_SHA="$(git -C "$R" log --grep='v0605 -- version' --format='%H' | tr '\n' ' ')"
chk "the decoy body-mention exists (so the anchoring control can actually fail)" sh -c "printf '%s' \"$DECOY_BODY_SHA\" | grep -q ' '"
chk "bump-sha ignores the body-mention decoy (anchored to the subject)" test "$GOT" = "$PREV_BUMP"
# a version with no bump commit -> return 1, nothing.
OUT="$(kosmos_release_bump_sha "$R" "9.9.99" 2>/dev/null)"; RC=$?
chk "absent version returns non-zero" test "$RC" -ne 0
chk "absent version prints nothing" test -z "$OUT"

# ---- the cap: a pathological range is bounded so the commit stays under ARG_MAX ----
BIG="$(mktemp -d "${TMPDIR:-/tmp}/reldiffbig.XXXXXX")"
git -C "$BIG" init -q; git -C "$BIG" config user.email t@t; git -C "$BIG" config user.name t
git -C "$BIG" commit -q --allow-empty -m base
BASE="$(git -C "$BIG" rev-parse HEAD)"
# 🔑 The fixture MUST exceed the ~64KB pipe buffer, or the SIGPIPE arm below is vacuous:
# a `head` cap only SIGPIPEs when `printf` is still writing after `head` closes at line 500,
# which needs the TOTAL output to overflow the buffer (a small diff fits entirely, printf
# finishes first, no SIGPIPE). So use long paths (a ~120-char dir + long filenames) and >500
# files: >500 forces head to close before the end, and long paths push total --stat output
# well past 64KB. (An earlier 600 short-named files gave only ~12KB and the arm passed on the
# buggy `head` too -- a vacuous guard, caught in review.)
BIGDIR="a-deliberately-long-directory-name-to-inflate-the-git-diff-stat-output-past-the-64kb-pipe-buffer-so-head-would-sigpipe"
mkdir -p "$BIG/$BIGDIR"
i=0; while [ "$i" -lt 700 ]; do printf 'x\n' > "$BIG/$BIGDIR/a-fairly-long-changed-file-name-number-$i.txt"; i=$((i+1)); done
git -C "$BIG" add -A; git -C "$BIG" commit -q -m "700 long-path files"
BIGTO="$(git -C "$BIG" rev-parse HEAD)"
FULL_BYTES=$(git -C "$BIG" diff --stat=1000,1000 "$BASE" "$BIGTO" | wc -c | tr -d ' ')
chk "the pathological fixture exceeds the ~64KB pipe buffer (so the SIGPIPE arm is non-vacuous)" test "$FULL_BYTES" -gt 65536
CAPPED="$(kosmos_release_diff_summary "$BIG" "$BASE" "$BIGTO")"
CAP_LINES=$(printf '%s\n' "$CAPPED" | wc -l | tr -d ' ')
chk "a 700-file range is CAPPED (<= ~502 lines, not 700+)" test "$CAP_LINES" -le 502
chk "the cap emits a truncation marker pointing at the full diff" has "$CAPPED" "truncated to keep the commit under ARG_MAX"
CAP_BYTES=$(printf '%s' "$CAPPED" | wc -c | tr -d ' ')
chk "the capped body is well under ARG_MAX (< 200 KB)" test "$CAP_BYTES" -lt 200000
# CONTROL: a small range (2 files) is NOT capped and carries no truncation marker.
SMALL="$(kosmos_release_diff_summary "$R" "$PREV_BUMP" "$THIS")"
chk "CONTROL: a small range is not truncated (no marker)" hasnt "$SMALL" "truncated to keep the commit"
# 🛑 PIPEFAIL ARM + DISCRIMINATION. release.sh runs `set -euo pipefail`; the set-u-only arms
# above cannot catch a SIGPIPE (141). Prove BOTH: (1) on THIS fixture a `head` cap actually
# SIGPIPEs under pipefail (so the guard can fail on the bug), and (2) the shipped `awk` cap
# does NOT (exit 0, marker survives). Without (1) the arm would pass on the buggy code too.
bash -c 'set -euo pipefail; printf "%s\n" "$(git -C "$1" diff --stat=1000,1000 "$2" "$3")" | head -n 500 >/dev/null' _ "$BIG" "$BASE" "$BIGTO" 2>/dev/null; HEAD_RC=$?
chk "DISCRIMINATOR: a head-based cap SIGPIPEs (non-zero) on this fixture under pipefail" test "$HEAD_RC" -ne 0
CAP_PF="$(bash -c 'set -euo pipefail; . "$1"; kosmos_release_diff_summary "$2" "$3" "$4"' _ "$LIB" "$BIG" "$BASE" "$BIGTO" 2>/dev/null)"; CAP_PF_RC=$?
chk "the shipped awk cap does NOT abort under set -euo pipefail (exit 0, not SIGPIPE 141)" test "$CAP_PF_RC" -eq 0
chk "under set -euo pipefail the truncation marker survives (not dropped by an aborted pipe)" has "$CAP_PF" "truncated to keep the commit under ARG_MAX"
rm -rf "$BIG"

echo "test-release-diff-summary: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
